use std::{
    cell::Cell,
    ffi::c_void,
    mem::size_of,
    rc::Rc,
    time::Instant,
};
use windows::{
    Win32::{
        Foundation::{COLORREF, HWND, LPARAM, POINT, RECT, WPARAM},
        Graphics::{
            Dwm::{
                DWMWA_BORDER_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWA_WINDOW_CORNER_PREFERENCE,
                DWMWCP_ROUND, DwmSetWindowAttribute,
            },
            Gdi::{
                BeginPaint, BitBlt, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, CreateCompatibleBitmap,
                CreateCompatibleDC, CreateFontW, CreatePen, CreateSolidBrush, DEFAULT_CHARSET,
                DEFAULT_PITCH, DT_CENTER, DT_END_ELLIPSIS, DT_LEFT, DT_NOPREFIX, DT_SINGLELINE,
                DT_VCENTER, DeleteDC, DeleteObject, DrawTextW, EndPaint, FF_DONTCARE, FW_BOLD,
                FW_NORMAL, FW_SEMIBOLD, FillRect, GetMonitorInfoW, HBITMAP, HBRUSH, HFONT,
                InvalidateRect, MONITOR_DEFAULTTOPRIMARY, MONITORINFO, MonitorFromPoint,
                MonitorFromWindow, OUT_DEFAULT_PRECIS, PAINTSTRUCT, PS_SOLID, RoundRect, SRCCOPY,
                SelectObject, SetBkMode, SetTextColor, TRANSPARENT,
            },
        },
        System::LibraryLoader::GetModuleHandleW,
        UI::{
            HiDpi::GetDpiForWindow,
            Input::KeyboardAndMouse::{
                ReleaseCapture, SetCapture, TME_LEAVE, TRACKMOUSEEVENT, TrackMouseEvent, VK_ESCAPE,
            },
            WindowsAndMessaging::{
                CS_HREDRAW, CS_VREDRAW, CreateWindowExW, DI_NORMAL, DefWindowProcW, DestroyWindow,
                DrawIconEx, GWLP_USERDATA, GetClientRect, GetCursorPos, GetWindowLongPtrW, HICON,
                HWND_TOPMOST, ICON_BIG, ICON_SMALL, IDC_ARROW, IsWindow, IsWindowVisible,
                KillTimer, LoadCursorW, PostMessageW, RegisterClassExW, SW_HIDE, SW_SHOW,
                SWP_NOACTIVATE, SWP_SHOWWINDOW, SendMessageW, SetForegroundWindow, SetTimer,
                SetWindowLongPtrW, SetWindowPos, ShowWindow, WA_INACTIVE, WM_ACTIVATE, WM_CLOSE,
                WM_COMMAND, WM_DESTROY, WM_ERASEBKGND, WM_KEYDOWN, WM_LBUTTONDOWN, WM_LBUTTONUP,
                WM_MOUSEMOVE, WM_PAINT, WM_SETICON, WM_TIMER, WNDCLASSEXW, WS_CLIPCHILDREN,
                WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
            },
        },
    },
    core::{PCWSTR, w},
};

const PANEL_CLASS: PCWSTR = w!("BaileysBackupStatsPanel");
const PANEL_REFRESH_TIMER_ID: usize = 701;
const WM_MOUSELEAVE_MSG: u32 = 0x02A3;
const LOGICAL_WIDTH: i32 = 424;
const LOGICAL_HEIGHT: i32 = 668;

pub const CMD_CHECK_NOW: usize = 1002;
pub const CMD_OPEN_LOG: usize = 1003;
pub const CMD_OPEN_BOT_LOG: usize = 1004;
pub const CMD_OPEN_FOLDER: usize = 1005;
pub const CMD_TOGGLE_AUTOSTART: usize = 1006;
pub const CMD_RESUME_VPS: usize = 1007;
pub const CMD_TOGGLE_AUTO_RESUME: usize = 1008;
pub const CMD_EXIT: usize = 1009;
pub const CMD_PING_VPS: usize = 1010;
pub const CMD_TOGGLE_KEEPALIVE: usize = 1011;

#[derive(Clone, Debug)]
pub struct PanelStats {
    pub app_pid: u32,
    pub child_node_pid: u32,
    pub instabox_configured: bool,
    pub vps_state: String,
    pub vps_availability: &'static str,
    pub runtime_remaining_mins: Option<u64>,
    pub failover_active: bool,
    pub checking_vps: bool,
    pub resuming_vps: bool,
    pub pinging_vps: bool,
    pub app_private_kb: u64,
    pub app_working_kb: u64,
    pub node_private_kb: u64,
    pub uptime_secs: u64,
    pub last_check_age_secs: Option<u64>,
    pub poll_interval_secs: u64,
    pub total_checks: u64,
    pub failover_count: u64,
    pub auto_start_enabled: bool,
    pub auto_resume_enabled: bool,
    pub auto_resume_cooldown_secs: Option<u64>,
    pub keepalive_enabled: bool,
    pub keepalive_ping_count: u64,
    pub keepalive_fail_count: u64,
    pub keepalive_consecutive_failures: u64,
    pub keepalive_last_error: Option<String>,
    pub keepalive_last_ping_latency_ms: Option<u64>,
    pub keepalive_last_ping_source: Option<String>,
    pub keepalive_interval_secs: u64,
    pub keepalive_lease_ttl_secs: u64,
    pub keepalive_idle_window_secs: u64,
    pub keepalive_lease_remaining_secs: Option<u64>,
    pub keepalive_idle_secs: Option<u64>,
    pub keepalive_pause_in_secs: Option<u64>,
    pub keepalive_next_ping_in_secs: Option<u64>,
    pub keepalive_idle_bar_pct: u8,
    pub keepalive_at_risk: bool,
    pub tray_registered: bool,
    pub recent_events: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HitTarget {
    Close,
    ToggleAutoStart,
    ToggleAutoResume,
    ToggleKeepalive,
    PingVps,
    ResumeVps,
    CheckNow,
    OpenWatchdogLog,
    OpenBotLog,
    OpenFolder,
    ExitApp,
}

#[derive(Clone, Copy, Debug)]
struct Layout {
    width: i32,
    height: i32,
    pad: i32,
    close_btn: RECT,
    card_vps: RECT,
    card_bot: RECT,
    card_ram: RECT,
    card_stats: RECT,
    row_config: RECT,
    toggle_pill: RECT,
    toggle_auto_resume_pill: RECT,
    toggle_keepalive_pill: RECT,
    card_logs: RECT,
    btn_ping: RECT,
    btn_resume: RECT,
    btn_check: RECT,
    btn_log_app: RECT,
    btn_log_wa: RECT,
    btn_folder: RECT,
    btn_exit: RECT,
}

const fn rgb(r: u8, g: u8, b: u8) -> COLORREF {
    COLORREF(((b as u32) << 16) | ((g as u32) << 8) | (r as u32))
}

#[inline]
fn sc(px: i32, dpi: i32) -> i32 {
    (px * dpi.max(96) + 48) / 96
}

fn mk_rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
    RECT {
        left,
        top,
        right,
        bottom,
    }
}

fn pt_in_rect(rc: RECT, x: i32, y: i32) -> bool {
    x >= rc.left && x < rc.right && y >= rc.top && y < rc.bottom
}

