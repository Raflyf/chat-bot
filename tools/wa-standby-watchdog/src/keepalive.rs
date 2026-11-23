use std::collections::HashMap;
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::Instant;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const ERROR_MAX_CHARS: usize = 160;

pub const SUPABASE_KEEPALIVE_STATE_FILE: &str = "__vps_keepalive_state.json";
pub const KEEPALIVE_LEASE_ID: &str = "baileys-bot-keepalive";
pub const MIN_KEEPALIVE_INTERVAL_SECS: u64 = 60;
pub const MAX_KEEPALIVE_LEASE_TTL_SECS: u64 = 3600;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeepaliveConfig {
    pub default_enabled: bool,
    pub interval_secs: u64,
    pub lease_ttl_secs: u64,
    pub idle_pause_minutes: u64,
}

impl KeepaliveConfig {
    pub fn from_env_map(env_map: &HashMap<String, String>) -> Self {
        let default_enabled = env_map
            .get("VPS_KEEPALIVE_ENABLED")
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
            .map_or(true, |v| !matches!(v.as_str(), "false" | "0" | "no" | "off"));

        let raw_interval = env_map
            .get("VPS_KEEPALIVE_INTERVAL_SECONDS")
            .and_then(|s| s.trim().parse::<u64>().ok())
            .filter(|&v| v > 0)
            .unwrap_or(600);
        let interval_secs = raw_interval.clamp(MIN_KEEPALIVE_INTERVAL_SECS, MAX_KEEPALIVE_LEASE_TTL_SECS);

        let min_ttl = (interval_secs.saturating_mul(2))
            .min(MAX_KEEPALIVE_LEASE_TTL_SECS)
            .max(30);
        let raw_ttl = env_map
            .get("VPS_KEEPALIVE_LEASE_TTL_SECONDS")
            .and_then(|s| s.trim().parse::<u64>().ok())
            .filter(|&v| v > 0)
            .unwrap_or(3600);
        let lease_ttl_secs = raw_ttl.clamp(min_ttl, MAX_KEEPALIVE_LEASE_TTL_SECS);

        let idle_pause_minutes = env_map
            .get("VPS_IDLE_PAUSE_MINUTES")
            .and_then(|s| s.trim().parse::<u64>().ok())
            .filter(|&v| v > 0)
            .unwrap_or(30)
            .max(1);

        Self {
            default_enabled,
            interval_secs,
            lease_ttl_secs,
            idle_pause_minutes,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VpsSnapshot {
    pub raw_state: String,
    pub auto_suspend_secs: Option<u64>,
    pub run_started_at_epoch: Option<u64>,
    pub max_run_minutes: Option<u64>,
    pub cooldown_until_epoch: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeepaliveState {
    pub enabled: bool,
    pub enabled_updated_at: Option<u64>,
    pub enabled_updated_by: Option<String>,
    pub last_ping_at: Option<u64>,
    pub last_attempt_at: Option<u64>,
    pub last_ping_ok: bool,
    pub last_ping_latency_ms: Option<u64>,
    pub last_ping_source: Option<String>,
    pub ping_count: u64,
    pub fail_count: u64,
    pub consecutive_failures: u64,
    pub last_error: Option<String>,
    pub next_ping_at: Option<u64>,
    pub cooldown_until: Option<u64>,
    pub lease_expires_at: Option<u64>,
    pub idle_window_secs: Option<u64>,
    pub idle_window_source: String,
    pub updated_at: Option<u64>,
}

impl KeepaliveState {
    pub fn default_with_enabled(enabled: bool) -> Self {
        Self {
            enabled,
            enabled_updated_at: None,
            enabled_updated_by: None,
            last_ping_at: None,
            last_attempt_at: None,
            last_ping_ok: false,
            last_ping_latency_ms: None,
            last_ping_source: None,
            ping_count: 0,
            fail_count: 0,
            consecutive_failures: 0,
            last_error: None,
            next_ping_at: None,
            cooldown_until: None,
            lease_expires_at: None,
            idle_window_secs: None,
            idle_window_source: "unknown".to_string(),
            updated_at: None,
        }
    }

    pub fn clear_on_disable(&mut self, now_secs: u64, source: &str) {
        self.enabled = false;
        self.enabled_updated_at = Some(now_secs);
        self.enabled_updated_by = normalize_source(source);
        self.cooldown_until = None;
        self.next_ping_at = None;
        self.lease_expires_at = None;
        self.consecutive_failures = 0;
        self.last_error = None;
        self.updated_at = Some(now_secs);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeepaliveView {
    pub enabled: bool,
    pub idle_window_secs: u64,
    pub lease_remaining_secs: Option<u64>,
    pub idle_secs: Option<u64>,
    pub pause_in_secs: Option<u64>,
    pub next_ping_in_secs: Option<u64>,
    pub idle_bar_pct: u8,
    pub at_risk: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LeaseRenewOutcome {
    Ok {
        status: u16,
        latency_ms: u64,
        lease_expires_at: Option<u64>,
    },
    NotRunning {
        status: u16,
    },
    Err {
        status: u16,
        latency_ms: u64,
        message: String,
        retry_after_secs: Option<u64>,
    },
}

pub fn format_duration_compact(secs: u64) -> String {
    if secs >= 3600 {
        let h = secs / 3600;
        let m = (secs % 3600) / 60;
        format!("{h}j {m}m")
    } else if secs >= 60 {
        let m = secs / 60;
        let s = secs % 60;
        format!("{m}m {s}d")
    } else {
        format!("{secs}d")
    }
}

pub fn parse_iso8601_epoch_secs(iso: &str) -> Option<u64> {
    let s = iso.trim();
    if s.len() < 19 {
        return None;
    }
    let b = s.as_bytes();
    if b[4] != b'-'
        || b[7] != b'-'
        || (b[10] != b'T' && b[10] != b't' && b[10] != b' ')
        || b[13] != b':'
        || b[16] != b':'
    {
        return None;
    }

    let year: i64 = s[0..4].parse().ok()?;
    let month: i64 = s[5..7].parse().ok()?;
    let day: i64 = s[8..10].parse().ok()?;
    let hour: u64 = s[11..13].parse().ok()?;
    let min: u64 = s[14..16].parse().ok()?;
    let sec: u64 = s[17..19].parse().ok()?;

    if year < 1970 || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    if hour > 23 || min > 59 || sec > 60 {
        return None;
    }

    let mut rest = &s[19..];
    if let Some(after_dot) = rest.strip_prefix('.') {
        let frac_len = after_dot.bytes().take_while(|c| c.is_ascii_digit()).count();
        if frac_len == 0 {
            return None;
        }
        rest = &after_dot[frac_len..];
    }

    let tz_offset_secs: i64 = if rest.is_empty() || rest.eq_ignore_ascii_case("z") {
        0
    } else if let Some(sign) = rest.chars().next().filter(|&c| c == '+' || c == '-') {
        let sign_mul = if sign == '-' { -1i64 } else { 1i64 };
        let tz_str = &rest[1..];
        let (oh, om): (u64, u64) = if tz_str.len() == 5 && tz_str.as_bytes()[2] == b':' {
            (tz_str[0..2].parse().ok()?, tz_str[3..5].parse().ok()?)
        } else if tz_str.len() == 4 && tz_str.bytes().all(|c| c.is_ascii_digit()) {
            (tz_str[0..2].parse().ok()?, tz_str[2..4].parse().ok()?)
        } else if tz_str.len() == 2 && tz_str.bytes().all(|c| c.is_ascii_digit()) {
            (tz_str.parse().ok()?, 0)
        } else {
            return None;
        };
        if oh > 23 || om > 59 {
            return None;
        }
        sign_mul * ((oh * 3600 + om * 60) as i64)
    } else {
        return None;
    };

    // Howard Hinnant civil-from/to-days algorithm
    let y = year - if month <= 2 { 1 } else { 0 };
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let m_adj = month + if month > 2 { -3 } else { 9 };
    let doy = (153 * m_adj + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;

    let total_secs = days
        .checked_mul(86_400)?
        .checked_add((hour * 3600 + min * 60 + sec.min(59)) as i64)?
        .checked_sub(tz_offset_secs)?;
    if total_secs > 0 {
        Some(total_secs as u64)
    } else {
        None
    }
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c as u32 == 0x7F => out.push(' '),
            c => out.push(c),
        }
    }
    out
}

fn curl_config_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn find_json_value_start<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("\"{key}\"");
    let mut search_from = 0;
    while let Some(pos) = json[search_from..].find(&needle) {
        let key_start = search_from + pos;
        let prev_ok = key_start == 0
            || matches!(
                json[..key_start].as_bytes().last().copied(),
                Some(b'{' | b',' | b' ' | b'\n' | b'\r' | b'\t')
            );
        let abs_pos = key_start + needle.len();
        if prev_ok {
            let rest = json[abs_pos..].trim_start();
            if let Some(after_colon) = rest.strip_prefix(':') {
                return Some(after_colon.trim_start());
            }
        }
        search_from = abs_pos;
    }
    None
}

fn parse_json_string_at(val_start: &str) -> Option<String> {
    let inner = val_start.strip_prefix('"')?;
    let mut out = String::new();
    let mut chars = inner.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next()? {
                '"' => out.push('"'),
                '\\' => out.push('\\'),
                '/' => out.push('/'),
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                'b' | 'f' => out.push(' '),
                other => out.push(other),
            }
        } else if ch == '"' {
            return Some(out);
        } else {
            out.push(ch);
        }
    }
    None
}

fn extract_json_string(json: &str, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(vs) = find_json_value_start(json, key) {
            if let Some(s) = parse_json_string_at(vs) {
                let clean = sanitize_single_line(&s, 240);
                if !clean.is_empty() {
                    return Some(clean);
                }
            }
        }
    }
    None
}

fn extract_json_bool(json: &str, keys: &[&str]) -> Option<bool> {
    for key in keys {
        if let Some(vs) = find_json_value_start(json, key) {
            if vs.starts_with("true") {
                return Some(true);
            }
            if vs.starts_with("false") {
                return Some(false);
            }
        }
    }
    None
}

fn extract_json_u64(json: &str, keys: &[&str]) -> Option<u64> {
    for key in keys {
        if let Some(vs) = find_json_value_start(json, key) {
            if vs.starts_with("null") {
                continue;
            }
            let num_slice = vs.strip_prefix('"').unwrap_or(vs);
            let digits: String = num_slice
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if !digits.is_empty() {
                if let Ok(v) = digits.parse::<u64>() {
                    return Some(v);
                }
            }
        }
    }
    None
}

fn extract_json_epoch(json: &str, keys: &[&str]) -> Option<u64> {
    extract_json_u64(json, keys).filter(|&v| v > 0)
}

fn sanitize_single_line(s: &str, max_chars: usize) -> String {
    let collapsed: String = s
        .chars()
        .map(|c| {
            if (c as u32) < 0x20 || c as u32 == 0x7F {
                ' '
            } else {
                c
            }
        })
        .collect();
    let trimmed = collapsed.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.chars().count() > max_chars {
        trimmed.chars().take(max_chars).collect()
    } else {
        trimmed
    }
}

fn normalize_source(s: &str) -> Option<String> {
    match s.trim().to_ascii_lowercase().as_str() {
        "web" => Some("web".to_string()),
        "cron" => Some("cron".to_string()),
        "vps" => Some("vps".to_string()),
        "desktop" => Some("desktop".to_string()),
        _ => None,
    }
}

fn normalize_window_source(s: &str) -> String {
    match s.trim().to_ascii_lowercase().as_str() {
        "live" => "live".to_string(),
        "config" => "config".to_string(),
        _ => "unknown".to_string(),
    }
}

fn extract_machine_scope(json: &str) -> &str {
    if let Some(vs) = find_json_value_start(json, "machine") {
        if vs.starts_with('{') {
            return vs;
        }
    }
    json
}

pub fn parse_vps_snapshot_json(json: &str) -> Option<VpsSnapshot> {
    let scope = extract_machine_scope(json);
    let raw_state = extract_json_string(scope, &["state", "status"])
        .or_else(|| extract_json_string(json, &["state", "status"]))?
        .to_ascii_lowercase();
    if raw_state.is_empty() {
        return None;
    }

    let auto_suspend_secs = extract_json_u64(
        scope,
        &["autoSuspendAfterSeconds", "auto_suspend_after_seconds"],
    )
    .filter(|&v| v > 0);
    let max_run_minutes =
        extract_json_u64(scope, &["maxRunMinutes", "max_run_minutes"]).filter(|&v| v > 0);
    let run_started_at_epoch = extract_json_string(scope, &["runStartedAt", "run_started_at"])
        .and_then(|iso| parse_iso8601_epoch_secs(&iso));
    let cooldown_until_epoch =
        extract_json_string(scope, &["cooldownUntil", "cooldown_until", "cooldown_at"])
            .and_then(|iso| parse_iso8601_epoch_secs(&iso));

    Some(VpsSnapshot {
        raw_state,
        auto_suspend_secs,
        run_started_at_epoch,
        max_run_minutes,
        cooldown_until_epoch,
    })
}

pub fn parse_keepalive_state_json(json: &str, default_enabled: bool) -> KeepaliveState {
    let mut st = KeepaliveState::default_with_enabled(default_enabled);
    if let Some(b) = extract_json_bool(json, &["enabled"]) {
        st.enabled = b;
    }
    st.enabled_updated_at = extract_json_epoch(json, &["enabled_updated_at"]);
    st.enabled_updated_by =
        extract_json_string(json, &["enabled_updated_by"]).and_then(|s| normalize_source(&s));
    st.last_ping_at = extract_json_epoch(json, &["last_ping_at"]);
    st.last_attempt_at = extract_json_epoch(json, &["last_attempt_at"]);
    if let Some(b) = extract_json_bool(json, &["last_ping_ok"]) {
        st.last_ping_ok = b;
    }
    st.last_ping_latency_ms = extract_json_u64(json, &["last_ping_latency_ms"]);
    st.last_ping_source =
        extract_json_string(json, &["last_ping_source"]).and_then(|s| normalize_source(&s));
    st.ping_count = extract_json_u64(json, &["ping_count"]).unwrap_or(0);
    st.fail_count = extract_json_u64(json, &["fail_count"]).unwrap_or(0);
    st.consecutive_failures = extract_json_u64(json, &["consecutive_failures"]).unwrap_or(0);
    st.last_error = extract_json_string(json, &["last_error"])
        .map(|s| sanitize_single_line(&s, ERROR_MAX_CHARS))
        .filter(|s| !s.is_empty());
    st.next_ping_at = extract_json_epoch(json, &["next_ping_at"]);
    st.cooldown_until = extract_json_epoch(json, &["cooldown_until"]);
    st.lease_expires_at = extract_json_epoch(json, &["lease_expires_at"]);
    st.idle_window_secs = extract_json_epoch(json, &["idle_window_secs"]);
    if let Some(ws) = extract_json_string(json, &["idle_window_source"]) {
        st.idle_window_source = normalize_window_source(&ws);
    }
    st.updated_at = extract_json_epoch(json, &["updated_at"]);
    st
}

fn fmt_opt_u64(v: Option<u64>) -> String {
    match v {
        Some(n) => n.to_string(),
        None => "null".to_string(),
    }
}

fn fmt_opt_str(v: &Option<String>) -> String {
    match v {
        Some(s) => format!("\"{}\"", json_escape(s)),
        None => "null".to_string(),
    }
}

pub fn serialize_keepalive_state_json(st: &KeepaliveState) -> String {
    let clean_err = st
        .last_error
        .as_deref()
        .map(|e| sanitize_single_line(e, ERROR_MAX_CHARS))
        .filter(|e| !e.is_empty());
    format!(
        "{{\"enabled\":{},\"enabled_updated_at\":{},\"enabled_updated_by\":{},\"last_ping_at\":{},\"last_attempt_at\":{},\"last_ping_ok\":{},\"last_ping_latency_ms\":{},\"last_ping_source\":{},\"ping_count\":{},\"fail_count\":{},\"consecutive_failures\":{},\"last_error\":{},\"next_ping_at\":{},\"cooldown_until\":{},\"lease_expires_at\":{},\"idle_window_secs\":{},\"idle_window_source\":\"{}\",\"updated_at\":{}}}",
        if st.enabled { "true" } else { "false" },
        fmt_opt_u64(st.enabled_updated_at),
        fmt_opt_str(&st.enabled_updated_by),
        fmt_opt_u64(st.last_ping_at),
        fmt_opt_u64(st.last_attempt_at),
        if st.last_ping_ok { "true" } else { "false" },
        fmt_opt_u64(st.last_ping_latency_ms),
        fmt_opt_str(&st.last_ping_source),
        st.ping_count,
        st.fail_count,
        st.consecutive_failures,
        fmt_opt_str(&clean_err),
        fmt_opt_u64(st.next_ping_at),
        fmt_opt_u64(st.cooldown_until),
        fmt_opt_u64(st.lease_expires_at),
        fmt_opt_u64(st.idle_window_secs),
        json_escape(&normalize_window_source(&st.idle_window_source)),
        fmt_opt_u64(st.updated_at),
    )
}

pub fn merge_keepalive_state(
    local: &KeepaliveState,
    remote: &KeepaliveState,
    live_idle_window: Option<u64>,
) -> (KeepaliveState, bool, bool) {
    let local_toggle_ts = local.enabled_updated_at.unwrap_or(0);
    let remote_toggle_ts = remote.enabled_updated_at.unwrap_or(0);
    let local_updated_ts = local.updated_at.unwrap_or(0);
    let remote_updated_ts = remote.updated_at.unwrap_or(0);

    let (win_enabled, win_upd_at, win_upd_by, remote_toggled) =
        if remote_toggle_ts > local_toggle_ts {
            (
                remote.enabled,
                remote.enabled_updated_at,
                remote.enabled_updated_by.clone(),
                remote.enabled != local.enabled,
            )
        } else {
            (
                local.enabled,
                local.enabled_updated_at,
                local.enabled_updated_by.clone(),
                false,
            )
        };

    let mut merged = if remote_updated_ts > local_updated_ts {
        remote.clone()
    } else {
        local.clone()
    };

    merged.enabled = win_enabled;
    merged.enabled_updated_at = win_upd_at;
    merged.enabled_updated_by = win_upd_by;

    // If local disabled more recently than remote telemetry, keep disable reset clean.
    if !win_enabled && local_toggle_ts > remote_toggle_ts {
        merged.cooldown_until = None;
        merged.next_ping_at = None;
        merged.lease_expires_at = None;
        merged.consecutive_failures = 0;
        merged.last_error = None;
        merged.updated_at = Some(local_updated_ts.max(local_toggle_ts));
    }

    if let Some(w) = live_idle_window.filter(|&w| w > 0) {
        merged.idle_window_secs = Some(w);
        merged.idle_window_source = "live".to_string();
    }

    let local_needs_push =
        local_toggle_ts > remote_toggle_ts || local_updated_ts > remote_updated_ts;

    (merged, remote_toggled, local_needs_push)
}

pub fn compute_keepalive_view(
    st: &KeepaliveState,
    cfg: &KeepaliveConfig,
    running: bool,
    live_auto_suspend_secs: Option<u64>,
    run_started_epoch: Option<u64>,
    now_secs: u64,
) -> KeepaliveView {
    let live_window = live_auto_suspend_secs.filter(|&w| w > 0);
    let cached_window = st.idle_window_secs.filter(|&w| w > 0);
    let idle_window_secs = live_window
        .or(cached_window)
        .unwrap_or_else(|| cfg.idle_pause_minutes.saturating_mul(60).max(60));

    let ping_from_current_run = st
        .last_ping_at
        .map_or(false, |lp| run_started_epoch.map_or(true, |rs| lp >= rs));

    let effective_lease_expires_at = if ping_from_current_run {
        st.lease_expires_at.filter(|&e| e > 0)
    } else {
        None
    };

    let lease_remaining_secs = effective_lease_expires_at.map(|e| e.saturating_sub(now_secs));

    let idle_secs = if ping_from_current_run {
        st.last_ping_at.map(|lp| now_secs.saturating_sub(lp))
    } else {
        None
    };

    let assumed_next_ping_at = if !st.enabled {
        None
    } else if running
        && !ping_from_current_run
        && st.cooldown_until.map_or(true, |c| c <= now_secs)
    {
        Some(now_secs)
    } else {
        Some(
            st.next_ping_at
                .unwrap_or_else(|| now_secs.saturating_add(cfg.interval_secs)),
        )
    };
    let next_ping_in_secs = assumed_next_ping_at.map(|nx| nx.saturating_sub(now_secs));

    let idle_count_from = if effective_lease_expires_at.is_some() {
        effective_lease_expires_at
    } else if ping_from_current_run && st.last_ping_at.is_some() {
        st.last_ping_at
    } else if running {
        run_started_epoch
    } else {
        None
    };

    let pause_at = idle_count_from.map(|f| f.saturating_add(idle_window_secs));
    let pause_in_secs = if running {
        pause_at.map(|pa| pa.saturating_sub(now_secs))
    } else {
        None
    };

    let at_risk = if let (true, Some(rem), Some(pa)) = (running, pause_in_secs, pause_at) {
        if st.enabled {
            rem <= 300 || assumed_next_ping_at.map_or(false, |nx| pa <= nx)
        } else {
            rem <= 300
        }
    } else {
        false
    };

    let idle_bar_pct = match pause_in_secs {
        Some(rem) if idle_window_secs > 0 && rem < idle_window_secs => {
            let used = idle_window_secs.saturating_sub(rem);
            ((used.saturating_mul(100) + idle_window_secs / 2) / idle_window_secs).min(100) as u8
        }
        Some(0) if idle_window_secs > 0 => 100,
        _ => 0,
    };

    KeepaliveView {
        enabled: st.enabled,
        idle_window_secs,
        lease_remaining_secs,
        idle_secs,
        pause_in_secs,
        next_ping_in_secs,
        idle_bar_pct,
        at_risk,
    }
}

pub fn is_keepalive_due(
    st: &KeepaliveState,
    running: bool,
    run_started_epoch: Option<u64>,
    interval_secs: u64,
    now_secs: u64,
) -> bool {
    if !running || !st.enabled {
        return false;
    }
    if st.cooldown_until.map_or(false, |c| c > now_secs) {
        return false;
    }
    let Some(last_ping) = st.last_ping_at else {
        return true;
    };
    if run_started_epoch.map_or(false, |rs| rs > last_ping) {
        return true;
    }
    now_secs.saturating_sub(last_ping) >= interval_secs
}

pub fn backoff_secs_for_failure(
    status: u16,
    consecutive_failures: u64,
    retry_after_secs: Option<u64>,
) -> u64 {
    if status == 401 || status == 403 {
        return 1800;
    }
    if status == 429 {
        if let Some(ra) = retry_after_secs {
            return ra.clamp(60, 1800).saturating_add(10);
        }
        return 900;
    }
    const STEPS: [u64; 4] = [300, 600, 1200, 1800];
    let idx = (consecutive_failures as usize).min(STEPS.len() - 1);
    STEPS[idx]
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

pub fn split_http_headers_and_body(raw: &str) -> (&str, &str) {
    let mut rest = raw;
    loop {
        if !rest.starts_with("HTTP/") {
            return ("", rest);
        }
        let crlf_pos = rest.find("\r\n\r\n");
        let lf_pos = rest.find("\n\n");
        let (sep_idx, sep_len) = match (crlf_pos, lf_pos) {
            (Some(c), Some(l)) => {
                if c <= l {
                    (c, 4)
                } else {
                    (l, 2)
                }
            }
            (Some(c), None) => (c, 4),
            (None, Some(l)) => (l, 2),
            (None, None) => return (rest, ""),
        };
        let hdr_block = &rest[..sep_idx];
        let after = &rest[sep_idx + sep_len..];
        let first_line = hdr_block.lines().next().unwrap_or("");
        let status_code = first_line
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse::<u16>().ok())
            .unwrap_or(0);
        if (100..200).contains(&status_code) && after.starts_with("HTTP/") {
            rest = after;
            continue;
        }
        return (hdr_block, after);
    }
}

pub fn parse_retry_after_header(headers: &str) -> Option<u64> {
    for line in headers.lines() {
        if let Some((name, val)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("retry-after") {
                let trimmed = val.trim();
                if !trimmed.is_empty() && trimmed.bytes().all(|b| b.is_ascii_digit()) {
                    if let Ok(secs) = trimmed.parse::<u64>() {
                        return Some(secs);
                    }
                }
            }
        }
    }
    None
}

fn sanitize_http_error(body: &str, status: u16) -> String {
    let candidate = extract_json_string(body, &["message", "error"]).unwrap_or_else(|| {
        sanitize_single_line(body, ERROR_MAX_CHARS)
    });
    let prefix = if status > 0 {
        format!("HTTP {status}")
    } else {
        "Jaringan gagal".to_string()
    };
    let combined = if candidate.is_empty() {
        prefix
    } else {
        format!("{prefix}: {candidate}")
    };
    sanitize_single_line(&combined, ERROR_MAX_CHARS)
}

pub fn renew_vps_activity_lease(
    curl_bin: &str,
    api_base: &str,
    api_key: &str,
    machine_id: &str,
    lease_ttl_secs: u64,
) -> LeaseRenewOutcome {
    let base = api_base.trim().trim_end_matches('/');
    let url = format!("{base}/v1/machines/{machine_id}/activity-leases/{KEEPALIVE_LEASE_ID}");
    let body_json = format!("{{\"ttlSeconds\":{}}}", lease_ttl_secs.clamp(30, MAX_KEEPALIVE_LEASE_TTL_SECS));

    let started = Instant::now();
    let mut cmd = Command::new(curl_bin);
    cmd.args(["-sS", "-i", "--max-time", "12", "-w", "\n%{http_code}", "--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => {
            return LeaseRenewOutcome::Err {
                status: 0,
                latency_ms: started.elapsed().as_millis() as u64,
                message: "Jaringan gagal: gagal menjalankan curl".to_string(),
                retry_after_secs: None,
            }
        }
    };

    if let Some(mut stdin) = child.stdin.take() {
        let cfg = format!(
            "url = {}\nrequest = \"PUT\"\nheader = {}\nheader = \"Accept: application/json\"\nheader = \"Content-Type: application/json\"\ndata = {}\n",
            curl_config_quote(&url),
            curl_config_quote(&format!("Authorization: Bearer {api_key}")),
            curl_config_quote(&body_json),
        );
        let _ = stdin.write_all(cfg.as_bytes());
    }

    let output = match child.wait_with_output() {
        Ok(o) => o,
        Err(_) => {
            return LeaseRenewOutcome::Err {
                status: 0,
                latency_ms: started.elapsed().as_millis() as u64,
                message: "Jaringan gagal: curl timeout / wait error".to_string(),
                retry_after_secs: None,
            }
        }
    };

    let latency_ms = started.elapsed().as_millis() as u64;
    let raw = String::from_utf8_lossy(&output.stdout);
    let (status, payload) = split_curl_body_and_status(&raw);
    let (headers, body) = split_http_headers_and_body(payload);

    if !output.status.success() && status == 0 {
        return LeaseRenewOutcome::Err {
            status: 0,
            latency_ms,
            message: "Jaringan gagal: tidak dapat menghubungi InstaBox".to_string(),
            retry_after_secs: None,
        };
    }

    if (200..300).contains(&status) {
        let lease_expires_at = extract_json_string(body, &["expiresAt", "expires_at"])
            .and_then(|iso| parse_iso8601_epoch_secs(&iso));
        return LeaseRenewOutcome::Ok {
            status,
            latency_ms,
            lease_expires_at,
        };
    }

    if status == 409 {
        return LeaseRenewOutcome::NotRunning { status };
    }

    let retry_after_secs = parse_retry_after_header(headers)
        .or_else(|| extract_json_u64(body, &["retryAfterSeconds", "retry_after_seconds"]));

    LeaseRenewOutcome::Err {
        status,
        latency_ms,
        message: sanitize_http_error(body, status),
        retry_after_secs,
    }
}

pub fn release_vps_activity_lease(
    curl_bin: &str,
    api_base: &str,
    api_key: &str,
    machine_id: &str,
) -> (bool, u16) {
    let base = api_base.trim().trim_end_matches('/');
    let url = format!("{base}/v1/machines/{machine_id}/activity-leases/{KEEPALIVE_LEASE_ID}");

    let mut cmd = Command::new(curl_bin);
    cmd.args(["-sS", "--max-time", "8", "-w", "\n%{http_code}", "--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return (false, 0),
    };

    if let Some(mut stdin) = child.stdin.take() {
        let cfg = format!(
            "url = {}\nrequest = \"DELETE\"\nheader = {}\nheader = \"Accept: application/json\"\n",
            curl_config_quote(&url),
            curl_config_quote(&format!("Authorization: Bearer {api_key}")),
        );
        let _ = stdin.write_all(cfg.as_bytes());
    }

    let Ok(output) = child.wait_with_output() else {
        return (false, 0);
    };
    let raw = String::from_utf8_lossy(&output.stdout);
    let (status, _) = split_curl_body_and_status(&raw);
    let ok = (200..300).contains(&status) || status == 404;
    (ok, status)
}

fn extract_postgrest_content_json(raw: &str) -> Option<String> {
    let needle = "\"content\"";
    let pos = raw.find(needle)?;
    let after_key = raw[pos + needle.len()..].trim_start();
    let after_colon = after_key.strip_prefix(':')?.trim_start();
    parse_json_string_at(after_colon)
}

pub fn pull_keepalive_state(
    curl_bin: &str,
    supabase_url: &str,
    supabase_key: &str,
    default_enabled: bool,
) -> Option<KeepaliveState> {
    let url = format!(
        "{supabase_url}/rest/v1/whatsapp_sessions?filename=eq.{SUPABASE_KEEPALIVE_STATE_FILE}&select=content&limit=1"
    );
    let mut cmd = Command::new(curl_bin);
    cmd.args(["-sS", "--max-time", "5", "--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().ok()?;
    if let Some(mut stdin) = child.stdin.take() {
        let cfg = format!(
            "url = {}\nheader = {}\nheader = {}\nheader = \"Accept: application/json\"\n",
            curl_config_quote(&url),
            curl_config_quote(&format!("apikey: {supabase_key}")),
            curl_config_quote(&format!("Authorization: Bearer {supabase_key}")),
        );
        let _ = stdin.write_all(cfg.as_bytes());
    }

    let output = child.wait_with_output().ok()?;
    if !output.status.success() {
        return None;
    }

    let body = String::from_utf8_lossy(&output.stdout);
    let content = extract_postgrest_content_json(&body)?;
    Some(parse_keepalive_state_json(&content, default_enabled))
}

pub fn push_keepalive_state(
    curl_bin: &str,
    supabase_url: &str,
    supabase_key: &str,
    st: &KeepaliveState,
    timeout_secs: &str,
) -> bool {
    let content_json = serialize_keepalive_state_json(st);
    let url = format!("{supabase_url}/rest/v1/whatsapp_sessions?on_conflict=filename");
    let row_json = format!(
        "{{\"filename\":\"{}\",\"content\":\"{}\"}}",
        SUPABASE_KEEPALIVE_STATE_FILE,
        json_escape(&content_json),
    );
    let mut cmd = Command::new(curl_bin);
    cmd.args(["-sS", "--max-time", timeout_secs, "--config", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return false,
    };
    if let Some(mut stdin) = child.stdin.take() {
        let cfg = format!(
            "url = {}\nrequest = \"POST\"\nheader = {}\nheader = {}\nheader = \"Content-Type: application/json\"\nheader = \"Prefer: resolution=merge-duplicates,return=minimal\"\ndata = {}\n",
            curl_config_quote(&url),
            curl_config_quote(&format!("apikey: {supabase_key}")),
            curl_config_quote(&format!("Authorization: Bearer {supabase_key}")),
            curl_config_quote(&row_json),
        );
        let _ = stdin.write_all(cfg.as_bytes());
    }

    child.wait_with_output().map_or(false, |o| o.status.success())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_iso8601_handles_utc_fractional_and_offsets() {
        assert_eq!(parse_iso8601_epoch_secs("1970-01-01T00:00:01Z"), Some(1));
        assert_eq!(
            parse_iso8601_epoch_secs("2026-11-22T22:28:13.774418Z"),
            parse_iso8601_epoch_secs("2026-11-22T22:28:13Z")
        );
        assert_eq!(
            parse_iso8601_epoch_secs("2026-11-23T05:28:13+07:00"),
            parse_iso8601_epoch_secs("2026-11-22T22:28:13Z")
        );
        assert_eq!(parse_iso8601_epoch_secs("invalid"), None);
    }

    #[test]
    fn parse_vps_snapshot_supports_flat_and_nested_formats() {
        let flat = r#"{"id":"m_1","state":"running","autoSuspendAfterSeconds":1800,"maxRunMinutes":480,"runStartedAt":"2026-11-22T22:28:13.774418Z","cooldownUntil":null}"#;
        let snap = parse_vps_snapshot_json(flat).expect("flat snapshot");
        assert_eq!(snap.raw_state, "running");
        assert_eq!(snap.auto_suspend_secs, Some(1800));
        assert_eq!(snap.max_run_minutes, Some(480));
        assert!(snap.run_started_at_epoch.is_some());
        assert_eq!(snap.cooldown_until_epoch, None);

        let nested = r#"{"machine":{"status":"PAUSED","auto_suspend_after_seconds":900,"cooldown_until":"2026-11-23T06:10:00Z"}}"#;
        let snap2 = parse_vps_snapshot_json(nested).expect("nested snapshot");
        assert_eq!(snap2.raw_state, "paused");
        assert_eq!(snap2.auto_suspend_secs, Some(900));
        assert!(snap2.cooldown_until_epoch.is_some());
    }

    #[test]
    fn keepalive_config_clamps_interval_and_lease_ttl() {
        let mut map = HashMap::new();
        let def = KeepaliveConfig::from_env_map(&map);
        assert!(def.default_enabled);
        assert_eq!(def.interval_secs, 600);
        assert_eq!(def.lease_ttl_secs, 3600);
        assert_eq!(def.idle_pause_minutes, 30);

        map.insert("VPS_KEEPALIVE_ENABLED".to_string(), "false".to_string());
        map.insert("VPS_KEEPALIVE_INTERVAL_SECONDS".to_string(), "20".to_string());
        map.insert("VPS_KEEPALIVE_LEASE_TTL_SECONDS".to_string(), "30".to_string());
        let clamped = KeepaliveConfig::from_env_map(&map);
        assert!(!clamped.default_enabled);
        assert_eq!(clamped.interval_secs, 60);
        assert_eq!(clamped.lease_ttl_secs, 120);
    }

    #[test]
    fn keepalive_state_json_roundtrip_preserves_nulls_and_escapes() {
        let mut st = KeepaliveState::default_with_enabled(true);
        st.enabled_updated_at = Some(1_795_400_000);
        st.enabled_updated_by = Some("desktop".to_string());
        st.last_ping_at = Some(1_795_400_100);
        st.last_attempt_at = Some(1_795_400_100);
        st.last_ping_ok = true;
        st.last_ping_latency_ms = Some(0);
        st.last_ping_source = Some("desktop".to_string());
        st.ping_count = 4;
        st.last_error = Some("HTTP 500: \"err\"\nline2".to_string());
        st.idle_window_secs = Some(1800);
        st.idle_window_source = "live".to_string();
        st.updated_at = Some(1_795_400_100);

        let json = serialize_keepalive_state_json(&st);
        let parsed = parse_keepalive_state_json(&json, false);
        assert!(parsed.enabled);
        assert_eq!(parsed.enabled_updated_by.as_deref(), Some("desktop"));
        assert_eq!(parsed.last_ping_latency_ms, Some(0));
        assert_eq!(parsed.ping_count, 4);
        assert_eq!(parsed.last_error.as_deref(), Some("HTTP 500: \"err\" line2"));
        assert_eq!(parsed.cooldown_until, None);
        assert_eq!(parsed.idle_window_source, "live");
    }

    #[test]
    fn merge_keepalive_state_respects_lww_toggle_and_telemetry() {
        let mut local = KeepaliveState::default_with_enabled(true);
        local.enabled_updated_at = Some(100);
        local.enabled_updated_by = Some("desktop".to_string());
        local.updated_at = Some(100);

        let mut remote = KeepaliveState::default_with_enabled(false);
        remote.enabled_updated_at = Some(200);
        remote.enabled_updated_by = Some("web".to_string());
        remote.ping_count = 7;
        remote.updated_at = Some(200);

        let (merged, remote_toggled, local_push) = merge_keepalive_state(&local, &remote, Some(1800));
        assert!(!merged.enabled);
        assert!(remote_toggled);
        assert!(!local_push);
        assert_eq!(merged.ping_count, 7);
        assert_eq!(merged.idle_window_secs, Some(1800));
        assert_eq!(merged.idle_window_source, "live");

        // Local toggle newer than remote -> pushes local toggle while adopting newer telemetry if any
        local.clear_on_disable(300, "desktop");
        remote.enabled = true;
        remote.enabled_updated_at = Some(250);
        let (merged2, remote_toggled2, local_push2) = merge_keepalive_state(&local, &remote, None);
        assert!(!merged2.enabled);
        assert!(!remote_toggled2);
        assert!(local_push2);
        assert_eq!(merged2.enabled_updated_by.as_deref(), Some("desktop"));
    }

    #[test]
    fn compute_keepalive_view_continuity_new_run_and_non_running() {
        let cfg = KeepaliveConfig {
            default_enabled: true,
            interval_secs: 600,
            lease_ttl_secs: 3600,
            idle_pause_minutes: 30,
        };
        let mut st = KeepaliveState::default_with_enabled(true);
        st.last_ping_at = Some(1000);
        st.lease_expires_at = Some(1100);
        st.next_ping_at = Some(1600);

        // Immediately after lease expiry (now=1200): pause starts from lease_expires_at (1100 + 1800 = 2900 -> rem = 1700)
        let v1 = compute_keepalive_view(&st, &cfg, true, Some(1800), Some(900), 1200);
        assert_eq!(v1.lease_remaining_secs, Some(0));
        assert_eq!(v1.pause_in_secs, Some(1700));
        assert!(v1.idle_bar_pct > 0 && v1.idle_bar_pct < 10);

        // Fresh run started after last_ping_at (run_started=2000 > last_ping=1000): lease cleared, next_ping=0
        let v_new = compute_keepalive_view(&st, &cfg, true, Some(1800), Some(2000), 2100);
        assert_eq!(v_new.lease_remaining_secs, None);
        assert_eq!(v_new.idle_secs, None);
        assert_eq!(v_new.next_ping_in_secs, Some(0));
        assert_eq!(v_new.pause_in_secs, Some(1700));

        // VPS down/paused: pause countdown hidden
        let v_down = compute_keepalive_view(&st, &cfg, false, Some(1800), Some(900), 1200);
        assert_eq!(v_down.pause_in_secs, None);
        assert!(!v_down.at_risk);
    }

    #[test]
    fn split_http_headers_skips_100_continue_and_parses_retry_after() {
        let raw = "HTTP/1.1 100 Continue\r\n\r\nHTTP/2 429 \r\nRetry-After: 75\r\ncontent-type: application/json\r\n\r\n{\"error\":\"slow down\"}";
        let (hdrs, body) = split_http_headers_and_body(raw);
        assert_eq!(parse_retry_after_header(hdrs), Some(75));
        assert_eq!(body, "{\"error\":\"slow down\"}");
    }

    #[test]
    fn is_keepalive_due_and_backoff_behave_accurately() {
        let mut st = KeepaliveState::default_with_enabled(true);
        assert!(is_keepalive_due(&st, true, Some(500), 600, 1000));
        assert!(!is_keepalive_due(&st, false, Some(500), 600, 1000));

        st.last_ping_at = Some(1000);
        assert!(!is_keepalive_due(&st, true, Some(900), 600, 1200));
        assert!(is_keepalive_due(&st, true, Some(900), 600, 1600));
        assert!(is_keepalive_due(&st, true, Some(1100), 600, 1105));

        st.cooldown_until = Some(1700);
        assert!(!is_keepalive_due(&st, true, Some(1100), 600, 1650));

        assert_eq!(backoff_secs_for_failure(401, 0, None), 1800);
        assert_eq!(backoff_secs_for_failure(429, 0, Some(120)), 130);
        assert_eq!(backoff_secs_for_failure(429, 0, None), 900);
        assert_eq!(backoff_secs_for_failure(500, 0, None), 300);
        assert_eq!(backoff_secs_for_failure(500, 1, None), 600);
    }
}
