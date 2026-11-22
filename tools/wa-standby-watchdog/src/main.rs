#![cfg_attr(not(test), windows_subsystem = "windows")]

mod icon;
mod panel;

use std::collections::{HashMap, VecDeque};
use std::env;
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::mem::size_of;
use std::net::{TcpListener, TcpStream};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use windows::{
    Win32::{
        Foundation::{
            CloseHandle, ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_ITEMS, FreeLibrary, HANDLE, HMODULE,
            HWND, LPARAM, LRESULT, POINT, WPARAM,
        },
        System::{
            Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize},
            LibraryLoader::{
                GetModuleHandleW, GetProcAddress, LOAD_LIBRARY_SEARCH_SYSTEM32, LoadLibraryExW,
            },
            ProcessStatus::{
                K32EmptyWorkingSet, K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
                PROCESS_MEMORY_COUNTERS_EX, PROCESS_MEMORY_COUNTERS_EX2,
            },
            Registry::{
                HKEY, HKEY_CURRENT_USER, KEY_ENUMERATE_SUB_KEYS, KEY_READ, KEY_SET_VALUE,
                REG_DWORD, REG_OPTION_NON_VOLATILE, REG_SZ, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
                RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegEnumKeyExW, RegGetValueW,
                RegOpenKeyExW, RegSetValueExW,
            },
            StationsAndDesktops::{
                DESKTOP_CONTROL_FLAGS, GetUserObjectInformationW, OpenDesktopW, SetThreadDesktop,
                UOI_NAME,
            },
            Threading::{
                GetCurrentProcess, GetCurrentThreadId, OpenProcess,
                PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
        UI::{
            Shell::{
                NIF_ICON, NIF_INFO, NIF_MESSAGE, NIF_SHOWTIP, NIF_TIP, NIIF_INFO, NIIF_WARNING,
                NIM_ADD, NIM_DELETE, NIM_MODIFY, NIM_SETVERSION, NIN_BALLOONUSERCLICK,
                NIN_SELECT, NOTIFYICON_VERSION_4, NOTIFYICONDATAW, Shell_NotifyIconW,
            },
            WindowsAndMessaging::{
                AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu,
                DestroyWindow, DispatchMessageW, GetCursorPos, GetMessageW, ICON_BIG, ICON_SMALL,
                KillTimer, MF_CHECKED, MF_DISABLED, MF_GRAYED, MF_SEPARATOR, MF_STRING,
                MF_UNCHECKED, MSG, PostMessageW, PostQuitMessage, RegisterClassExW,
                RegisterWindowMessageW, SendMessageW, SetForegroundWindow, SetMenuDefaultItem,
                SetProcessDPIAware, SetTimer, TPM_BOTTOMALIGN, TPM_LEFTALIGN, TPM_RETURNCMD,
                TPM_RIGHTBUTTON, TrackPopupMenu, TranslateMessage, WM_APP, WM_CLOSE, WM_COMMAND,
                WM_CONTEXTMENU, WM_DESTROY, WM_ENDSESSION, WM_LBUTTONDBLCLK, WM_LBUTTONUP, WM_NULL,
                WM_QUERYENDSESSION, WM_RBUTTONUP, WM_SETICON, WM_TIMER, WNDCLASSEXW,
                WS_EX_TOOLWINDOW, WS_OVERLAPPED,
            },
        },
    },
    core::{PCSTR, PCWSTR, s, w},
};

const NIN_KEYSELECT: u32 = NIN_SELECT | 1;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const CONTROL_ADDR: &str = "127.0.0.1:47831";
const POLL_INTERVAL_SECS: u64 = 30;
const MAX_LOG_BYTES: u64 = 256 * 1024;
const MAX_RECENT_EVENTS: usize = 6;
const TRAY_UID: u32 = 1;
const TRAY_RETRY_TIMER_ID: usize = 501;

// Custom Window Messages
const WM_TRAYICON: u32 = WM_APP + 1;
const WM_APP_UPDATE_TRAY: u32 = WM_APP + 2;
const WM_APP_SHOW_BALLOON: u32 = WM_APP + 3;
const WM_APP_SHOW_PANEL: u32 = WM_APP + 4;
const WM_APP_TOGGLE_PANEL: u32 = WM_APP + 5;

// Context Menu & Panel Shared Command IDs
const IDM_SHOW_PANEL: usize = 1001;
const IDM_CHECK_NOW: usize = panel::CMD_CHECK_NOW;
const IDM_OPEN_LOG: usize = panel::CMD_OPEN_LOG;
const IDM_OPEN_BOT_LOG: usize = panel::CMD_OPEN_BOT_LOG;
const IDM_OPEN_FOLDER: usize = panel::CMD_OPEN_FOLDER;
const IDM_TOGGLE_AUTOSTART: usize = panel::CMD_TOGGLE_AUTOSTART;
const IDM_RESUME_VPS: usize = panel::CMD_RESUME_VPS;
const IDM_TOGGLE_AUTO_RESUME: usize = panel::CMD_TOGGLE_AUTO_RESUME;
const IDM_EXIT: usize = panel::CMD_EXIT;

static IDEMPOTENCY_SEQ: AtomicU64 = AtomicU64::new(1);

const RUN_SUBKEY: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Run");
const RUN_VALUE_NAME: PCWSTR = w!("BaileysBackup");
const LEGACY_RUN_VALUE_NAME: PCWSTR = w!("FreeAIBotStandbyWatchdog");
const APP_SETTINGS_SUBKEY: PCWSTR = w!(r"Software\BaileysBackup");
const PROJECT_ROOT_VALUE: PCWSTR = w!("ProjectRoot");
const AUTO_RESUME_VALUE: PCWSTR = w!("AutoResumeVps");

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
    last_check_instant: Option<Instant>,
    auto_resume_cooldown_until: Option<Instant>,
    balloon_title: String,
    balloon_body: String,
    balloon_is_warning: bool,
    recent_events: VecDeque<String>,
}

struct AppContext {
    project_root: PathBuf,
    running: Arc<AtomicBool>,
    force_poll: Arc<AtomicBool>,
    checking_vps: Arc<AtomicBool>,
    resume_requested: Arc<AtomicBool>,
    resuming_vps: Arc<AtomicBool>,
    auto_resume_enabled: Arc<AtomicBool>,
    tray_registered: Arc<AtomicBool>,
    tray_retry_left: AtomicU8,
    child_pid: Arc<AtomicU32>,
    total_checks: Arc<AtomicU64>,
    failover_count: Arc<AtomicU64>,
    shared: Arc<Mutex<SharedState>>,
    hwnd_raw: AtomicIsize,
    icons: icon::AppIcons,
    taskbar_created_msg: u32,
    started_at: Instant,
}

static APP_CTX: OnceLock<Arc<AppContext>> = OnceLock::new();