fn compute_layout(dpi: i32) -> Layout {
    let w = sc(LOGICAL_WIDTH, dpi);
    let h = sc(LOGICAL_HEIGHT, dpi);
    let pad = sc(14, dpi);
    let gap = sc(8, dpi);
    let inner_w = w - pad * 2;

    let close_sz = sc(28, dpi);
    let close_btn = mk_rect(w - pad - close_sz, sc(14, dpi), w - pad, sc(14, dpi) + close_sz);

    // 2x2 KPI grid
    let grid_top = sc(63, dpi);
    let card_w = (inner_w - gap) / 2;
    let card_h = sc(74, dpi);
    let row2_top = grid_top + card_h + gap;

    let card_vps = mk_rect(pad, grid_top, pad + card_w, grid_top + card_h);
    let card_bot = mk_rect(pad + card_w + gap, grid_top, w - pad, grid_top + card_h);
    let card_ram = mk_rect(pad, row2_top, pad + card_w, row2_top + card_h);
    let card_stats = mk_rect(pad + card_w + gap, row2_top, w - pad, row2_top + card_h);

    // Config card: Row A (Auto-Start) + Row B (Auto-Resume) + Row C (Auto-Ping Keepalive)
    let cfg_top = row2_top + card_h + gap;
    let cfg_h = sc(216, dpi);
    let row_config = mk_rect(pad, cfg_top, w - pad, cfg_top + cfg_h);
    let pill_w = sc(86, dpi);
    let pill_h = sc(24, dpi);
    let pill_right = w - pad - sc(12, dpi);
    let toggle_pill = mk_rect(
        pill_right - pill_w,
        cfg_top + sc(10, dpi),
        pill_right,
        cfg_top + sc(10, dpi) + pill_h,
    );
    let toggle_auto_resume_pill = mk_rect(
        pill_right - pill_w,
        cfg_top + sc(57, dpi),
        pill_right,
        cfg_top + sc(57, dpi) + pill_h,
    );
    let toggle_keepalive_pill = mk_rect(
        pill_right - pill_w,
        cfg_top + sc(99, dpi),
        pill_right,
        cfg_top + sc(99, dpi) + pill_h,
    );

    // Recent events log card
    let logs_top = cfg_top + cfg_h + gap;
    let logs_h = sc(84, dpi);
    let card_logs = mk_rect(pad, logs_top, w - pad, logs_top + logs_h);

    // Action buttons (Row 1: 3 columns — Ping VPS / Resume VPS / Cek Status)
    let btn1_top = logs_top + logs_h + sc(10, dpi);
    let btn1_h = sc(34, dpi);
    let col3_gap = sc(8, dpi);
    let col3_w = (inner_w - col3_gap * 2) / 3;
    let btn_ping = mk_rect(pad, btn1_top, pad + col3_w, btn1_top + btn1_h);
    let btn_resume = mk_rect(
        pad + col3_w + col3_gap,
        btn1_top,
        pad + col3_w * 2 + col3_gap,
        btn1_top + btn1_h,
    );
    let btn_check = mk_rect(pad + (col3_w + col3_gap) * 2, btn1_top, w - pad, btn1_top + btn1_h);

    // Row 2: Log App / Log Bot WA / Folder Proyek
    let btn2_top = btn1_top + btn1_h + sc(8, dpi);
    let btn2_h = sc(30, dpi);
    let btn_log_app = mk_rect(pad, btn2_top, pad + col3_w, btn2_top + btn2_h);
    let btn_log_wa = mk_rect(
        pad + col3_w + col3_gap,
        btn2_top,
        pad + col3_w * 2 + col3_gap,
        btn2_top + btn2_h,
    );
    let btn_folder = mk_rect(pad + (col3_w + col3_gap) * 2, btn2_top, w - pad, btn2_top + btn2_h);

    let btn3_top = btn2_top + btn2_h + sc(8, dpi);
    let btn3_h = sc(28, dpi);
    let btn_exit = mk_rect(pad, btn3_top, w - pad, btn3_top + btn3_h);

    Layout {
        width: w,
        height: h,
        pad,
        close_btn,
        card_vps,
        card_bot,
        card_ram,
        card_stats,
        row_config,
        toggle_pill,
        toggle_auto_resume_pill,
        toggle_keepalive_pill,
        card_logs,
        btn_ping,
        btn_resume,
        btn_check,
        btn_log_app,
        btn_log_wa,
        btn_folder,
        btn_exit,
    }
}

fn hit_test_layout(layout: &Layout, x: i32, y: i32) -> Option<HitTarget> {
    if pt_in_rect(layout.close_btn, x, y) {
        Some(HitTarget::Close)
    } else if pt_in_rect(layout.toggle_pill, x, y) {
        Some(HitTarget::ToggleAutoStart)
    } else if pt_in_rect(layout.toggle_auto_resume_pill, x, y) {
        Some(HitTarget::ToggleAutoResume)
    } else if pt_in_rect(layout.toggle_keepalive_pill, x, y) {
        Some(HitTarget::ToggleKeepalive)
    } else if pt_in_rect(layout.btn_ping, x, y) {
        Some(HitTarget::PingVps)
    } else if pt_in_rect(layout.btn_resume, x, y) {
        Some(HitTarget::ResumeVps)
    } else if pt_in_rect(layout.btn_check, x, y) {
        Some(HitTarget::CheckNow)
    } else if pt_in_rect(layout.btn_log_app, x, y) {
        Some(HitTarget::OpenWatchdogLog)
    } else if pt_in_rect(layout.btn_log_wa, x, y) {
        Some(HitTarget::OpenBotLog)
    } else if pt_in_rect(layout.btn_folder, x, y) {
        Some(HitTarget::OpenFolder)
    } else if pt_in_rect(layout.btn_exit, x, y) {
        Some(HitTarget::ExitApp)
    } else {
        None
    }
}

pub fn format_uptime_compact(secs: u64) -> String {
    let h = secs / 3600;
    let m = (secs % 3600) / 60;
    let s = secs % 60;
    if h > 0 {
        format!("{h}j {m}m {s}d")
    } else if m > 0 {
        format!("{m}m {s}d")
    } else {
        format!("{s} detik")
    }
}

pub fn format_kb_mb(kb: u64) -> String {
    if kb == 0 {
        return "0 MB".to_string();
    }
    let tenths = (kb * 10 + 512) / 1024;
    format!("{}.{} MB", tenths / 10, tenths % 10)
}

struct PanelState {
    host_hwnd: HWND,
    stats_fn: Rc<dyn Fn() -> PanelStats>,
    on_hide_fn: Rc<dyn Fn()>,
    icon_standby: HICON,
    icon_active: HICON,
    hover: Option<HitTarget>,
    pressed: Option<HitTarget>,
    tracking_leave: bool,
    last_hidden_at: Option<Instant>,
    dpi: i32,
}

thread_local! {
    static PANEL_HWND: Cell<isize> = const { Cell::new(0) };
}

fn current_panel() -> Option<HWND> {
    let raw = PANEL_HWND.with(Cell::get);
    if raw == 0 {
        return None;
    }
    let hwnd = HWND(raw as *mut c_void);
    if unsafe { IsWindow(hwnd).as_bool() } {
        Some(hwnd)
    } else {
        PANEL_HWND.with(|s| s.set(0));
        None
    }
}

unsafe fn state_mut<'a>(hwnd: HWND) -> Option<&'a mut PanelState> {
    let ptr = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut PanelState;
    if ptr.is_null() {
        None
    } else {
        Some(unsafe { &mut *ptr })
    }
}

fn ensure_class() -> Result<(), String> {
    let instance = unsafe { GetModuleHandleW(None) }.map_err(|e| e.to_string())?;
    let wc = WNDCLASSEXW {
        cbSize: size_of::<WNDCLASSEXW>() as u32,
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(panel_wnd_proc),
        hInstance: instance.into(),
        lpszClassName: PANEL_CLASS,
        hCursor: unsafe { LoadCursorW(None, IDC_ARROW) }.map_err(|e| e.to_string())?,
        hbrBackground: HBRUSH::default(),
        ..Default::default()
    };
    let atom = unsafe { RegisterClassExW(&wc) };
    if atom == 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() != Some(1410) {
            // 1410 = ERROR_CLASS_ALREADY_EXISTS
            return Err(format!("RegisterClassExW gagal: {err}"));
        }
    }
    Ok(())
}

