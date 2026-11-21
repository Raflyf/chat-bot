#![cfg_attr(not(test), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const CONTROL_ADDR: &str = "127.0.0.1:47831";
const POLL_INTERVAL_SECS: u64 = 30;
const MAX_LOG_BYTES: u64 = 256 * 1024;

// Win32 Message & Tray Constants
const WM_DESTROY: u32 = 0x0002;
const WM_CLOSE: u32 = 0x0010;
const WM_COMMAND: u32 = 0x0111;
const WM_LBUTTONUP: u32 = 0x0202;
const WM_LBUTTONDBLCLK: u32 = 0x0203;
const WM_RBUTTONUP: u32 = 0x0205;
const WM_CONTEXTMENU: u32 = 0x007B;
const WM_NULL: u32 = 0x0000;
const WM_APP: u32 = 0x8000;
const WM_TRAYICON: u32 = WM_APP + 1;
const WM_APP_UPDATE_TRAY: u32 = WM_APP + 2;
const WM_APP_SHOW_BALLOON: u32 = WM_APP + 3;
const WM_APP_SHOW_DIALOG: u32 = WM_APP + 4;

const NIM_ADD: u32 = 0x0000_0000;
const NIM_MODIFY: u32 = 0x0000_0001;
const NIM_DELETE: u32 = 0x0000_0002;

const NIF_MESSAGE: u32 = 0x0000_0001;
const NIF_ICON: u32 = 0x0000_0002;
const NIF_TIP: u32 = 0x0000_0004;
const NIF_INFO: u32 = 0x0000_0010;
const NIIF_INFO: u32 = 0x0000_0001;
const NIIF_WARNING: u32 = 0x0000_0002;

const MF_STRING: u32 = 0x0000_0000;
const MF_GRAYED: u32 = 0x0000_0001;
const MF_DISABLED: u32 = 0x0000_0002;
const MF_SEPARATOR: u32 = 0x0000_0800;

const TPM_LEFTALIGN: u32 = 0x0000;
const TPM_BOTTOMALIGN: u32 = 0x0020;
const TPM_RIGHTBUTTON: u32 = 0x0002;

const MB_OK: u32 = 0x0000_0000;
const MB_ICONINFORMATION: u32 = 0x0000_0040;
const MB_SETFOREGROUND: u32 = 0x0001_0000;

const IDI_APPLICATION_FALLBACK: usize = 32512;
const TRAY_UID: u32 = 101;

// Context Menu Command IDs
const IDM_SHOW_STATUS: usize = 1001;
const IDM_CHECK_NOW: usize = 1002;
const IDM_OPEN_LOG: usize = 1003;
const IDM_OPEN_BOT_LOG: usize = 1004;
const IDM_OPEN_FOLDER: usize = 1005;
const IDM_EXIT: usize = 1009;

#[cfg(windows)]
#[repr(C)]
struct POINT {
    x: i32,
    y: i32,
}

#[cfg(windows)]
#[repr(C)]
struct MSG {
    hwnd: isize,
    message: u32,
    wparam: usize,
    lparam: isize,
    time: u32,
    pt: POINT,
    lprivate: u32,
}

#[cfg(windows)]
#[repr(C)]
struct WNDCLASSEXW {
    cb_size: u32,
    style: u32,
    lpfn_wnd_proc: unsafe extern "system" fn(isize, u32, usize, isize) -> isize,
    cb_cls_extra: i32,
    cb_wnd_extra: i32,
    h_instance: isize,
    h_icon: isize,
    h_cursor: isize,
    hbr_background: isize,
    lpsz_menu_name: *const u16,
    lpsz_class_name: *const u16,
    h_icon_sm: isize,
}