fn to_wide_nul(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
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

fn record_event(ctx: &AppContext, msg: &str) {
    if let Ok(mut g) = ctx.shared.lock() {
        if g.recent_events.len() >= MAX_RECENT_EVENTS {
            g.recent_events.pop_back();
        }
        g.recent_events.push_front(msg.to_string());
    }
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

fn is_valid_project_root(dir: &Path) -> bool {
    dir.join("package.json").is_file() && dir.join(".env").is_file()
}

fn parse_project_dir_arg(args: &[String]) -> Option<PathBuf> {
    let mut i = 1;
    while i < args.len() {
        let arg = &args[i];
        if let Some(val) = arg.strip_prefix("--project-dir=") {
            let trimmed = val.trim().trim_matches('"');
            if !trimmed.is_empty() {
                return Some(PathBuf::from(trimmed));
            }
        } else if arg == "--project-dir" {
            if let Some(val) = args.get(i + 1) {
                let trimmed = val.trim().trim_matches('"');
                if !trimmed.is_empty() {
                    return Some(PathBuf::from(trimmed));
                }
            }
        }
        i += 1;
    }
    None
}

fn read_saved_project_root() -> Option<PathBuf> {
    unsafe {
        let mut needed: u32 = 0;
        let st = RegGetValueW(
            HKEY_CURRENT_USER,
            APP_SETTINGS_SUBKEY,
            PROJECT_ROOT_VALUE,
            RRF_RT_REG_SZ,
            None,
            None,
            Some(&mut needed),
        );
        if st.is_err() || needed < 4 || needed > 4096 {
            return None;
        }
        let mut buf = vec![0u16; (needed as usize).div_ceil(2)];
        let st2 = RegGetValueW(
            HKEY_CURRENT_USER,
            APP_SETTINGS_SUBKEY,
            PROJECT_ROOT_VALUE,
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut needed),
        );
        if st2.is_err() {
            return None;
        }
        let wchar_len = (needed as usize / 2).min(buf.len());
        let raw = String::from_utf16_lossy(&buf[..wchar_len]);
        let trimmed = raw.trim_end_matches('\0').trim();
        if trimmed.is_empty() {
            return None;
        }
        Some(PathBuf::from(trimmed))
    }
}

fn save_project_root(root: &Path) -> bool {
    unsafe {
        let mut key = HKEY::default();
        if RegCreateKeyExW(
            HKEY_CURRENT_USER,
            APP_SETTINGS_SUBKEY,
            0,
            None,
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
        .is_err()
        {
            return false;
        }
        let wide: Vec<u16> = root
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let raw_bytes =
            std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2);
        let ok = RegSetValueExW(key, PROJECT_ROOT_VALUE, 0, REG_SZ, Some(raw_bytes)).is_ok();
        let _ = RegCloseKey(key);
        ok
    }
}

fn locate_project_root(args: &[String]) -> Option<PathBuf> {
    if let Some(arg_dir) = parse_project_dir_arg(args) {
        if is_valid_project_root(&arg_dir) {
            let _ = save_project_root(&arg_dir);
            return Some(arg_dir);
        }
    }
    if let Some(saved) = read_saved_project_root() {
        if is_valid_project_root(&saved) {
            return Some(saved);
        }
    }
    if let Ok(exe) = env::current_exe() {
        let mut cur = exe.parent();
        while let Some(dir) = cur {
            if is_valid_project_root(dir) {
                let _ = save_project_root(dir);
                return Some(dir.to_path_buf());
            }
            cur = dir.parent();
        }
    }
    if let Ok(cwd) = env::current_dir() {
        let mut cur: Option<&Path> = Some(&cwd);
        while let Some(dir) = cur {
            if is_valid_project_root(dir) {
                let _ = save_project_root(dir);
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

fn curl_bin_path() -> &'static str {
    if Path::new(r"C:\Windows\System32\curl.exe").is_file() {
        r"C:\Windows\System32\curl.exe"
    } else {
        "curl"
    }
}

fn resolve_instabox_creds(project_root: &Path) -> Option<(String, String, String)> {
    let env_map = load_env_file(project_root);
    let api_key = env_map
        .get("INSTABOX_API_KEY")
        .map(String::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let machine_id = env_map
        .get("INSTABOX_MACHINE_ID")
        .map(String::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if api_key.is_empty() || machine_id.is_empty() {
        return None;
    }
    let api_base = env_map
        .get("INSTABOX_API_BASE")
        .map(String::as_str)
        .unwrap_or("https://api.instabox.sh")
        .trim()
        .trim_end_matches('/')
        .to_string();
    Some((api_base, api_key, machine_id))
}

fn query_vps_state(project_root: &Path) -> (VpsAvailability, String) {
    let Some((api_base, api_key, machine_id)) = resolve_instabox_creds(project_root) else {
        return (VpsAvailability::Unknown, "missing_env".to_string());
    };

    let url = format!("{api_base}/v1/machines/{machine_id}");
    let mut cmd = Command::new(curl_bin_path());
    cmd.args(["-sS", "--max-time", "8", "--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);

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

fn choose_vps_action_endpoint(raw_state: &str) -> &'static str {
    match raw_state.trim().to_ascii_lowercase().as_str() {
        "stopped" | "off" => "start",
        _ => "resume",
    }
}

fn split_curl_body_and_status(raw: &str) -> (u16, &str) {
    let trimmed = raw.trim_end_matches(&['\r', '\n'][..]);
    if let Some(idx) = trimmed.rfind('\n') {
        let candidate = trimmed[idx + 1..].trim();
        if candidate.len() == 3 && candidate.bytes().all(|b| b.is_ascii_digit()) {
            if let Ok(code) = candidate.parse::<u16>() {
                let body = trimmed[..idx].trim_end_matches(&['\r', '\n'][..]);
                return (code, body);
            }
        }
    } else if trimmed.len() == 3 && trimmed.bytes().all(|b| b.is_ascii_digit()) {
        if let Ok(code) = trimmed.parse::<u16>() {
            return (code, "");
        }
    }
    (0, trimmed)
}

fn extract_json_string_field(json: &str, keys: &[&str]) -> Option<String> {
    for key in keys {
        let needle = format!("\"{key}\"");
        let mut search_from = 0;
        while let Some(pos) = json[search_from..].find(&needle) {
            let abs_pos = search_from + pos + needle.len();
            let rest = json[abs_pos..].trim_start();
            if let Some(after_colon) = rest.strip_prefix(':') {
                let val_start = after_colon.trim_start();
                if let Some(inner) = val_start.strip_prefix('"') {
                    let mut out = String::new();
                    let mut chars = inner.chars();
                    while let Some(ch) = chars.next() {
                        if ch == '\\' {
                            if let Some(esc) = chars.next() {
                                out.push(match esc {
                                    'n' => ' ',
                                    'r' => ' ',
                                    't' => ' ',
                                    other => other,
                                });
                            }
                        } else if ch == '"' {
                            break;
                        } else {
                            out.push(ch);
                        }
                        if out.chars().count() >= 120 {
                            break;
                        }
                    }
                    let clean = out.trim().to_string();
                    if !clean.is_empty() {
                        return Some(clean);
                    }
                }
            }
            search_from = abs_pos;
        }
    }
    None
}

fn extract_json_u64_field(json: &str, key: &str) -> Option<u64> {
    let needle = format!("\"{key}\"");
    let mut search_from = 0;
    while let Some(pos) = json[search_from..].find(&needle) {
        let abs_pos = search_from + pos + needle.len();
        let rest = json[abs_pos..].trim_start();
        if let Some(after_colon) = rest.strip_prefix(':') {
            let val_start = after_colon.trim_start();
            let digits: String = val_start.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !digits.is_empty() {
                if let Ok(v) = digits.parse::<u64>() {
                    return Some(v);
                }
            }
        }
        search_from = abs_pos;
    }
    None
}

fn is_cooldown_response(body: &str) -> bool {
    if extract_json_string_field(body, &["code"])
        .is_some_and(|c| c.eq_ignore_ascii_case("machine_cooldown"))
    {
        return true;
    }
    body.to_ascii_lowercase().contains("machine_cooldown")
}

fn should_fallback_resume_to_start(status: u16, body: &str) -> bool {
    match status {
        400 | 404 | 405 | 422 => true,
        409 => !is_cooldown_response(body),
        _ => false,
    }
}

fn format_vps_resume_error(status: u16, body: &str) -> String {
    if status == 409 && is_cooldown_response(body) {
        if let Some(secs) = extract_json_u64_field(body, "retryAfterSeconds") {
            if secs >= 60 {
                return format!("VPS sedang cooldown (coba lagi dalam ~{}m)", secs.div_ceil(60));
            }
            return format!("VPS sedang cooldown (coba lagi dalam ~{secs}d)");
        }
        return "VPS sedang cooldown, coba lagi nanti".to_string();
    }
    if status == 401 || status == 403 {
        return format!("API key ditolak / butuh izin machines:write (HTTP {status})");
    }
    if status == 429 {
        return "Terlalu banyak permintaan ke InstaBox (HTTP 429)".to_string();
    }
    if status == 0 {
        return "Gagal menghubungi API InstaBox".to_string();
    }
    if let Some(msg) = extract_json_string_field(body, &["message", "error"]) {
        format!("HTTP {status}: {msg}")
    } else {
        format!("HTTP {status}")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct VpsResumeError {
    status: u16,
    is_cooldown: bool,
    retry_after_secs: Option<u64>,
    message: String,
}

fn make_vps_resume_error(status: u16, body: &str) -> VpsResumeError {
    VpsResumeError {
        status,
        is_cooldown: status == 409 && is_cooldown_response(body),
        retry_after_secs: extract_json_u64_field(body, "retryAfterSeconds"),
        message: format_vps_resume_error(status, body),
    }
}

fn compute_auto_resume_backoff_secs(err: &VpsResumeError, consecutive_failures: u32) -> u64 {
    if err.is_cooldown {
        err.retry_after_secs.unwrap_or(300).clamp(60, 3600) + 10
    } else if err.status == 401 || err.status == 403 {
        1800
    } else if err.status == 429 {
        err.retry_after_secs.unwrap_or(180).clamp(60, 1800) + 10
    } else {
        const BACKOFF_STEPS: [u64; 3] = [120, 300, 600];
        BACKOFF_STEPS[consecutive_failures.min(2) as usize]
    }
}

fn post_instabox_machine_action(
    api_base: &str,
    api_key: &str,
    machine_id: &str,
    action: &str,
) -> Result<(u16, String), VpsResumeError> {
    let url = format!("{api_base}/v1/machines/{machine_id}/{action}");
    let seq = IDEMPOTENCY_SEQ.fetch_add(1, Ordering::Relaxed);
    let idemp_key = format!(
        "baileys-backup-{}-{}-{}",
        now_epoch_secs(),
        std::process::id(),
        seq
    );

    let mut cmd = Command::new(curl_bin_path());
    cmd.args([
        "-sS",
        "--max-time",
        "15",
        "-w",
        "\n%{http_code}",
        "--config",
        "-",
    ])
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::pipe())
    .creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|_| VpsResumeError {
        status: 0,
        is_cooldown: false,
        retry_after_secs: None,
        message: "Gagal menjalankan curl untuk mengaktifkan VPS".to_string(),
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let cfg = format!(
            "url = \"{url}\"\nrequest = \"POST\"\nheader = \"Authorization: Bearer {api_key}\"\nheader = \"Accept: application/json\"\nheader = \"Content-Type: application/json\"\nheader = \"Idempotency-Key: {idemp_key}\"\ndata = \"{{}}\"\n"
        );
        let _ = stdin.write_all(cfg.as_bytes());
    }

    let output = child.wait_with_output().map_err(|_| VpsResumeError {
        status: 0,
        is_cooldown: false,
        retry_after_secs: None,
        message: "Koneksi ke API InstaBox terputus".to_string(),
    })?;

    let raw_out = String::from_utf8_lossy(&output.stdout);
    let (status, body) = split_curl_body_and_status(&raw_out);
    if status == 0 && !output.status.success() {
        return Err(make_vps_resume_error(0, ""));
    }
    Ok((status, body.to_string()))
}

fn trigger_vps_resume(
    project_root: &Path,
    current_raw_state: &str,
) -> Result<(String, u16), VpsResumeError> {
    let Some((api_base, api_key, machine_id)) = resolve_instabox_creds(project_root) else {
        return Err(VpsResumeError {
            status: 0,
            is_cooldown: false,
            retry_after_secs: None,
            message: "INSTABOX_API_KEY atau INSTABOX_MACHINE_ID belum diisi di .env".to_string(),
        });
    };

    let primary_action = choose_vps_action_endpoint(current_raw_state);
    let (status, body) =
        post_instabox_machine_action(&api_base, &api_key, &machine_id, primary_action)?;
    if (200..=299).contains(&status) {
        return Ok((primary_action.to_string(), status));
    }

    if primary_action == "resume" && should_fallback_resume_to_start(status, &body) {
        let (status2, body2) =
            post_instabox_machine_action(&api_base, &api_key, &machine_id, "start")?;
        if (200..=299).contains(&status2) {
            return Ok(("start".to_string(), status2));
        }
        return Err(make_vps_resume_error(status2, &body2));
    }

    Err(make_vps_resume_error(status, &body))
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
        .stderr(Stdio::from(err_log))
        .creation_flags(CREATE_NO_WINDOW);

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
        format!(
            "Baileys Backup - BACKUP AKTIF\nVPS Utama: {vps_upper}\nBot WA berjalan di Laptop (PID {cpid})"
        )
    } else {
        format!(
            "Baileys Backup - Standby Pasif\nVPS Utama: {vps_upper}\n0 proses Node.js (Hemat RAM)"
        )
    }
}

/// Pastikan UI thread berada di desktop interaktif `"Default"` (karena tool/service launch
/// dapat dimulai di virtual desktop lain yang tidak memiliki `Shell_TrayWnd`).
fn ensure_interactive_default_desktop() -> Result<String, String> {
    unsafe {
        let cur_tid = GetCurrentThreadId();
        let h_cur = windows::Win32::System::StationsAndDesktops::GetThreadDesktop(cur_tid)
            .map_err(|e| format!("GetThreadDesktop gagal: {e}"))?;

        let mut name_buf = [0u16; 128];
        let mut needed = 0u32;
        let _ = GetUserObjectInformationW(
            HANDLE(h_cur.0),
            UOI_NAME,
            Some(name_buf.as_mut_ptr().cast()),
            (name_buf.len() * 2) as u32,
            Some(&mut needed),
        );
        let cur_len = name_buf.iter().position(|&c| c == 0).unwrap_or(0);
        let cur_name = String::from_utf16_lossy(&name_buf[..cur_len]);
        if cur_name.eq_ignore_ascii_case("Default") {
            return Ok(cur_name);
        }

        const DESKTOP_GENERIC_ALL: u32 = 0x1000_0000;
        let h_def = OpenDesktopW(
            w!("Default"),
            DESKTOP_CONTROL_FLAGS(0),
            false,
            DESKTOP_GENERIC_ALL,
        )
        .map_err(|e| format!("OpenDesktopW('Default') dari '{cur_name}' gagal: {e}"))?;

        SetThreadDesktop(h_def).map_err(|e| format!("SetThreadDesktop('Default') gagal: {e}"))?;
        Ok(format!("{cur_name} -> Default"))
    }
}

fn enable_dpi_awareness() {
    unsafe {
        if let Ok(user32) = GetModuleHandleW(w!("user32.dll")) {
            if let Some(proc) = GetProcAddress(user32, s!("SetProcessDpiAwarenessContext")) {
                let set: unsafe extern "system" fn(isize) -> windows::Win32::Foundation::BOOL =
                    std::mem::transmute(proc);
                if set(-4).as_bool() {
                    return; // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
                }
            }
        }
        let _ = SetProcessDPIAware();
    }
}

fn trim_working_set() {
    unsafe {
        let _ = K32EmptyWorkingSet(GetCurrentProcess());
    }
}

fn is_auto_resume_enabled() -> bool {
    let mut val: u32 = 0;
    let mut bytes = size_of::<u32>() as u32;
    let st = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            APP_SETTINGS_SUBKEY,
            AUTO_RESUME_VALUE,
            RRF_RT_REG_DWORD,
            None,
            Some((&mut val as *mut u32).cast()),
            Some(&mut bytes),
        )
    };
    st.is_ok() && val != 0
}

fn set_auto_resume_enabled(enabled: bool) -> bool {
    unsafe {
        let mut key = HKEY::default();
        if RegCreateKeyExW(
            HKEY_CURRENT_USER,
            APP_SETTINGS_SUBKEY,
            0,
            None,
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
        .is_err()
        {
            return false;
        }
        let val: u32 = if enabled { 1 } else { 0 };
        let ok = RegSetValueExW(key, AUTO_RESUME_VALUE, 0, REG_DWORD, Some(&val.to_le_bytes()))
            .is_ok();
        let _ = RegCloseKey(key);
        ok
    }
}

/// Ambil `(private_kb, working_kb)` proses lewat Win32 kernel32 `K32GetProcessMemoryInfo` (tanpa child process).
fn query_process_memory_kb(pid: u32) -> (u64, u64) {
    if pid == 0 {
        return (0, 0);
    }
    unsafe {
        let (handle, should_close) = if pid == std::process::id() {
            (GetCurrentProcess(), false)
        } else {
            match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                Ok(h) => (h, true),
                Err(_) => return (0, 0),
            }
        };

        let mut ex2 = PROCESS_MEMORY_COUNTERS_EX2 {
            cb: size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32,
            ..Default::default()
        };
        let ok_ex2 = K32GetProcessMemoryInfo(
            handle,
            (&mut ex2 as *mut PROCESS_MEMORY_COUNTERS_EX2).cast::<PROCESS_MEMORY_COUNTERS>(),
            ex2.cb,
        )
        .as_bool();

        let result = if ok_ex2 {
            let priv_bytes = if ex2.PrivateWorkingSetSize > 0 {
                ex2.PrivateWorkingSetSize
            } else {
                ex2.PrivateUsage
            };
            (
                (priv_bytes as u64) / 1024,
                (ex2.WorkingSetSize as u64) / 1024,
            )
        } else {
            let mut ex1 = PROCESS_MEMORY_COUNTERS_EX {
                cb: size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
                ..Default::default()
            };
            if K32GetProcessMemoryInfo(
                handle,
                (&mut ex1 as *mut PROCESS_MEMORY_COUNTERS_EX).cast::<PROCESS_MEMORY_COUNTERS>(),
                ex1.cb,
            )
            .as_bool()
            {
                (
                    (ex1.PrivateUsage as u64) / 1024,
                    (ex1.WorkingSetSize as u64) / 1024,
                )
            } else {
                (0, 0)
            }
        };

        if should_close && !handle.is_invalid() {
            let _ = CloseHandle(handle);
        }
        result
    }
}

fn is_autostart_enabled() -> bool {
    let mut buf = [0u16; 1024];
    let mut bytes = size_of_val(&buf) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            RUN_SUBKEY,
            RUN_VALUE_NAME,
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr().cast()),
            Some(&mut bytes),
        )
    };
    if status == ERROR_FILE_NOT_FOUND || status.is_err() {
        return false;
    }
    bytes > 2 && buf[0] != 0
}

fn set_autostart_enabled(enabled: bool, project_root: &Path) -> bool {
    let Ok(exe) = env::current_exe() else {
        return false;
    };
    let _ = save_project_root(project_root);
    unsafe {
        let mut key = HKEY::default();
        if enabled {
            if RegCreateKeyExW(
                HKEY_CURRENT_USER,
                RUN_SUBKEY,
                0,
                None,
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                None,
                &mut key,
                None,
            )
            .is_err()
            {
                return false;
            }
            let _ = RegDeleteValueW(key, LEGACY_RUN_VALUE_NAME);
            let cmd_line: Vec<u16> = std::iter::once(b'"' as u16)
                .chain(exe.as_os_str().encode_wide())
                .chain(b"\" --silent --project-dir \"".iter().map(|&b| b as u16))
                .chain(project_root.as_os_str().encode_wide())
                .chain(b"\"\0".iter().map(|&b| b as u16))
                .collect();
            let raw_bytes =
                std::slice::from_raw_parts(cmd_line.as_ptr().cast::<u8>(), cmd_line.len() * 2);
            let ok = RegSetValueExW(key, RUN_VALUE_NAME, 0, REG_SZ, Some(raw_bytes)).is_ok();
            let _ = RegCloseKey(key);
            ok
        } else {
            let open_st = RegOpenKeyExW(HKEY_CURRENT_USER, RUN_SUBKEY, 0, KEY_SET_VALUE, &mut key);
            if open_st == ERROR_FILE_NOT_FOUND {
                return true;
            }
            if open_st.is_err() {
                return false;
            }
            let _ = RegDeleteValueW(key, LEGACY_RUN_VALUE_NAME);
            let del = RegDeleteValueW(key, RUN_VALUE_NAME);
            let _ = RegCloseKey(key);
            del.is_ok() || del == ERROR_FILE_NOT_FOUND
        }
    }
}

/// Promosikan ikon Baileys Backup agar tampil langsung di taskbar kanan bawah Windows 11
/// menggunakan Registry Win32 native (0 proses PowerShell).
fn promote_tray_icon_in_windows11_native() {
    unsafe {
        let mut root_key = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            w!(r"Control Panel\NotifyIconSettings"),
            0,
            KEY_ENUMERATE_SUB_KEYS | KEY_READ,
            &mut root_key,
        )
        .is_err()
        {
            return;
        }

        let mut idx = 0u32;
        loop {
            let mut sub_name = [0u16; 256];
            let mut sub_len = sub_name.len() as u32;
            let err = RegEnumKeyExW(
                root_key,
                idx,
                windows::core::PWSTR(sub_name.as_mut_ptr()),
                &mut sub_len,
                None,
                windows::core::PWSTR::null(),
                None,
                None,
            );
            if err == ERROR_NO_MORE_ITEMS || err.is_err() {
                break;
            }
            idx += 1;

            let mut sub_key = HKEY::default();
            if RegOpenKeyExW(
                root_key,
                PCWSTR(sub_name.as_ptr()),
                0,
                KEY_READ | KEY_SET_VALUE,
                &mut sub_key,
            )
            .is_ok()
            {
                let mut exe_buf = [0u16; 512];
                let mut exe_bytes = size_of_val(&exe_buf) as u32;
                let st = RegGetValueW(
                    sub_key,
                    None,
                    w!("ExecutablePath"),
                    RRF_RT_REG_SZ,
                    None,
                    Some(exe_buf.as_mut_ptr().cast()),
                    Some(&mut exe_bytes),
                );
                if st.is_ok() && exe_bytes >= 2 {
                    let wchar_len = (exe_bytes as usize / 2).saturating_sub(1);
                    let exe_path = String::from_utf16_lossy(&exe_buf[..wchar_len]).to_ascii_lowercase();
                    if exe_path.contains("baileysbackup.exe") {
                        let promoted: u32 = 1;
                        let mut cur_promoted = 0u32;
                        let mut pbytes = size_of::<u32>() as u32;
                        let already = RegGetValueW(
                            sub_key,
                            None,
                            w!("IsPromoted"),
                            RRF_RT_REG_DWORD,
                            None,
                            Some((&mut cur_promoted as *mut u32).cast()),
                            Some(&mut pbytes),
                        )
                        .is_ok()
                            && cur_promoted == 1;
                        if !already {
                            let val_bytes = promoted.to_le_bytes();
                            let _ = RegSetValueExW(
                                sub_key,
                                w!("IsPromoted"),
                                0,
                                REG_DWORD,
                                Some(&val_bytes),
                            );
                        }
                    }
                }
                let _ = RegCloseKey(sub_key);
            }
        }
        let _ = RegCloseKey(root_key);
    }
}

fn apply_dark_context_menu_theme() {
    unsafe {
        if let Ok(uxtheme) = LoadLibraryExW(w!("uxtheme.dll"), None, LOAD_LIBRARY_SEARCH_SYSTEM32) {
            if let Some(set_mode) = GetProcAddress(uxtheme, PCSTR(135usize as *const u8)) {
                let set_mode: unsafe extern "system" fn(i32) -> i32 = std::mem::transmute(set_mode);
                let _ = set_mode(2); // AllowDark
            }
            if let Some(flush) = GetProcAddress(uxtheme, PCSTR(136usize as *const u8)) {
                let flush: unsafe extern "system" fn() = std::mem::transmute(flush);
                flush();
            }
            let _ = FreeLibrary(uxtheme);
        }
    }
}

fn build_nid(ctx: &AppContext) -> NOTIFYICONDATAW {
    let hwnd = HWND(ctx.hwnd_raw.load(Ordering::SeqCst) as *mut core::ffi::c_void);
    let cpid = ctx.child_pid.load(Ordering::SeqCst);
    let raw_state = ctx
        .shared
        .lock()
        .map(|g| g.raw_state.clone())
        .unwrap_or_else(|_| "unknown".to_string());

    let tip = format_tray_tooltip(&raw_state, cpid);
    let mut nid = NOTIFYICONDATAW {
        cbSize: size_of::<NOTIFYICONDATAW>() as u32,
        hWnd: hwnd,
        uID: TRAY_UID,
        uFlags: NIF_MESSAGE | NIF_ICON | NIF_TIP | NIF_SHOWTIP,
        uCallbackMessage: WM_TRAYICON,
        hIcon: ctx.icons.tray_icon(cpid > 0),
        ..Default::default()
    };
    nid.Anonymous.uVersion = NOTIFYICON_VERSION_4;
    copy_wide_fixed(&mut nid.szTip, &tip);
    nid
}

fn add_or_update_tray_icon(ctx: &AppContext, is_add: bool) -> bool {
    let mut nid = build_nid(ctx);
    unsafe {
        let registered = if is_add {
            if Shell_NotifyIconW(NIM_ADD, &nid).as_bool() {
                nid.Anonymous.uVersion = NOTIFYICON_VERSION_4;
                let _ = Shell_NotifyIconW(NIM_SETVERSION, &nid);
                true
            } else {
                Shell_NotifyIconW(NIM_MODIFY, &nid).as_bool()
            }
        } else if Shell_NotifyIconW(NIM_MODIFY, &nid).as_bool() {
            true
        } else if Shell_NotifyIconW(NIM_ADD, &nid).as_bool() {
            nid.Anonymous.uVersion = NOTIFYICON_VERSION_4;
            let _ = Shell_NotifyIconW(NIM_SETVERSION, &nid);
            true
        } else {
            false
        };

        ctx.tray_registered.store(registered, Ordering::SeqCst);
        if is_add {
            if registered {
                append_log(&ctx.project_root, "System Tray terdaftar (NIM_ADD OK).");
                promote_tray_icon_in_windows11_native();
            } else {
                let err = std::io::Error::last_os_error();
                append_log(
                    &ctx.project_root,
                    &format!("Shell_NotifyIconW(NIM_ADD) belum diterima Explorer: {err}"),
                );
            }
        }
        registered
    }
}

fn show_tray_balloon(ctx: &AppContext) {
    if !ctx.tray_registered.load(Ordering::SeqCst) {
        return;
    }
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
    nid.uFlags |= NIF_INFO;
    nid.dwInfoFlags = if is_warn { NIIF_WARNING } else { NIIF_INFO };
    copy_wide_fixed(&mut nid.szInfoTitle, &title);
    copy_wide_fixed(&mut nid.szInfo, &body);
    unsafe {
        let _ = Shell_NotifyIconW(NIM_MODIFY, &nid);
    }
}

fn remove_tray_icon(ctx: &AppContext) {
    let hwnd = HWND(ctx.hwnd_raw.load(Ordering::SeqCst) as *mut core::ffi::c_void);
    let nid = NOTIFYICONDATAW {
        cbSize: size_of::<NOTIFYICONDATAW>() as u32,
        hWnd: hwnd,
        uID: TRAY_UID,
        ..Default::default()
    };
    unsafe {
        let _ = Shell_NotifyIconW(NIM_DELETE, &nid);
    }
    ctx.tray_registered.store(false, Ordering::SeqCst);
}

fn queue_balloon(ctx: &AppContext, title: &str, body: &str, is_warning: bool) {
    if let Ok(mut g) = ctx.shared.lock() {
        g.balloon_title = title.to_string();
        g.balloon_body = body.to_string();
        g.balloon_is_warning = is_warning;
    }
    let hwnd = HWND(ctx.hwnd_raw.load(Ordering::SeqCst) as *mut core::ffi::c_void);
    if !hwnd.0.is_null() {
        unsafe {
            let _ = PostMessageW(hwnd, WM_APP_SHOW_BALLOON, WPARAM(0), LPARAM(0));
        }
    }
}

fn collect_panel_stats(ctx: &AppContext) -> panel::PanelStats {
    let cpid = ctx.child_pid.load(Ordering::SeqCst);
    let (app_priv, app_ws) = query_process_memory_kb(std::process::id());
    let (node_priv, _) = if cpid > 0 {
        query_process_memory_kb(cpid)
    } else {
        (0, 0)
    };

    let (vps_avail, vps_state, last_age, cooldown_secs, recent_events) = match ctx.shared.lock() {
        Ok(g) => (
            g.vps_availability.as_str(),
            g.raw_state.clone(),
            g.last_check_instant.map(|t| t.elapsed().as_secs()),
            g.auto_resume_cooldown_until
                .and_then(|u| u.checked_duration_since(Instant::now()))
                .map(|d| d.as_secs())
                .filter(|&s| s > 0),
            g.recent_events.iter().cloned().collect(),
        ),
        Err(_) => ("unknown", "unknown".to_string(), None, None, Vec::new()),
    };

    panel::PanelStats {
        app_pid: std::process::id(),
        child_node_pid: cpid,
        vps_state,
        vps_availability: vps_avail,
        failover_active: cpid > 0,
        checking_vps: ctx.checking_vps.load(Ordering::SeqCst),
        resuming_vps: ctx.resuming_vps.load(Ordering::SeqCst),
        app_private_kb: app_priv,
        app_working_kb: app_ws,
        node_private_kb: node_priv,
        uptime_secs: ctx.started_at.elapsed().as_secs(),
        last_check_age_secs: last_age,
        poll_interval_secs: POLL_INTERVAL_SECS,
        total_checks: ctx.total_checks.load(Ordering::SeqCst),
        failover_count: ctx.failover_count.load(Ordering::SeqCst),
        auto_start_enabled: is_autostart_enabled(),
        auto_resume_enabled: ctx.auto_resume_enabled.load(Ordering::SeqCst),
        auto_resume_cooldown_secs: cooldown_secs,
        tray_registered: ctx.tray_registered.load(Ordering::SeqCst),
        recent_events,
    }
}

fn show_panel_for_ctx(hwnd: HWND, ctx: &Arc<AppContext>, toggle: bool) {
    let c_stats = Arc::clone(ctx);
    let stats_fn: Rc<dyn Fn() -> panel::PanelStats> =
        Rc::new(move || collect_panel_stats(&c_stats));
    let on_hide_fn: Rc<dyn Fn()> = Rc::new(|| {
        trim_working_set();
    });
    if toggle {
        panel::toggle_panel(
            hwnd,
            ctx.icons.standby_lg,
            ctx.icons.active_lg,
            stats_fn,
            on_hide_fn,
        );
    } else {
        panel::show_panel(
            hwnd,
            ctx.icons.standby_lg,
            ctx.icons.active_lg,
            stats_fn,
            on_hide_fn,
        );
    }
}

fn show_tray_context_menu(hwnd: HWND, ctx: &Arc<AppContext>) {
    apply_dark_context_menu_theme();
    let (avail, raw_st) = ctx
        .shared
        .lock()
        .map(|g| (g.vps_availability, g.raw_state.clone()))
        .unwrap_or((VpsAvailability::Unknown, "unknown".to_string()));
    let cpid = ctx.child_pid.load(Ordering::SeqCst);
    let autostart = is_autostart_enabled();
    let resume_disabled =
        avail == VpsAvailability::Running || ctx.resuming_vps.load(Ordering::SeqCst);

    let hdr = to_wide_nul(&format!(
        "Baileys Backup  (VPS: {})",
        raw_st.to_ascii_uppercase()
    ));
    let mode = if cpid > 0 {
        to_wide_nul(&format!("Mode: Backup Lokal Aktif (PID {cpid})"))
    } else {
        to_wide_nul("Mode: Standby Pasif (0 Node.js)")
    };
    let lbl_panel = to_wide_nul("Buka Panel Statistik");
    let lbl_check = to_wide_nul("Cek Status VPS Sekarang");
    let lbl_resume = to_wide_nul("Resume / Aktifkan VPS Utama");
    let lbl_auto_resume = to_wide_nul("Auto-Resume VPS Otomatis");
    let lbl_startup = to_wide_nul("Jalankan saat Login Windows");
    let lbl_log = to_wide_nul("Buka Log Baileys Backup");
    let lbl_bot_log = to_wide_nul("Buka Log Bot WhatsApp Lokal");
    let lbl_folder = to_wide_nul("Buka Folder Proyek");
    let lbl_exit = to_wide_nul("Keluar (Matikan Baileys Backup)");
    let auto_resume = ctx.auto_resume_enabled.load(Ordering::SeqCst);

    unsafe {
        let Ok(hmenu) = CreatePopupMenu() else {
            return;
        };
        let _ = AppendMenuW(hmenu, MF_STRING, IDM_SHOW_PANEL, PCWSTR(hdr.as_ptr()));
        let _ = SetMenuDefaultItem(hmenu, IDM_SHOW_PANEL as u32, 0);
        let _ = AppendMenuW(
            hmenu,
            MF_STRING | MF_DISABLED | MF_GRAYED,
            0,
            PCWSTR(mode.as_ptr()),
        );
        let _ = AppendMenuW(hmenu, MF_SEPARATOR, 0, PCWSTR::null());
        let _ = AppendMenuW(hmenu, MF_STRING, IDM_SHOW_PANEL, PCWSTR(lbl_panel.as_ptr()));
        let _ = AppendMenuW(hmenu, MF_STRING, IDM_CHECK_NOW, PCWSTR(lbl_check.as_ptr()));
        let _ = AppendMenuW(
            hmenu,
            MF_STRING
                | if resume_disabled {
                    MF_DISABLED | MF_GRAYED
                } else {
                    windows::Win32::UI::WindowsAndMessaging::MENU_ITEM_FLAGS(0)
                },
            IDM_RESUME_VPS,
            PCWSTR(lbl_resume.as_ptr()),
        );
        let _ = AppendMenuW(
            hmenu,
            MF_STRING | if auto_resume { MF_CHECKED } else { MF_UNCHECKED },
            IDM_TOGGLE_AUTO_RESUME,
            PCWSTR(lbl_auto_resume.as_ptr()),
        );
        let _ = AppendMenuW(
            hmenu,
            MF_STRING | if autostart { MF_CHECKED } else { MF_UNCHECKED },
            IDM_TOGGLE_AUTOSTART,
            PCWSTR(lbl_startup.as_ptr()),
        );
        let _ = AppendMenuW(hmenu, MF_SEPARATOR, 0, PCWSTR::null());
        let _ = AppendMenuW(hmenu, MF_STRING, IDM_OPEN_LOG, PCWSTR(lbl_log.as_ptr()));
        let _ = AppendMenuW(
            hmenu,
            MF_STRING,
            IDM_OPEN_BOT_LOG,
            PCWSTR(lbl_bot_log.as_ptr()),
        );
        let _ = AppendMenuW(
            hmenu,
            MF_STRING,
            IDM_OPEN_FOLDER,
            PCWSTR(lbl_folder.as_ptr()),
        );
        let _ = AppendMenuW(hmenu, MF_SEPARATOR, 0, PCWSTR::null());
        let _ = AppendMenuW(hmenu, MF_STRING, IDM_EXIT, PCWSTR(lbl_exit.as_ptr()));

        let mut pt = POINT::default();
        let _ = GetCursorPos(&mut pt);
        let _ = SetForegroundWindow(hwnd);
        let selected = TrackPopupMenu(
            hmenu,
            TPM_RETURNCMD | TPM_LEFTALIGN | TPM_BOTTOMALIGN | TPM_RIGHTBUTTON,
            pt.x,
            pt.y,
            0,
            hwnd,
            None,
        )
        .0 as usize;
        let _ = PostMessageW(hwnd, WM_NULL, WPARAM(0), LPARAM(0));
        let _ = DestroyMenu(hmenu);

        if selected != 0 {
            handle_command_id(hwnd, ctx, selected);
        }
    }
}

fn open_file_in_notepad(path: &Path) {
    if !path.is_file() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(path, "");
    }
    let _ = Command::new("notepad.exe").arg(path).spawn();
}

fn request_vps_resume(ctx: &Arc<AppContext>) -> &'static str {
    let avail = ctx
        .shared
        .lock()
        .map(|g| g.vps_availability)
        .unwrap_or(VpsAvailability::Unknown);
    if avail == VpsAvailability::Running {
        record_event(ctx, "VPS utama sudah aktif (RUNNING)");
        return "already_running";
    }
    if ctx.resuming_vps.swap(true, Ordering::SeqCst) {
        return "in_progress";
    }
    ctx.resume_requested.store(true, Ordering::SeqCst);
    record_event(ctx, "Mengirim perintah aktifkan VPS...");
    "resuming"
}