fn compute_panel_position(host_hwnd: HWND, width: i32, height: i32, dpi: i32) -> (i32, i32) {
    let margin = sc(12, dpi);
    let mut pt = POINT::default();
    let _ = unsafe { GetCursorPos(&mut pt) };
    let mon = if !host_hwnd.0.is_null() {
        unsafe { MonitorFromPoint(pt, MONITOR_DEFAULTTOPRIMARY) }
    } else {
        unsafe { MonitorFromWindow(host_hwnd, MONITOR_DEFAULTTOPRIMARY) }
    };
    let mut mi = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if unsafe { GetMonitorInfoW(mon, &mut mi) }.as_bool() {
        let x = (mi.rcWork.right - width - margin).max(mi.rcWork.left);
        let y = (mi.rcWork.bottom - height - margin).max(mi.rcWork.top);
        return (x, y);
    }
    (40, 40)
}

unsafe fn make_font(dpi: i32, pt_size: i32, weight: i32) -> HFONT {
    let h = -sc(pt_size, dpi);
    unsafe {
        CreateFontW(
            h,
            0,
            0,
            0,
            weight,
            0,
            0,
            0,
            DEFAULT_CHARSET.0 as u32,
            OUT_DEFAULT_PRECIS.0 as u32,
            CLIP_DEFAULT_PRECIS.0 as u32,
            CLEARTYPE_QUALITY.0 as u32,
            (DEFAULT_PITCH.0 | FF_DONTCARE.0) as u32,
            w!("Segoe UI Variable Text"),
        )
    }
}

unsafe fn draw_rounded_box(
    hdc: windows::Win32::Graphics::Gdi::HDC,
    rc: RECT,
    radius: i32,
    fill: COLORREF,
    border: COLORREF,
) {
    unsafe {
        let brush = CreateSolidBrush(fill);
        let pen = CreatePen(PS_SOLID, 1, border);
        let old_b = SelectObject(hdc, brush);
        let old_p = SelectObject(hdc, pen);
        let _ = RoundRect(hdc, rc.left, rc.top, rc.right, rc.bottom, radius, radius);
        SelectObject(hdc, old_b);
        SelectObject(hdc, old_p);
        let _ = DeleteObject(brush);
        let _ = DeleteObject(pen);
    }
}

unsafe fn draw_text_rect(
    hdc: windows::Win32::Graphics::Gdi::HDC,
    text: &str,
    mut rc: RECT,
    color: COLORREF,
    font: HFONT,
    flags: u32,
) {
    let mut wide: Vec<u16> = text.encode_utf16().collect();
    if wide.is_empty() {
        return;
    }
    unsafe {
        let old_f = SelectObject(hdc, font);
        SetTextColor(hdc, color);
        let _ = DrawTextW(
            hdc,
            &mut wide,
            &mut rc,
            windows::Win32::Graphics::Gdi::DRAW_TEXT_FORMAT(flags | DT_NOPREFIX.0),
        );
        SelectObject(hdc, old_f);
    }
}