#[cfg(windows)]
#[repr(C)]
struct NOTIFYICONDATAW {
    cb_size: u32,
    h_wnd: isize,
    u_id: u32,
    u_flags: u32,
    u_callback_message: u32,
    h_icon: isize,
    sz_tip: [u16; 128],
    dw_state: u32,
    dw_state_mask: u32,
    sz_info: [u16; 256],
    u_timeout_or_version: u32,
    sz_info_title: [u16; 64],
    dw_info_flags: u32,
    guid_item: [u8; 16],
    h_balloon_icon: isize,
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleW(lp_module_name: *const u16) -> isize;
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn RegisterClassExW(lpwcx: *const WNDCLASSEXW) -> u16;
    fn CreateWindowExW(
        dw_ex_style: u32,
        lp_class_name: *const u16,
        lp_window_name: *const u16,
        dw_style: u32,
        x: i32,
        y: i32,
        n_width: i32,
        n_height: i32,
        h_wnd_parent: isize,
        h_menu: isize,
        h_instance: isize,
        lp_param: *mut core::ffi::c_void,
    ) -> isize;
    fn DefWindowProcW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
    fn GetMessageW(lp_msg: *mut MSG, h_wnd: isize, w_msg_filter_min: u32, w_msg_filter_max: u32) -> i32;
    fn TranslateMessage(lp_msg: *const MSG) -> i32;
    fn DispatchMessageW(lp_msg: *const MSG) -> isize;
    fn PostMessageW(h_wnd: isize, msg: u32, wparam: usize, lparam: isize) -> i32;
    fn PostQuitMessage(n_exit_code: i32);
    fn DestroyWindow(h_wnd: isize) -> i32;
    fn LoadIconW(h_instance: isize, lp_icon_name: *const u16) -> isize;
    fn CreatePopupMenu() -> isize;
    fn AppendMenuW(h_menu: isize, u_flags: u32, u_id_new_item: usize, lp_new_item: *const u16) -> i32;
    fn SetMenuDefaultItem(h_menu: isize, u_item: u32, f_by_pos: u32) -> i32;
    fn TrackPopupMenu(
        h_menu: isize,
        u_flags: u32,
        x: i32,
        y: i32,
        n_reserved: i32,
        h_wnd: isize,
        prc_rect: *const core::ffi::c_void,
    ) -> i32;
    fn DestroyMenu(h_menu: isize) -> i32;
    fn GetCursorPos(lp_point: *mut POINT) -> i32;
    fn SetForegroundWindow(h_wnd: isize) -> i32;
    fn MessageBoxW(h_wnd: isize, lp_text: *const u16, lp_caption: *const u16, u_type: u32) -> i32;
    fn RegisterWindowMessageW(lp_string: *const u16) -> u32;
}

#[cfg(windows)]
#[link(name = "shell32")]
extern "system" {
    fn Shell_NotifyIconW(dw_message: u32, lp_data: *const NOTIFYICONDATAW) -> i32;
}

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
    balloon_title: String,
    balloon_body: String,
    balloon_is_warning: bool,
}

struct AppContext {
    project_root: PathBuf,
    running: Arc<AtomicBool>,
    force_poll: Arc<AtomicBool>,
    child_pid: Arc<AtomicU32>,
    shared: Arc<Mutex<SharedState>>,
    hwnd: AtomicIsize,
    icon_standby: isize,
    icon_active: isize,
    taskbar_created_msg: u32,
    started_at: Instant,
    dialog_open: AtomicBool,
}

static APP_CTX: OnceLock<Arc<AppContext>> = OnceLock::new();

fn to_wide_nul(s: &str) -> Vec<u16> {
    let mut v: Vec<u16> = s.encode_utf16().collect();
    v.push(0);
    v
}

fn copy_wide_fixed<const N: usize>(dst: &mut [u16; N], s: &str) {
    dst.fill(0);
    for (idx, ch) in s.encode_utf16().take(N.saturating_sub(1)).enumerate() {
        dst[idx] = ch;
    }
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
                    "Baileys Backup lokal dinyalakan (PID {}, heap cap 96 MB, windowless).",
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
            &format!("Menghentikan Baileys Backup lokal (PID {pid}, alasan: {reason})..."),
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
            &format!("Baileys Backup lokal (PID {pid}) berhenti bersih. RAM Node dibebaskan 100%."),
        );
    }
}

fn format_tray_tooltip(raw_state: &str, cpid: u32) -> String {
    let vps_upper = raw_state.to_ascii_uppercase();
    if cpid > 0 {
        format!("Baileys Backup - BACKUP AKTIF\nVPS Utama: {vps_upper}\nBot WA berjalan di Laptop (PID {cpid})")
    } else {
        format!("Baileys Backup - Standby Pasif\nVPS Utama: {vps_upper}\n0 proses Node.js (Hemat RAM)")
    }
}

