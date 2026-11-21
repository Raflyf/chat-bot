#![cfg_attr(not(test), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const CONTROL_ADDR: &str = "127.0.0.1:47831";
const POLL_INTERVAL_SECS: u64 = 30;
const MAX_LOG_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VpsAvailability {
    Running,
    Down,
    Transient,
    Unknown,
}

impl VpsAvailability {
    fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Down => "down",
            Self::Transient => "transient",
            Self::Unknown => "unknown",
        }
    }
}

struct SharedState {
    vps_availability: VpsAvailability,
    raw_state: String,
    last_check_epoch: u64,
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn append_log(project_root: &Path, message: &str) {
    let logs_dir = project_root.join("logs");
    let _ = fs::create_dir_all(&logs_dir);
    let log_path = logs_dir.join("wa-standby-watchdog.log");

    if let Ok(meta) = fs::metadata(&log_path) {
        if meta.len() > MAX_LOG_BYTES {
            if let Ok(mut content) = fs::read_to_string(&log_path) {
                let keep_from = content.len().saturating_sub((MAX_LOG_BYTES / 2) as usize);
                content = content.split_off(keep_from);
                let _ = fs::write(&log_path, content);
            }
        }
    }

    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let ts = now_epoch_secs();
        let _ = writeln!(f, "[ts={ts}] {message}");
    }
}

fn locate_project_root() -> Option<PathBuf> {
    if let Ok(exe) = env::current_exe() {
        let mut cur = exe.parent();
        while let Some(dir) = cur {
            if dir.join("package.json").is_file() && dir.join(".env").is_file() {
                return Some(dir.to_path_buf());
            }
            cur = dir.parent();
        }
    }
    if let Ok(cwd) = env::current_dir() {
        let mut cur: Option<&Path> = Some(&cwd);
        while let Some(dir) = cur {
            if dir.join("package.json").is_file() && dir.join(".env").is_file() {
                return Some(dir.to_path_buf());
            }
            cur = dir.parent();
        }
    }
    None
}

fn parse_env_content(raw: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(eq_idx) = trimmed.find('=') {
            let key = trimmed[..eq_idx].trim();
            if key.is_empty() {
                continue;
            }
            let mut val = trimmed[eq_idx + 1..].trim();
            if (val.starts_with('"') && val.ends_with('"') && val.len() >= 2)
                || (val.starts_with('\'') && val.ends_with('\'') && val.len() >= 2)
            {
                val = &val[1..val.len() - 1];
            }
            map.insert(key.to_string(), val.trim().to_string());
        }
    }
    map
}

fn load_env_file(project_root: &Path) -> HashMap<String, String> {
    let env_path = project_root.join(".env");
    match fs::read_to_string(env_path) {
        Ok(raw) => parse_env_content(&raw),
        Err(_) => HashMap::new(),
    }
}

/// Ekstraksi nilai `"state"` atau `"status"` dari JSON mesin InstaBox tanpa ketergantungan crate eksternal.
fn extract_machine_state_from_json(json: &str) -> Option<String> {
    for key in ["\"state\"", "\"status\""] {
        let mut search_from = 0;
        while let Some(pos) = json[search_from..].find(key) {
            let abs_pos = search_from + pos + key.len();
            let rest = json[abs_pos..].trim_start();
            if let Some(after_colon) = rest.strip_prefix(':') {
                let val_start = after_colon.trim_start();
                if let Some(inner) = val_start.strip_prefix('"') {
                    if let Some(end_quote) = inner.find('"') {
                        let candidate = inner[..end_quote].trim().to_ascii_lowercase();
                        if !candidate.is_empty() {
                            return Some(candidate);
                        }
                    }
                }
            }
            search_from = abs_pos;
        }
    }
    None
}

fn classify_vps_state(raw_state: &str) -> VpsAvailability {
    match raw_state.trim().to_ascii_lowercase().as_str() {
        "running" => VpsAvailability::Running,
        "paused" | "stopped" | "suspended" | "off" | "terminated" | "error" | "failed" => {
            VpsAvailability::Down
        }
        "starting" | "resuming" | "creating" | "booting" | "provisioning" => {
            VpsAvailability::Transient
        }
        _ => VpsAvailability::Unknown,
    }
}