unsafe fn paint_panel(hwnd: HWND, st: &PanelState) {
    let mut ps = PAINTSTRUCT::default();
    let hdc = unsafe { BeginPaint(hwnd, &mut ps) };
    if hdc.0.is_null() {
        return;
    }

    let mut client = RECT::default();
    let _ = unsafe { GetClientRect(hwnd, &mut client) };
    let w = (client.right - client.left).max(1);
    let h = (client.bottom - client.top).max(1);

    let dpi = st.dpi.max(96);
    let layout = compute_layout(dpi);
    let stats = (st.stats_fn)();

    // Double buffer offscreen DC to eliminate flicker
    let mem_dc = unsafe { CreateCompatibleDC(hdc) };
    let bmp: HBITMAP = unsafe { CreateCompatibleBitmap(hdc, w, h) };
    let old_bmp = unsafe { SelectObject(mem_dc, bmp) };
    unsafe {
        SetBkMode(mem_dc, TRANSPARENT);
    }

    // Palette
    let c_bg = rgb(21, 24, 29); // #15181D
    let c_card = rgb(30, 35, 42); // #1E232A
    let c_card_border = rgb(46, 54, 66); // #2E3642
    let c_text = rgb(241, 245, 249); // #F1F5F9
    let c_muted = rgb(148, 163, 184); // #94A3B8
    let c_sub = rgb(116, 130, 150);
    let c_emerald = rgb(16, 185, 129); // #10B981
    let c_emerald_bg = rgb(17, 54, 44);
    let c_emerald_hover = rgb(20, 200, 140);
    let c_amber = rgb(245, 158, 11); // #F59E0B
    let c_amber_bg = rgb(62, 42, 16);
    let c_btn_bg = rgb(38, 45, 55);
    let c_btn_hover = rgb(52, 61, 74);
    let c_danger_bg = rgb(44, 25, 28);
    let c_danger_border = rgb(95, 42, 48);
    let c_danger_text = rgb(248, 113, 113);

    let f_title = unsafe { make_font(dpi, 14, FW_BOLD.0 as i32) };
    let f_label = unsafe { make_font(dpi, 9, FW_SEMIBOLD.0 as i32) };
    let f_val = unsafe { make_font(dpi, 13, FW_BOLD.0 as i32) };
    let f_body = unsafe { make_font(dpi, 10, FW_NORMAL.0 as i32) };
    let f_btn = unsafe { make_font(dpi, 10, FW_SEMIBOLD.0 as i32) };
    let f_badge = unsafe { make_font(dpi, 9, FW_BOLD.0 as i32) };

    // 1. Background
    unsafe {
        let bg_brush = CreateSolidBrush(c_bg);
        FillRect(mem_dc, &client, bg_brush);
        let _ = DeleteObject(bg_brush);
    }

    // 2. Header: Icon + Title + Status Pill + Close Button
    let pad = layout.pad;
    let icon_sz = sc(28, dpi);
    let active_icon = if stats.failover_active {
        st.icon_active
    } else {
        st.icon_standby
    };
    if !active_icon.is_invalid() {
        unsafe {
            let _ = DrawIconEx(
                mem_dc,
                pad,
                sc(15, dpi),
                active_icon,
                icon_sz,
                icon_sz,
                0,
                None,
                DI_NORMAL,
            );
        }
    }

    let title_left = pad + icon_sz + sc(10, dpi);
    unsafe {
        draw_text_rect(
            mem_dc,
            "Baileys Backup",
            mk_rect(title_left, sc(13, dpi), layout.close_btn.left - sc(8, dpi), sc(34, dpi)),
            c_text,
            f_title,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
        );
        draw_text_rect(
            mem_dc,
            &format!("v{} · PID {}", env!("CARGO_PKG_VERSION"), stats.app_pid),
            mk_rect(title_left, sc(34, dpi), title_left + sc(115, dpi), sc(50, dpi)),
            c_muted,
            f_label,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
        );
    }

    // Status pill in header
    let (pill_text, pill_fg, pill_bg) = if stats.failover_active {
        ("BACKUP AKTIF", c_amber, c_amber_bg)
    } else {
        ("STANDBY PASIF", c_emerald, c_emerald_bg)
    };
    let pill_rc = mk_rect(
        title_left + sc(116, dpi),
        sc(32, dpi),
        title_left + sc(222, dpi),
        sc(52, dpi),
    );
    unsafe {
        draw_rounded_box(mem_dc, pill_rc, sc(10, dpi), pill_bg, pill_fg);
        draw_text_rect(
            mem_dc,
            pill_text,
            pill_rc,
            pill_fg,
            f_badge,
            DT_CENTER.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
        );
    }

    // Close X button
    let close_bg = if st.hover == Some(HitTarget::Close) {
        c_btn_hover
    } else {
        c_card
    };
    unsafe {
        draw_rounded_box(mem_dc, layout.close_btn, sc(8, dpi), close_bg, c_card_border);
        draw_text_rect(
            mem_dc,
            "✕",
            layout.close_btn,
            c_muted,
            f_btn,
            DT_CENTER.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
        );
    }

    // Divider hairline
    unsafe {
        let div_brush = CreateSolidBrush(c_card_border);
        let div_rc = mk_rect(pad, sc(56, dpi), w - pad, sc(57, dpi));
        FillRect(mem_dc, &div_rc, div_brush);
        let _ = DeleteObject(div_brush);
    }

    // 3. Telemetry 2x2 KPI Cards
    let radius = sc(10, dpi);
    let draw_kpi = |rc: RECT, title: &str, value: &str, val_color: COLORREF, sub: &str| unsafe {
        draw_rounded_box(mem_dc, rc, radius, c_card, c_card_border);
        let p = sc(12, dpi);
        draw_text_rect(
            mem_dc,
            title,
            mk_rect(rc.left + p, rc.top + sc(8, dpi), rc.right - p, rc.top + sc(22, dpi)),
            c_muted,
            f_label,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
        );
        draw_text_rect(
            mem_dc,
            value,
            mk_rect(rc.left + p, rc.top + sc(24, dpi), rc.right - p, rc.top + sc(48, dpi)),
            val_color,
            f_val,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
        );
        draw_text_rect(
            mem_dc,
            sub,
            mk_rect(rc.left + p, rc.top + sc(50, dpi), rc.right - p, rc.bottom - sc(7, dpi)),
            c_sub,
            f_body,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
        );
    };

    // Card 1: VPS UTAMA
    let vps_color = if stats.resuming_vps {
        c_amber
    } else {
        match stats.vps_availability {
            "running" => c_emerald,
            "down" | "transient" => c_amber,
            _ => c_muted,
        }
    };
    let age_str = match stats.last_check_age_secs {
        Some(s) if s < 60 => format!("Cek {s}d lalu"),
        Some(s) => format!("Cek {}m lalu", s / 60),
        None => "Belum pernah dicek".to_string(),
    };
    let last_check_str = if stats.vps_availability == "running" {
        if let Some(mins) = stats.runtime_remaining_mins {
            format!("{age_str} · Sisa ~{mins}m")
        } else {
            age_str
        }
    } else {
        age_str
    };
    let vps_val = if stats.resuming_vps {
        "MENGAKTIFKAN...".to_string()
    } else if stats.checking_vps {
        "MENGECEK...".to_string()
    } else {
        stats.vps_state.to_ascii_uppercase()
    };
    draw_kpi(layout.card_vps, "VPS UTAMA", &vps_val, vps_color, &last_check_str);

    // Card 2: BOT WA LOKAL
    let (bot_val, bot_col, bot_sub) = if stats.child_node_pid > 0 {
        (
            format!("AKTIF (PID {})", stats.child_node_pid),
            c_amber,
            "Failover aktif di laptop".to_string(),
        )
    } else {
        (
            "Standby (0 Node)".to_string(),
            c_emerald,
            "Hemat RAM (VPS aktif)".to_string(),
        )
    };
    draw_kpi(layout.card_bot, "BOT WA LOKAL", &bot_val, bot_col, &bot_sub);

    // Card 3: PEMAKAIAN RAM
    let ram_val = format!("App: {}", format_kb_mb(stats.app_private_kb));
    let ram_sub = if stats.node_private_kb > 0 {
        format!("Node: {} · WS {}", format_kb_mb(stats.node_private_kb), format_kb_mb(stats.app_working_kb))
    } else {
        format!("Node: 0 MB · WS {}", format_kb_mb(stats.app_working_kb))
    };
    draw_kpi(layout.card_ram, "MEMORI PRIVAT", &ram_val, c_text, &ram_sub);

    // Card 4: UPTIME & HITUNGAN
    let up_str = format_uptime_compact(stats.uptime_secs);
    let stat_sub = format!(
        "Cek {}x · Failover {}x",
        stats.total_checks, stats.failover_count
    );
    draw_kpi(layout.card_stats, "UPTIME & RIWAYAT", &up_str, c_text, &stat_sub);

    // 4. Auto-Start & Auto-Resume Settings Card
    unsafe {
        draw_rounded_box(mem_dc, layout.row_config, radius, c_card, c_card_border);
        let p = sc(12, dpi);
        let text_right = layout.toggle_pill.left - sc(8, dpi);

        // Row A: Auto-Start Windows
        draw_text_rect(
            mem_dc,
            "Auto-Start saat Login Windows",
            mk_rect(
                layout.row_config.left + p,
                layout.row_config.top + sc(7, dpi),
                text_right,
                layout.row_config.top + sc(26, dpi),
            ),
            c_text,
            f_btn,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
        );
        let tray_desc = format!(
            "System Tray: {} · Pantau tiap {}s",
            if stats.tray_registered { "Aktif" } else { "Menunggu" },
            stats.poll_interval_secs
        );
        draw_text_rect(
            mem_dc,
            &tray_desc,
            mk_rect(
                layout.row_config.left + p,
                layout.row_config.top + sc(24, dpi),
                text_right,
                layout.row_config.top + sc(42, dpi),
            ),
            c_muted,
            f_body,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
        );

        let (tg_lbl, tg_fg, tg_bg) = if stats.auto_start_enabled {
            ("AKTIF", c_emerald, c_emerald_bg)
        } else {
            ("NONAKTIF", c_muted, c_btn_bg)
        };
        let tg_border = if st.hover == Some(HitTarget::ToggleAutoStart) {
            c_text
        } else {
            tg_fg
        };
        draw_rounded_box(mem_dc, layout.toggle_pill, sc(10, dpi), tg_bg, tg_border);
        draw_text_rect(
            mem_dc,
            tg_lbl,
            layout.toggle_pill,
            tg_fg,
            f_badge,
            DT_CENTER.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
        );

        // Row divider
        let div_brush = CreateSolidBrush(c_card_border);
        let row_div = mk_rect(
            layout.row_config.left + p,
            layout.row_config.top + sc(46, dpi),
            layout.row_config.right - p,
            layout.row_config.top + sc(47, dpi),
        );
        FillRect(mem_dc, &row_div, div_brush);
        let _ = DeleteObject(div_brush);

        // Row B: Mode Resume VPS (Otomatis / Manual)
        draw_text_rect(
            mem_dc,
            "Mode Resume VPS Utama",
            mk_rect(
                layout.row_config.left + p,
                layout.row_config.top + sc(51, dpi),
                text_right,
                layout.row_config.top + sc(69, dpi),
            ),
            c_text,
            f_btn,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
        );
        let auto_desc = if stats.auto_resume_enabled {
            match stats.auto_resume_cooldown_secs {
                Some(secs) if secs >= 60 => {
                    format!("Otomatis · Cooldown ~{}m lagi", secs.div_ceil(60))
                }
                Some(secs) if secs > 0 => format!("Otomatis · Cooldown ~{secs}d lagi"),
                _ => "Otomatis aktifkan VPS saat paused/suspended".to_string(),
            }
        } else {
            "Manual · Klik tombol Resume VPS saat perlu".to_string()
        };
        let auto_desc_color = if stats.auto_resume_enabled
            && stats.auto_resume_cooldown_secs.is_some_and(|s| s > 0)
        {
            c_amber
        } else {
            c_muted
        };
        draw_text_rect(
            mem_dc,
            &auto_desc,
            mk_rect(
                layout.row_config.left + p,
                layout.row_config.top + sc(69, dpi),
                text_right,
                layout.row_config.top + sc(88, dpi),
            ),
            auto_desc_color,
            f_body,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
        );

        let (ar_lbl, ar_fg, ar_bg) = if stats.auto_resume_enabled {
            ("OTOMATIS", c_emerald, c_emerald_bg)
        } else {
            ("MANUAL", c_muted, c_btn_bg)
        };
        let ar_border = if st.hover == Some(HitTarget::ToggleAutoResume) {
            c_text
        } else {
            ar_fg
        };
        draw_rounded_box(
            mem_dc,
            layout.toggle_auto_resume_pill,
            sc(10, dpi),
            ar_bg,
            ar_border,
        );
        draw_text_rect(
            mem_dc,
            ar_lbl,
            layout.toggle_auto_resume_pill,
            ar_fg,
            f_badge,
            DT_CENTER.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
        );

        // Second divider before Row C (Auto-Ping Keepalive)
        let div_brush2 = CreateSolidBrush(c_card_border);
        let row_div2 = mk_rect(
            layout.row_config.left + p,
            layout.row_config.top + sc(93, dpi),
            layout.row_config.right - p,
            layout.row_config.top + sc(94, dpi),
        );
        FillRect(mem_dc, &row_div2, div_brush2);
        let _ = DeleteObject(div_brush2);

        // Row C: Auto-Ping VPS (anti idle-pause)
        let c_left = layout.row_config.left + p;
        let c_right = layout.row_config.right - p;
        let ka_title_right = (c_left + sc(98, dpi)).min(layout.toggle_keepalive_pill.left - sc(6, dpi));
        draw_text_rect(
            mem_dc,
            "Auto-Ping VPS",
            mk_rect(
                c_left,
                layout.row_config.top + sc(99, dpi),
                ka_title_right,
                layout.row_config.top + sc(123, dpi),
            ),
            c_text,
            f_btn,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
        );

        let (badge_lbl, badge_fg, badge_bg) = if !stats.instabox_configured {
            ("API belum siap", c_muted, c_btn_bg)
        } else if !stats.keepalive_enabled {
            ("Rentan pause", c_amber, c_amber_bg)
        } else if stats.keepalive_consecutive_failures > 0 {
            ("Ping gagal", c_danger_text, c_danger_bg)
        } else if stats.vps_availability != "running" {
            ("Menunggu VPS", c_muted, c_btn_bg)
        } else if stats.keepalive_at_risk {
            ("Berisiko", c_amber, c_amber_bg)
        } else {
            ("Terlindungi", c_emerald, c_emerald_bg)
        };
        let badge_left = ka_title_right + sc(4, dpi);
        let badge_right = (badge_left + sc(100, dpi)).min(layout.toggle_keepalive_pill.left - sc(8, dpi));
        if badge_right > badge_left + sc(40, dpi) {
            let ka_badge_rc = mk_rect(
                badge_left,
                layout.row_config.top + sc(101, dpi),
                badge_right,
                layout.row_config.top + sc(121, dpi),
            );
            draw_rounded_box(mem_dc, ka_badge_rc, sc(9, dpi), badge_bg, badge_fg);
            draw_text_rect(
                mem_dc,
                badge_lbl,
                ka_badge_rc,
                badge_fg,
                f_badge,
                DT_CENTER.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
            );
        }

        let (ka_lbl, ka_fg, ka_bg) = if stats.keepalive_enabled {
            ("AKTIF", c_emerald, c_emerald_bg)
        } else {
            ("NONAKTIF", c_muted, c_btn_bg)
        };
        let ka_border = if st.hover == Some(HitTarget::ToggleKeepalive) {
            c_text
        } else {
            ka_fg
        };
        draw_rounded_box(
            mem_dc,
            layout.toggle_keepalive_pill,
            sc(10, dpi),
            ka_bg,
            ka_border,
        );
        draw_text_rect(
            mem_dc,
            ka_lbl,
            layout.toggle_keepalive_pill,
            ka_fg,
            f_badge,
            DT_CENTER.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
        );

        let win_mins = ((stats.keepalive_idle_window_secs + 30) / 60).max(1);
        let iv_mins = ((stats.keepalive_interval_secs + 30) / 60).max(1);
        let ttl_mins = ((stats.keepalive_lease_ttl_secs + 30) / 60).max(1);
        let cfg_summary = format!(
            "Jendela idle {win_mins}m · interval {iv_mins}m · lease {ttl_mins}m"
        );
        draw_text_rect(
            mem_dc,
            &cfg_summary,
            mk_rect(
                c_left,
                layout.row_config.top + sc(124, dpi),
                c_right,
                layout.row_config.top + sc(140, dpi),
            ),
            c_sub,
            f_body,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
        );

        let vps_is_running_ka = stats.vps_availability == "running";
        let next_ping_str = if !stats.keepalive_enabled {
            "nonaktif".to_string()
        } else if !vps_is_running_ka {
            "menunggu VPS".to_string()
        } else if stats.pinging_vps {
            "mengirim...".to_string()
        } else {
            match stats.keepalive_next_ping_in_secs {
                Some(0) => "sekarang".to_string(),
                Some(s) => crate::keepalive::format_duration_compact(s),
                None => "—".to_string(),
            }
        };
        let lease_str = match stats.keepalive_lease_remaining_secs {
            Some(s) if s > 0 => crate::keepalive::format_duration_compact(s),
            Some(_) => "habis".to_string(),
            None => "tidak ada".to_string(),
        };
        let idle_str = match stats.keepalive_idle_secs {
            Some(s) => crate::keepalive::format_duration_compact(s),
            None => "—".to_string(),
        };
        let pause_str = match stats.keepalive_pause_in_secs {
            Some(0) => "segera!".to_string(),
            Some(s) => crate::keepalive::format_duration_compact(s),
            None => "—".to_string(),
        };
        let pause_color = if stats.keepalive_at_risk { c_amber } else { c_muted };

        let meta_w = (c_right - c_left - sc(8, dpi)) / 2;
        let col1_r = c_left + meta_w;
        let col2_l = col1_r + sc(8, dpi);

        draw_text_rect(
            mem_dc,
            &format!("Ping berikut: {next_ping_str}"),
            mk_rect(
                c_left,
                layout.row_config.top + sc(142, dpi),
                col1_r,
                layout.row_config.top + sc(158, dpi),
            ),
            c_muted,
            f_body,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
        );
        draw_text_rect(
            mem_dc,
            &format!("Lease aktif: {lease_str}"),
            mk_rect(
                col2_l,
                layout.row_config.top + sc(142, dpi),
                c_right,
                layout.row_config.top + sc(158, dpi),
            ),
            c_muted,
            f_body,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
        );
        draw_text_rect(
            mem_dc,
            &format!("Sejak ping: {idle_str}"),
            mk_rect(
                c_left,
                layout.row_config.top + sc(159, dpi),
                col1_r,
                layout.row_config.top + sc(175, dpi),
            ),
            c_muted,
            f_body,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
        );
        draw_text_rect(
            mem_dc,
            &format!("Pause idle: {pause_str}"),
            mk_rect(
                col2_l,
                layout.row_config.top + sc(159, dpi),
                c_right,
                layout.row_config.top + sc(175, dpi),
            ),
            pause_color,
            f_body,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
        );

        // Idle progress bar
        let bar_rc = mk_rect(
            c_left,
            layout.row_config.top + sc(180, dpi),
            c_right,
            layout.row_config.top + sc(186, dpi),
        );
        draw_rounded_box(mem_dc, bar_rc, sc(3, dpi), c_bg, c_card_border);
        if stats.keepalive_idle_bar_pct > 0 {
            let total_w = (c_right - c_left).max(1);
            let fill_w = ((total_w * stats.keepalive_idle_bar_pct as i32) / 100)
                .max(sc(6, dpi))
                .min(total_w);
            let fill_col = if stats.keepalive_idle_bar_pct >= 70 || stats.keepalive_at_risk {
                c_amber
            } else {
                c_emerald
            };
            let fill_rc = mk_rect(bar_rc.left, bar_rc.top, bar_rc.left + fill_w, bar_rc.bottom);
            draw_rounded_box(mem_dc, fill_rc, sc(3, dpi), fill_col, fill_col);
        }

        // Footer: Ping stats OR last error
        let (footer_txt, footer_col) = if let Some(ref err_msg) = stats.keepalive_last_error {
            (format!("Error: {err_msg}"), c_danger_text)
        } else {
            let mut s = format!("Ping sukses: {}x", stats.keepalive_ping_count);
            if stats.keepalive_fail_count > 0 {
                s.push_str(&format!(" · {} gagal", stats.keepalive_fail_count));
            }
            if let Some(ms) = stats.keepalive_last_ping_latency_ms {
                s.push_str(&format!(" · {ms} ms"));
            }
            if let Some(ref src) = stats.keepalive_last_ping_source {
                s.push_str(&format!(" ({src})"));
            }
            (s, c_sub)
        };
        draw_text_rect(
            mem_dc,
            &footer_txt,
            mk_rect(
                c_left,
                layout.row_config.top + sc(191, dpi),
                c_right,
                layout.row_config.bottom - sc(5, dpi),
            ),
            footer_col,
            f_body,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
        );
    }

    // 5. Recent Events Log Card
    unsafe {
        draw_rounded_box(mem_dc, layout.card_logs, radius, c_card, c_card_border);
        let p = sc(12, dpi);
        draw_text_rect(
            mem_dc,
            "AKTIVITAS TERAKHIR",
            mk_rect(
                layout.card_logs.left + p,
                layout.card_logs.top + sc(7, dpi),
                layout.card_logs.right - p,
                layout.card_logs.top + sc(22, dpi),
            ),
            c_muted,
            f_label,
            DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
        );
        let line_h = sc(19, dpi);
        let start_y = layout.card_logs.top + sc(23, dpi);
        if stats.recent_events.is_empty() {
            draw_text_rect(
                mem_dc,
                "• Menunggu catatan aktivitas pertama...",
                mk_rect(layout.card_logs.left + p, start_y, layout.card_logs.right - p, start_y + line_h),
                c_sub,
                f_body,
                DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
            );
        } else {
            for (idx, ev) in stats.recent_events.iter().take(3).enumerate() {
                let y = start_y + (idx as i32) * line_h;
                draw_text_rect(
                    mem_dc,
                    &format!("• {ev}"),
                    mk_rect(
                        layout.card_logs.left + p,
                        y,
                        layout.card_logs.right - p,
                        y + line_h,
                    ),
                    c_text,
                    f_body,
                    DT_LEFT.0 | DT_VCENTER.0 | DT_SINGLELINE.0 | DT_END_ELLIPSIS.0,
                );
            }
        }
    }

    // 6. Action Buttons
    let btn_r = sc(8, dpi);
    unsafe {
        let vps_is_running = stats.vps_availability == "running";
        let vps_is_transient = stats.vps_availability == "transient";
        let can_resume = !vps_is_running && !vps_is_transient && !stats.resuming_vps;
        let can_ping = vps_is_running && stats.instabox_configured && !stats.pinging_vps;

        let ping_label = if stats.pinging_vps {
            "Mengirim..."
        } else {
            "Ping VPS"
        };
        let (ping_bg, ping_brd, ping_fg) = if stats.pinging_vps {
            (c_amber_bg, c_amber, c_amber)
        } else if can_ping {
            let bg = if st.hover == Some(HitTarget::PingVps) {
                c_btn_hover
            } else {
                c_emerald_bg
            };
            (bg, rgb(30, 88, 70), c_emerald)
        } else {
            (rgb(28, 32, 39), c_card_border, c_sub)
        };
        draw_rounded_box(mem_dc, layout.btn_ping, btn_r, ping_bg, ping_brd);
        draw_text_rect(
            mem_dc,
            ping_label,
            layout.btn_ping,
            ping_fg,
            f_btn,
            DT_CENTER.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
        );

        let resume_label = if stats.resuming_vps {
            "Mengaktifkan..."
        } else if vps_is_running {
            "VPS Aktif"
        } else if vps_is_transient {
            "Booting..."
        } else if matches!(stats.vps_state.to_ascii_lowercase().as_str(), "stopped" | "off") {
            "Aktifkan VPS"
        } else {
            "Resume VPS"
        };

        let (res_bg, res_brd, res_fg) = if can_resume {
            let bg = if st.hover == Some(HitTarget::ResumeVps) {
                rgb(251, 191, 36)
            } else {
                c_amber
            };
            (bg, bg, rgb(20, 14, 4))
        } else if stats.resuming_vps || vps_is_transient {
            (c_amber_bg, c_amber, c_amber)
        } else {
            (c_emerald_bg, rgb(30, 88, 70), c_emerald)
        };
        draw_rounded_box(mem_dc, layout.btn_resume, btn_r, res_bg, res_brd);
        draw_text_rect(
            mem_dc,
            resume_label,
            layout.btn_resume,
            res_fg,
            f_btn,
            DT_CENTER.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
        );

        let (chk_bg, chk_brd, chk_fg) = if can_resume {
            let bg = if st.hover == Some(HitTarget::CheckNow) {
                c_btn_hover
            } else {
                c_btn_bg
            };
            let brd = if st.hover == Some(HitTarget::CheckNow) {
                rgb(90, 102, 120)
            } else {
                c_card_border
            };
            (bg, brd, c_text)
        } else {
            let bg = if st.hover == Some(HitTarget::CheckNow) {
                c_emerald_hover
            } else {
                c_emerald
            };
            (bg, bg, rgb(10, 20, 16))
        };
        draw_rounded_box(mem_dc, layout.btn_check, btn_r, chk_bg, chk_brd);
        draw_text_rect(
            mem_dc,
            if stats.checking_vps {
                "Mengecek..."
            } else {
                "Cek Status"
            },
            layout.btn_check,
            chk_fg,
            f_btn,
            DT_CENTER.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
        );

        let draw_sec_btn = |rc: RECT, target: HitTarget, label: &str| {
            let bg = if st.hover == Some(target) {
                c_btn_hover
            } else {
                c_btn_bg
            };
            let brd = if st.hover == Some(target) {
                rgb(90, 102, 120)
            } else {
                c_card_border
            };
            draw_rounded_box(mem_dc, rc, btn_r, bg, brd);
            draw_text_rect(
                mem_dc,
                label,
                rc,
                c_text,
                f_btn,
                DT_CENTER.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
            );
        };

        draw_sec_btn(layout.btn_log_app, HitTarget::OpenWatchdogLog, "Log App");
        draw_sec_btn(layout.btn_log_wa, HitTarget::OpenBotLog, "Log Bot WA");
        draw_sec_btn(layout.btn_folder, HitTarget::OpenFolder, "Folder Proyek");

        let exit_bg = if st.hover == Some(HitTarget::ExitApp) {
            rgb(76, 32, 36)
        } else {
            c_danger_bg
        };
        draw_rounded_box(mem_dc, layout.btn_exit, btn_r, exit_bg, c_danger_border);
        draw_text_rect(
            mem_dc,
            "Matikan Baileys Backup",
            layout.btn_exit,
            c_danger_text,
            f_btn,
            DT_CENTER.0 | DT_VCENTER.0 | DT_SINGLELINE.0,
        );
    }

    // Blit & clean up every GDI object immediately so hidden footprint stays zero
    unsafe {
        let _ = BitBlt(hdc, 0, 0, w, h, mem_dc, 0, 0, SRCCOPY);
        SelectObject(mem_dc, old_bmp);
        let _ = DeleteObject(bmp);
        let _ = DeleteDC(mem_dc);
        for f in [f_title, f_label, f_val, f_body, f_btn, f_badge] {
            let _ = DeleteObject(f);
        }
        let _ = EndPaint(hwnd, &ps);
    }
}