fn apply_auto_resume_mode(ctx: &Arc<AppContext>, next: bool) -> bool {
    let persisted = set_auto_resume_enabled(next);
    ctx.auto_resume_enabled.store(next, Ordering::SeqCst);
    if !next {
        if let Ok(mut g) = ctx.shared.lock() {
            g.auto_resume_cooldown_until = None;
        }
    }
    let msg = if next {
        "Mode Resume VPS: OTOMATIS"
    } else {
        "Mode Resume VPS: MANUAL"
    };
    append_log(&ctx.project_root, msg);
    record_event(ctx, msg);

    if next {
        let (avail, cooldown_active) = ctx
            .shared
            .lock()
            .map(|g| {
                (
                    g.vps_availability,
                    g.auto_resume_cooldown_until
                        .is_some_and(|u| Instant::now() < u),
                )
            })
            .unwrap_or((VpsAvailability::Unknown, false));
        if avail == VpsAvailability::Down && !cooldown_active {
            ctx.force_poll.store(true, Ordering::SeqCst);
        }
    }
    persisted
}

fn handle_command_id(hwnd: HWND, ctx: &Arc<AppContext>, cmd_id: usize) {
    match cmd_id {
        IDM_SHOW_PANEL => show_panel_for_ctx(hwnd, ctx, false),
        IDM_CHECK_NOW => {
            ctx.checking_vps.store(true, Ordering::SeqCst);
            ctx.force_poll.store(true, Ordering::SeqCst);
            panel::refresh_if_visible();
        }
        IDM_RESUME_VPS => {
            let _ = request_vps_resume(ctx);
            panel::refresh_if_visible();
        }
        IDM_TOGGLE_AUTO_RESUME => {
            let next = !ctx.auto_resume_enabled.load(Ordering::SeqCst);
            let _ = apply_auto_resume_mode(ctx, next);
            panel::refresh_if_visible();
        }
        IDM_TOGGLE_AUTOSTART => {
            let next = !is_autostart_enabled();
            if set_autostart_enabled(next, &ctx.project_root) {
                let msg = if next {
                    "Auto-Start Windows diaktifkan"
                } else {
                    "Auto-Start Windows dinonaktifkan"
                };
                append_log(&ctx.project_root, msg);
                record_event(ctx, msg);
            }
            panel::refresh_if_visible();
        }
        IDM_OPEN_LOG => {
            let log_file = ctx
                .project_root
                .join("logs")
                .join("wa-standby-watchdog.log");
            open_file_in_notepad(&log_file);
        }
        IDM_OPEN_BOT_LOG => {
            let bot_log = ctx
                .project_root
                .join("logs")
                .join("wa-baileys-backup.log");
            open_file_in_notepad(&bot_log);
        }
        IDM_OPEN_FOLDER => {
            let _ = Command::new("explorer.exe").arg(&ctx.project_root).spawn();
        }
        IDM_EXIT => {
            ctx.running.store(false, Ordering::SeqCst);
            panel::destroy_panel();
            remove_tray_icon(ctx);
            unsafe {
                let _ = DestroyWindow(hwnd);
            }
        }
        _ => {}
    }
}

