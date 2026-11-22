(() => {
  const SESSION_TOKEN_KEY = "freeaibot_admin_session_token";
  const RELEASE_FALLBACK_URL =
    "https://github.com/Raflyf/chat-bot/releases/tag/baileys-backup-latest";

  let cachedSnapshot = null;
  let clientReceivedAtMs = 0;
  let tickTimer = null;
  let fastPollTimer = null;
  let fastPollRemaining = 0;
  let inFlightCheck = false;
  let inFlightResume = false;
  let inFlightToggle = false;
  let lastActionFeedback = null;

  function translate(key, fallback) {
    if (typeof window.t === "function") {
      return window.t(key, fallback);
    }
    return fallback;
  }

  function getToken() {
    try {
      return sessionStorage.getItem(SESSION_TOKEN_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function formatCompactDuration(totalSecs) {
    const secs = Math.max(0, Math.floor(Number(totalSecs) || 0));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const isEn = document.documentElement.lang === "en";
    if (h > 0) return isEn ? `${h}h ${m}m ${s}s` : `${h}j ${m}m ${s}d`;
    if (m > 0) return isEn ? `${m}m ${s}s` : `${m}m ${s}d`;
    return isEn ? `${s}s` : `${s}d`;
  }

  function formatKbAsMb(kb) {
    const val = Number(kb) || 0;
    if (val <= 0) return "0 MB";
    const mb = val / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  function formatClockTime(epochSecs) {
    if (!epochSecs || epochSecs <= 0) return "--:--";
    try {
      return new Date(epochSecs * 1000).toLocaleTimeString(
        document.documentElement.lang === "en" ? "en-US" : "id-ID",
        { hour: "2-digit", minute: "2-digit" },
      );
    } catch (_) {
      return "--:--";
    }
  }

  function effectiveServerEpoch() {
    if (!cachedSnapshot || !cachedSnapshot.serverTimeEpoch) {
      return Math.floor(Date.now() / 1000);
    }
    const elapsedSinceFetch = clientReceivedAtMs
      ? Math.max(0, Math.floor((Date.now() - clientReceivedAtMs) / 1000))
      : 0;
    return cachedSnapshot.serverTimeEpoch + elapsedSinceFetch;
  }

  function setFeedback(kind, message) {
    lastActionFeedback = message ? { kind, message } : null;
    const el = byId("bb-feedback");
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      el.className = "bb-feedback";
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.className = `bb-feedback bb-feedback-${kind || "info"}`;
  }

  function stopFastPoll() {
    if (fastPollTimer) {
      clearTimeout(fastPollTimer);
      fastPollTimer = null;
    }
    fastPollRemaining = 0;
  }

  function scheduleFastPoll() {
    stopFastPoll();
    fastPollRemaining = 8;
    const step = async () => {
      if (fastPollRemaining <= 0) return;
      if (document.hidden) {
        fastPollTimer = setTimeout(step, 5000);
        return;
      }
      fastPollRemaining -= 1;
      await fetchStatus(false);
      if (cachedSnapshot && cachedSnapshot.vpsAvailability === "running") {
        stopFastPoll();
        return;
      }
      if (fastPollRemaining > 0) {
        fastPollTimer = setTimeout(step, 5000);
      }
    };
    fastPollTimer = setTimeout(step, 4000);
  }

  function updateDynamicCountdowns() {
    if (!cachedSnapshot) return;
    const nowEpoch = effectiveServerEpoch();

    const vpsSub = byId("bb-vps-sub");
    if (vpsSub) {
      if (!cachedSnapshot.instaboxConfigured) {
        vpsSub.textContent = translate(
          "dash.bb.notConfigured",
          "InstaBox API belum dikonfigurasi",
        );
      } else {
        const parts = [];
        if (cachedSnapshot.lastCheckedAt) {
          const age = Math.max(0, nowEpoch - cachedSnapshot.lastCheckedAt);
          parts.push(
            `${translate("dash.bb.lastCheckPrefix", "Cek terakhir:")} ${formatCompactDuration(age)} ${translate("dash.bb.agoSuffix", "lalu")}`,
          );
        }
        if (
          cachedSnapshot.vpsAvailability === "running" &&
          typeof cachedSnapshot.runtimeRemainingMinutes === "number"
        ) {
          parts.push(
            `${translate("dash.bb.remainingRuntime", "Sisa batas:")} ~${cachedSnapshot.runtimeRemainingMinutes} ${translate("dash.bb.minShort", "mnt")}`,
          );
        } else if (cachedSnapshot.liveFetchError) {
          parts.push(
            translate(
              "dash.bb.liveErrWarn",
              "Kueri live gagal, menampilkan snapshot terakhir.",
            ),
          );
        }
        vpsSub.textContent =
          parts.length > 0
            ? parts.join(" · ")
            : translate("dash.bb.waitingData", "Menunggu data");
      }
    }

    const autoDesc = byId("bb-auto-resume-desc");
    if (autoDesc) {
      if (
        cachedSnapshot.autoResumeEnabled &&
        cachedSnapshot.cooldownUntilEpoch &&
        cachedSnapshot.cooldownUntilEpoch > nowEpoch
      ) {
        const rem = cachedSnapshot.cooldownUntilEpoch - nowEpoch;
        autoDesc.textContent = `${translate("dash.bb.cooldownWait", "Cooldown:")} ${formatCompactDuration(rem)}`;
      } else if (cachedSnapshot.autoResumeEnabled) {
        autoDesc.textContent = translate(
          "dash.bb.autoResumeOnDesc",
          "Otomatis: VPS di-resume otomatis saat paused/suspended (laptop & cloud cron)",
        );
      } else {
        autoDesc.textContent = translate(
          "dash.bb.autoResumeOffDesc",
          "Manual: aktifkan lewat tombol di dashboard atau System Tray Windows",
        );
      }
    }
  }

  function syncLiveTicker() {
    const hasTimerNeed =
      cachedSnapshot &&
      !document.hidden &&
      Boolean(getToken()) &&
      (cachedSnapshot.lastCheckedAt || cachedSnapshot.cooldownUntilEpoch);

    if (hasTimerNeed && !tickTimer) {
      tickTimer = setInterval(() => {
        if (document.hidden || !cachedSnapshot) return;
        updateDynamicCountdowns();
      }, 1000);
    } else if (!hasTimerNeed && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function sourceLabel(src) {
    if (src === "cron") return translate("dash.bb.srcCron", "Cron");
    if (src === "desktop") return translate("dash.bb.srcDesktop", "Laptop");
    return translate("dash.bb.srcWeb", "Web");
  }

  function renderEventsList(events) {
    const list = byId("bb-events-list");
    if (!list) return;
    list.textContent = "";

    if (!Array.isArray(events) || events.length === 0) {
      const li = document.createElement("li");
      li.className = "bb-event-empty";
      li.textContent = translate(
        "dash.bb.eventsEmpty",
        "Belum ada aktivitas Baileys Backup tercatat.",
      );
      list.appendChild(li);
      return;
    }

    for (const ev of events) {
      const li = document.createElement("li");
      li.className = "bb-event-item";

      const meta = document.createElement("span");
      meta.className = `bb-event-src bb-event-src-${ev.source || "web"}`;
      const timeStr = ev.ts ? formatClockTime(ev.ts) : "--:--";
      meta.textContent = `${timeStr} · ${sourceLabel(ev.source)}`;

      const text = document.createElement("span");
      text.className = "bb-event-msg";
      text.textContent = ev.message || "";

      li.appendChild(meta);
      li.appendChild(text);
      list.appendChild(li);
    }
  }

  function renderSnapshot(view) {
    cachedSnapshot = view;

    const desktop = view.desktop;
    const isBackupActive = Boolean(view.desktopOnline && desktop && desktop.failoverActive);

    const modeBadge = byId("bb-mode-badge");
    if (modeBadge) {
      if (isBackupActive) {
        modeBadge.textContent = translate("dash.bb.badgeFailover", "BACKUP AKTIF");
        modeBadge.className = "badge bb-badge-warn";
      } else if (view.desktopOnline) {
        modeBadge.textContent = translate("dash.bb.badgeStandby", "STANDBY PASIF");
        modeBadge.className = "badge bb-badge-ok";
      } else {
        modeBadge.textContent = translate("dash.bb.badgeCloudOnly", "MONITOR CLOUD");
        modeBadge.className = "badge bb-badge-neutral";
      }
    }

    const laptopBadge = byId("bb-laptop-badge");
    if (laptopBadge) {
      if (view.desktopOnline && desktop) {
        laptopBadge.textContent = `${translate("dash.bb.laptopOnline", "Laptop Online")} · v${desktop.appVersion} (PID ${desktop.appPid})`;
        laptopBadge.className = "badge bb-badge-ok";
      } else {
        laptopBadge.textContent = translate("dash.bb.laptopOffline", "Laptop Offline");
        laptopBadge.className = "badge bb-badge-muted";
      }
    }

    const vpsVal = byId("bb-vps-state");
    if (vpsVal) {
      const stateText = (view.vpsState || "unknown").toUpperCase();
      vpsVal.textContent = stateText;
      vpsVal.className = "bb-metric-value";
      if (view.vpsAvailability === "running") {
        vpsVal.classList.add("bb-tone-ok");
      } else if (view.vpsAvailability === "down") {
        vpsVal.classList.add("bb-tone-warn");
      } else if (view.vpsAvailability === "transient") {
        vpsVal.classList.add("bb-tone-accent");
      } else {
        vpsVal.classList.add("bb-tone-muted");
      }
    }

    const botVal = byId("bb-bot-state");
    const botSub = byId("bb-bot-sub");
    if (botVal && botSub) {
      botVal.className = "bb-metric-value";
      if (isBackupActive && desktop && desktop.childNodePid > 0) {
        botVal.textContent = `${translate("dash.bb.botActivePid", "AKTIF")} (PID ${desktop.childNodePid})`;
        botVal.classList.add("bb-tone-warn");
        botSub.textContent = translate(
          "dash.bb.failoverActiveSub",
          "Failover aktif di laptop",
        );
      } else if (view.desktopOnline) {
        botVal.textContent = translate("dash.bb.botStandby", "STANDBY PASIF");
        botVal.classList.add("bb-tone-ok");
        botSub.textContent = translate(
          "dash.bb.botStandbySub",
          "0 proses Node.js (Hemat RAM)",
        );
      } else {
        botVal.textContent = translate("dash.bb.botCloudMode", "MODE CLOUD");
        botVal.classList.add("bb-tone-muted");
        botSub.textContent = translate(
          "dash.bb.botOfflineSub",
          "Laptop mati, pemantauan cloud tetap aktif",
        );
      }
    }

    const ramVal = byId("bb-ram-value");
    const ramSub = byId("bb-ram-sub");
    if (ramVal && ramSub) {
      if (view.desktopOnline && desktop) {
        ramVal.textContent = `App: ${formatKbAsMb(desktop.appPrivateKb)}`;
        ramSub.textContent = `Node: ${formatKbAsMb(desktop.nodePrivateKb)} · WS ${formatKbAsMb(desktop.appWorkingKb)}`;
      } else if (desktop && desktop.appPrivateKb > 0) {
        ramVal.textContent = `App: ${formatKbAsMb(desktop.appPrivateKb)}`;
        ramSub.textContent = translate("dash.bb.ramOffline", "Tidak ada proses lokal aktif");
      } else {
        ramVal.textContent = "0 MB";
        ramSub.textContent = translate("dash.bb.ramOffline", "Tidak ada proses lokal aktif");
      }
    }

    const upVal = byId("bb-uptime-value");
    const upSub = byId("bb-uptime-sub");
    if (upVal && upSub) {
      if (view.desktopOnline && desktop) {
        upVal.textContent = formatCompactDuration(desktop.uptimeSecs);
        upSub.textContent = `${translate("dash.bb.checksLabel", "Cek")} ${desktop.totalChecks}x · ${translate("dash.bb.failoverLabel", "Failover")} ${desktop.failoverCount}x`;
      } else {
        upVal.textContent = translate("dash.bb.uptimeZero", "Laptop off");
        const prevFail = desktop ? desktop.failoverCount : 0;
        upSub.textContent = `${translate("dash.bb.srcWeb", "Web")} ${view.webChecksCount || 0}x · ${translate("dash.bb.failoverLabel", "Failover")} ${prevFail}x`;
      }
    }

    const toggleBtn = byId("bb-btn-auto-resume");
    if (toggleBtn) {
      const enabled = Boolean(view.autoResumeEnabled);
      toggleBtn.setAttribute("aria-checked", enabled ? "true" : "false");
      toggleBtn.classList.toggle("is-on", enabled);
      toggleBtn.textContent = enabled
        ? translate("dash.bb.modeAuto", "OTOMATIS")
        : translate("dash.bb.modeManual", "MANUAL");
      toggleBtn.disabled = inFlightToggle;
    }

    const autoStartNote = byId("bb-autostart-note");
    if (autoStartNote) {
      if (view.desktopOnline && desktop) {
        const prefix = desktop.autoStartEnabled
          ? translate("dash.bb.autoStartActive", "Auto-Start Login Windows: AKTIF · tray")
          : translate("dash.bb.autoStartOff", "Auto-Start Login Windows: NONAKTIF · tray");
        const trayWord = desktop.trayRegistered
          ? translate("dash.bb.trayOk", "aktif")
          : translate("dash.bb.trayOff", "nonaktif");
        autoStartNote.textContent = `${prefix} ${trayWord}`;
      } else {
        autoStartNote.textContent = translate(
          "dash.bb.autostartFallback",
          "Laptop offline. Kontrol web dan cloud cron tetap aktif.",
        );
      }
    }

    const dlLink = byId("bb-download-msi");
    if (dlLink) {
      dlLink.href = view.installerReleaseUrl || RELEASE_FALLBACK_URL;
    }

    const resumeBtn = byId("bb-btn-resume");
    if (resumeBtn) {
      const isRunning = view.vpsAvailability === "running";
      const unconfigured = !view.instaboxConfigured;
      resumeBtn.disabled = inFlightResume || isRunning || unconfigured;
      resumeBtn.classList.toggle("is-running", isRunning);
      if (inFlightResume) {
        resumeBtn.textContent = translate("dash.bb.btnResuming", "Mengaktifkan VPS...");
      } else if (isRunning) {
        resumeBtn.textContent = translate("dash.bb.btnVpsActive", "VPS Aktif (RUNNING)");
      } else {
        resumeBtn.textContent = translate("dash.bb.btnResume", "Resume / Aktifkan VPS");
      }
    }

    const checkBtn = byId("bb-btn-check");
    if (checkBtn) {
      checkBtn.disabled = inFlightCheck;
      checkBtn.textContent = inFlightCheck
        ? translate("dash.bb.btnChecking", "Mengecek...")
        : translate("dash.bb.btnCheck", "Cek Status VPS Sekarang");
    }

    renderEventsList(view.recentEvents);
    updateDynamicCountdowns();
    syncLiveTicker();
  }

  async function fetchStatus(showFeedbackOnError) {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/baileys-backup", {
        method: "GET",
        headers: { "x-admin-token": token },
      });
      if (res.status === 401) return;
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.ok && json.data) {
        clientReceivedAtMs = Date.now();
        renderSnapshot(json.data);
      } else if (showFeedbackOnError && json && json.error) {
        setFeedback("error", json.error);
      }
    } catch (_) {
      if (showFeedbackOnError) {
        setFeedback(
          "error",
          translate("dash.bb.fetchErr", "Gagal memuat status Baileys Backup."),
        );
      }
    }
  }

  async function postAction(payload) {
    const token = getToken();
    if (!token) return null;
    const res = await fetch("/api/baileys-backup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, json };
  }

  async function handleCheckNow() {
    if (inFlightCheck) return;
    inFlightCheck = true;
    if (cachedSnapshot) renderSnapshot(cachedSnapshot);
    try {
      const result = await postAction({ action: "check" });
      if (result && result.json && result.json.data) {
        clientReceivedAtMs = Date.now();
        if (result.json.message) {
          setFeedback(result.json.ok ? "ok" : "warn", result.json.message);
        }
        renderSnapshot(result.json.data);
      } else {
        setFeedback("error", translate("dash.bb.fetchErr", "Gagal mengecek status VPS."));
      }
    } catch (_) {
      setFeedback("error", translate("dash.bb.fetchErr", "Gagal mengecek status VPS."));
    } finally {
      inFlightCheck = false;
      if (cachedSnapshot) renderSnapshot(cachedSnapshot);
    }
  }

  async function handleResumeVps() {
    if (inFlightResume) return;
    inFlightResume = true;
    if (cachedSnapshot) renderSnapshot(cachedSnapshot);
    try {
      const result = await postAction({ action: "resume" });
      if (result && result.json && result.json.data) {
        clientReceivedAtMs = Date.now();
        const kind = result.json.ok
          ? "ok"
          : result.status === 409
            ? "warn"
            : "error";
        if (result.json.message) setFeedback(kind, result.json.message);
        renderSnapshot(result.json.data);
        if (result.json.ok && result.json.status === "resuming") {
          scheduleFastPoll();
        }
      } else {
        setFeedback(
          "error",
          (result && result.json && result.json.error) || "Gagal mengaktifkan VPS.",
        );
      }
    } catch (_) {
      setFeedback("error", "Gagal menghubungi server untuk mengaktifkan VPS.");
    } finally {
      inFlightResume = false;
      if (cachedSnapshot) renderSnapshot(cachedSnapshot);
    }
  }

  async function handleToggleAutoResume() {
    if (inFlightToggle || !cachedSnapshot) return;
    const next = !cachedSnapshot.autoResumeEnabled;
    inFlightToggle = true;
    if (cachedSnapshot) renderSnapshot(cachedSnapshot);
    try {
      const result = await postAction({
        action: "set_mode",
        autoResumeEnabled: next,
      });
      if (result && result.json && result.json.data) {
        clientReceivedAtMs = Date.now();
        if (result.json.message) setFeedback("ok", result.json.message);
        renderSnapshot(result.json.data);
        if (result.json.autoTriggeredResume) {
          scheduleFastPoll();
        }
      } else {
        setFeedback("error", "Gagal mengubah mode Auto-Resume VPS.");
      }
    } catch (_) {
      setFeedback("error", "Gagal mengubah mode Auto-Resume VPS.");
    } finally {
      inFlightToggle = false;
      if (cachedSnapshot) renderSnapshot(cachedSnapshot);
    }
  }

  function bindEvents() {
    const checkBtn = byId("bb-btn-check");
    if (checkBtn) checkBtn.addEventListener("click", handleCheckNow);

    const resumeBtn = byId("bb-btn-resume");
    if (resumeBtn) resumeBtn.addEventListener("click", handleResumeVps);

    const toggleBtn = byId("bb-btn-auto-resume");
    if (toggleBtn) toggleBtn.addEventListener("click", handleToggleAutoResume);

    document.addEventListener("visibilitychange", () => {
      syncLiveTicker();
      if (!document.hidden && getToken() && cachedSnapshot) {
        updateDynamicCountdowns();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindEvents);
  } else {
    bindEvents();
  }

  window.BaileysBackupPanel = {
    fetchStatus,
    renderCached: () => {
      if (cachedSnapshot) renderSnapshot(cachedSnapshot);
      if (lastActionFeedback) setFeedback(lastActionFeedback.kind, lastActionFeedback.message);
    },
    reset: () => {
      stopFastPoll();
      if (tickTimer) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      cachedSnapshot = null;
      setFeedback(null, "");
    },
  };
})();