fn hide_panel_internal(hwnd: HWND) {
    unsafe {
        let _ = KillTimer(hwnd, PANEL_REFRESH_TIMER_ID);
        let _ = ShowWindow(hwnd, SW_HIDE);
        if let Some(st) = state_mut(hwnd) {
            st.hover = None;
            st.pressed = None;
            st.last_hidden_at = Some(Instant::now());
            (st.on_hide_fn)();
        }
    }
}

unsafe extern "system" fn panel_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    match msg {
        WM_ERASEBKGND => return windows::Win32::Foundation::LRESULT(1),
        WM_PAINT => {
            if let Some(st) = unsafe { state_mut(hwnd) } {
                unsafe { paint_panel(hwnd, st) };
                return windows::Win32::Foundation::LRESULT(0);
            }
        }
        WM_TIMER if wparam.0 == PANEL_REFRESH_TIMER_ID => {
            unsafe {
                let _ = InvalidateRect(hwnd, None, false);
            }
            return windows::Win32::Foundation::LRESULT(0);
        }
        WM_MOUSEMOVE => {
            if let Some(st) = unsafe { state_mut(hwnd) } {
                if !st.tracking_leave {
                    let mut tme = TRACKMOUSEEVENT {
                        cbSize: size_of::<TRACKMOUSEEVENT>() as u32,
                        dwFlags: TME_LEAVE,
                        hwndTrack: hwnd,
                        dwHoverTime: 0,
                    };
                    if unsafe { TrackMouseEvent(&mut tme) }.is_ok() {
                        st.tracking_leave = true;
                    }
                }
                let x = (lparam.0 & 0xFFFF) as i16 as i32;
                let y = ((lparam.0 >> 16) & 0xFFFF) as i16 as i32;
                let next_hover = hit_test_layout(&compute_layout(st.dpi), x, y);
                if st.hover != next_hover {
                    st.hover = next_hover;
                    unsafe {
                        let _ = InvalidateRect(hwnd, None, false);
                    }
                }
                return windows::Win32::Foundation::LRESULT(0);
            }
        }
        WM_MOUSELEAVE_MSG => {
            if let Some(st) = unsafe { state_mut(hwnd) } {
                st.tracking_leave = false;
                if st.hover.is_some() || st.pressed.is_some() {
                    st.hover = None;
                    st.pressed = None;
                    unsafe {
                        let _ = InvalidateRect(hwnd, None, false);
                    }
                }
                return windows::Win32::Foundation::LRESULT(0);
            }
        }
        WM_LBUTTONDOWN => {
            if let Some(st) = unsafe { state_mut(hwnd) } {
                let x = (lparam.0 & 0xFFFF) as i16 as i32;
                let y = ((lparam.0 >> 16) & 0xFFFF) as i16 as i32;
                st.pressed = hit_test_layout(&compute_layout(st.dpi), x, y);
                unsafe {
                    SetCapture(hwnd);
                    let _ = InvalidateRect(hwnd, None, false);
                }
                return windows::Win32::Foundation::LRESULT(0);
            }
        }
        WM_LBUTTONUP => {
            if let Some(st) = unsafe { state_mut(hwnd) } {
                let _ = unsafe { ReleaseCapture() };
                let x = (lparam.0 & 0xFFFF) as i16 as i32;
                let y = ((lparam.0 >> 16) & 0xFFFF) as i16 as i32;
                let target = hit_test_layout(&compute_layout(st.dpi), x, y);
                let clicked = st.pressed.take().filter(|&p| Some(p) == target);
                st.hover = target;
                unsafe {
                    let _ = InvalidateRect(hwnd, None, false);
                }
                if let Some(act) = clicked {
                    match act {
                        HitTarget::Close => hide_panel_internal(hwnd),
                        HitTarget::ToggleAutoStart => unsafe {
                            let _ = PostMessageW(st.host_hwnd, WM_COMMAND, WPARAM(CMD_TOGGLE_AUTOSTART), LPARAM(0));
                        },
                        HitTarget::ToggleAutoResume => unsafe {
                            let _ = PostMessageW(st.host_hwnd, WM_COMMAND, WPARAM(CMD_TOGGLE_AUTO_RESUME), LPARAM(0));
                        },
                        HitTarget::ToggleKeepalive => unsafe {
                            let _ = PostMessageW(st.host_hwnd, WM_COMMAND, WPARAM(CMD_TOGGLE_KEEPALIVE), LPARAM(0));
                        },
                        HitTarget::PingVps => unsafe {
                            let _ = PostMessageW(st.host_hwnd, WM_COMMAND, WPARAM(CMD_PING_VPS), LPARAM(0));
                        },
                        HitTarget::ResumeVps => unsafe {
                            let _ = PostMessageW(st.host_hwnd, WM_COMMAND, WPARAM(CMD_RESUME_VPS), LPARAM(0));
                        },
                        HitTarget::CheckNow => unsafe {
                            let _ = PostMessageW(st.host_hwnd, WM_COMMAND, WPARAM(CMD_CHECK_NOW), LPARAM(0));
                        },
                        HitTarget::OpenWatchdogLog => {
                            hide_panel_internal(hwnd);
                            unsafe {
                                let _ = PostMessageW(st.host_hwnd, WM_COMMAND, WPARAM(CMD_OPEN_LOG), LPARAM(0));
                            }
                        }
                        HitTarget::OpenBotLog => {
                            hide_panel_internal(hwnd);
                            unsafe {
                                let _ = PostMessageW(st.host_hwnd, WM_COMMAND, WPARAM(CMD_OPEN_BOT_LOG), LPARAM(0));
                            }
                        }
                        HitTarget::OpenFolder => {
                            hide_panel_internal(hwnd);
                            unsafe {
                                let _ = PostMessageW(st.host_hwnd, WM_COMMAND, WPARAM(CMD_OPEN_FOLDER), LPARAM(0));
                            }
                        }
                        HitTarget::ExitApp => {
                            hide_panel_internal(hwnd);
                            unsafe {
                                let _ = PostMessageW(st.host_hwnd, WM_COMMAND, WPARAM(CMD_EXIT), LPARAM(0));
                            }
                        }
                    }
                }
                return windows::Win32::Foundation::LRESULT(0);
            }
        }
        WM_KEYDOWN => {
            if wparam.0 == VK_ESCAPE.0 as usize {
                hide_panel_internal(hwnd);
                return windows::Win32::Foundation::LRESULT(0);
            }
        }
        WM_ACTIVATE => {
            if (wparam.0 & 0xFFFF) as u32 == WA_INACTIVE {
                hide_panel_internal(hwnd);
                return windows::Win32::Foundation::LRESULT(0);
            }
        }
        WM_CLOSE => {
            hide_panel_internal(hwnd);
            return windows::Win32::Foundation::LRESULT(0);
        }
        WM_DESTROY => {
            PANEL_HWND.with(|s| s.set(0));
            let ptr = unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0) } as *mut PanelState;
            if !ptr.is_null() {
                drop(unsafe { Box::from_raw(ptr) });
            }
            return windows::Win32::Foundation::LRESULT(0);
        }
        _ => {}
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn ensure_panel_window(
    host_hwnd: HWND,
    icon_standby: HICON,
    icon_active: HICON,
    stats_fn: Rc<dyn Fn() -> PanelStats>,
    on_hide_fn: Rc<dyn Fn()>,
) -> Result<HWND, String> {
    if let Some(existing) = current_panel() {
        return Ok(existing);
    }
    ensure_class()?;
    let instance = unsafe { GetModuleHandleW(None) }.map_err(|e| e.to_string())?;
    let initial_dpi = unsafe { GetDpiForWindow(host_hwnd) }.max(96) as i32;
    let layout = compute_layout(initial_dpi);

    let boxed = Box::new(PanelState {
        host_hwnd,
        stats_fn,
        on_hide_fn,
        icon_standby,
        icon_active,
        hover: None,
        pressed: None,
        tracking_leave: false,
        last_hidden_at: None,
        dpi: initial_dpi,
    });
    let raw_state = Box::into_raw(boxed);

    let hwnd = unsafe {
        CreateWindowExW(
            WS_EX_TOOLWINDOW | WS_EX_TOPMOST,
            PANEL_CLASS,
            w!("Baileys Backup - Statistik"),
            WS_POPUP | WS_CLIPCHILDREN,
            0,
            0,
            layout.width,
            layout.height,
            None,
            None,
            instance,
            None,
        )
    }
    .map_err(|e| {
        drop(unsafe { Box::from_raw(raw_state) });
        format!("CreateWindowExW panel gagal: {e}")
    })?;

    unsafe {
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, raw_state as isize);
        let dark: i32 = 1;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            (&dark as *const i32).cast(),
            size_of::<i32>() as u32,
        );
        let corner = DWMWCP_ROUND.0;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            (&corner as *const i32).cast(),
            size_of::<i32>() as u32,
        );
        let border_col: u32 = 0x003D_332C; // COLORREF BGR for #2C333D
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            (&border_col as *const u32).cast(),
            size_of::<u32>() as u32,
        );
        if !icon_standby.is_invalid() {
            let _ = SendMessageW(hwnd, WM_SETICON, WPARAM(ICON_BIG as usize), LPARAM(icon_standby.0 as isize));
            let _ = SendMessageW(hwnd, WM_SETICON, WPARAM(ICON_SMALL as usize), LPARAM(icon_standby.0 as isize));
        }
    }

    PANEL_HWND.with(|s| s.set(hwnd.0 as isize));
    Ok(hwnd)
}

