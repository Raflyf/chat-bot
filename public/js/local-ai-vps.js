(() => {
  const SESSION_TOKEN_KEY = "freeaibot_admin_session_token";

  let cachedSnapshot = null;
  let clientReceivedAtMs = 0;
  let tickTimer = null;
  let fastPollTimer = null;
  let fastPollRemaining = 0;
  let inFlightCheck = false;
  let inFlightResume = false;
  let inFlightAutoResume = false;
  let inFlightKeepalive = false;
  let inFlightPrimary = false;
  let keepaliveAutoTimer = null;
  let keepaliveAutoRunning = false;
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
    const elapsed = clientReceivedAtMs
      ? Math.max(0, Math.floor((Date.now() - clientReceivedAtMs) / 1000))
      : 0;
    return cachedSnapshot.serverTimeEpoch + elapsed;
  }

  function setFeedback(kind, message) {
    lastActionFeedback = message ? { kind, message } : null;
    const el = byId("ai2-feedback");
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

  function sourceLabel(src) {
    if (src === "cron") return translate("dash.bb.srcCron", "Cron");
    return translate("dash.bb.srcWeb", "Web");
  }

  function renderEventsList(events) {
    const list = byId("ai2-events-list");
    if (!list) return;
    list.textContent = "";

    if (!Array.isArray(events) || events.length === 0) {
      const li = document.createElement("li");
      li.className = "bb-event-empty";
      li.textContent = translate(
        "dash.ai2.eventsEmpty",
        "Belum ada aktivitas VPS 2 (Local AI) tercatat.",
      );
      list.appendChild(li);
      return;
    }

    for (const ev of events) {
      const li = document.createElement("li");
      li.className = "bb-event-item";

      const meta = document.createElement("span");
      meta.className = `bb-event-src bb-event-src-${ev.source || "web"}`;
      meta.textContent = `${ev.ts ? formatClockTime(ev.ts) : "--:--"} · ${sourceLabel(ev.source)}`;

      const text = document.createElement("span");
      text.className = "bb-event-msg";
      text.textContent = ev.message || "";

      li.appendChild(meta);
      li.appendChild(text);
      list.appendChild(li);
    }
  }

  function updateKeepaliveLive() {
    if (!cachedSnapshot || !cachedSnapshot.keepalive) return;
    const ka = cachedSnapshot.keepalive;
    const nowEpoch = effectiveServerEpoch();
    const isRunning = cachedSnapshot.vpsAvailability === "running";
    const idleWindow = Math.max(60, Number(ka.idleWindowSecs) || 1800);

    const nextEl = byId("ai2-keepalive-next");
    const leaseEl = byId("ai2-keepalive-lease");
    const idleEl = byId("ai2-keepalive-idle");
    const pauseEl = byId("ai2-keepalive-pause");
    const countEl = byId("ai2-keepalive-count");
    const fillEl = byId("ai2-keepalive-bar-fill");

    if (countEl) {
      const fails = Number(ka.failCount) || 0;
      countEl.textContent =
        fails > 0
          ? `${ka.pingCount || 0} (${fails} ${translate("dash.bb.keepaliveFailed", "gagal")})`
          : String(ka.pingCount || 0);
    }

    const elapsed = Math.max(0, nowEpoch - (cachedSnapshot.serverTimeEpoch || nowEpoch));
    const leaseRem =
      typeof ka.leaseRemainingSecs === "number" ? Math.max(0, ka.leaseRemainingSecs - elapsed) : null;
    const idleSecs =
      typeof ka.idleSecs === "number" ? Math.max(0, ka.idleSecs + elapsed) : null;
    const pauseRem =
      typeof ka.pauseInSecs === "number" ? Math.max(0, ka.pauseInSecs - elapsed) : null;
    const nextPingRem =
      typeof ka.nextPingInSecs === "number" ? Math.max(0, ka.nextPingInSecs - elapsed) : null;

    if (nextEl) {
      if (!ka.enabled) nextEl.textContent = translate("dash.bb.keepaliveDisabledShort", "nonaktif");
      else if (!isRunning) nextEl.textContent = translate("dash.bb.keepaliveWaitingVps", "menunggu VPS");
      else if (nextPingRem === null || nextPingRem <= 0) nextEl.textContent = translate("dash.bb.keepaliveDue", "segera");
      else nextEl.textContent = formatCompactDuration(nextPingRem);
    }

    if (leaseEl) {
      if (!isRunning) leaseEl.textContent = translate("dash.bb.keepaliveWaitingVps", "menunggu VPS");
      else if (leaseRem !== null && leaseRem > 0) leaseEl.textContent = formatCompactDuration(leaseRem);
      else leaseEl.textContent = translate("dash.bb.keepaliveLeaseNone", "tidak aktif");
    }

    if (idleEl) {
      idleEl.textContent =
        idleSecs !== null ? formatCompactDuration(idleSecs) : translate("dash.bb.keepaliveNever", "belum pernah");
    }

    if (pauseEl) {
      if (!isRunning) pauseEl.textContent = translate("dash.bb.keepaliveWaitingVps", "menunggu VPS");
      else if (pauseRem === null) pauseEl.textContent = translate("dash.bb.keepaliveUntracked", "belum terlacak");
      else if (pauseRem <= 0) pauseEl.textContent = translate("dash.bb.keepaliveOverdue", "lewat batas");
      else pauseEl.textContent = formatCompactDuration(pauseRem);
    }

    if (fillEl) {
      let pct = 0;
      let tone = "is-ok";
      if (!isRunning) {
        pct = 0;
        tone = "is-muted";
      } else if (leaseRem !== null && leaseRem > 0) {
        const leaseTotal = Math.max(60, Number(ka.leaseTtlSecs) || 3600);
        pct = Math.max(8, Math.min(100, Math.round((leaseRem / leaseTotal) * 100)));
        tone = "is-ok";
      } else if (pauseRem !== null) {
        pct = Math.max(0, Math.min(100, Math.round((pauseRem / idleWindow) * 100)));
        tone = pauseRem <= 300 ? "is-danger" : "is-warn";
      } else {
        pct = 0;
        tone = "is-muted";
      }
      fillEl.style.width = `${pct}%`;
      fillEl.className = `bb-keepalive-bar-fill ${tone}`;
    }
  }

  function renderKeepalive(data) {
    const ka = data.keepalive;
    if (!ka) return;
    const isRunning = data.vpsAvailability === "running";
    const badge = byId("ai2-keepalive-badge");
    const desc = byId("ai2-keepalive-desc");
    const toggleBtn = byId("ai2-btn-keepalive");
    const pingBtn = byId("ai2-btn-ping");
    const errEl = byId("ai2-keepalive-err");

    if (badge) {
      if (!ka.enabled) {
        badge.textContent = translate("dash.bb.keepaliveBadgeOff", "Rawan pause");
        badge.className = "bb-keepalive-badge is-warn";
      } else if (!isRunning) {
        badge.textContent = translate("dash.bb.keepaliveBadgeIdle", "Menunggu VPS");
        badge.className = "bb-keepalive-badge is-muted";
      } else if (ka.consecutiveFailures > 0) {
        badge.textContent = translate("dash.bb.keepaliveBadgeFail", "Ping gagal");
        badge.className = "bb-keepalive-badge is-danger";
      } else if (ka.atRisk) {
        badge.textContent = translate("dash.bb.keepaliveBadgeRisk", "Berisiko");
        badge.className = "bb-keepalive-badge is-warn";
      } else {
        badge.textContent = translate("dash.bb.keepaliveBadgeOk", "Terlindungi");
        badge.className = "bb-keepalive-badge is-ok";
      }
    }

    if (desc) {
      const idleMin = Math.round((Number(ka.idleWindowSecs) || 1800) / 60);
      const intervalMin = Math.max(1, Math.round((Number(ka.intervalSecs) || 600) / 60));
      const leaseMin = Math.max(1, Math.round((Number(ka.leaseTtlSecs) || 3600) / 60));
      desc.textContent = `${translate("dash.bb.keepaliveDesc", "Lease aktivitas diperbarui otomatis agar VPS tidak di-pause setelah jendela idle habis.")} ${translate("dash.bb.keepaliveWindow", "Jendela idle")}: ${idleMin} ${translate("dash.bb.minShort", "mnt")} · ${translate("dash.bb.keepaliveInterval", "interval ping")}: ${intervalMin} ${translate("dash.bb.minShort", "mnt")} · ${translate("dash.bb.keepaliveLease", "lease")}: ${leaseMin} ${translate("dash.bb.minShort", "mnt")}.`;
    }

    if (toggleBtn) {
      toggleBtn.disabled = inFlightKeepalive;
      toggleBtn.setAttribute("aria-checked", ka.enabled ? "true" : "false");
      toggleBtn.classList.toggle("is-on", Boolean(ka.enabled));
      toggleBtn.textContent = ka.enabled
        ? translate("dash.bb.keepaliveOn", "AKTIF")
        : translate("dash.bb.keepaliveOff", "NONAKTIF");
    }

    if (pingBtn) {
      const canPing = Boolean(data.instaboxConfigured) && isRunning;
      pingBtn.disabled = !canPing || inFlightKeepalive || keepaliveAutoRunning;
      pingBtn.textContent =
        inFlightKeepalive || keepaliveAutoRunning
          ? translate("dash.bb.btnPinging", "Mengirim ping...")
          : translate("dash.ai2.btnPing", "Ping VPS 2 Sekarang");
    }

    if (errEl) {
      if (ka.lastError) {
        errEl.hidden = false;
        errEl.textContent = `${translate("dash.bb.keepaliveLastErr", "Error terakhir")}: ${ka.lastError}`;
      } else {
        errEl.hidden = true;
        errEl.textContent = "";
      }
    }

    updateKeepaliveLive();
  }

  function updateDynamicCountdowns() {
    if (!cachedSnapshot) return;
    const nowEpoch = effectiveServerEpoch();

    const vpsSub = byId("ai2-vps-sub");
    if (vpsSub) {
      if (!cachedSnapshot.instaboxConfigured) {
        vpsSub.textContent = translate("dash.ai2.notConfigured", "LOCAL_AI_INSTABOX_* belum diset");
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
          parts.push(translate("dash.bb.liveErrWarn", "Kueri live gagal, menampilkan snapshot terakhir."));
        }
        vpsSub.textContent = parts.length > 0 ? parts.join(" · ") : translate("dash.bb.waitingData", "Menunggu data");
      }
    }

    const autoDesc = byId("ai2-auto-resume-desc");
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
          "dash.ai2.autoResumeOnDesc",
          "Otomatis: VPS 2 di-resume otomatis saat paused/suspended (cloud cron)",
        );
      } else {
        autoDesc.textContent = translate(
          "dash.ai2.autoResumeOffDesc",
          "Manual: aktifkan VPS 2 lewat tombol di dashboard",
        );
      }
    }

    updateKeepaliveLive();
  }

  function syncLiveTicker() {
    const need = Boolean(
      cachedSnapshot &&
        !document.hidden &&
        getToken() &&
        (cachedSnapshot.lastCheckedAt ||
          cachedSnapshot.cooldownUntilEpoch ||
          (cachedSnapshot.keepalive &&
            (cachedSnapshot.keepalive.enabled || cachedSnapshot.keepalive.lastPingAt))),
    );
    if (need && !tickTimer) {
      tickTimer = setInterval(() => {
        if (document.hidden || !cachedSnapshot) return;
        updateDynamicCountdowns();
      }, 1000);
    } else if (!need && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function renderSnapshot(data) {
    cachedSnapshot = data;

    // Header badges
    const roleBadge = byId("ai2-role-badge");
    if (roleBadge) {
      if (!data.aiEndpointConfigured) {
        roleBadge.textContent = translate("dash.ai2.badgeUnconfigured", "ENDPOINT BELUM DISET");
        roleBadge.className = "badge bb-badge-muted";
      } else if (data.useAsPrimary) {
        roleBadge.textContent = translate("dash.ai2.badgePrimary", "MODEL UTAMA (ON)");
        roleBadge.className = "badge bb-badge-ok";
      } else {
        roleBadge.textContent = translate("dash.ai2.badgeBackup", "BACKUP TERAKHIR (OFF)");
        roleBadge.className = "badge bb-badge-neutral";
      }
    }

    const healthBadge = byId("ai2-health-badge");
    if (healthBadge) {
      if (!data.aiEndpointConfigured) {
        healthBadge.textContent = translate("dash.ai2.aiOff", "AI Offline");
        healthBadge.className = "badge bb-badge-muted";
      } else if (data.aiHealthOk === true) {
        healthBadge.textContent = `AI Online · ${data.aiHealthLatencyMs ?? 0}ms`;
        healthBadge.className = "badge bb-badge-ok";
      } else {
        healthBadge.textContent = translate("dash.ai2.aiOffline", "AI Offline");
        healthBadge.className = "badge bb-badge-warn";
      }
    }

    // Card 1: VPS 2 State
    const vpsVal = byId("ai2-vps-state");
    if (vpsVal) {
      const raw = String(data.vpsState || "unknown").toUpperCase();
      vpsVal.textContent = raw;
      const tone =
        data.vpsAvailability === "running"
          ? "bb-tone-ok"
          : data.vpsAvailability === "down"
            ? "bb-tone-danger"
            : data.vpsAvailability === "transient"
              ? "bb-tone-warn"
              : "bb-tone-muted";
      vpsVal.className = `bb-metric-value ${tone}`;
    }

    // Card 2: Llama Server Health
    const srvVal = byId("ai2-server-state");
    const srvSub = byId("ai2-server-sub");
    if (srvVal) {
      if (!data.aiEndpointConfigured) {
        srvVal.textContent = translate("dash.ai2.unconfiguredShort", "BELUM DISET");
        srvVal.className = "bb-metric-value bb-tone-muted";
      } else if (data.aiHealthOk === true) {
        srvVal.textContent = "ONLINE";
        srvVal.className = "bb-metric-value bb-tone-ok";
      } else {
        srvVal.textContent = "OFFLINE";
        srvVal.className = "bb-metric-value bb-tone-danger";
      }
    }
    if (srvSub) {
      if (!data.aiEndpointConfigured) {
        srvSub.textContent = translate("dash.ai2.setEnvHint", "Isi LOCAL_AI_URL & LOCAL_AI_API_KEY");
      } else if (data.aiHealthOk === true) {
        srvSub.textContent = `Health ${data.aiHealthLatencyMs ?? 0} ms · ${data.visionEnabled ? "Text + Vision" : "Text only"}`;
      } else {
        srvSub.textContent = translate("dash.ai2.failoverReady", "Failover otomatis ke cloud aktif");
      }
    }

    // Card 3: Routing Mode (Primary vs Last Backup)
    const routeVal = byId("ai2-routing-value");
    const routeSub = byId("ai2-routing-sub");
    if (routeVal) {
      if (data.useAsPrimary) {
        routeVal.textContent = translate("dash.ai2.routingPrimary", "MODEL UTAMA");
        routeVal.className = "bb-metric-value bb-tone-ok";
      } else {
        routeVal.textContent = translate("dash.ai2.routingBackup", "BACKUP TERAKHIR");
        routeVal.className = "bb-metric-value bb-tone-neutral";
      }
    }
    if (routeSub) {
      routeSub.textContent = data.modelName || "ternary-bonsai-2-9b";
    }

    // Card 4: Context & Stats
    const ctxVal = byId("ai2-ctx-value");
    const ctxSub = byId("ai2-ctx-sub");
    if (ctxVal) {
      const k = Math.round((Number(data.maxContextTokens) || 14500) / 1000);
      ctxVal.textContent = `16K ctx (${k}K cap)`;
      ctxVal.className = "bb-metric-value";
    }
    if (ctxSub) {
      const pings = data.keepalive ? Number(data.keepalive.pingCount) || 0 : 0;
      ctxSub.textContent = `Web ${data.webChecksCount || 0}x · Ping ${pings}x`;
    }

    // Control 1: Toggle Model Lokal sebagai Model Utama (ON / OFF)
    const primaryBtn = byId("ai2-btn-primary");
    const primaryDesc = byId("ai2-primary-desc");
    if (primaryBtn) {
      primaryBtn.disabled = inFlightPrimary;
      primaryBtn.setAttribute("aria-checked", data.useAsPrimary ? "true" : "false");
      primaryBtn.classList.toggle("is-on", Boolean(data.useAsPrimary));
      primaryBtn.textContent = data.useAsPrimary
        ? translate("dash.ai2.primaryOn", "ON · UTAMA")
        : translate("dash.ai2.primaryOff", "OFF · BACKUP");
    }
    if (primaryDesc) {
      primaryDesc.textContent = data.useAsPrimary
        ? translate(
            "dash.ai2.primaryOnDesc",
            "ON: Model lokal VPS 2 dipakai sebagai Tier 1 (model utama), failover otomatis ke cloud bila VPS mati.",
          )
        : translate(
            "dash.ai2.primaryOffDesc",
            "OFF: Model cloud dipakai lebih dulu; model lokal VPS 2 menjadi backup terakhir unlimited.",
          );
    }

    // Control 2: Auto-Resume VPS 2
    const autoBtn = byId("ai2-btn-auto-resume");
    if (autoBtn) {
      autoBtn.disabled = inFlightAutoResume;
      autoBtn.setAttribute("aria-checked", data.autoResumeEnabled ? "true" : "false");
      autoBtn.classList.toggle("is-on", Boolean(data.autoResumeEnabled));
      autoBtn.textContent = data.autoResumeEnabled
        ? translate("dash.bb.modeAuto", "OTOMATIS")
        : translate("dash.bb.modeManual", "MANUAL");
    }

    // Control 3: Auto-Ping VPS 2
    renderKeepalive(data);

    // Resume & Check buttons
    const resumeBtn = byId("ai2-btn-resume");
    if (resumeBtn) {
      const isRunning = data.vpsAvailability === "running";
      const isTransient = data.vpsAvailability === "transient";
      resumeBtn.disabled = !data.instaboxConfigured || isRunning || isTransient || inFlightResume;
      if (inFlightResume) {
        resumeBtn.textContent = translate("dash.ai2.btnResuming", "Mengaktifkan VPS 2...");
      } else if (isRunning) {
        resumeBtn.textContent = translate("dash.ai2.btnVpsActive", "VPS 2 Aktif (RUNNING)");
      } else {
        resumeBtn.textContent = translate("dash.ai2.btnResume", "Resume / Aktifkan VPS 2");
      }
    }

    const checkBtn = byId("ai2-btn-check");
    if (checkBtn) {
      checkBtn.disabled = inFlightCheck;
      checkBtn.textContent = inFlightCheck
        ? translate("dash.bb.btnChecking", "Mengecek...")
        : translate("dash.ai2.btnCheck", "Cek Status VPS 2 Sekarang");
    }

    renderEventsList(data.recentEvents);
    updateDynamicCountdowns();
    syncLiveTicker();
    syncKeepaliveAutoTimer();
  }

  async function fetchStatus(showFeedbackOnError) {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/baileys-backup?target=ai", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });
      if (res.status === 401) return;
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.data) {
        if (showFeedbackOnError) {
          setFeedback("error", (json && json.error) || translate("dash.ai2.fetchErr", "Gagal memuat status VPS 2."));
        }
        return;
      }
      clientReceivedAtMs = Date.now();
      renderSnapshot(json.data);
    } catch (_) {
      if (showFeedbackOnError) {
        setFeedback("error", translate("dash.ai2.fetchErr", "Gagal memuat status VPS 2."));
      }
    }
  }

  async function postAction(payload) {
    const token = getToken();
    if (!token) return null;
    const res = await fetch("/api/baileys-backup", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ target: "ai", ...payload }),
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    return { res, json };
  }

  async function handleTogglePrimary() {
    if (inFlightPrimary || !cachedSnapshot) return;
    inFlightPrimary = true;
    renderSnapshot(cachedSnapshot);
    try {
      const nextVal = !cachedSnapshot.useAsPrimary;
      const result = await postAction({ action: "set_primary", useAsPrimary: nextVal });
      if (!result || !result.json || !result.res.ok) {
        setFeedback(
          "error",
          (result && result.json && result.json.error) ||
            translate("dash.ai2.primaryErr", "Gagal mengubah mode Model Utama."),
        );
      } else {
        if (result.json.data) {
          clientReceivedAtMs = Date.now();
          renderSnapshot(result.json.data);
        }
        setFeedback("ok", result.json.message || "");
      }
    } catch (_) {
      setFeedback("error", translate("dash.ai2.primaryErr", "Gagal mengubah mode Model Utama."));
    } finally {
      inFlightPrimary = false;
      if (cachedSnapshot) renderSnapshot(cachedSnapshot);
    }
  }

  async function handleToggleAutoResume() {
    if (inFlightAutoResume || !cachedSnapshot) return;
    inFlightAutoResume = true;
    renderSnapshot(cachedSnapshot);
    try {
      const nextVal = !cachedSnapshot.autoResumeEnabled;
      const result = await postAction({ action: "set_mode", autoResumeEnabled: nextVal });
      if (!result || !result.json || !result.res.ok) {
        setFeedback("error", (result && result.json && result.json.error) || "Gagal mengubah Auto-Resume VPS 2.");
      } else {
        if (result.json.data) {
          clientReceivedAtMs = Date.now();
          renderSnapshot(result.json.data);
        }
        setFeedback("ok", result.json.message || "");
      }
    } catch (_) {
      setFeedback("error", "Gagal mengubah Auto-Resume VPS 2.");
    } finally {
      inFlightAutoResume = false;
      if (cachedSnapshot) renderSnapshot(cachedSnapshot);
    }
  }

  async function handleToggleKeepalive() {
    if (inFlightKeepalive || !cachedSnapshot || !cachedSnapshot.keepalive) return;
    inFlightKeepalive = true;
    renderSnapshot(cachedSnapshot);
    try {
      const nextVal = !cachedSnapshot.keepalive.enabled;
      const result = await postAction({ action: "set_keepalive", keepaliveEnabled: nextVal });
      if (!result || !result.json || !result.res.ok) {
        setFeedback(
          "error",
          (result && result.json && result.json.error) ||
            translate("dash.bb.keepaliveToggleErr", "Gagal mengubah Auto-Ping VPS 2."),
        );
      } else {
        if (result.json.data) {
          clientReceivedAtMs = Date.now();
          renderSnapshot(result.json.data);
        }
        setFeedback("ok", result.json.message || "");
      }
    } catch (_) {
      setFeedback("error", translate("dash.bb.keepaliveToggleErr", "Gagal mengubah Auto-Ping VPS 2."));
    } finally {
      inFlightKeepalive = false;
      if (cachedSnapshot) renderSnapshot(cachedSnapshot);
    }
  }

  async function handlePingNow() {
    if (inFlightKeepalive || !cachedSnapshot) return;
    inFlightKeepalive = true;
    renderSnapshot(cachedSnapshot);
    try {
      const result = await postAction({ action: "keepalive" });
      if (!result || !result.json) {
        setFeedback("error", translate("dash.bb.keepalivePingErr", "Gagal mengirim ping VPS 2."));
      } else {
        if (result.json.data) {
          clientReceivedAtMs = Date.now();
          renderSnapshot(result.json.data);
        }
        setFeedback(result.json.ok ? "ok" : "warn", result.json.message || result.json.error || "");
      }
    } catch (_) {
      setFeedback("error", translate("dash.bb.keepalivePingErr", "Gagal mengirim ping VPS 2."));
    } finally {
      inFlightKeepalive = false;
      if (cachedSnapshot) renderSnapshot(cachedSnapshot);
    }
  }

  async function handleResumeNow() {
    if (inFlightResume || !cachedSnapshot) return;
    inFlightResume = true;
    renderSnapshot(cachedSnapshot);
    try {
      const result = await postAction({ action: "resume" });
      if (!result || !result.json) {
        setFeedback("error", "Gagal mengirim perintah resume VPS 2.");
      } else {
        if (result.json.data) {
          clientReceivedAtMs = Date.now();
          renderSnapshot(result.json.data);
        }
        if (result.json.ok) {
          setFeedback("ok", result.json.message || "");
          if (result.json.status === "accepted" || result.json.status === "transient") {
            scheduleFastPoll();
          }
        } else {
          setFeedback("warn", result.json.message || result.json.error || "");
        }
      }
    } catch (_) {
      setFeedback("error", "Gagal mengirim perintah resume VPS 2.");
    } finally {
      inFlightResume = false;
      if (cachedSnapshot) renderSnapshot(cachedSnapshot);
    }
  }

  async function handleCheckNow() {
    if (inFlightCheck) return;
    inFlightCheck = true;
    if (cachedSnapshot) renderSnapshot(cachedSnapshot);
    try {
      const result = await postAction({ action: "check" });
      if (!result || !result.json || !result.res.ok) {
        setFeedback("error", (result && result.json && result.json.error) || translate("dash.ai2.fetchErr", "Gagal mengecek VPS 2."));
      } else if (result.json.data) {
        clientReceivedAtMs = Date.now();
        renderSnapshot(result.json.data);
        setFeedback("ok", translate("dash.ai2.checkOk", "Status VPS 2 dan server AI berhasil diperbarui."));
      }
    } catch (_) {
      setFeedback("error", translate("dash.ai2.fetchErr", "Gagal mengecek VPS 2."));
    } finally {
      inFlightCheck = false;
      if (cachedSnapshot) renderSnapshot(cachedSnapshot);
    }
  }

  function isKeepaliveDue() {
    if (!cachedSnapshot || cachedSnapshot.vpsAvailability !== "running") return false;
    const ka = cachedSnapshot.keepalive;
    if (!ka || !ka.enabled) return false;
    if (inFlightKeepalive || keepaliveAutoRunning) return false;
    const nowEpoch = effectiveServerEpoch();
    if (typeof ka.nextPingInSecs === "number") {
      return nowEpoch >= cachedSnapshot.serverTimeEpoch + ka.nextPingInSecs;
    }
    const base = ka.lastPingAt || 0;
    return !base || nowEpoch - base >= (ka.intervalSecs || 600);
  }

  async function autoPingKeepalive() {
    if (!isKeepaliveDue()) return;
    keepaliveAutoRunning = true;
    if (cachedSnapshot) renderKeepalive(cachedSnapshot);
    try {
      const result = await postAction({ action: "keepalive", auto: true });
      if (result && result.json && result.json.data) {
        clientReceivedAtMs = Date.now();
        renderSnapshot(result.json.data);
      }
    } catch (_) {
      // Senyap: cron tetap jalur utama
    } finally {
      keepaliveAutoRunning = false;
      if (cachedSnapshot) renderKeepalive(cachedSnapshot);
    }
  }

  function syncKeepaliveAutoTimer() {
    const ka = cachedSnapshot && cachedSnapshot.keepalive;
    const need = Boolean(
      ka &&
        ka.enabled &&
        getToken() &&
        !document.hidden &&
        cachedSnapshot.vpsAvailability === "running",
    );
    if (need && !keepaliveAutoTimer) {
      keepaliveAutoTimer = setInterval(() => {
        void autoPingKeepalive();
      }, 30_000);
    } else if (!need && keepaliveAutoTimer) {
      clearInterval(keepaliveAutoTimer);
      keepaliveAutoTimer = null;
    }
  }

  function bindEvents() {
    const bind = (id, fn) => {
      const el = byId(id);
      if (el) el.addEventListener("click", fn);
    };
    bind("ai2-btn-primary", handleTogglePrimary);
    bind("ai2-btn-auto-resume", handleToggleAutoResume);
    bind("ai2-btn-keepalive", handleToggleKeepalive);
    bind("ai2-btn-ping", handlePingNow);
    bind("ai2-btn-resume", handleResumeNow);
    bind("ai2-btn-check", handleCheckNow);

    document.addEventListener("visibilitychange", () => {
      syncLiveTicker();
      syncKeepaliveAutoTimer();
      if (!document.hidden && getToken() && cachedSnapshot) {
        updateDynamicCountdowns();
        void autoPingKeepalive();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindEvents);
  } else {
    bindEvents();
  }

  window.LocalAiVpsPanel = {
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
      if (keepaliveAutoTimer) {
        clearInterval(keepaliveAutoTimer);
        keepaliveAutoTimer = null;
      }
      cachedSnapshot = null;
      setFeedback(null, "");
    },
  };
})();