fn query_vps_state(project_root: &Path) -> (VpsAvailability, String) {
    let env_map = load_env_file(project_root);
    let api_key = env_map
        .get("INSTABOX_API_KEY")
        .map(String::as_str)
        .unwrap_or("")
        .trim();
    let machine_id = env_map
        .get("INSTABOX_MACHINE_ID")
        .map(String::as_str)
        .unwrap_or("")
        .trim();
    if api_key.is_empty() || machine_id.is_empty() {
        return (VpsAvailability::Unknown, "missing_env".to_string());
    }

    let api_base = env_map
        .get("INSTABOX_API_BASE")
        .map(String::as_str)
        .unwrap_or("https://api.instabox.sh")
        .trim()
        .trim_end_matches('/');

    let url = format!("{api_base}/v1/machines/{machine_id}");
    let curl_bin = if Path::new(r"C:\Windows\System32\curl.exe").is_file() {
        r"C:\Windows\System32\curl.exe"
    } else {
        "curl"
    };

    let mut cmd = Command::new(curl_bin);
    cmd.args(["-sS", "--max-time", "8", "--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return (VpsAvailability::Unknown, "curl_spawn_failed".to_string()),
    };

    if let Some(mut stdin) = child.stdin.take() {
        let cfg = format!(
            "url = \"{url}\"\nheader = \"Authorization: Bearer {api_key}\"\nheader = \"Accept: application/json\"\n"
        );
        let _ = stdin.write_all(cfg.as_bytes());
    }

    let output = match child.wait_with_output() {
        Ok(o) => o,
        Err(_) => return (VpsAvailability::Unknown, "curl_wait_failed".to_string()),
    };

    if !output.status.success() {
        return (VpsAvailability::Unknown, "http_error".to_string());
    }

    let body = String::from_utf8_lossy(&output.stdout);
    match extract_machine_state_from_json(&body) {
        Some(st) => (classify_vps_state(&st), st),
        None => (VpsAvailability::Unknown, "invalid_json".to_string()),
    }
}

fn find_node_binary() -> PathBuf {
    let default_win = PathBuf::from(r"C:\Program Files\nodejs\node.exe");
    if default_win.is_file() {
        return default_win;
    }
    PathBuf::from("node")
}

fn spawn_local_baileys(project_root: &Path) -> Option<Child> {
    let entry_js = project_root.join("dist").join("whatsapp_baileys.js");
    if !entry_js.is_file() {
        append_log(
            project_root,
            "dist/whatsapp_baileys.js belum ditemukan. Jalankan `npm run build` terlebih dahulu.",
        );
        return None;
    }

    let logs_dir = project_root.join("logs");
    let _ = fs::create_dir_all(&logs_dir);
    let out_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(logs_dir.join("wa-baileys-backup.log"))
        .ok()?;
    let err_log = out_log.try_clone().ok()?;

    let node_bin = find_node_binary();
    let mut cmd = Command::new(node_bin);
    cmd.current_dir(project_root)
        .args([
            "--max-old-space-size=96",
            "dist/whatsapp_baileys.js",
            "--primary",
            "--from-watchdog",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::from(out_log))
        .stderr(Stdio::from(err_log));

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.spawn() {
        Ok(child) => {
            append_log(
                project_root,
                &format!(
                    "Baileys backup lokal dinyalakan (PID {}, heap cap 96 MB, windowless).",
                    child.id()
                ),
            );
            Some(child)
        }
        Err(e) => {
            append_log(project_root, &format!("Gagal menyalakan node.exe: {e}"));
            None
        }
    }
}

fn stop_local_baileys(project_root: &Path, child_slot: &mut Option<Child>, reason: &str) {
    if let Some(mut child) = child_slot.take() {
        let pid = child.id();
        append_log(
            project_root,
            &format!("Menghentikan Baileys backup lokal (PID {pid}, alasan: {reason})..."),
        );
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(b"YIELD\n");
            let _ = stdin.flush();
        }
        let deadline = Instant::now() + Duration::from_secs(6);
        let mut exited = false;
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                exited = true;
                break;
            }
            thread::sleep(Duration::from_millis(120));
        }
        if !exited {
            let _ = child.kill();
            let _ = child.wait();
        }
        append_log(
            project_root,
            &format!("Baileys backup lokal (PID {pid}) berhenti bersih. RAM Node dibebaskan 100%."),
        );
    }
}