pub fn show_panel(
    host_hwnd: HWND,
    icon_standby: HICON,
    icon_active: HICON,
    stats_fn: Rc<dyn Fn() -> PanelStats>,
    on_hide_fn: Rc<dyn Fn()>,
) {
    if let Ok(hwnd) = ensure_panel_window(host_hwnd, icon_standby, icon_active, stats_fn, on_hide_fn) {
        let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96) as i32;
        if let Some(st) = unsafe { state_mut(hwnd) } {
            st.dpi = dpi;
            st.hover = None;
            st.pressed = None;
        }
        let layout = compute_layout(dpi);
        let (x, y) = compute_panel_position(host_hwnd, layout.width, layout.height, dpi);
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                x,
                y,
                layout.width,
                layout.height,
                SWP_SHOWWINDOW | SWP_NOACTIVATE,
            );
            let _ = ShowWindow(hwnd, SW_SHOW);
            let _ = SetForegroundWindow(hwnd);
            let _ = SetTimer(hwnd, PANEL_REFRESH_TIMER_ID, 1000, None);
            let _ = InvalidateRect(hwnd, None, false);
        }
    }
}

pub fn toggle_panel(
    host_hwnd: HWND,
    icon_standby: HICON,
    icon_active: HICON,
    stats_fn: Rc<dyn Fn() -> PanelStats>,
    on_hide_fn: Rc<dyn Fn()>,
) {
    if let Some(hwnd) = current_panel() {
        if unsafe { IsWindowVisible(hwnd).as_bool() } {
            hide_panel_internal(hwnd);
            return;
        }
        // Avoid instant reopen if WA_INACTIVE just hid it from the same tray click
        if let Some(st) = unsafe { state_mut(hwnd) } {
            if let Some(t) = st.last_hidden_at {
                if t.elapsed().as_millis() < 220 {
                    return;
                }
            }
        }
    }
    show_panel(host_hwnd, icon_standby, icon_active, stats_fn, on_hide_fn);
}