#[cfg(windows)]
fn build_nid(ctx: &AppContext) -> NOTIFYICONDATAW {
    let hwnd = ctx.hwnd.load(Ordering::SeqCst);
    let cpid = ctx.child_pid.load(Ordering::SeqCst);
    let raw_state = ctx
        .shared
        .lock()
        .map(|g| g.raw_state.clone())
        .unwrap_or_else(|_| "unknown".to_string());

    let tip = format_tray_tooltip(&raw_state, cpid);
    let mut nid = NOTIFYICONDATAW {
        cb_size: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
        h_wnd: hwnd,
        u_id: TRAY_UID,
        u_flags: NIF_MESSAGE | NIF_ICON | NIF_TIP,
        u_callback_message: WM_TRAYICON,
        h_icon: if cpid > 0 { ctx.icon_active } else { ctx.icon_standby },
        sz_tip: [0u16; 128],
        dw_state: 0,
        dw_state_mask: 0,
        sz_info: [0u16; 256],
        u_timeout_or_version: 3000,
        sz_info_title: [0u16; 64],
        dw_info_flags: 0,
        guid_item: [0u8; 16],
        h_balloon_icon: 0,
    };
    copy_wide_fixed(&mut nid.sz_tip, &tip);
    nid
}

#[cfg(windows)]
fn add_or_update_tray_icon(ctx: &AppContext, is_add: bool) {
    let nid = build_nid(ctx);
    unsafe {
        if is_add {
            if Shell_NotifyIconW(NIM_ADD, &nid) == 0 {
                let _ = Shell_NotifyIconW(NIM_MODIFY, &nid);
            }
        } else if Shell_NotifyIconW(NIM_MODIFY, &nid) == 0 {
            let _ = Shell_NotifyIconW(NIM_ADD, &nid);
        }
    }
}

#[cfg(windows)]
fn show_tray_balloon(ctx: &AppContext) {
    let mut nid = build_nid(ctx);
    let (title, body, is_warn) = match ctx.shared.lock() {
        Ok(g) => (
            g.balloon_title.clone(),
            g.balloon_body.clone(),
            g.balloon_is_warning,
        ),
        Err(_) => return,
    };
    if body.is_empty() {
        return;
    }
    nid.u_flags |= NIF_INFO;
    nid.dw_info_flags = if is_warn { NIIF_WARNING } else { NIIF_INFO };
    copy_wide_fixed(&mut nid.sz_info_title, &title);
    copy_wide_fixed(&mut nid.sz_info, &body);
    unsafe {
        let _ = Shell_NotifyIconW(NIM_MODIFY, &nid);
    }
}

#[cfg(windows)]
fn remove_tray_icon(ctx: &AppContext) {
    let nid = build_nid(ctx);
    unsafe {
        let _ = Shell_NotifyIconW(NIM_DELETE, &nid);
    }
}

#[cfg(windows)]
fn queue_balloon(ctx: &AppContext, title: &str, body: &str, is_warning: bool) {
    if let Ok(mut g) = ctx.shared.lock() {
        g.balloon_title = title.to_string();
        g.balloon_body = body.to_string();
        g.balloon_is_warning = is_warning;
    }
    let hwnd = ctx.hwnd.load(Ordering::SeqCst);
    if hwnd != 0 {
        unsafe {
            let _ = PostMessageW(hwnd, WM_APP_SHOW_BALLOON, 0, 0);
        }
    }
}

#[cfg(windows)]
fn promote_tray_icon_in_windows11() {
    let ps_cmd = r#"
$keys = Get-ChildItem 'HKCU:\Control Panel\NotifyIconSettings' -ErrorAction SilentlyContinue
foreach ($k in $keys) {
  $p = (Get-ItemProperty -Path $k.PSPath -Name ExecutablePath -ErrorAction SilentlyContinue).ExecutablePath
  if ($p -and ($p -match 'BaileysBackup\.exe|wa-standby-watchdog\.exe')) {
    Set-ItemProperty -Path $k.PSPath -Name IsPromoted -Value 1 -Type DWord -ErrorAction SilentlyContinue
  }
}
"#;
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_cmd])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    let _ = cmd.spawn();
}