unsafe extern "system" fn tray_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if let Some(ctx) = APP_CTX.get() {
        if msg == ctx.taskbar_created_msg && ctx.taskbar_created_msg != 0 {
            if !add_or_update_tray_icon(ctx, true) {
                ctx.tray_retry_left.store(15, Ordering::SeqCst);
                let _ = unsafe { SetTimer(hwnd, TRAY_RETRY_TIMER_ID, 2000, None) };
            }
            return LRESULT(0);
        }

        match msg {
            WM_TIMER if wparam.0 == TRAY_RETRY_TIMER_ID => {
                let ok = add_or_update_tray_icon(ctx, true);
                let left = ctx.tray_retry_left.load(Ordering::SeqCst);
                if ok || left == 0 {
                    let _ = unsafe { KillTimer(hwnd, TRAY_RETRY_TIMER_ID) };
                } else {
                    ctx.tray_retry_left.store(left - 1, Ordering::SeqCst);
                }
                return LRESULT(0);
            }
            WM_TRAYICON => {
                let event = (lparam.0 as u32) & 0xFFFF;
                if event == WM_RBUTTONUP || event == WM_CONTEXTMENU {
                    show_tray_context_menu(hwnd, ctx);
                } else if event == WM_LBUTTONUP
                    || event == NIN_SELECT
                    || event == NIN_KEYSELECT
                {
                    show_panel_for_ctx(hwnd, ctx, true);
                } else if event == WM_LBUTTONDBLCLK || event == NIN_BALLOONUSERCLICK {
                    show_panel_for_ctx(hwnd, ctx, false);
                }
                return LRESULT(0);
            }
            WM_APP_UPDATE_TRAY => {
                add_or_update_tray_icon(ctx, false);
                let cpid = ctx.child_pid.load(Ordering::SeqCst);
                let big = ctx.icons.panel_icon(cpid > 0);
                let sm = ctx.icons.tray_icon(cpid > 0);
                unsafe {
                    let _ = SendMessageW(hwnd, WM_SETICON, WPARAM(ICON_BIG as usize), LPARAM(big.0 as isize));
                    let _ = SendMessageW(hwnd, WM_SETICON, WPARAM(ICON_SMALL as usize), LPARAM(sm.0 as isize));
                }
                panel::refresh_if_visible();
                return LRESULT(0);
            }
            WM_APP_SHOW_BALLOON => {
                add_or_update_tray_icon(ctx, false);
                show_tray_balloon(ctx);
                return LRESULT(0);
            }
            WM_APP_SHOW_PANEL => {
                show_panel_for_ctx(hwnd, ctx, false);
                return LRESULT(0);
            }
            WM_APP_TOGGLE_PANEL => {
                show_panel_for_ctx(hwnd, ctx, true);
                return LRESULT(0);
            }
            WM_COMMAND => {
                let cmd_id = wparam.0 & 0xFFFF;
                handle_command_id(hwnd, ctx, cmd_id);
                return LRESULT(0);
            }
            WM_QUERYENDSESSION => return LRESULT(1),
            WM_ENDSESSION if wparam.0 != 0 => {
                ctx.running.store(false, Ordering::SeqCst);
                panel::destroy_panel();
                remove_tray_icon(ctx);
                unsafe { PostQuitMessage(0) };
                return LRESULT(0);
            }
            WM_CLOSE => {
                ctx.running.store(false, Ordering::SeqCst);
                panel::destroy_panel();
                remove_tray_icon(ctx);
                let _ = unsafe { DestroyWindow(hwnd) };
                return LRESULT(0);
            }
            WM_DESTROY => {
                let _ = unsafe { KillTimer(hwnd, TRAY_RETRY_TIMER_ID) };
                ctx.running.store(false, Ordering::SeqCst);
                panel::destroy_panel();
                remove_tray_icon(ctx);
                unsafe { PostQuitMessage(0) };
                return LRESULT(0);
            }
            _ => {}
        }
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn handle_control_client(mut stream: TcpStream, ctx: &Arc<AppContext>) {
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
    let hwnd = HWND(ctx.hwnd_raw.load(Ordering::SeqCst) as *mut core::ffi::c_void);

    if cmd == "STOP" {
        ctx.running.store(false, Ordering::SeqCst);
        if !hwnd.0.is_null() {
            unsafe {
                let _ = PostMessageW(hwnd, WM_CLOSE, WPARAM(0), LPARAM(0));
            }
        }
        let _ = stream.write_all(b"{\"ok\":true,\"action\":\"stopping\"}\n");
        let _ = stream.flush();
        return;
    }

    if cmd == "CHECK_NOW" {
        ctx.checking_vps.store(true, Ordering::SeqCst);
        ctx.force_poll.store(true, Ordering::SeqCst);
        let _ = stream.write_all(b"{\"ok\":true,\"action\":\"polling\"}\n");
        let _ = stream.flush();
        return;
    }

    if cmd == "RESUME_VPS" {
        let action = request_vps_resume(ctx);
        if !hwnd.0.is_null() {
            unsafe {
                let _ = PostMessageW(hwnd, WM_APP_UPDATE_TRAY, WPARAM(0), LPARAM(0));
            }
        }
        let resp = format!("{{\"ok\":true,\"action\":\"{action}\"}}\n");
        let _ = stream.write_all(resp.as_bytes());
        let _ = stream.flush();
        return;
    }

    if cmd == "TOGGLE_AUTO_RESUME" || cmd == "SET_AUTO_RESUME_ON" || cmd == "SET_AUTO_RESUME_OFF" {
        let next = match cmd.as_str() {
            "SET_AUTO_RESUME_ON" => true,
            "SET_AUTO_RESUME_OFF" => false,
            _ => !ctx.auto_resume_enabled.load(Ordering::SeqCst),
        };
        let _ = apply_auto_resume_mode(ctx, next);
        if !hwnd.0.is_null() {
            unsafe {
                let _ = PostMessageW(hwnd, WM_APP_UPDATE_TRAY, WPARAM(0), LPARAM(0));
            }
        }
        let resp = format!(
            "{{\"ok\":true,\"autoResumeEnabled\":{}}}\n",
            if next { "true" } else { "false" }
        );
        let _ = stream.write_all(resp.as_bytes());
        let _ = stream.flush();
        return;
    }

    if cmd == "SHOW_PANEL" || cmd == "POPUP" {
        if !hwnd.0.is_null() {
            unsafe {
                let _ = PostMessageW(hwnd, WM_APP_SHOW_PANEL, WPARAM(0), LPARAM(0));
            }
        }
        let _ = stream.write_all(b"{\"ok\":true,\"action\":\"panel_shown\"}\n");
        let _ = stream.flush();
        return;
    }

    let (avail, raw_st, last_ts, cooldown_secs) = match ctx.shared.lock() {
        Ok(g) => (
            g.vps_availability.as_str(),
            g.raw_state.clone(),
            g.last_check_epoch,
            g.auto_resume_cooldown_until
                .and_then(|u| u.checked_duration_since(Instant::now()))
                .map(|d| d.as_secs())
                .unwrap_or(0),
        ),
        Err(_) => ("unknown", "lock_err".to_string(), 0, 0),
    };
    let cpid = ctx.child_pid.load(Ordering::SeqCst);
    let (app_priv_kb, app_ws_kb) = query_process_memory_kb(std::process::id());
    let (node_priv_kb, _) = if cpid > 0 {
        query_process_memory_kb(cpid)
    } else {
        (0, 0)
    };
    let tray_active = ctx.tray_registered.load(Ordering::SeqCst);
    let resuming_vps = ctx.resuming_vps.load(Ordering::SeqCst);
    let auto_resume_enabled = ctx.auto_resume_enabled.load(Ordering::SeqCst);
    let resp = format!(
        "{{\"ok\":true,\"appName\":\"Baileys Backup\",\"watchdogPid\":{},\"vpsAvailability\":\"{}\",\"vpsState\":\"{}\",\"failoverActive\":{},\"childNodePid\":{},\"lastCheckEpoch\":{},\"uptimeSecs\":{},\"trayActive\":{},\"resumingVps\":{},\"autoResumeEnabled\":{},\"autoResumeCooldownSecs\":{},\"appPrivateKb\":{},\"appWorkingKb\":{},\"nodePrivateKb\":{},\"totalChecks\":{},\"failoverCount\":{}}}\n",
        std::process::id(),
        avail,
        raw_st,
        if cpid > 0 { "true" } else { "false" },
        cpid,
        last_ts,
        ctx.started_at.elapsed().as_secs(),
        if tray_active { "true" } else { "false" },
        if resuming_vps { "true" } else { "false" },
        if auto_resume_enabled { "true" } else { "false" },
        cooldown_secs,
        app_priv_kb,
        app_ws_kb,
        node_priv_kb,
        ctx.total_checks.load(Ordering::SeqCst),
        ctx.failover_count.load(Ordering::SeqCst),
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn notify_existing_instance_show_panel() -> bool {
    if let Ok(mut stream) =
        TcpStream::connect_timeout(&CONTROL_ADDR.parse().unwrap(), Duration::from_millis(800))
    {
        let _ = stream.write_all(b"SHOW_PANEL\n");
        let _ = stream.flush();
        return true;
    }
    false
}

fn execute_vps_resume_attempt(
    ctx: &Arc<AppContext>,
    is_auto: bool,
    auto_resume_failures: &mut u32,
    auto_resume_not_before: &mut Option<Instant>,
    fast_polls_left: &mut u8,
    next_poll: &mut Instant,
) {
    let current_raw = ctx
        .shared
        .lock()
        .map(|g| g.raw_state.clone())
        .unwrap_or_default();
    match trigger_vps_resume(&ctx.project_root, &current_raw) {
        Ok((action, code)) => {
            *auto_resume_failures = 0;
            *auto_resume_not_before = Some(Instant::now() + Duration::from_secs(60));
            if let Ok(mut g) = ctx.shared.lock() {
                g.auto_resume_cooldown_until = None;
            }
            let msg = if is_auto {
                format!("Auto-Resume VPS diterima ({action}, HTTP {code}). Menunggu aktif...")
            } else {
                format!("Permintaan {action} VPS diterima (HTTP {code}). Menunggu aktif...")
            };
            append_log(&ctx.project_root, &msg);
            record_event(ctx, &msg);
            queue_balloon(
                ctx,
                if is_auto {
                    "Baileys Backup - Auto-Resume VPS"
                } else {
                    "Baileys Backup - Mengaktifkan VPS"
                },
                "Permintaan aktifkan VPS diterima. Bot lokal akan berhenti otomatis saat VPS RUNNING.",
                false,
            );
            *fast_polls_left = 10;
            *next_poll = Instant::now() + Duration::from_secs(3);
        }
        Err(err) => {
            let show_warn = !is_auto || *auto_resume_failures == 0;
            if err.is_cooldown || is_auto {
                let backoff = compute_auto_resume_backoff_secs(&err, *auto_resume_failures);
                *auto_resume_failures = auto_resume_failures.saturating_add(1);
                let until = Instant::now() + Duration::from_secs(backoff);
                *auto_resume_not_before = Some(until);
                if let Ok(mut g) = ctx.shared.lock() {
                    g.auto_resume_cooldown_until = Some(until);
                }
            }
            let prefix = if is_auto {
                "Auto-Resume VPS gagal"
            } else {
                "Gagal aktifkan VPS"
            };
            let msg = format!("{prefix}: {}", err.message);
            append_log(&ctx.project_root, &msg);
            record_event(ctx, &msg);
            if show_warn {
                queue_balloon(
                    ctx,
                    if is_auto {
                        "Baileys Backup - Auto-Resume Ditunda"
                    } else {
                        "Baileys Backup - Gagal Aktifkan VPS"
                    },
                    &err.message,
                    true,
                );
            }
        }
    }
    ctx.resuming_vps.store(false, Ordering::SeqCst);
    let hwnd = HWND(ctx.hwnd_raw.load(Ordering::SeqCst) as *mut core::ffi::c_void);
    if !hwnd.0.is_null() {
        unsafe {
            let _ = PostMessageW(hwnd, WM_APP_UPDATE_TRAY, WPARAM(0), LPARAM(0));
        }
    }
}

fn run_worker_loop(listener: TcpListener, ctx: Arc<AppContext>) {
    let mut child_node: Option<Child> = None;
    let mut next_poll = Instant::now();
    let mut fast_polls_left: u8 = 0;
    let mut auto_resume_not_before: Option<Instant> = None;
    let mut auto_resume_failures: u32 = 0;

    while ctx.running.load(Ordering::SeqCst) {
        while let Ok((stream, _)) = listener.accept() {
            handle_control_client(stream, &ctx);
        }
        if !ctx.running.load(Ordering::SeqCst) {
            break;
        }

        if !ctx.auto_resume_enabled.load(Ordering::SeqCst) {
            auto_resume_not_before = None;
            auto_resume_failures = 0;
        }

        // Check if child node.exe exited on its own
        if let Some(ref mut ch) = child_node {
            if let Ok(Some(status)) = ch.try_wait() {
                let msg = format!("Bot lokal berhenti mandiri ({status})");
                append_log(&ctx.project_root, &msg);
                record_event(&ctx, &msg);
                child_node = None;
                ctx.child_pid.store(0, Ordering::SeqCst);
                let hwnd = HWND(ctx.hwnd_raw.load(Ordering::SeqCst) as *mut core::ffi::c_void);
                if !hwnd.0.is_null() {
                    unsafe {
                        let _ = PostMessageW(hwnd, WM_APP_UPDATE_TRAY, WPARAM(0), LPARAM(0));
                    }
                }
            }
        }

        if ctx.resume_requested.swap(false, Ordering::SeqCst) {
            execute_vps_resume_attempt(
                &ctx,
                false,
                &mut auto_resume_failures,
                &mut auto_resume_not_before,
                &mut fast_polls_left,
                &mut next_poll,
            );
        }

        let manual_check = ctx.force_poll.swap(false, Ordering::SeqCst);
        if manual_check || Instant::now() >= next_poll {
            let (avail, raw_st) = query_vps_state(&ctx.project_root);
            ctx.total_checks.fetch_add(1, Ordering::SeqCst);
            ctx.checking_vps.store(false, Ordering::SeqCst);

            let mut state_changed = false;
            if let Ok(mut g) = ctx.shared.lock() {
                if g.raw_state != raw_st {
                    state_changed = true;
                    let msg = format!(
                        "VPS: {} -> {}",
                        g.raw_state.to_ascii_uppercase(),
                        raw_st.to_ascii_uppercase()
                    );
                    append_log(
                        &ctx.project_root,
                        &format!("Status VPS: {} ({}) -> {}", g.raw_state, avail.as_str(), raw_st),
                    );
                    drop(g);
                    record_event(&ctx, &msg);
                    if let Ok(mut g2) = ctx.shared.lock() {
                        g2.vps_availability = avail;
                        g2.raw_state = raw_st.clone();
                        g2.last_check_epoch = now_epoch_secs();
                        g2.last_check_instant = Some(Instant::now());
                    }
                } else {
                    g.vps_availability = avail;
                    g.raw_state = raw_st.clone();
                    g.last_check_epoch = now_epoch_secs();
                    g.last_check_instant = Some(Instant::now());
                }
            }

            match avail {
                VpsAvailability::Running => {
                    auto_resume_failures = 0;
                    auto_resume_not_before = None;
                    if let Ok(mut g) = ctx.shared.lock() {
                        g.auto_resume_cooldown_until = None;
                    }
                    if child_node.is_some() {
                        stop_local_baileys(
                            &ctx.project_root,
                            &mut child_node,
                            "VPS utama kembali running",
                        );
                        ctx.child_pid.store(0, Ordering::SeqCst);
                        record_event(&ctx, "Standby aktif: VPS RUNNING, Node lokal dimatikan");
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
                        if pid > 0 {
                            ctx.failover_count.fetch_add(1, Ordering::SeqCst);
                            record_event(&ctx, &format!("Failover aktif di laptop (PID {pid})"));
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

                    if ctx.auto_resume_enabled.load(Ordering::SeqCst)
                        && !ctx.resuming_vps.load(Ordering::SeqCst)
                    {
                        let ready = auto_resume_not_before
                            .map(|t| Instant::now() >= t)
                            .unwrap_or(true);
                        if ready && !ctx.resuming_vps.swap(true, Ordering::SeqCst) {
                            let hwnd =
                                HWND(ctx.hwnd_raw.load(Ordering::SeqCst) as *mut core::ffi::c_void);
                            if !hwnd.0.is_null() {
                                unsafe {
                                    let _ =
                                        PostMessageW(hwnd, WM_APP_UPDATE_TRAY, WPARAM(0), LPARAM(0));
                                }
                            }
                            execute_vps_resume_attempt(
                                &ctx,
                                true,
                                &mut auto_resume_failures,
                                &mut auto_resume_not_before,
                                &mut fast_polls_left,
                                &mut next_poll,
                            );
                        }
                    }
                }
                VpsAvailability::Transient | VpsAvailability::Unknown => {}
            }

            let hwnd = HWND(ctx.hwnd_raw.load(Ordering::SeqCst) as *mut core::ffi::c_void);
            if !hwnd.0.is_null() && (state_changed || manual_check) {
                unsafe {
                    let _ = PostMessageW(hwnd, WM_APP_UPDATE_TRAY, WPARAM(0), LPARAM(0));
                }
            }
            if manual_check {
                let cpid = ctx.child_pid.load(Ordering::SeqCst);
                let msg = if cpid > 0 {
                    format!(
                        "Cek manual: VPS {}, Backup AKTIF (PID {cpid})",
                        raw_st.to_ascii_uppercase()
                    )
                } else {
                    format!(
                        "Cek manual: VPS {}, Standby Pasif",
                        raw_st.to_ascii_uppercase()
                    )
                };
                record_event(&ctx, &msg);
                queue_balloon(&ctx, "Baileys Backup — Cek Status VPS", &msg, false);
            }

            if avail == VpsAvailability::Running {
                fast_polls_left = 0;
                next_poll = Instant::now() + Duration::from_secs(POLL_INTERVAL_SECS);
            } else if fast_polls_left > 0 {
                fast_polls_left -= 1;
                next_poll = Instant::now() + Duration::from_secs(3);
            } else {
                next_poll = Instant::now() + Duration::from_secs(POLL_INTERVAL_SECS);
            }
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

    let project_root = match locate_project_root(&args) {
        Some(p) => p,
        None => return,
    };
    let _ = env::set_current_dir(&project_root);

    // Single-instance guard + control socket
    let listener = match TcpListener::bind(CONTROL_ADDR) {
        Ok(l) => l,
        Err(_) => {
            if !is_silent_launch {
                let _ = notify_existing_instance_show_panel();
            }
            return;
        }
    };
    let _ = listener.set_nonblocking(true);

    // 1. Pastikan thread GUI berjalan pada desktop interaktif "Default" tempat taskbar berada
    let desktop_note = ensure_interactive_default_desktop();

    // 2. PerMonitorV2 DPI & Apartment COM (wajib untuk Shell_NotifyIconW Windows 11)
    enable_dpi_awareness();
    let com_hr = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };

    let icons = match icon::AppIcons::load() {
        Ok(ic) => ic,
        Err(e) => {
            append_log(&project_root, &format!("Gagal memuat AppIcons: {e}"));
            if com_hr.is_ok() {
                unsafe { CoUninitialize() };
            }
            return;
        }
    };

    let taskbar_created_msg = unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) };

    let ctx = Arc::new(AppContext {
        project_root: project_root.clone(),
        running: Arc::new(AtomicBool::new(true)),
        force_poll: Arc::new(AtomicBool::new(false)),
        checking_vps: Arc::new(AtomicBool::new(false)),
        resume_requested: Arc::new(AtomicBool::new(false)),
        resuming_vps: Arc::new(AtomicBool::new(false)),
        auto_resume_enabled: Arc::new(AtomicBool::new(is_auto_resume_enabled())),
        tray_registered: Arc::new(AtomicBool::new(false)),
        tray_retry_left: AtomicU8::new(15),
        child_pid: Arc::new(AtomicU32::new(0)),
        total_checks: Arc::new(AtomicU64::new(0)),
        failover_count: Arc::new(AtomicU64::new(0)),
        shared: Arc::new(Mutex::new(SharedState {
            vps_availability: VpsAvailability::Unknown,
            raw_state: "mengecek...".to_string(),
            last_check_epoch: 0,
            last_check_instant: None,
            auto_resume_cooldown_until: None,
            balloon_title: String::new(),
            balloon_body: String::new(),
            balloon_is_warning: false,
            recent_events: VecDeque::from(["Baileys Backup dimulai di System Tray".to_string()]),
        })),
        hwnd_raw: AtomicIsize::new(0),
        icons,
        taskbar_created_msg,
        started_at: Instant::now(),
    });
    let _ = APP_CTX.set(Arc::clone(&ctx));

    append_log(
        &project_root,
        &format!(
            "Baileys Backup dimulai (PID {}, desktop: {}, COM: 0x{:08X}, interval {}s).",
            std::process::id(),
            desktop_note.as_deref().unwrap_or("unknown"),
            com_hr.0 as u32,
            POLL_INTERVAL_SECS
        ),
    );

    unsafe {
        let hinstance: HMODULE = GetModuleHandleW(None).unwrap_or_default();
        let wc = WNDCLASSEXW {
            cbSize: size_of::<WNDCLASSEXW>() as u32,
            lpfnWndProc: Some(tray_wnd_proc),
            hInstance: hinstance.into(),
            hIcon: ctx.icons.standby_lg,
            hIconSm: ctx.icons.standby_sm,
            lpszClassName: w!("BaileysBackupTrayWindowClass"),
            ..Default::default()
        };
        let _ = RegisterClassExW(&wc);

        if let Ok(hwnd) = CreateWindowExW(
            WS_EX_TOOLWINDOW,
            w!("BaileysBackupTrayWindowClass"),
            w!("Baileys Backup"),
            WS_OVERLAPPED,
            0,
            0,
            0,
            0,
            None,
            None,
            hinstance,
            None,
        ) {
            ctx.hwnd_raw.store(hwnd.0 as isize, Ordering::SeqCst);
            let _ = SendMessageW(
                hwnd,
                WM_SETICON,
                WPARAM(ICON_BIG as usize),
                LPARAM(ctx.icons.standby_lg.0 as isize),
            );
            let _ = SendMessageW(
                hwnd,
                WM_SETICON,
                WPARAM(ICON_SMALL as usize),
                LPARAM(ctx.icons.standby_sm.0 as isize),
            );
            if !add_or_update_tray_icon(&ctx, true) {
                let _ = SetTimer(hwnd, TRAY_RETRY_TIMER_ID, 2000, None);
            }
        } else {
            let err = std::io::Error::last_os_error();
            append_log(&project_root, &format!("CreateWindowExW host gagal: {err}"));
        }
    }

    // Pangkas working set awal agar idle footprint langsung ultra-rendah (~1.5-3 MB)
    trim_working_set();

    let worker_ctx = Arc::clone(&ctx);
    let worker_handle = thread::spawn(move || {
        run_worker_loop(listener, worker_ctx);
    });

    unsafe {
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }

    ctx.running.store(false, Ordering::SeqCst);
    let _ = worker_handle.join();

    if com_hr.is_ok() {
        unsafe { CoUninitialize() };
    }
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

    #[test]
    fn notifyicondata_size_matches_x64_shell32_contract() {
        assert_eq!(size_of::<NOTIFYICONDATAW>(), 976);
    }

    #[test]
    fn parse_project_dir_arg_extracts_both_forms() {
        let form_split = vec![
            "BaileysBackup.exe".to_string(),
            "--silent".to_string(),
            "--project-dir".to_string(),
            "D:\\code\\project\\projek_no_name".to_string(),
        ];
        assert_eq!(
            parse_project_dir_arg(&form_split),
            Some(PathBuf::from("D:\\code\\project\\projek_no_name"))
        );

        let form_eq = vec![
            "BaileysBackup.exe".to_string(),
            "--project-dir=\"D:\\code\\project\\projek_no_name\"".to_string(),
        ];
        assert_eq!(
            parse_project_dir_arg(&form_eq),
            Some(PathBuf::from("D:\\code\\project\\projek_no_name"))
        );
    }

    #[test]
    fn choose_vps_action_endpoint_maps_suspended_vs_stopped() {
        assert_eq!(choose_vps_action_endpoint("suspended"), "resume");
        assert_eq!(choose_vps_action_endpoint("paused"), "resume");
        assert_eq!(choose_vps_action_endpoint("stopped"), "start");
        assert_eq!(choose_vps_action_endpoint("OFF"), "start");
        assert_eq!(choose_vps_action_endpoint("unknown"), "resume");
    }

    #[test]
    fn split_curl_body_and_status_parses_http_code_and_body() {
        let (code, body) = split_curl_body_and_status("{\"id\":\"op_1\",\"status\":\"pending\"}\n202\n");
        assert_eq!(code, 202);
        assert_eq!(body, "{\"id\":\"op_1\",\"status\":\"pending\"}");

        let (code_empty, body_empty) = split_curl_body_and_status("\n204");
        assert_eq!(code_empty, 204);
        assert_eq!(body_empty, "");

        let (code_bad, body_bad) = split_curl_body_and_status("curl connection timeout");
        assert_eq!(code_bad, 0);
        assert_eq!(body_bad, "curl connection timeout");
    }

    #[test]
    fn should_fallback_resume_to_start_handles_cooldown_and_state_errors() {
        let cooldown_json = r#"{"error":{"code":"machine_cooldown","message":"The machine is resting"}}"#;
        assert!(!should_fallback_resume_to_start(409, cooldown_json));
        assert!(should_fallback_resume_to_start(
            409,
            r#"{"error":{"code":"invalid_state","message":"machine is stopped"}}"#
        ));
        assert!(should_fallback_resume_to_start(404, "{}"));
        assert!(!should_fallback_resume_to_start(403, "{}"));
    }

    #[test]
    fn format_vps_resume_error_produces_clear_indonesian_messages() {
        let cooldown = r#"{"error":{"code":"machine_cooldown","retryAfterSeconds":420}}"#;
        assert_eq!(
            format_vps_resume_error(409, cooldown),
            "VPS sedang cooldown (coba lagi dalam ~7m)"
        );
        assert_eq!(
            format_vps_resume_error(403, "{}"),
            "API key ditolak / butuh izin machines:write (HTTP 403)"
        );
        assert_eq!(
            format_vps_resume_error(500, r#"{"error":{"message":"backend busy"}}"#),
            "HTTP 500: backend busy"
        );
    }

    #[test]
    fn compute_auto_resume_backoff_secs_respects_cooldown_and_failures() {
        let cooldown_with_retry = VpsResumeError {
            status: 409,
            is_cooldown: true,
            retry_after_secs: Some(420),
            message: "cooldown".to_string(),
        };
        assert_eq!(compute_auto_resume_backoff_secs(&cooldown_with_retry, 0), 430);

        let cooldown_no_retry = VpsResumeError {
            status: 409,
            is_cooldown: true,
            retry_after_secs: None,
            message: "cooldown".to_string(),
        };
        assert_eq!(compute_auto_resume_backoff_secs(&cooldown_no_retry, 0), 310);

        let auth_err = VpsResumeError {
            status: 403,
            is_cooldown: false,
            retry_after_secs: None,
            message: "forbidden".to_string(),
        };
        assert_eq!(compute_auto_resume_backoff_secs(&auth_err, 0), 1800);

        let rate_err = VpsResumeError {
            status: 429,
            is_cooldown: false,
            retry_after_secs: Some(90),
            message: "rate limited".to_string(),
        };
        assert_eq!(compute_auto_resume_backoff_secs(&rate_err, 0), 100);

        let transient_err = VpsResumeError {
            status: 500,
            is_cooldown: false,
            retry_after_secs: None,
            message: "server error".to_string(),
        };
        assert_eq!(compute_auto_resume_backoff_secs(&transient_err, 0), 120);
        assert_eq!(compute_auto_resume_backoff_secs(&transient_err, 1), 300);
        assert_eq!(compute_auto_resume_backoff_secs(&transient_err, 2), 600);
        assert_eq!(compute_auto_resume_backoff_secs(&transient_err, 5), 600);
    }
}