pub fn refresh_if_visible() {
    if let Some(hwnd) = current_panel() {
        if unsafe { IsWindowVisible(hwnd).as_bool() } {
            unsafe {
                let _ = InvalidateRect(hwnd, None, false);
            }
        }
    }
}

pub fn destroy_panel() {
    if let Some(hwnd) = current_panel() {
        unsafe {
            let _ = DestroyWindow(hwnd);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_buttons_do_not_overlap_and_hit_test_accurately() {
        for dpi in [96, 144] {
            let layout = compute_layout(dpi);
            assert!(layout.toggle_pill.bottom < layout.toggle_auto_resume_pill.top);
            assert!(layout.toggle_auto_resume_pill.bottom < layout.toggle_keepalive_pill.top);
            assert!(layout.toggle_keepalive_pill.bottom < layout.row_config.bottom);
            assert!(layout.row_config.bottom < layout.card_logs.top);
            assert!(layout.card_logs.bottom < layout.btn_ping.top);
            assert!(layout.btn_ping.right < layout.btn_resume.left);
            assert!(layout.btn_resume.right < layout.btn_check.left);
            assert!(layout.btn_ping.bottom < layout.btn_log_app.top);
            assert!(layout.btn_resume.bottom < layout.btn_log_app.top);
            assert!(layout.btn_check.bottom < layout.btn_log_app.top);
            assert!(layout.btn_log_app.right < layout.btn_log_wa.left);
            assert!(layout.btn_log_wa.right < layout.btn_folder.left);
            assert!(layout.btn_log_app.bottom < layout.btn_exit.top);
            assert!(layout.btn_exit.bottom <= layout.height - layout.pad);

            assert_eq!(
                hit_test_layout(
                    &layout,
                    (layout.toggle_keepalive_pill.left + layout.toggle_keepalive_pill.right) / 2,
                    (layout.toggle_keepalive_pill.top + layout.toggle_keepalive_pill.bottom) / 2
                ),
                Some(HitTarget::ToggleKeepalive)
            );
            assert_eq!(
                hit_test_layout(
                    &layout,
                    (layout.btn_ping.left + layout.btn_ping.right) / 2,
                    (layout.btn_ping.top + layout.btn_ping.bottom) / 2
                ),
                Some(HitTarget::PingVps)
            );
            assert_eq!(
                hit_test_layout(
                    &layout,
                    (layout.toggle_auto_resume_pill.left + layout.toggle_auto_resume_pill.right) / 2,
                    (layout.toggle_auto_resume_pill.top + layout.toggle_auto_resume_pill.bottom) / 2
                ),
                Some(HitTarget::ToggleAutoResume)
            );
            assert_eq!(
                hit_test_layout(
                    &layout,
                    (layout.btn_resume.left + layout.btn_resume.right) / 2,
                    (layout.btn_resume.top + layout.btn_resume.bottom) / 2
                ),
                Some(HitTarget::ResumeVps)
            );
            assert_eq!(
                hit_test_layout(
                    &layout,
                    (layout.btn_check.left + layout.btn_check.right) / 2,
                    (layout.btn_check.top + layout.btn_check.bottom) / 2
                ),
                Some(HitTarget::CheckNow)
            );
            assert_eq!(
                hit_test_layout(
                    &layout,
                    (layout.toggle_pill.left + layout.toggle_pill.right) / 2,
                    (layout.toggle_pill.top + layout.toggle_pill.bottom) / 2
                ),
                Some(HitTarget::ToggleAutoStart)
            );
            assert_eq!(
                hit_test_layout(
                    &layout,
                    (layout.close_btn.left + layout.close_btn.right) / 2,
                    (layout.close_btn.top + layout.close_btn.bottom) / 2
                ),
                Some(HitTarget::Close)
            );
            assert_eq!(hit_test_layout(&layout, 5, 5), None);
        }
    }

    #[test]
    fn format_helpers_produce_readable_indonesian_telemetry() {
        assert_eq!(format_kb_mb(0), "0 MB");
        assert_eq!(format_kb_mb(2242), "2.2 MB");
        assert_eq!(format_uptime_compact(45), "45 detik");
        assert_eq!(format_uptime_compact(125), "2m 5d");
        assert_eq!(format_uptime_compact(3665), "1j 1m 5d");
    }
}