#[cfg(windows)]
fn show_status_dialog_async(ctx: Arc<AppContext>) {
    if ctx.dialog_open.swap(true, Ordering::SeqCst) {
        return;
    }
    thread::spawn(move || {
        let (avail, raw_st) = ctx
            .shared
            .lock()
            .map(|g| (g.vps_availability.as_str(), g.raw_state.clone()))
            .unwrap_or(("unknown", "unknown".to_string()));
        let cpid = ctx.child_pid.load(Ordering::SeqCst);
        let uptime_mins = ctx.started_at.elapsed().as_secs() / 60;
        let uptime_secs = ctx.started_at.elapsed().as_secs() % 60;

        let mode_line = if cpid > 0 {
            format!("BACKUP LOKAL AKTIF (node.exe PID {cpid})")
        } else {
            "STANDBY PASIF (0 Proses Node.js — Hemat RAM ~5 MB)".to_string()
        };

        let text = format!(
            "Baileys Backup — Auto-Failover Bot WhatsApp\n\
            ────────────────────────────────────────\n\
            • Status Aplikasi   : Berjalan di System Tray (PID {})\n\
            • Status VPS Utama  : {} ({})\n\
            • Mode Bot Lokal    : {}\n\
            • Uptime Watchdog   : {} menit {} detik\n\
            • Interval Cek VPS  : Setiap {} detik\n\
            • Lokasi Proyek     : {}\n\n\
            Klik kanan ikon Baileys Backup di System Tray (dekat jam Windows) untuk mengecek status VPS, membuka log, atau mematikan aplikasi.",
            std::process::id(),
            raw_st.to_ascii_uppercase(),
            avail,
            mode_line,
            uptime_mins,
            uptime_secs,
            POLL_INTERVAL_SECS,
            ctx.project_root.display()
        );
        let title_w = to_wide_nul("Baileys Backup - Ringkasan Status");
        let text_w = to_wide_nul(&text);
        unsafe {
            let _ = MessageBoxW(
                0,
                text_w.as_ptr(),
                title_w.as_ptr(),
                MB_OK | MB_ICONINFORMATION | MB_SETFOREGROUND,
            );
        }
        ctx.dialog_open.store(false, Ordering::SeqCst);
    });
}

#[cfg(windows)]
fn show_tray_context_menu(hwnd: isize, ctx: &AppContext) {
    let raw_st = ctx
        .shared
        .lock()
        .map(|g| g.raw_state.clone())
        .unwrap_or_else(|_| "unknown".to_string());
    let cpid = ctx.child_pid.load(Ordering::SeqCst);

    let header_line = to_wide_nul("Baileys Backup v1.0");
    let vps_line = to_wide_nul(&format!("Status VPS Utama: {}", raw_st.to_ascii_uppercase()));
    let mode_line = if cpid > 0 {
        to_wide_nul(&format!("Mode Lokal: BACKUP AKTIF (PID {cpid})"))
    } else {
        to_wide_nul("Mode Lokal: Standby Pasif (0 Node.js)")
    };

    let lbl_status = to_wide_nul("Lihat Ringkasan Status...");
    let lbl_check = to_wide_nul("Cek Status VPS Sekarang");
    let lbl_log = to_wide_nul("Buka Log Baileys Backup");
    let lbl_bot_log = to_wide_nul("Buka Log Bot WhatsApp Lokal");
    let lbl_folder = to_wide_nul("Buka Folder Proyek");
    let lbl_exit = to_wide_nul("Keluar (Matikan Baileys Backup)");

    unsafe {
        let hmenu = CreatePopupMenu();
        if hmenu == 0 {
            return;
        }
        let _ = AppendMenuW(hmenu, MF_STRING, IDM_SHOW_STATUS, header_line.as_ptr());
        let _ = SetMenuDefaultItem(hmenu, IDM_SHOW_STATUS as u32, 0);
        let _ = AppendMenuW(hmenu, MF_STRING | MF_DISABLED | MF_GRAYED, 0, vps_line.as_ptr());
        let _ = AppendMenuW(hmenu, MF_STRING | MF_DISABLED | MF_GRAYED, 0, mode_line.as_ptr());
        let _ = AppendMenuW(hmenu, MF_SEPARATOR, 0, null());
        let _ = AppendMenuW(hmenu, MF_STRING, IDM_SHOW_STATUS, lbl_status.as_ptr());
        let _ = AppendMenuW(hmenu, MF_STRING, IDM_CHECK_NOW, lbl_check.as_ptr());
        let _ = AppendMenuW(hmenu, MF_STRING, IDM_OPEN_LOG, lbl_log.as_ptr());
        let _ = AppendMenuW(hmenu, MF_STRING, IDM_OPEN_BOT_LOG, lbl_bot_log.as_ptr());
        let _ = AppendMenuW(hmenu, MF_STRING, IDM_OPEN_FOLDER, lbl_folder.as_ptr());
        let _ = AppendMenuW(hmenu, MF_SEPARATOR, 0, null());
        let _ = AppendMenuW(hmenu, MF_STRING, IDM_EXIT, lbl_exit.as_ptr());

        let mut pt = POINT { x: 0, y: 0 };
        let _ = GetCursorPos(&mut pt);
        let _ = SetForegroundWindow(hwnd);
        let _ = TrackPopupMenu(
            hmenu,
            TPM_LEFTALIGN | TPM_BOTTOMALIGN | TPM_RIGHTBUTTON,
            pt.x,
            pt.y,
            0,
            hwnd,
            null(),
        );
        let _ = PostMessageW(hwnd, WM_NULL, 0, 0);
        let _ = DestroyMenu(hmenu);
    }
}