fn handle_control_client(
    mut stream: TcpStream,
    running: &Arc<AtomicBool>,
    child_pid: &Arc<AtomicU32>,
    shared: &Arc<Mutex<SharedState>>,
    started_at: Instant,
) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() {
        return;
    }
    let cmd = line.trim().to_ascii_uppercase();
    if cmd == "STOP" {
        running.store(false, Ordering::SeqCst);
        let _ = stream.write_all(b"{\"ok\":true,\"action\":\"stopping\"}\n");
        let _ = stream.flush();
        return;
    }

    let (avail, raw_st, last_ts) = match shared.lock() {
        Ok(g) => (
            g.vps_availability.as_str(),
            g.raw_state.clone(),
            g.last_check_epoch,
        ),
        Err(_) => ("unknown", "lock_err".to_string(), 0),
    };
    let cpid = child_pid.load(Ordering::SeqCst);
    let resp = format!(
        "{{\"ok\":true,\"watchdogPid\":{},\"vpsAvailability\":\"{}\",\"vpsState\":\"{}\",\"failoverActive\":{},\"childNodePid\":{},\"lastCheckEpoch\":{},\"uptimeSecs\":{}}}\n",
        std::process::id(),
        avail,
        raw_st,
        if cpid > 0 { "true" } else { "false" },
        cpid,
        last_ts,
        started_at.elapsed().as_secs()
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn main() {
    let project_root = match locate_project_root() {
        Some(p) => p,
        None => return,
    };
    let _ = env::set_current_dir(&project_root);

    // Single-instance guard sekaligus control socket lokal (otomatis rilis oleh kernel bila proses mati).
    let listener = match TcpListener::bind(CONTROL_ADDR) {
        Ok(l) => l,
        Err(_) => return,
    };
    let _ = listener.set_nonblocking(true);

    let running = Arc::new(AtomicBool::new(true));
    let child_pid = Arc::new(AtomicU32::new(0));
    let shared = Arc::new(Mutex::new(SharedState {
        vps_availability: VpsAvailability::Unknown,
        raw_state: "init".to_string(),
        last_check_epoch: 0,
    }));
    let started_at = Instant::now();

    append_log(
        &project_root,
        &format!(
            "Watchdog Rust dimulai (PID {}, control {}, interval {}s, windowless).",
            std::process::id(),
            CONTROL_ADDR,
            POLL_INTERVAL_SECS
        ),
    );

    let mut child_node: Option<Child> = None;
    let mut next_poll = Instant::now();

    while running.load(Ordering::SeqCst) {
        // 1. Layani permintaan kontrol lokal (STATUS / STOP) tanpa memblokir
        while let Ok((stream, _)) = listener.accept() {
            handle_control_client(stream, &running, &child_pid, &shared, started_at);
        }
        if !running.load(Ordering::SeqCst) {
            break;
        }

        // 2. Cek apakah child node.exe keluar sendiri (mis. karena kode 440 connectionReplaced)
        if let Some(ref mut ch) = child_node {
            if let Ok(Some(status)) = ch.try_wait() {
                append_log(
                    &project_root,
                    &format!("Proses Baileys lokal selesai dengan status: {status}."),
                );
                child_node = None;
                child_pid.store(0, Ordering::SeqCst);
            }
        }

        // 3. Evaluasi status VPS setiap 30 detik
        if Instant::now() >= next_poll {
            let (avail, raw_st) = query_vps_state(&project_root);
            if let Ok(mut g) = shared.lock() {
                if g.raw_state != raw_st {
                    append_log(
                        &project_root,
                        &format!(
                            "Status VPS: {} ({}) -> {}",
                            g.raw_state,
                             avail.as_str(),
                            raw_st
                        ),
                    );
                }
                g.vps_availability = avail;
                g.raw_state = raw_st.clone();
                g.last_check_epoch = now_epoch_secs();
            }

            match avail {
                VpsAvailability::Running => {
                    if child_node.is_some() {
                        stop_local_baileys(&project_root, &mut child_node, "VPS utama kembali running");
                        child_pid.store(0, Ordering::SeqCst);
                    }
                }
                VpsAvailability::Down => {
                    if child_node.is_none() {
                        child_node = spawn_local_baileys(&project_root);
                        let pid = child_node.as_ref().map(Child::id).unwrap_or(0);
                        child_pid.store(pid, Ordering::SeqCst);
                    }
                }
                VpsAvailability::Transient | VpsAvailability::Unknown => {}
            }

            next_poll = Instant::now() + Duration::from_secs(POLL_INTERVAL_SECS);
        }

        thread::sleep(Duration::from_millis(200));
    }

    stop_local_baileys(&project_root, &mut child_node, "Watchdog berhenti");
    child_pid.store(0, Ordering::SeqCst);
    append_log(&project_root, "Watchdog Rust dihentikan dengan bersih.");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_machine_state_handles_flat_and_nested_json() {
        let flat = r#"{"id":"m_123","name":"freeaibot-wa","state":"running","maxRunMinutes":480}"#;
        assert_eq!(
            extract_machine_state_from_json(flat),
            Some("running".to_string())
        );

        let nested = r#"{"machine":{"id":"m_123","status":"suspended"}}"#;
        assert_eq!(
            extract_machine_state_from_json(nested),
            Some("suspended".to_string())
        );
    }

    #[test]
    fn classify_vps_state_maps_all_lifecycle_states() {
        assert_eq!(classify_vps_state("running"), VpsAvailability::Running);
        assert_eq!(classify_vps_state("suspended"), VpsAvailability::Down);
        assert_eq!(classify_vps_state("paused"), VpsAvailability::Down);
        assert_eq!(classify_vps_state("stopped"), VpsAvailability::Down);
        assert_eq!(classify_vps_state("starting"), VpsAvailability::Transient);
        assert_eq!(classify_vps_state("resuming"), VpsAvailability::Transient);
        assert_eq!(classify_vps_state("unexpected"), VpsAvailability::Unknown);
    }

    #[test]
    fn parse_env_content_strips_quotes_and_comments() {
        let sample = "# comment\nINSTABOX_API_KEY=\"ibx_secret\"\nINSTABOX_MACHINE_ID='m_abc'\n";
        let map = parse_env_content(sample);
        assert_eq!(
            map.get("INSTABOX_API_KEY").map(String::as_str),
            Some("ibx_secret")
        );
        assert_eq!(
            map.get("INSTABOX_MACHINE_ID").map(String::as_str),
            Some("m_abc")
        );
    }
}