#[cfg(windows)]
fn open_file_in_notepad(path: &Path) {
    if !path.is_file() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(path, "");
    }
    let _ = Command::new("notepad.exe").arg(path).spawn();
}

#[cfg(windows)]
unsafe extern "system" fn tray_wnd_proc(
    hwnd: isize,
    msg: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    if let Some(ctx) = APP_CTX.get() {
        if msg == ctx.taskbar_created_msg && ctx.taskbar_created_msg != 0 {
            add_or_update_tray_icon(ctx, true);
            return 0;
        }

        match msg {
            WM_TRAYICON => {
                let event = (lparam as u32) & 0xFFFF;
                if event == WM_RBUTTONUP || event == WM_CONTEXTMENU || event == WM_LBUTTONUP {
                    show_tray_context_menu(hwnd, ctx);
                } else if event == WM_LBUTTONDBLCLK {
                    show_status_dialog_async(Arc::clone(ctx));
                }
                return 0;
            }
            WM_APP_UPDATE_TRAY => {
                add_or_update_tray_icon(ctx, false);
                return 0;
            }
            WM_APP_SHOW_BALLOON => {
                add_or_update_tray_icon(ctx, false);
                show_tray_balloon(ctx);
                return 0;
            }
            WM_APP_SHOW_DIALOG => {
                show_status_dialog_async(Arc::clone(ctx));
                return 0;
            }
            WM_COMMAND => {
                let cmd_id = wparam & 0xFFFF;
                match cmd_id {
                    IDM_SHOW_STATUS => {
                        show_status_dialog_async(Arc::clone(ctx));
                    }
                    IDM_CHECK_NOW => {
                        ctx.force_poll.store(true, Ordering::SeqCst);
                    }
                    IDM_OPEN_LOG => {
                        let log_file = ctx.project_root.join("logs").join("wa-standby-watchdog.log");
                        open_file_in_notepad(&log_file);
                    }
                    IDM_OPEN_BOT_LOG => {
                        let bot_log = ctx.project_root.join("logs").join("wa-baileys-backup.log");
                        open_file_in_notepad(&bot_log);
                    }
                    IDM_OPEN_FOLDER => {
                        let _ = Command::new("explorer.exe").arg(&ctx.project_root).spawn();
                    }
                    IDM_EXIT => {
                        ctx.running.store(false, Ordering::SeqCst);
                        remove_tray_icon(ctx);
                        let _ = DestroyWindow(hwnd);
                    }
                    _ => {}
                }
                return 0;
            }
            WM_CLOSE => {
                ctx.running.store(false, Ordering::SeqCst);
                remove_tray_icon(ctx);
                let _ = DestroyWindow(hwnd);
                return 0;
            }
            WM_DESTROY => {
                ctx.running.store(false, Ordering::SeqCst);
                remove_tray_icon(ctx);
                PostQuitMessage(0);
                return 0;
            }
            _ => {}
        }
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

fn handle_control_client(
    mut stream: TcpStream,
    ctx: &Arc<AppContext>,
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
        ctx.running.store(false, Ordering::SeqCst);
        let hwnd = ctx.hwnd.load(Ordering::SeqCst);
        if hwnd != 0 {
            #[cfg(windows)]
            unsafe {
                let _ = PostMessageW(hwnd, WM_CLOSE, 0, 0);
            }
        }
        let _ = stream.write_all(b"{\"ok\":true,\"action\":\"stopping\"}\n");
        let _ = stream.flush();
        return;
    }

    if cmd == "CHECK_NOW" {
        ctx.force_poll.store(true, Ordering::SeqCst);
        let _ = stream.write_all(b"{\"ok\":true,\"action\":\"polling\"}\n");
        let _ = stream.flush();
        return;
    }

    if cmd == "POPUP" {
        let hwnd = ctx.hwnd.load(Ordering::SeqCst);
        if hwnd != 0 {
            #[cfg(windows)]
            {
                let cpid = ctx.child_pid.load(Ordering::SeqCst);
                let raw_st = ctx
                    .shared
                    .lock()
                    .map(|g| g.raw_state.clone())
                    .unwrap_or_else(|_| "unknown".to_string());
                let body = if cpid > 0 {
                    format!(
                        "Baileys Backup aktif di System Tray.\nVPS: {} | Backup Lokal: AKTIF (PID {})",
                        raw_st.to_ascii_uppercase(),
                        cpid
                    )
                } else {
                    format!(
                        "Baileys Backup aktif di System Tray.\nVPS: {} | Mode: Standby Pasif (Hemat RAM)",
                        raw_st.to_ascii_uppercase()
                    )
                };
                queue_balloon(ctx, "Baileys Backup", &body, false);
                unsafe {
                    let _ = PostMessageW(hwnd, WM_APP_SHOW_DIALOG, 0, 0);
                }
            }
        }
        let _ = stream.write_all(b"{\"ok\":true,\"action\":\"popup_shown\"}\n");
        let _ = stream.flush();
        return;
    }

    let (avail, raw_st, last_ts) = match ctx.shared.lock() {
        Ok(g) => (
            g.vps_availability.as_str(),
            g.raw_state.clone(),
            g.last_check_epoch,
        ),
        Err(_) => ("unknown", "lock_err".to_string(), 0),
    };
    let cpid = ctx.child_pid.load(Ordering::SeqCst);
    let resp = format!(
        "{{\"ok\":true,\"appName\":\"Baileys Backup\",\"watchdogPid\":{},\"vpsAvailability\":\"{}\",\"vpsState\":\"{}\",\"failoverActive\":{},\"childNodePid\":{},\"lastCheckEpoch\":{},\"uptimeSecs\":{},\"trayActive\":true}}\n",
        std::process::id(),
        avail,
        raw_st,
        if cpid > 0 { "true" } else { "false" },
        cpid,
        last_ts,
        ctx.started_at.elapsed().as_secs()
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn notify_existing_instance_popup() -> bool {
    if let Ok(mut stream) = TcpStream::connect_timeout(
        &CONTROL_ADDR.parse().unwrap(),
        Duration::from_millis(800),
    ) {
        let _ = stream.write_all(b"POPUP\n");
        let _ = stream.flush();
        return true;
    }
    false
}

fn run_worker_loop(listener: TcpListener, ctx: Arc<AppContext>) {
    let mut child_node: Option<Child> = None;
    let mut next_poll = Instant::now();

    while ctx.running.load(Ordering::SeqCst) {
        while let Ok((stream, _)) = listener.accept() {
            handle_control_client(stream, &ctx);
        }
        if !ctx.running.load(Ordering::SeqCst) {
            break;
        }

        // Check if child node.exe exited on its own
        if let Some(ref mut ch) = child_node {
            if let Ok(Some(status)) = ch.try_wait() {
                append_log(
                    &ctx.project_root,
                    &format!("Proses Baileys lokal selesai dengan status: {status}."),
                );
                child_node = None;
                ctx.child_pid.store(0, Ordering::SeqCst);
                #[cfg(windows)]
                {
                    let hwnd = ctx.hwnd.load(Ordering::SeqCst);
                    if hwnd != 0 {
                        unsafe {
                            let _ = PostMessageW(hwnd, WM_APP_UPDATE_TRAY, 0, 0);
                        }
                    }
                }
            }
        }

        let manual_check = ctx.force_poll.swap(false, Ordering::SeqCst);
        if manual_check || Instant::now() >= next_poll {
            let (avail, raw_st) = query_vps_state(&ctx.project_root);
            let mut state_changed = false;
            if let Ok(mut g) = ctx.shared.lock() {
                if g.raw_state != raw_st {
                    state_changed = true;
                    append_log(
                        &ctx.project_root,
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
                        stop_local_baileys(
                            &ctx.project_root,
                            &mut child_node,
                            "VPS utama kembali running",
                        );
                        ctx.child_pid.store(0, Ordering::SeqCst);
                        #[cfg(windows)]
                        queue_balloon(
                            &ctx,
                            "Baileys Backup — Standby Pasif",
                            "VPS utama kembali RUNNING. Bot lokal dihentikan otomatis untuk menghemat RAM.",
                            false,
                        );
                    }
                }
                VpsAvailability::Down => {
                    if child_node.is_none() {
                        child_node = spawn_local_baileys(&ctx.project_root);
                        let pid = child_node.as_ref().map(Child::id).unwrap_or(0);
                        ctx.child_pid.store(pid, Ordering::SeqCst);
                        #[cfg(windows)]
                        if pid > 0 {
                            queue_balloon(
                                &ctx,
                                "Baileys Backup — Failover Aktif",
                                &format!(
                                    "VPS utama sedang {} — Bot WhatsApp otomatis diambil alih oleh laptop (PID {}).",
                                    raw_st.to_ascii_uppercase(),
                                    pid
                                ),
                                true,
                            );
                        }
                    }
                }
                VpsAvailability::Transient | VpsAvailability::Unknown => {}
            }

            #[cfg(windows)]
            {
                let hwnd = ctx.hwnd.load(Ordering::SeqCst);
                if hwnd != 0 && (state_changed || manual_check) {
                    unsafe {
                        let _ = PostMessageW(hwnd, WM_APP_UPDATE_TRAY, 0, 0);
                    }
                }
                if manual_check {
                    let cpid = ctx.child_pid.load(Ordering::SeqCst);
                    let msg = if cpid > 0 {
                        format!(
                            "Status VPS: {} | Backup Lokal: AKTIF (PID {})",
                            raw_st.to_ascii_uppercase(),
                            cpid
                        )
                    } else {
                        format!(
                            "Status VPS: {} | Mode: Standby Pasif (0 Node.js)",
                            raw_st.to_ascii_uppercase()
                        )
                    };
                    queue_balloon(&ctx, "Baileys Backup — Cek Status VPS", &msg, false);
                }
            }

            next_poll = Instant::now() + Duration::from_secs(POLL_INTERVAL_SECS);
        }

        thread::sleep(Duration::from_millis(180));
    }

    stop_local_baileys(&ctx.project_root, &mut child_node, "Baileys Backup berhenti");
    ctx.child_pid.store(0, Ordering::SeqCst);
    append_log(&ctx.project_root, "Baileys Backup dihentikan dengan bersih.");
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let is_silent_launch = args.iter().any(|a| a == "--silent");

    let project_root = match locate_project_root() {
        Some(p) => p,
        None => return,
    };
    let _ = env::set_current_dir(&project_root);

    // Single-instance guard + control socket
    let listener = match TcpListener::bind(CONTROL_ADDR) {
        Ok(l) => l,
        Err(_) => {
            if !is_silent_launch {
                let _ = notify_existing_instance_popup();
            }
            return;
        }
    };
    let _ = listener.set_nonblocking(true);

    #[cfg(windows)]
    let (icon_standby, icon_active, taskbar_created_msg, hinstance) = unsafe {
        let hinst = GetModuleHandleW(null());
        // Resource ID 1 = Standby icon, Resource ID 2 = Active failover icon
        let mut ic1 = LoadIconW(hinst, 1usize as *const u16);
        if ic1 == 0 {
            ic1 = LoadIconW(0, IDI_APPLICATION_FALLBACK as *const u16);
        }
        let mut ic2 = LoadIconW(hinst, 2usize as *const u16);
        if ic2 == 0 {
            ic2 = ic1;
        }
        let tb_msg = RegisterWindowMessageW(to_wide_nul("TaskbarCreated").as_ptr());
        (ic1, ic2, tb_msg, hinst)
    };

    #[cfg(not(windows))]
    let (icon_standby, icon_active, taskbar_created_msg, _hinstance) = (0isize, 0isize, 0u32, 0isize);

    let ctx = Arc::new(AppContext {
        project_root: project_root.clone(),
        running: Arc::new(AtomicBool::new(true)),
        force_poll: Arc::new(AtomicBool::new(false)),
        child_pid: Arc::new(AtomicU32::new(0)),
        shared: Arc::new(Mutex::new(SharedState {
            vps_availability: VpsAvailability::Unknown,
            raw_state: "mengecek...".to_string(),
            last_check_epoch: 0,
            balloon_title: String::new(),
            balloon_body: String::new(),
            balloon_is_warning: false,
        })),
        hwnd: AtomicIsize::new(0),
        icon_standby,
        icon_active,
        taskbar_created_msg,
        started_at: Instant::now(),
        dialog_open: AtomicBool::new(false),
    });
    let _ = APP_CTX.set(Arc::clone(&ctx));

    append_log(
        &project_root,
        &format!(
            "Baileys Backup dimulai (PID {}, System Tray aktif, control {}, interval {}s).",
            std::process::id(),
            CONTROL_ADDR,
            POLL_INTERVAL_SECS
        ),
    );

    #[cfg(windows)]
    unsafe {
        let class_name = to_wide_nul("BaileysBackupTrayWindowClass");
        let wnd_title = to_wide_nul("Baileys Backup");
        let wc = WNDCLASSEXW {
            cb_size: std::mem::size_of::<WNDCLASSEXW>() as u32,
            style: 0,
            lpfn_wnd_proc: tray_wnd_proc,
            cb_cls_extra: 0,
            cb_wnd_extra: 0,
            h_instance: hinstance,
            h_icon: icon_standby,
            h_cursor: 0,
            hbr_background: 0,
            lpsz_menu_name: null(),
            lpsz_class_name: class_name.as_ptr(),
            h_icon_sm: icon_standby,
        };
        let _ = RegisterClassExW(&wc);

        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            wnd_title.as_ptr(),
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            hinstance,
            null_mut(),
        );
        if hwnd != 0 {
            ctx.hwnd.store(hwnd, Ordering::SeqCst);
            add_or_update_tray_icon(&ctx, true);

            // Pin tray icon in Windows 11 taskbar area so user doesn't have to hunt in overflow menu
            thread::spawn(|| {
                thread::sleep(Duration::from_millis(900));
                promote_tray_icon_in_windows11();
            });
        }
    }

    let worker_ctx = Arc::clone(&ctx);
    let worker_handle = thread::spawn(move || {
        run_worker_loop(listener, worker_ctx);
    });

    #[cfg(windows)]
    unsafe {
        let mut msg = MSG {
            hwnd: 0,
            message: 0,
            wparam: 0,
            lparam: 0,
            time: 0,
            pt: POINT { x: 0, y: 0 },
            lprivate: 0,
        };
        while GetMessageW(&mut msg, 0, 0, 0) > 0 {
            let _ = TranslateMessage(&msg);
            let _ = DispatchMessageW(&msg);
        }
    }

    ctx.running.store(false, Ordering::SeqCst);
    let _ = worker_handle.join();
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

    #[test]
    fn format_tray_tooltip_shows_standby_and_active_modes() {
        let st_tip = format_tray_tooltip("running", 0);
        assert!(st_tip.contains("Baileys Backup - Standby Pasif"));
        assert!(st_tip.contains("VPS Utama: RUNNING"));

        let act_tip = format_tray_tooltip("paused", 4321);
        assert!(act_tip.contains("Baileys Backup - BACKUP AKTIF"));
        assert!(act_tip.contains("PID 4321"));
    }
}
