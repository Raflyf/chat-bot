const SESSION_TOKEN_KEY = "freeaibot_admin_session_token";
    const SESSION_EXP_KEY = "freeaibot_admin_session_exp";

    let autoRefresh = true;
    let refreshTimer = null;
    let sessionExpiryTimer = null;
    let resendCountdownTimer = null;
    let datasetSearchTimeout = null;

    function getStoredToken() {
      const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
      const exp = Number(sessionStorage.getItem(SESSION_EXP_KEY) || 0);
      const now = Date.now();
      // Berikan toleransi 30 detik untuk clock drift
      if (!token || (exp && now >= exp + 30000)) {
        clearStoredToken();
        return "";
      }
      return token;
    }

    function setStoredSession(token, expTimestamp) {
      const exp = Number(expTimestamp) || (Date.now() + 15 * 60 * 1000);
      sessionStorage.setItem(SESSION_TOKEN_KEY, token);
      sessionStorage.setItem(SESSION_EXP_KEY, String(exp));
      try {
        localStorage.removeItem(SESSION_TOKEN_KEY);
        localStorage.removeItem(SESSION_EXP_KEY);
      } catch (_) {}
    }

    function clearStoredToken() {
      if (sessionExpiryTimer) {
        clearTimeout(sessionExpiryTimer);
        sessionExpiryTimer = null;
      }
      try {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
        sessionStorage.removeItem(SESSION_EXP_KEY);
        localStorage.removeItem(SESSION_TOKEN_KEY);
        localStorage.removeItem(SESSION_EXP_KEY);
      } catch (_) {}
    }

    function leaveToHome(event) {
      if (event) event.preventDefault();
      clearStoredToken();
      window.location.href = "/";
    }

    function startSessionExpiryCountdown(expTimestamp) {
      if (sessionExpiryTimer) {
        clearTimeout(sessionExpiryTimer);
        sessionExpiryTimer = null;
      }
      const exp = Number(expTimestamp) || (Date.now() + 15 * 60 * 1000);
      const remainingMs = exp - Date.now();
      if (remainingMs <= 0 && (Date.now() - exp > 30000)) {
        triggerSessionExpired("expired");
        return;
      }
      const safeDuration = Math.max(10000, Math.min(15 * 60 * 1000, remainingMs > 0 ? remainingMs : 15 * 60 * 1000));
      sessionExpiryTimer = setTimeout(() => {
        triggerSessionExpired("expired");
      }, safeDuration);
    }

    function triggerSessionExpired(reason = "expired") {
      clearStoredToken();
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      document.documentElement.classList.remove("authenticated");
      document.documentElement.classList.add("not-authenticated");
      document.getElementById("auth-modal").classList.remove("hidden");
      const alertEl = document.getElementById("auth-alert");
      if (alertEl) {
        alertEl.className = "auth-alert auth-alert-error show";
        if (reason === "auth_lost" || reason === "unauthorized") {
          alertEl.textContent = "Sesi autentikasi terputus atau tidak valid (pembaruan server). Masukkan Master PIN kembali.";
        } else {
          alertEl.textContent = "Sesi admin 15 menit telah berakhir untuk keamanan. Masukkan Master PIN kembali.";
        }
      }
      const pinField = document.getElementById("pin-input");
      if (pinField) {
        pinField.value = "";
        pinField.focus();
      }
    }

    function formatTime(isoString) {
      if (!isoString) return "-";
      const d = new Date(isoString);
      return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }

    function formatDateTime(isoString) {
      if (!isoString) return "-";
      const d = new Date(isoString);
      return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    }

    function formatTokens(num) {
      if (!num || isNaN(num) || num <= 0) return "0 Token";
      if (num >= 1000000) {
        const val = (num / 1000000).toLocaleString("id-ID", { maximumFractionDigits: 1 });
        return `${val}M Token`;
      }
      if (num >= 1000) {
        const val = (num / 1000).toLocaleString("id-ID", { maximumFractionDigits: 0 });
        return `${val}K Token`;
      }
      return `${num.toLocaleString("id-ID")} Token`;
    }

    // =========================================================================
    // NATIVE PIN SUBMISSION (KEYBOARD-DRIVEN)
    // =========================================================================
    async function handlePinSubmit(e) {
      if (e) e.preventDefault();
      const pinField = document.getElementById("pin-input");
      const pinValue = pinField.value.trim();

      if (!pinValue) {
        pinField.focus();
        return;
      }

      const alertEl = document.getElementById("auth-alert");
      alertEl.className = "auth-alert";
      alertEl.textContent = "";

      const submitBtn = document.getElementById("btn-submit-pin");
      submitBtn.disabled = true;

      try {
        const res = await fetch("/api/admin-otp?action=verify_pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "verify_pin", pin: pinValue }),
        });

        const data = await res.json();

        if (res.ok && data.verified && data.session_token) {
          const duration = Number(data.duration_ms) || (15 * 60 * 1000);
          const clientExp = Date.now() + duration;
          setStoredSession(data.session_token, clientExp);
          startSessionExpiryCountdown(clientExp);
          document.documentElement.classList.remove("not-authenticated");
          document.documentElement.classList.add("authenticated");
          document.getElementById("auth-modal").classList.add("hidden");
          pinField.value = "";
          fetchData();
          fetchDataset();
          if (autoRefresh && !refreshTimer) {
            refreshTimer = setInterval(fetchData, 15000);
          }
        } else {
          // Gagal
          const card = document.getElementById("pin-card");
          card.classList.add("shake");
          setTimeout(() => card.classList.remove("shake"), 400);
          pinField.value = "";
          pinField.focus();

          alertEl.className = "auth-alert auth-alert-error show";
          alertEl.textContent = data.message || "Master PIN salah.";

          if (data.remaining_attempts !== undefined) {
            document.getElementById("attempts-label").textContent = `Sisa percobaan: ${data.remaining_attempts} kali`;
          }
          if (data.is_locked) {
            document.getElementById("attempts-label").textContent = "Sistem Terkunci 1 Menit. Gunakan Reset via Email.";
          }
        }
      } catch (err) {
        console.error("PIN verification error:", err);
        alertEl.className = "auth-alert auth-alert-error show";
        alertEl.textContent = "Gagal menghubungi server keamanan. Silakan coba lagi.";
      } finally {
        submitBtn.disabled = false;
      }
    }

    // =========================================================================
    // RESET PIN VIA EMAIL OTP
    // =========================================================================
    function openResetModal() {
      document.getElementById("auth-modal").classList.add("hidden");
      document.getElementById("reset-modal").classList.remove("hidden");
      document.getElementById("reset-step-1").style.display = "flex";
      document.getElementById("reset-step-2").style.display = "none";
      const alertEl = document.getElementById("reset-alert");
      alertEl.className = "auth-alert";
      alertEl.textContent = "";
    }

    function closeResetModal() {
      document.getElementById("reset-modal").classList.add("hidden");
      document.getElementById("auth-modal").classList.remove("hidden");
      const pinField = document.getElementById("pin-input");
      if (pinField) {
        pinField.value = "";
        pinField.focus();
      }
    }

    async function handleSendOtp() {
      const btn = document.getElementById("btn-send-otp");
      const resendBtn = document.getElementById("btn-resend-otp");
      const alertEl = document.getElementById("reset-alert");

      if (btn) btn.disabled = true;
      if (resendBtn) resendBtn.disabled = true;

      alertEl.className = "auth-alert auth-alert-success show";
      alertEl.textContent = "Mengirimkan kode OTP ke email admin...";

      try {
        const res = await fetch("/api/admin-otp?action=send_otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "send_otp" }),
        });
        const data = await res.json();

        if (res.ok && data.success) {
          alertEl.className = "auth-alert auth-alert-success show";
          alertEl.textContent = data.message;
          if (data.target_email_masked) {
            document.getElementById("reset-target-email").textContent = data.target_email_masked;
          }

          document.getElementById("reset-step-1").style.display = "none";
          document.getElementById("reset-step-2").style.display = "flex";
          document.getElementById("input-otp").focus();

          startOtpTimer(60);
        } else {
          alertEl.className = "auth-alert auth-alert-error show";
          alertEl.textContent = data.message || "Gagal mengirim kode OTP.";
          if (btn) btn.disabled = false;
        }
      } catch (err) {
        console.error("sendOtp error:", err);
        alertEl.className = "auth-alert auth-alert-error show";
        alertEl.textContent = "Terjadi kesalahan jaringan saat mengirim OTP.";
        if (btn) btn.disabled = false;
      }
    }

    function startOtpTimer(seconds) {
      const resendBtn = document.getElementById("btn-resend-otp");
      if (!resendBtn) return;
      resendBtn.disabled = true;
      let remaining = seconds;

      if (resendCountdownTimer) clearInterval(resendCountdownTimer);
      resendBtn.textContent = `Kirim Ulang OTP (${remaining}s)`;

      resendCountdownTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(resendCountdownTimer);
          resendBtn.disabled = false;
          resendBtn.textContent = "Kirim Ulang OTP";
        } else {
          resendBtn.textContent = `Kirim Ulang OTP (${remaining}s)`;
        }
      }, 1000);
    }

    async function handleVerifyOtpAndReset() {
      const otpCode = document.getElementById("input-otp").value.trim();
      const newPin = document.getElementById("input-new-pin").value.trim();
      const confirmPin = document.getElementById("input-confirm-pin").value.trim();
      const alertEl = document.getElementById("reset-alert");

      if (!/^\d{6}$/.test(otpCode)) {
        alertEl.className = "auth-alert auth-alert-error show";
        alertEl.textContent = "Kode OTP harus berupa 6 digit angka.";
        return;
      }

      if (newPin.length < 4 || newPin.length > 8 || !/^\d+$/.test(newPin)) {
        alertEl.className = "auth-alert auth-alert-error show";
        alertEl.textContent = "Master PIN baru harus berupa 4 hingga 8 digit angka.";
        return;
      }

      if (newPin !== confirmPin) {
        alertEl.className = "auth-alert auth-alert-error show";
        alertEl.textContent = "Konfirmasi PIN baru tidak cocok.";
        return;
      }

      const submitBtn = document.getElementById("btn-submit-reset");
      submitBtn.disabled = true;
      alertEl.className = "auth-alert auth-alert-success show";
      alertEl.textContent = "Memverifikasi OTP dan mereset PIN...";

      try {
        const res = await fetch("/api/admin-otp?action=verify_otp_and_reset_pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "verify_otp_and_reset_pin",
            otp_code: otpCode,
            new_pin: newPin,
          }),
        });

        const data = await res.json();

        if (res.ok && data.success) {
          alertEl.className = "auth-alert auth-alert-success show";
          alertEl.textContent = data.message + " Mengalihkan ke login...";
          setTimeout(() => {
            closeResetModal();
            document.documentElement.classList.remove("authenticated");
            document.documentElement.classList.add("not-authenticated");
            document.getElementById("auth-modal").classList.remove("hidden");
            const loginAlert = document.getElementById("auth-alert");
            loginAlert.className = "auth-alert auth-alert-success show";
            loginAlert.textContent = "PIN baru berhasil disimpan. Silakan masukkan PIN baru Anda.";
          }, 1500);
        } else {
          alertEl.className = "auth-alert auth-alert-error show";
          alertEl.textContent = data.message || "Gagal mereset Master PIN.";
          submitBtn.disabled = false;
        }
      } catch (err) {
        console.error("resetPin error:", err);
        alertEl.className = "auth-alert auth-alert-error show";
        alertEl.textContent = "Kesalahan koneksi saat mereset PIN.";
        submitBtn.disabled = false;
      }
    }

    async function handleLogout() {
      const token = getStoredToken();
      if (token) {
        fetch("/api/admin-otp?action=logout", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-admin-token": token },
          body: JSON.stringify({ action: "logout", session_token: token }),
        }).catch(() => {});
      }
      clearStoredToken();
      document.documentElement.classList.remove("authenticated");
      document.documentElement.classList.add("not-authenticated");
      document.getElementById("auth-modal").classList.remove("hidden");
      const pinField = document.getElementById("pin-input");
      if (pinField) {
        pinField.value = "";
        pinField.focus();
      }
    }

    // =========================================================================
    // SESSION VERIFICATION & DATA LOADER
    // =========================================================================
    async function checkSession() {
      const token = getStoredToken();
      if (!token) {
        document.documentElement.classList.remove("authenticated");
        document.documentElement.classList.add("not-authenticated");
        document.getElementById("auth-modal").classList.remove("hidden");
        fetchAuthState();
        const pinField = document.getElementById("pin-input");
        if (pinField) pinField.focus();
        return false;
      }

      try {
        const res = await fetch("/api/admin-otp?action=verify_session", {
          method: "GET",
          headers: { "x-admin-token": token },
        });
        const data = await res.json();
        if (res.ok && data.valid) {
          let exp = Number(data.expires_at) || Number(sessionStorage.getItem(SESSION_EXP_KEY) || 0);
          if (!exp || exp <= Date.now()) {
            exp = Date.now() + 15 * 60 * 1000;
          }
          sessionStorage.setItem(SESSION_EXP_KEY, String(exp));
          startSessionExpiryCountdown(exp);
          document.documentElement.classList.remove("not-authenticated");
          document.documentElement.classList.add("authenticated");
          document.getElementById("auth-modal").classList.add("hidden");
          return true;
        } else {
          triggerSessionExpired("unauthorized");
          return false;
        }
      } catch {
        // network error, biarkan modal login muncul
        document.documentElement.classList.remove("authenticated");
        document.documentElement.classList.add("not-authenticated");
        document.getElementById("auth-modal").classList.remove("hidden");
        return false;
      }
    }

    async function fetchAuthState() {
      try {
        const res = await fetch("/api/admin-otp?action=get_auth_state");
        const data = await res.json();
        if (res.ok && data.success) {
          if (data.target_email_masked) {
            document.getElementById("reset-target-email").textContent = data.target_email_masked;
          }
          if (data.is_locked) {
            const alertEl = document.getElementById("auth-alert");
            alertEl.className = "auth-alert auth-alert-error show";
            alertEl.textContent = "Akses sedang terkunci karena batas percobaan terlampaui. Tunggu 1 menit atau gunakan Reset via Email.";
            document.getElementById("attempts-label").textContent = "Sistem Terkunci";
          } else if (data.remaining_attempts !== undefined) {
            document.getElementById("attempts-label").textContent = `Sisa percobaan: ${data.remaining_attempts} kali`;
          }
        }
      } catch (_) {}
    }

    // =========================================================================
    // MULTI-LEVEL FILTERING STATE & DASHBOARD DATA LOADER (WITH SWR MEMORY CACHE)
    // =========================================================================
    let currentTimeRange = "today";
    let currentPlatform = "all";
    let currentProviderFilter = "all";
    let currentKeyStatusFilter = "all";
    let cachedDashboardData = null;
    const statsCache = new Map();
    const datasetCache = new Map();

    function setTimeRange(range) {
      currentTimeRange = range;
      document.querySelectorAll("#time-filter-pills .pill-filter-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-range") === range);
      });
      document.querySelectorAll("#matrix-time-filters .matrix-filter-pill").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-range") === range);
      });
      // Sinkronkan juga filter rentang pada dataset
      const dsRange = document.getElementById("dataset-range-filter");
      if (dsRange) dsRange.value = range;

      fetchData();
      fetchDataset();
    }

    function setMatrixRange(range) {
      setTimeRange(range);
    }

    function setPlatformFilter(platform) {
      currentPlatform = platform;
      document.querySelectorAll("#platform-filter-pills .pill-filter-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-platform") === platform);
      });
      // Sinkronkan juga filter platform pada dataset
      const dsPlatform = document.getElementById("dataset-platform-filter");
      if (dsPlatform) dsPlatform.value = platform === "all" ? "" : platform;

      fetchData();
      fetchDataset();
    }

    function setProviderFilter(provider) {
      currentProviderFilter = provider;
      document.querySelectorAll("#provider-filter-pills .pill-filter-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-provider") === provider);
      });
      if (cachedDashboardData) renderPoolMatrix(cachedDashboardData);
    }

    function setKeyStatusFilter(status) {
      currentKeyStatusFilter = status;
      if (cachedDashboardData) renderPoolMatrix(cachedDashboardData);
    }

    async function fetchData(force = false) {
      const token = getStoredToken();
      if (!token) return;

      const cacheKey = `${currentTimeRange}_${currentPlatform}`;
      // Instant render dari cache jika ada dan bukan force refresh
      if (!force && statsCache.has(cacheKey)) {
        const cached = statsCache.get(cacheKey);
        cachedDashboardData = cached;
        renderDashboard(cached);
      }

      const btnIcon = document.getElementById("btn-refresh-icon");
      if (btnIcon) btnIcon.innerHTML = '<span class="pulse-dot"></span>';

      try {
        const url = `/api/stats?range=${encodeURIComponent(currentTimeRange)}&platform=${encodeURIComponent(currentPlatform)}`;
        const res = await fetch(url, {
          headers: { "x-admin-token": token },
        });

        if (res.status === 401) {
          // Lakukan recheck verifikasi sesi sebelum memutuskan sesi hilang
          const recheck = await fetch("/api/admin-otp?action=verify_session", {
            headers: { "x-admin-token": token },
          }).catch(() => null);

          if (recheck && recheck.ok) {
            const recheckData = await recheck.json().catch(() => ({}));
            if (recheckData.valid) {
              console.warn("Transient 401 pada /api/stats terdeteksi, sesi tetap valid.");
              return;
            }
          }

          triggerSessionExpired("auth_lost");
          return;
        }

        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        statsCache.set(cacheKey, data);
        cachedDashboardData = data;
        renderDashboard(data);
      } catch (err) {
        console.error("Gagal mengambil metrik:", err);
      } finally {
        if (btnIcon) btnIcon.innerHTML = "&#x21bb;";
      }
    }

    function renderDashboard(data) {
      if (!data || !data.ok) return;

      const rangeLabel = data.rangeLabel || "Hari Ini";
      const platformLabel = data.platform === "whatsapp" ? " (WhatsApp)" : data.platform === "telegram" ? " (Telegram)" : "";

      if (data.isDatabaseConnected === false) {
        document.getElementById("server-time").textContent =
          "Sinkronisasi: " + formatTime(data.serverTime) + " WIB \u2022 Supabase Belum Terhubung di Vercel Env";
      } else {
        document.getElementById("server-time").textContent =
          "Sinkronisasi: " + formatTime(data.serverTime) + " WIB \u2022 Periode: " + rangeLabel + platformLabel;
      }

      // KPI Titles & Values
      document.getElementById("kpi-title-msgs").textContent = `Pesan (${rangeLabel})`;
      document.getElementById("kpi-today-msgs").textContent = (data.summary.totalMessagesPeriod ?? data.summary.totalMessagesToday ?? 0).toLocaleString();
      document.getElementById("kpi-total-msgs").textContent = (data.summary.totalMessagesAllTime ?? 0).toLocaleString();
      document.getElementById("kpi-wa").textContent = (data.summary.whatsappPeriod ?? data.summary.whatsappToday ?? 0) + " WA";
      document.getElementById("kpi-tele").textContent = (data.summary.telegramPeriod ?? data.summary.telegramToday ?? 0) + " Tele";

      document.getElementById("kpi-title-calls").textContent = `Panggilan & Token API (${rangeLabel})`;
      const totalCalls = data.summary.totalCallsPeriod ?? data.summary.totalCallsToday ?? 0;
      const totalTokens = data.summary.totalTokensPeriod ?? 0;
      document.getElementById("kpi-calls-today").textContent = totalCalls.toLocaleString() + " calls";
      document.getElementById("kpi-total-keys").textContent = `${formatTokens(totalTokens)} Token \u2022 ${data.summary.totalKeys} Keys Terpantau`;

      document.getElementById("kpi-title-model").textContent = `Model Terpopuler (${rangeLabel})`;
      const topModel = data.modelsBreakdown && data.modelsBreakdown.length > 0
        ? data.modelsBreakdown[0].name
        : "Menunggu panggilan";
      document.getElementById("kpi-top-model").textContent = topModel;

      // Pool reset label
      const poolReset = document.getElementById("pool-reset-label");
      if (poolReset) {
        if (data.range === "today") poolReset.textContent = "Reset: 00:00 UTC (xKiro, Groq, Cloudflare, OpenRouter) \u2022 00:00 PT (Gemini)";
        else poolReset.textContent = `Akumulasi Periode ${rangeLabel}`;
      }

      // Dynamic Section Titles
      const modelsH = document.getElementById("models-section-title");
      if (modelsH) modelsH.textContent = `Distribusi Model LLM (${rangeLabel})`;
      const mediaH = document.getElementById("media-section-title");
      if (mediaH) mediaH.textContent = `Pemrosesan Tipe Media (${rangeLabel})`;

      // Render Pools Matrix, Dedicated Token Quota Matrix & AI Model Router Matrix
      renderPoolMatrix(data);
      renderLiveUpstreamTable(data);
      renderTokenMatrix(data);
      renderAiModelMatrix(data);

      // Media Counts
      const mc = data.mediaCounts || {};
      document.getElementById("media-text").textContent = (mc.text || 0).toLocaleString();
      document.getElementById("media-voice").textContent = (mc.voice || 0).toLocaleString();
      document.getElementById("media-image").textContent = (mc.image || 0).toLocaleString();
      document.getElementById("media-sticker").textContent = (mc.sticker || 0).toLocaleString();
      document.getElementById("media-doc").textContent = (mc.document || 0).toLocaleString();
      document.getElementById("media-video").textContent = (mc.video || 0).toLocaleString();
    }

    function renderAiModelMatrix(data) {
      const gridEl = document.getElementById("matrix-cards-grid");
      if (!gridEl) return;

      const totalInferensiEl = document.getElementById("matrix-total-inferensi");
      const totalResolusiEl = document.getElementById("gateway-total-resolusi");

      const modelsBreakdown = data.modelsBreakdown || [];
      let totalCalls = modelsBreakdown.reduce((sum, m) => sum + (m.count || 0), 0);
      if (totalCalls === 0 && data.summary) {
        totalCalls = data.summary.totalCallsPeriod || data.summary.totalMessagesPeriod || 0;
      }

      if (totalInferensiEl) totalInferensiEl.textContent = `${totalCalls.toLocaleString()}x`;
      if (totalResolusiEl) totalResolusiEl.textContent = `${totalCalls.toLocaleString()}x`;

      // Sinkronkan active state filter waktu
      document.querySelectorAll("#matrix-time-filters .matrix-filter-pill").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-range") === currentTimeRange);
      });

      // Pemetaan frekuensi pemanggilan model dari database
      const countMap = new Map();
      modelsBreakdown.forEach(m => {
        const rawName = (m.name || "").toLowerCase();
        countMap.set(rawName, m.count || 0);
      });

      function getCount(matchKeys) {
        for (const k of matchKeys) {
          const lower = k.toLowerCase();
          for (const [name, cnt] of countMap.entries()) {
            if (name.includes(lower) || lower.includes(name)) {
              return cnt;
            }
          }
        }
        return 0;
      }

      // Katalog model router multi-tier (urutan sinkron 100% dengan rantai failover runtime sistem v0.26)
      const catalog = [
        // --- Tier 1: xKiro Gateway (DeepSeek Engine) ---
        {
          name: "DeepSeek V4 Flash",
          provider: "XKIRO",
          tagClass: "tag-xkiro",
          capabilities: ["Fast Reasoning", "Text"],
          desc: "Prioritas #1 Tier 1 - Model penalaran super cepat latensi rendah",
          matchKeys: ["deepseek/deepseek-v4-flash", "deepseek-v4-flash", "xkiro/deepseek/deepseek-v4-flash"],
        },
        {
          name: "DeepSeek V4 Pro",
          provider: "XKIRO",
          tagClass: "tag-xkiro",
          capabilities: ["Code", "Deep Reasoning"],
          desc: "Prioritas #2 Tier 1 - Frontier reasoning & logika koding mendalam",
          matchKeys: ["deepseek/deepseek-v4-pro", "deepseek-v4-pro", "xkiro/deepseek/deepseek-v4-pro"],
        },
        {
          name: "DeepSeek V3.2",
          provider: "XKIRO",
          tagClass: "tag-xkiro",
          capabilities: ["Text", "Reasoning"],
          desc: "Prioritas #3 Tier 1 - Cadangan penalaran stabil xKiro Gateway",
          matchKeys: ["deepseek/deepseek-v3.2", "deepseek-v3.2", "xkiro/deepseek/deepseek-v3.2"],
        },

        // --- Tier 2: Groq Cloud API (LPU Inference Engine) ---
        {
          name: "Qwen 3.8 27B",
          provider: "GROQ",
          tagClass: "tag-groq",
          capabilities: ["Vision", "LPU Speed"],
          desc: "Prioritas #1 Tier 2 - Respons kilat ~500 tok/s LPU & Multimodal",
          matchKeys: ["groq/qwen/qwen3.8-27b", "groq/qwen3.8", "qwen/qwen3.8-27b", "qwen3.8-27b"],
        },
        {
          name: "Qwen 3.6 27B",
          provider: "GROQ",
          tagClass: "tag-groq",
          capabilities: ["Vision", "LPU Speed"],
          desc: "Prioritas #2 Tier 2 - Cadangan Groq LPU kecepatan tinggi & Multimodal",
          matchKeys: ["groq/qwen/qwen3.6-27b", "groq/qwen3.6", "qwen/qwen3.6-27b", "qwen3.6-27b"],
        },
        {
          name: "Groq Whisper Turbo",
          provider: "GROQ",
          tagClass: "tag-groq",
          capabilities: ["Voice Note (VN)"],
          desc: "Transkripsi Voice Note audio sub-detik ~500ms",
          matchKeys: ["whisper-large-v3-turbo", "whisper-large-v3", "whisper", "groq/whisper"],
        },

        // --- Tier 3: Cloudflare Workers AI ---
        {
          name: "Llama 3.1 70B Instruct",
          provider: "CLOUDFLARE",
          tagClass: "tag-cloudflare",
          capabilities: ["High-Reasoning", "Text", "Code"],
          desc: "Prioritas #1 Tier 3 - Model reasoning andalan Cloudflare Workers AI",
          matchKeys: ["cloudflare/@cf/meta/llama-3.1-70b-instruct", "@cf/meta/llama-3.1-70b-instruct", "llama-3.1-70b"],
        },
        {
          name: "Qwen 2.5 Coder 32B",
          provider: "CLOUDFLARE",
          tagClass: "tag-cloudflare",
          capabilities: ["Code", "Math", "Text"],
          desc: "Prioritas #2 Tier 3 - Cadangan presisi tinggi koding Cloudflare AI",
          matchKeys: ["cloudflare/@cf/qwen/qwen2.5-coder-32b-instruct", "@cf/qwen/qwen2.5-coder-32b-instruct", "qwen2.5-coder-32b"],
        },

        // --- Tier 4: Google Gemini API ---
        {
          name: "Gemini 3.8 Flash",
          provider: "GEMINI",
          tagClass: "tag-gemini",
          capabilities: ["Multimodal Vision"],
          desc: "Prioritas #1 Tier 4 - Frontier multimodal native foto, PDF & dokumen",
          matchKeys: ["gemini/gemini-3.8-flash", "gemini-3.8-flash"],
        },
        {
          name: "Gemini 2.5 Flash",
          provider: "GEMINI",
          tagClass: "tag-gemini",
          capabilities: ["Multimodal Vision"],
          desc: "Prioritas #2 Tier 4 - Cadangan multimodal vision stabil 1M konteks",
          matchKeys: ["gemini/gemini-2.5-flash", "gemini-2.5-flash"],
        },

        // --- Tier 5: OpenRouter AI ---
        {
          name: "Nex N2.5 Pro Free",
          provider: "OPENROUTER",
          tagClass: "tag-openrouter",
          capabilities: ["Text", "Vision"],
          desc: "Prioritas #1 Tier 5 - Dynamic SOTA Free router & Multimodal",
          matchKeys: ["openrouter/nex-agi/nex-n2.5-pro:free", "nex-n2.5-pro", "nex-agi/nex-n2.5-pro:free"],
        },
        {
          name: "Nex N2.5 Mini Free",
          provider: "OPENROUTER",
          tagClass: "tag-openrouter",
          capabilities: ["Text", "Vision"],
          desc: "Prioritas #2 Tier 5 - Cadangan efisien router OpenRouter",
          matchKeys: ["openrouter/nex-agi/nex-n2.5-mini:free", "nex-n2.5-mini", "nex-agi/nex-n2.5-mini:free"],
        },
        {
          name: "Nemotron 3.5 Lightning",
          provider: "OPENROUTER",
          tagClass: "tag-openrouter",
          capabilities: ["Fast Text"],
          desc: "Prioritas #3 Tier 5 - Model berkecepatan tinggi OpenRouter Cloud",
          matchKeys: ["openrouter/nvidia/nemotron-3.5-lightning:free", "nemotron-3.5-lightning", "nvidia/nemotron-3.5-lightning:free"],
        },
      ];

      // Urutan Model Berbasis MRU (Most Recently Used):
      // Jika ada model baru terpakai jadi #1, maka model #1 sebelumnya bergeser jadi #2, #3, dst.
      // Model-model yang sudah pernah terpakai tidak akan kembali ke posisi statis/bawah.

      // 1. Ambil urutan model all-time terbaru dari backend (recentModels)
      const serverRecent = Array.isArray(data.recentModels) ? data.recentModels : [];

      // 2. Pertahankan juga MRU stack di client session + localStorage agar urutan tidak reset saat reload
      const MRU_STORAGE_KEY = "freeaibot_mru_models_stack";
      if (!window.__mruModelHistory || !Array.isArray(window.__mruModelHistory) || window.__mruModelHistory.length === 0) {
        try {
          const stored = localStorage.getItem(MRU_STORAGE_KEY);
          window.__mruModelHistory = stored ? JSON.parse(stored) : [];
        } catch {
          window.__mruModelHistory = [];
        }
      }

      // Sinkronkan data recent dari server ke history client (dari terlama ke terbaru agar unshift menempatkan yang terbaru di #1)
      for (let idx = serverRecent.length - 1; idx >= 0; idx--) {
        const sm = serverRecent[idx];
        if (sm) {
          const existingIdx = window.__mruModelHistory.findIndex(k => k.toLowerCase() === sm.toLowerCase());
          if (existingIdx !== -1) {
            window.__mruModelHistory.splice(existingIdx, 1);
          }
          window.__mruModelHistory.unshift(sm);
        }
      }

      // Jika ada activeModel saat ini, pastikan ia berada mutlak di posisi paling puncak (#1)
      const currentActive = data.activeModel || (modelsBreakdown[0]?.name);
      if (currentActive) {
        const existingIdx = window.__mruModelHistory.findIndex(k => k.toLowerCase() === currentActive.toLowerCase());
        if (existingIdx !== -1) {
          window.__mruModelHistory.splice(existingIdx, 1);
        }
        window.__mruModelHistory.unshift(currentActive);
      }

      // Masukkan juga model-model dari breakdown yang memiliki eksekusi (count > 0) ke dalam MRU jika belum ada
      modelsBreakdown.forEach(m => {
        if (m.name && (m.count || 0) > 0) {
          const already = window.__mruModelHistory.some(k => k.toLowerCase() === m.name.toLowerCase());
          if (!already) {
            window.__mruModelHistory.push(m.name);
          }
        }
      });

      // Purge sembarang model historis yang sudah tidak ada di katalog aktif sistem
      window.__mruModelHistory = (window.__mruModelHistory || []).filter(mruKey => {
        if (!mruKey) return false;
        const keyLower = mruKey.toLowerCase();
        return catalog.some(item =>
          item.matchKeys.some(k => {
            const kl = k.toLowerCase();
            return keyLower === kl || keyLower.endsWith('/' + kl) || kl.endsWith('/' + keyLower) || keyLower.includes(kl) || kl.includes(keyLower);
          })
        );
      });

      // Simpan state MRU bersih terkini ke localStorage
      try {
        localStorage.setItem(MRU_STORAGE_KEY, JSON.stringify(window.__mruModelHistory));
      } catch {}

      // 3. Susun orderedCatalog:
      // Petakan model dari window.__mruModelHistory ke item katalog aktif
      const orderedCatalog = [];
      const usedCatalogIndices = new Set();

      for (const mruKey of window.__mruModelHistory) {
        const keyLower = mruKey.toLowerCase();
        const catIdx = catalog.findIndex((item, i) => {
          if (usedCatalogIndices.has(i)) return false;
          return item.matchKeys.some(k => {
            const kl = k.toLowerCase();
            return keyLower === kl || keyLower.endsWith('/' + kl) || kl.endsWith('/' + keyLower) || keyLower.includes(kl) || kl.includes(keyLower);
          });
        });

        if (catIdx !== -1) {
          usedCatalogIndices.add(catIdx);
          orderedCatalog.push(catalog[catIdx]);
        }
      }

      // 4. Tambahkan sisa model katalog statis yang BELUM PERNAH dipakai di bawahnya
      catalog.forEach((item, i) => {
        if (!usedCatalogIndices.has(i)) {
          orderedCatalog.push(item);
        }
      });

      // Render kartu dengan urutan baru: posisi #1 selalu model yang sedang aktif
      gridEl.innerHTML = orderedCatalog.map((c, i) => {
        const count = getCount(c.matchKeys);
        const isActive = i === 0; // Posisi #1 selalu aktif terbaru
        const activeBadge = isActive
          ? `<span class="badge-active-live"><span class="pulse-dot-cyan"></span>AKTIF TERBARU</span>`
          : ``;
        const cardClass = isActive ? `model-matrix-card card-active` : `model-matrix-card`;

        const caps = c.capabilities || ["Text"];
        const capBadgesHtml = caps.map(cap => {
          let capClass = "tag-cap-text";
          const lower = cap.toLowerCase();
          if (lower.includes("vision") || lower.includes("multimodal")) capClass = "tag-cap-vision";
          else if (lower.includes("voice")) capClass = "tag-cap-voice";
          else if (lower.includes("code")) capClass = "tag-cap-code";
          return `<span class="tag-cap ${capClass}">${escapeHtml(cap)}</span>`;
        }).join("");

        return `
          <div class="${cardClass}">
            <div>
              <div class="card-top-row">
                <div class="card-num-group">
                  <span class="card-number">#${i + 1}</span>
                  ${activeBadge}
                </div>
                <span class="tag-provider ${c.tagClass}">${c.provider}</span>
              </div>
              <div class="card-model-name">${escapeHtml(c.name)}</div>
              ${capBadgesHtml ? `<div class="card-caps-row">${capBadgesHtml}</div>` : ""}
              <div class="card-model-desc">${escapeHtml(c.desc)}</div>
            </div>
            <div class="card-footer-row">
              <span class="card-footer-label">Total Eksekusi</span>
              <span class="card-footer-count">${count.toLocaleString()}x</span>
            </div>
          </div>
        `;
      }).join("");
    }

    function renderPoolMatrix(data) {
      const poolGrid = document.getElementById("pool-grid");
      if (!poolGrid) return;
      poolGrid.innerHTML = "";

      const pools = data.pools || data.providers || [];
      const filteredPools = pools.filter(p => {
        if (currentProviderFilter !== "all" && p.kind !== currentProviderFilter) return false;
        return true;
      });

      if (filteredPools.length === 0) {
        poolGrid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-dim); padding: 2rem;">Tidak ada pool provider yang sesuai filter.</div>`;
        return;
      }

      filteredPools.forEach(p => {
        const card = document.createElement("div");
        card.className = "provider-card";

        let keysHtml = "";
        const filteredKeys = (p.keys || []).filter(k => {
          if (currentKeyStatusFilter === "healthy" && k.status !== "healthy") return false;
          if (currentKeyStatusFilter === "warning" && k.status !== "warning") return false;
          if (currentKeyStatusFilter === "capped" && k.status !== "capped") return false;
          return true;
        });

        if (filteredKeys.length === 0) {
          keysHtml = `<div style="color: var(--text-dim); font-size: 0.8rem; padding: 0.5rem 0;">Tidak ada key dengan status ${currentKeyStatusFilter}.</div>`;
        } else {
          filteredKeys.forEach(k => {
            let progressColor = "progress-emerald";
            if (k.status === "capped" || k.percent >= 100) progressColor = "progress-rose";
            else if (k.status === "warning" || k.percent >= 80) progressColor = "progress-amber";

            const statusLabel = k.status === "capped" ? "Capped" : k.status === "warning" ? "Waspada" : "Optimal";
            const cleanSuffix = k.suffix.startsWith("...") ? k.suffix : "..." + k.suffix;
            const capLabel = k.cap > 0 ? `${k.used.toLocaleString()} / ${k.cap.toLocaleString()} calls (${k.percent}%)` : `${k.used.toLocaleString()} calls`;

            keysHtml += `
              <div class="key-row">
                <div class="key-info-line">
                  <div class="key-identity">
                    <span class="key-label">${escapeHtml(cleanSuffix)}</span>
                    <span class="key-badge-status status-${k.status}">${statusLabel}</span>
                  </div>
                  <span class="key-stats">${capLabel}</span>
                </div>
                <div class="progress-bar-bg">
                  <div class="progress-bar-fill ${progressColor}" style="width: ${Math.min(100, k.percent || 0)}%"></div>
                </div>
              </div>
            `;
          });
        }

        const usedValue = p.usedPeriod ?? p.usedToday ?? 0;
        const capInfo = p.totalCap > 0 ? `Cap: ${p.totalCap.toLocaleString()} calls` : "Uncapped";
        const providerLiveBadge = p.isLiveSynced
          ? `<span class="badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; font-size: 0.68rem; font-weight: 700; border: 1px solid rgba(56, 189, 248, 0.25); padding: 2px 7px; border-radius: 9999px; margin-left: 6px;">● Live Remote Sync</span>`
          : "";

        const modelCountInfo = Array.isArray(p.allModels) && p.allModels.length > 1
          ? ` <span style="color: var(--text-dim); font-size: 0.72rem; font-family: var(--font-mono);">(+${p.allModels.length - 1} Cadangan)</span>`
          : "";

        card.innerHTML = `
          <div class="provider-header">
            <div>
              <div class="provider-name" style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                <span>${escapeHtml(p.displayName)}</span>
                ${providerLiveBadge}
              </div>
              <div class="provider-models">${escapeHtml(p.primaryModel)}${modelCountInfo}</div>
            </div>
            <div class="provider-summary-stat">
              <div class="provider-usage-text">${usedValue.toLocaleString()} Calls</div>
              <div class="provider-cap-text">${p.keyCount} Keys &bull; ${capInfo}</div>
            </div>
          </div>
          <div class="keys-list">
            ${keysHtml}
          </div>
        `;
        poolGrid.appendChild(card);
      });
    }

    function renderLiveUpstreamTable(data) {
      const tbody = document.getElementById("live-upstream-tbody");
      if (!tbody) return;
      tbody.innerHTML = "";

      const pools = data.pools || data.providers || [];
      let grandTotalTokenCap = 0;
      let grandTotalTokenUsed = 0;
      let grandTotalTokenRemaining = 0;
      let grandTotalCloudflareRpd = 0;
      let grandTotalCloudflareUsed = 0;
      let totalAllKeys = 0;
      let totalOrUsageUsd = 0;

      const rows = [];

      pools.forEach(p => {
        if (!p.keys || p.keys.length === 0) return;

        p.keys.forEach(k => {
          totalAllKeys++;
          const cleanSuffix = k.suffix.startsWith("...") ? k.suffix : "..." + k.suffix;

          if (p.kind === "xkiro") {
            const keyCap = k.tokenCap || 5000000;
            const keyUsed = k.tokensUsed || 0;
            const keyRemaining = (k.liveRemainingTokens !== null && k.liveRemainingTokens !== undefined) ? k.liveRemainingTokens : Math.max(0, keyCap - keyUsed);
            const pct = k.tokenPercent || 0;

            grandTotalTokenCap += keyCap;
            grandTotalTokenUsed += keyUsed;
            grandTotalTokenRemaining += keyRemaining;

            rows.push(`
              <tr>
                <td>
                  <div style="font-weight: 700; color: var(--text-main); font-size: 0.88rem;">${escapeHtml(p.displayName)}</div>
                  <div style="font-family: var(--font-mono); font-size: 0.78rem; color: #38bdf8; font-weight: 700; margin-top: 3px;">sk-xt-${escapeHtml(cleanSuffix)}</div>
                </td>
                <td>
                  <div style="font-weight: 600; color: #cbd5e1; font-size: 0.82rem;">${escapeHtml(k.liveUserName || "Akun Terverifikasi")}</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">${escapeHtml(k.liveUserEmail || "api.xkiro.com")}</div>
                </td>
                <td>
                  <div style="display: flex; justify-content: space-between; font-size: 0.78rem; font-family: var(--font-mono); margin-bottom: 4px;">
                    <span style="font-weight: 700; color: #fbbf24;">${keyUsed.toLocaleString("id-ID")} Token</span>
                    <span style="color: var(--text-dim);">${pct}%</span>
                  </div>
                  <div class="progress-bar-bg" style="height: 6px;">
                    <div class="progress-bar-fill ${pct >= 100 ? 'progress-rose' : pct >= 80 ? 'progress-amber' : 'progress-emerald'}" style="width: ${Math.min(100, pct)}%"></div>
                  </div>
                  <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 3px;">Limit: ${keyCap.toLocaleString("id-ID")} &bull; Global (Bot + IDE)</div>
                </td>
                <td>
                  <div style="font-size: 1.05rem; font-weight: 800; color: #34d399; font-family: var(--font-mono);">${keyRemaining.toLocaleString("id-ID")}</div>
                  <div style="font-size: 0.72rem; color: #10b981; font-weight: 600; margin-top: 2px;">● Sisa Token Hari Ini</div>
                </td>
                <td style="text-align: right;">
                  <span class="badge-live-sync" style="margin-bottom: 4px;">● Live Synced</span>
                  <div><span class="key-badge-status status-healthy">OPTIMAL</span></div>
                </td>
              </tr>
            `);
          } else if (p.kind === "openrouter") {
            const usageUsd = Number(k.liveUsageUsd || 0);
            const dailyUsd = Number(k.liveUsageDailyUsd || 0);
            totalOrUsageUsd += usageUsd;

            rows.push(`
              <tr>
                <td>
                  <div style="font-weight: 700; color: var(--text-main); font-size: 0.88rem;">${escapeHtml(p.displayName)}</div>
                  <div style="font-family: var(--font-mono); font-size: 0.78rem; color: #a855f7; font-weight: 700; margin-top: 3px;">sk-or-${escapeHtml(cleanSuffix)}</div>
                </td>
                <td>
                  <div style="font-weight: 600; color: #cbd5e1; font-size: 0.82rem;">OpenRouter Key Pool</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">openrouter.ai/keys</div>
                </td>
                <td>
                  <div style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: #38bdf8;">$${usageUsd.toFixed(5)} USD</div>
                  <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">Daily Usage: $${dailyUsd.toFixed(5)} &bull; Free Model Route</div>
                </td>
                <td>
                  <div style="font-size: 0.92rem; font-weight: 700; color: #34d399;">Free Tier Active</div>
                  <div style="font-size: 0.72rem; color: #10b981; margin-top: 2px;">Bebas Kuota Model :free</div>
                </td>
                <td style="text-align: right;">
                  <span class="badge-live-sync" style="margin-bottom: 4px;">● Live Synced</span>
                  <div><span class="key-badge-status status-healthy">OPTIMAL</span></div>
                </td>
              </tr>
            `);
          } else if (p.kind === "groq") {
            const keyCap = k.tokenCap || 200000;
            const keyUsed = k.tokensUsed || 0;
            const keyRemaining = Math.max(0, keyCap - keyUsed);
            const pct = k.tokenPercent || 0;

            grandTotalTokenCap += keyCap;
            grandTotalTokenUsed += keyUsed;
            grandTotalTokenRemaining += keyRemaining;

            const callCountText = k.used > 0 ? ` (${k.used.toLocaleString()} calls)` : "";

            rows.push(`
              <tr>
                <td>
                  <div style="font-weight: 700; color: var(--text-main); font-size: 0.88rem;">${escapeHtml(p.displayName)}</div>
                  <div style="font-family: var(--font-mono); font-size: 0.78rem; color: #f97316; font-weight: 700; margin-top: 3px;">gsk_${escapeHtml(cleanSuffix)}</div>
                </td>
                <td>
                  <div style="font-weight: 600; color: #cbd5e1; font-size: 0.82rem;">Groq Cloud Console</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">console.groq.com &bull; Free Tier</div>
                </td>
                <td>
                  <div style="display: flex; justify-content: space-between; font-size: 0.78rem; font-family: var(--font-mono); margin-bottom: 4px;">
                    <span style="font-weight: 700; color: #fbbf24;">${keyUsed.toLocaleString("id-ID")} Token${callCountText}</span>
                    <span style="color: var(--text-dim);">${pct}%</span>
                  </div>
                  <div class="progress-bar-bg" style="height: 6px;">
                    <div class="progress-bar-fill ${pct >= 100 ? 'progress-rose' : pct >= 80 ? 'progress-amber' : 'progress-emerald'}" style="width: ${Math.min(100, pct)}%"></div>
                  </div>
                  <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 3px;">Limit: ${keyCap.toLocaleString("id-ID")} TPD &bull; Upstream Real Usage</div>
                </td>
                <td>
                  <div style="font-size: 1.05rem; font-weight: 800; color: #34d399; font-family: var(--font-mono);">${keyRemaining.toLocaleString("id-ID")}</div>
                  <div style="font-size: 0.72rem; color: #10b981; font-weight: 600; margin-top: 2px;">● Sisa Token Riil (TPD)</div>
                </td>
                <td style="text-align: right;">
                  <span class="badge-bot-sync" style="margin-bottom: 4px; background: rgba(249, 115, 22, 0.15); color: #fb923c; border-color: rgba(249, 115, 22, 0.3);">● Upstream Real Usage</span>
                  <div><span class="key-badge-status status-healthy">OPTIMAL</span></div>
                </td>
              </tr>
            `);
          } else if (p.kind === "cloudflare") {
            const keyCap = p.cap || 120;
            const keyUsed = k.used || 0;
            const keyRemaining = Math.max(0, keyCap - keyUsed);
            const pct = keyCap > 0 ? Math.min(100, Math.round((keyUsed / keyCap) * 100)) : 0;

            grandTotalCloudflareRpd += keyCap;
            grandTotalCloudflareUsed += keyUsed;

            rows.push(`
              <tr>
                <td>
                  <div style="font-weight: 700; color: var(--text-main); font-size: 0.88rem;">${escapeHtml(p.displayName)}</div>
                  <div style="font-family: var(--font-mono); font-size: 0.78rem; color: #f38020; font-weight: 700; margin-top: 3px;">cfut_...${escapeHtml(cleanSuffix)}</div>
                </td>
                <td>
                  <div style="font-weight: 600; color: #cbd5e1; font-size: 0.82rem;">Workers AI Dashboard</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">dash.cloudflare.com/ai</div>
                </td>
                <td>
                  <div style="display: flex; justify-content: space-between; font-size: 0.78rem; font-family: var(--font-mono); margin-bottom: 4px;">
                    <span style="font-weight: 700; color: #fbbf24;">${keyUsed.toLocaleString("id-ID")} Req</span>
                    <span style="color: var(--text-dim);">${pct}%</span>
                  </div>
                  <div class="progress-bar-bg" style="height: 6px;">
                    <div class="progress-bar-fill ${pct >= 100 ? 'progress-rose' : pct >= 80 ? 'progress-amber' : 'progress-emerald'}" style="width: ${Math.min(100, pct)}%"></div>
                  </div>
                  <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 3px;">Limit: ${keyCap.toLocaleString("id-ID")} RPD (~10K Neurons) &bull; Bot Monitored</div>
                </td>
                <td>
                  <div style="font-size: 1.05rem; font-weight: 800; color: #34d399; font-family: var(--font-mono);">${keyRemaining.toLocaleString("id-ID")}</div>
                  <div style="font-size: 0.72rem; color: #10b981; font-weight: 600; margin-top: 2px;">● Sisa Kuota Harian (RPD)</div>
                </td>
                <td style="text-align: right;">
                  <span class="badge-bot-sync" style="margin-bottom: 4px;">● Bot Monitored</span>
                  <div><span class="key-badge-status status-healthy">OPTIMAL</span></div>
                </td>
              </tr>
            `);
          } else if (p.kind === "gemini") {
            rows.push(`
              <tr>
                <td>
                  <div style="font-weight: 700; color: var(--text-main); font-size: 0.88rem;">${escapeHtml(p.displayName)}</div>
                  <div style="font-family: var(--font-mono); font-size: 0.78rem; color: #60a5fa; font-weight: 700; margin-top: 3px;">AIza...${escapeHtml(cleanSuffix)}</div>
                </td>
                <td>
                  <div style="font-weight: 600; color: #cbd5e1; font-size: 0.82rem;">Google AI Studio</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">aistudio.google.com</div>
                </td>
                <td>
                  <div style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: #38bdf8;">${(k.used || 0).toLocaleString("id-ID")} Panggilan</div>
                  <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">Batas: 1.500 RPD &bull; 1M TPM Tier</div>
                </td>
                <td>
                  <div style="font-size: 0.92rem; font-weight: 700; color: #34d399;">Uncapped Daily</div>
                  <div style="font-size: 0.72rem; color: #10b981; margin-top: 2px;">Bebas Kuota Token Harian</div>
                </td>
                <td style="text-align: right;">
                  <span class="badge-bot-sync" style="margin-bottom: 4px;">● Bot Monitored</span>
                  <div><span class="key-badge-status status-healthy">OPTIMAL</span></div>
                </td>
              </tr>
            `);
          }
        });
      });

      if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">Tidak ada data sinkronisasi upstream aktif.</td></tr>`;
      } else {
        tbody.innerHTML = rows.join("");
      }

      // Update Mini KPI Ribbon (Universal across all providers)
      const capEl = document.getElementById("upstream-total-cap");
      const usedEl = document.getElementById("upstream-total-used");
      const remEl = document.getElementById("upstream-total-remaining");
      const pctEl = document.getElementById("upstream-remaining-pct");
      const orEl = document.getElementById("upstream-openrouter-status");

      const capSubEl = document.getElementById("upstream-total-cap-sub");

      if (capEl) capEl.textContent = grandTotalTokenCap.toLocaleString("id-ID") + " Token";
      if (capSubEl) {
        capSubEl.textContent = grandTotalCloudflareRpd > 0 
          ? `xKiro & Groq (+${grandTotalCloudflareRpd} RPD Cloudflare)` 
          : "Seluruh Provider Terdaftar";
      }
      if (usedEl) usedEl.textContent = grandTotalTokenUsed.toLocaleString("id-ID") + " Token";
      if (remEl) remEl.textContent = grandTotalTokenRemaining.toLocaleString("id-ID") + " Token";
      if (pctEl && grandTotalTokenCap > 0) {
        const remainingPct = Math.round((grandTotalTokenRemaining / grandTotalTokenCap) * 100);
        pctEl.textContent = `${remainingPct}% Kuota Bersih Tersedia`;
      }
      if (orEl) {
        orEl.textContent = `${totalAllKeys} Kunci Aktif`;
      }

      // WhatsApp Cloud API 1.000 Sesi Percakapan / Bulan (Jendela 24 Jam per User)
      const waSessions = data.summary?.whatsappMonthlySessions;
      const waSessEl = document.getElementById("upstream-wa-sessions");
      const waSessSubEl = document.getElementById("upstream-wa-sessions-sub");
      if (waSessEl && waSessions) {
        waSessEl.textContent = `${waSessions.used.toLocaleString("id-ID")} / ${waSessions.limit.toLocaleString("id-ID")}`;
      }
      if (waSessSubEl && waSessions) {
        waSessSubEl.textContent = `Sisa ${waSessions.remaining.toLocaleString("id-ID")} Sesi (${waSessions.monthLabel})`;
      }
    }

    function renderTokenMatrix(data) {
      const tbody = document.getElementById("token-matrix-tbody");
      if (!tbody) return;
      tbody.innerHTML = "";

      const pools = data.pools || data.providers || [];
      if (pools.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 1.5rem;">Tidak ada data provider.</td></tr>`;
        return;
      }

      pools.forEach(p => {
        const usedCalls = p.usedPeriod ?? p.usedToday ?? 0;
        const tokensUsed = p.totalTokensUsed ?? (usedCalls * (p.avgTokensPerChat || 0));

        let statusBadgeClass = "status-healthy";
        let statusText = "Optimal";
        if (p.percent >= 100) {
          statusBadgeClass = "status-capped";
          statusText = "Capped";
        } else if (p.percent >= 80) {
          statusBadgeClass = "status-warning";
          statusText = "Waspada";
        }

        let mechanismText = "Kuota Token Harian";
        let limitOfficial = `${formatTokens(p.tokenCapPerKey)}/hari/key`;
        if (p.kind === "cloudflare") {
          mechanismText = "Batas Neuron Harian";
          limitOfficial = `10.000 Neuron (~${(p.capPerKey || 120).toLocaleString()} RPD)`;
        } else if (p.tokenLimitType === "requests_tpm") {
          mechanismText = "Batas Permintaan & TPM";
          limitOfficial = p.totalCap > 0 ? `${p.capPerKey.toLocaleString()} RPD/key` : "Tanpa Limit Mutlak";
        } else if (p.tokenLimitType === "monthly_credits") {
          mechanismText = "Kredit Bulanan Akun";
          limitOfficial = "Included Usage Credits";
        }

        let syncSubtext = "";
        if (p.isLiveSynced) {
          syncSubtext = `<div style="font-size: 0.72rem; color: #34d399; margin-top: 2px; font-weight: 600;">● Live API Sync (Global di Semua App &amp; IDE)</div>`;
        } else if (p.realUsageCalls > 0 || (p.avgTokensPerChat && p.avgTokensPerChat > 0)) {
          syncSubtext = `<div style="font-size: 0.72rem; color: #38bdf8; margin-top: 2px; font-weight: 600;">● Token Riil Upstream (Rata-rata ~${formatTokens(p.avgTokensPerChat)}/chat)</div>`;
        } else {
          syncSubtext = `<div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">Terhitung dari riwayat pesan</div>`;
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div style="font-weight: 700; color: var(--text-main); font-size: 0.88rem;">${escapeHtml(p.displayName)}</div>
            <div style="font-size: 0.74rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">${escapeHtml(p.primaryModel)}</div>
          </td>
          <td>
            <span style="color: #cbd5e1; font-weight: 500;">${escapeHtml(mechanismText)}</span>
          </td>
          <td>
            <span class="tp-badge-context">${escapeHtml(p.contextWindow || "-")}</span>
          </td>
          <td>
            <span style="font-weight: 600; color: #38bdf8;">${escapeHtml(limitOfficial)}</span>
          </td>
          <td>
            <span class="tp-badge-cycle">${escapeHtml(p.resetCycle || "-")}</span>
          </td>
          <td>
            <div style="font-weight: 700; color: var(--text-main);">${usedCalls.toLocaleString()} Calls &bull; ${formatTokens(tokensUsed)} Token</div>
            ${syncSubtext}
          </td>
          <td style="text-align: right;">
            <span class="key-badge-status ${statusBadgeClass}">${statusText}</span>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }


    // =========================================================================
    // DATASET EVALUATION & TRAINING LOADER (PAGINATED: 5 CHATS PER PAGE)
    // =========================================================================
    let currentDatasetPage = 1;
    const DATASET_PAGE_SIZE = 5;
    let cachedDatasetPairs = [];

    function debounceDatasetSearch() {
      if (datasetSearchTimeout) clearTimeout(datasetSearchTimeout);
      datasetSearchTimeout = setTimeout(() => {
        currentDatasetPage = 1;
        fetchDataset();
      }, 350);
    }

    async function fetchDataset(force = false) {
      const token = getStoredToken();
      if (!token) return;

      const q = document.getElementById("dataset-search").value.trim();
      const range = document.getElementById("dataset-range-filter")?.value || "all";
      const platform = document.getElementById("dataset-platform-filter").value;
      const model = document.getElementById("dataset-model-filter")?.value || "";

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta";
      const cacheKey = `${range}_${platform}_${model}_${q}_${tz}`;
      if (!force && datasetCache.has(cacheKey)) {
        cachedDatasetPairs = datasetCache.get(cacheKey);
        currentDatasetPage = 1;
        renderDatasetTable();
      }

      try {
        const url = `/api/dataset?format=json&q=${encodeURIComponent(q)}&range=${encodeURIComponent(range)}&platform=${encodeURIComponent(platform)}&model=${encodeURIComponent(model)}&tz=${encodeURIComponent(tz)}&limit=300&_t=${Date.now()}`;
        const res = await fetch(url, {
          headers: { "x-admin-token": token },
        });

        if (res.status === 401) {
          // Lakukan recheck verifikasi sesi sebelum memutuskan sesi hilang
          const recheck = await fetch("/api/admin-otp?action=verify_session", {
            headers: { "x-admin-token": token },
          }).catch(() => null);

          if (recheck && recheck.ok) {
            const recheckData = await recheck.json().catch(() => ({}));
            if (recheckData.valid) {
              console.warn("Transient 401 pada /api/dataset terdeteksi, sesi tetap valid.");
              return;
            }
          }

          triggerSessionExpired("auth_lost");
          return;
        }

        const data = await res.json();
        cachedDatasetPairs = data.pairs || [];
        datasetCache.set(cacheKey, cachedDatasetPairs);
        renderDatasetTable();
      } catch (err) {
        console.error("fetchDataset error:", err);
      }
    }

    function renderDatasetTable() {
      const tbody = document.getElementById("dataset-tbody");
      const infoEl = document.getElementById("dataset-pagination-info");
      const controlsEl = document.getElementById("dataset-pagination-controls");
      if (!tbody) return;

      const total = cachedDatasetPairs.length;
      if (total === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2.5rem;">Tidak ada data percakapan yang cocok dengan filter pencarian.</td></tr>`;
        if (infoEl) infoEl.textContent = "Tidak ada percakapan ditemukan";
        if (controlsEl) controlsEl.innerHTML = "";
        return;
      }

      const totalPages = Math.ceil(total / DATASET_PAGE_SIZE);
      if (currentDatasetPage > totalPages) currentDatasetPage = totalPages;
      if (currentDatasetPage < 1) currentDatasetPage = 1;

      const startIdx = (currentDatasetPage - 1) * DATASET_PAGE_SIZE;
      const endIdx = Math.min(startIdx + DATASET_PAGE_SIZE, total);
      const pageItems = cachedDatasetPairs.slice(startIdx, endIdx);

      tbody.innerHTML = "";
      pageItems.forEach(p => {
        const tr = document.createElement("tr");

        const platformBadge = p.platform === "whatsapp"
          ? `<span class="badge badge-wa">WhatsApp</span>`
          : `<span class="badge badge-tele">Telegram</span>`;

        // Metrik token per chat (Input Prompt, Context total, Output Reply, Total Terpakai)
        const promptTk = Number(p.promptTokens) || Math.max(1, Math.ceil(((p.userPrompt || "")).length / 3.8));
        const outTk = Number(p.completionTokens) || (p.botReply ? Math.max(1, Math.ceil(p.botReply.length / 3.8)) : 0);
        const ctxTk = Number(p.contextTokens) || promptTk;
        const totalTk = Number(p.totalTokens) || (ctxTk + outTk);
        const isRealUsage = p.isRealUsage === true;
        const cleanVia = (p.via || "Router").split('#')[0].trim();
        const usageBadge = isRealUsage
          ? `<span style="font-size: 0.65rem; padding: 1px 5px; border-radius: 4px; background: rgba(56, 189, 248, 0.15); color: var(--accent-cyan); border: 1px solid rgba(56, 189, 248, 0.3); font-family: var(--font-mono); font-weight: 600;" title="Valid: Data token asli tercatat dari respon engine provider API">Real Usage</span>`
          : '';

        tr.innerHTML = `
          <td>
            <div style="font-size: 0.775rem; color: var(--text-muted); font-family: var(--font-mono);">${formatDateTime(p.createdAt)}</div>
            <div style="margin-top: 0.25rem;">${platformBadge}</div>
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-size: 0.775rem; color: var(--text-dim);">${escapeHtml(p.chatIdMasked)}</div>
            <div style="margin-top: 0.2rem; display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;">
              <span class="model-tag">${escapeHtml(cleanVia)}</span>
              ${usageBadge}
            </div>
          </td>
          <td>
            <div style="font-family: var(--font-mono); font-weight: 700; font-size: 0.85rem; color: var(--accent-cyan); display: flex; align-items: center; gap: 0.35rem;">
              <span>${totalTk.toLocaleString("id-ID")}</span>
              <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: normal;">tk</span>
            </div>
            <div style="font-size: 0.7rem; color: var(--text-dim); margin-top: 0.25rem;" title="Input Context: ${ctxTk.toLocaleString('id-ID')} tk | Output Completion: ${outTk.toLocaleString('id-ID')} tk | Total: ${totalTk.toLocaleString('id-ID')} tk${isRealUsage ? ' (Terverifikasi Upstream Engine)' : ''}">
              <span style="color: var(--text-muted);">Ctx:</span> ${ctxTk.toLocaleString("id-ID")} &bull; <span style="color: var(--text-muted);">Out:</span> ${outTk.toLocaleString("id-ID")}
            </div>
          </td>
          <td>
            <div class="dataset-prompt">${escapeHtml(p.userPrompt)}</div>
          </td>
          <td>
            <div class="dataset-reply">${escapeHtml(p.botReply)}</div>
          </td>
          <td style="text-align: right;">
            <button class="btn" style="padding: 0.25rem 0.6rem; font-size: 0.75rem;" data-copy-id="${p.id}">
              Copy
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Update Pagination Text
      if (infoEl) {
        infoEl.textContent = `Menampilkan ${startIdx + 1}–${endIdx} dari ${total} Percakapan (Halaman ${currentDatasetPage} dari ${totalPages})`;
      }

      // Update Pagination Buttons
      if (controlsEl) {
        let paginationHtml = "";

        const prevDisabledAttr = currentDatasetPage <= 1 ? "disabled" : "";
        const prevAction = currentDatasetPage <= 1 ? "" : `data-page="${currentDatasetPage - 1}"`;
        paginationHtml += `<button class="pagination-btn" ${prevDisabledAttr} ${prevAction}>&laquo; Prev</button>`;

        let startPage = Math.max(1, currentDatasetPage - 2);
        let endPage = Math.min(totalPages, startPage + 4);
        if (endPage - startPage < 4) {
          startPage = Math.max(1, endPage - 4);
        }

        if (startPage > 1) {
          paginationHtml += `<button class="pagination-btn" data-page="1">1</button>`;
          if (startPage > 2) {
            paginationHtml += `<span class="pagination-ellipsis">&hellip;</span>`;
          }
        }

        for (let i = startPage; i <= endPage; i++) {
          const activeClass = i === currentDatasetPage ? "active" : "";
          paginationHtml += `<button class="pagination-btn ${activeClass}" data-page="${i}">${i}</button>`;
        }

        if (endPage < totalPages) {
          if (endPage < totalPages - 1) {
            paginationHtml += `<span class="pagination-ellipsis">&hellip;</span>`;
          }
          paginationHtml += `<button class="pagination-btn" data-page="${totalPages}">${totalPages}</button>`;
        }

        const nextDisabledAttr = currentDatasetPage >= totalPages ? "disabled" : "";
        const nextAction = currentDatasetPage >= totalPages ? "" : `data-page="${currentDatasetPage + 1}"`;
        paginationHtml += `<button class="pagination-btn" ${nextDisabledAttr} ${nextAction}>Next &raquo;</button>`;

        controlsEl.innerHTML = paginationHtml;
      }
    }

    function goToDatasetPage(page) {
      currentDatasetPage = page;
      renderDatasetTable();
      const section = document.getElementById("dataset-section");
      if (section) {
        section.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }

    function downloadDataset(format) {
      const token = getStoredToken();
      if (!token) return;

      const q = document.getElementById("dataset-search")?.value.trim() || "";
      const rangeSelect = document.getElementById("dataset-range-filter");
      const range = rangeSelect ? rangeSelect.value : "all";
      const platform = document.getElementById("dataset-platform-filter")?.value || "";
      const model = document.getElementById("dataset-model-filter")?.value || "";
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta";

      const url = `/api/dataset?format=${format}&q=${encodeURIComponent(q)}&range=${encodeURIComponent(range)}&platform=${encodeURIComponent(platform)}&model=${encodeURIComponent(model)}&tz=${encodeURIComponent(tz)}&limit=3000&token=${encodeURIComponent(token)}`;

      const a = document.createElement("a");
      a.href = url;
      const filePrefix = format === "csv" ? "evaluasi_chatbot" : "training_dataset";
      const rangeLabel = range === "today" ? "hari_ini" : range === "all" ? "semua" : range;
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const dateTag = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timeTag = `${pad(now.getHours())}-${pad(now.getMinutes())}`;

      let filterSuffix = "";
      if (platform) filterSuffix += `_${platform}`;
      if (model) filterSuffix += `_${model.replace(/[^a-z0-9_-]/gi, "")}`;

      a.download = `${filePrefix}_${rangeLabel}_${dateTag}_jam_${timeTag}${filterSuffix}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    function escapeHtml(str) {
      if (!str) return "";
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function escapeJs(str) {
      if (!str) return "";
      return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    }

    function copyPromptById(id) {
      const item = cachedDatasetPairs.find(x => x.id === id);
      const text = item ? item.userPrompt : "";
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        alert("Pertanyaan berhasil disalin ke clipboard.");
      }).catch(() => {});
    }

    function toggleAutoRefresh() {
      autoRefresh = !autoRefresh;
      const btn = document.getElementById("btn-auto");
      if (autoRefresh) {
        btn.classList.add("active");
        btn.querySelector("span").textContent = "Auto: 15s";
        refreshTimer = setInterval(() => {
          fetchData();
        }, 15000);
      } else {
        btn.classList.remove("active");
        btn.querySelector("span").textContent = "Auto: Off";
        if (refreshTimer) clearInterval(refreshTimer);
      }
    }

    // =========================================================================
    // EVENT BINDING (CSP-SAFE: replaces every removed inline on* handler)
    // =========================================================================
    function bindDashboardEvents() {
      const on = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
      };

      // Auth gateway controls
      on("link-home-auth", "click", (e) => leaveToHome(e));
      on("link-home-header", "click", (e) => leaveToHome(e));
      on("pin-form", "submit", (e) => handlePinSubmit(e));
      on("btn-open-reset", "click", openResetModal);
      on("btn-send-otp", "click", handleSendOtp);
      on("btn-resend-otp", "click", handleSendOtp);
      on("btn-submit-reset", "click", handleVerifyOtpAndReset);
      on("btn-cancel-reset", "click", closeResetModal);
      on("btn-back-reset", "click", closeResetModal);

      // Header action controls
      on("btn-auto", "click", toggleAutoRefresh);
      on("btn-manual-refresh", "click", () => {
        fetchData(true);
        fetchDataset(true);
      });
      on("btn-logout", "click", handleLogout);

      // Metric pill filters (literal argument carried via data-* attributes)
      document.querySelectorAll("#time-filter-pills [data-range]").forEach((el) => {
        el.addEventListener("click", () => setTimeRange(el.dataset.range));
      });
      document.querySelectorAll("#platform-filter-pills [data-platform]").forEach((el) => {
        el.addEventListener("click", () => setPlatformFilter(el.dataset.platform));
      });
      document.querySelectorAll("#provider-filter-pills [data-provider]").forEach((el) => {
        el.addEventListener("click", () => setProviderFilter(el.dataset.provider));
      });
      document.querySelectorAll("#matrix-time-filters [data-range]").forEach((el) => {
        el.addEventListener("click", () => setMatrixRange(el.dataset.range));
      });

      // Key status dropdown
      on("key-status-filter", "change", (e) => setKeyStatusFilter(e.target.value));

      // Dataset filter controls
      on("dataset-search", "input", debounceDatasetSearch);
      on("dataset-range-filter", "change", () => fetchDataset());
      on("dataset-platform-filter", "change", () => fetchDataset());
      on("dataset-model-filter", "change", () => fetchDataset());
      on("btn-download-csv", "click", () => downloadDataset("csv"));
      on("btn-download-jsonl", "click", () => downloadDataset("jsonl"));

      // Delegated dataset table actions: table rows and pagination markup are
      // injected dynamically, so their inline handlers were replaced with
      // data-* attributes handled here (CSP blocks inline handlers entirely).
      const tbody = document.getElementById("dataset-tbody");
      if (tbody) {
        tbody.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-copy-id]");
          if (!btn) return;
          copyPromptById(Number(btn.dataset.copyId));
        });
      }

      const paginationControls = document.getElementById("dataset-pagination-controls");
      if (paginationControls) {
        paginationControls.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-page]");
          if (!btn || btn.disabled) return;
          goToDatasetPage(Number(btn.dataset.page));
        });
      }
    }

    // =========================================================================
    // SMART STICKY HEADER SCROLL CONTROLLER (HIDE ON SCROLL DOWN, REVEAL ON SCROLL UP)
    // =========================================================================
    (() => {
      let lastScrollY = window.pageYOffset || document.documentElement.scrollTop;
      let ticking = false;
      const scrollThreshold = 8;
      const headerEl = document.querySelector("header");
      if (!headerEl) return;

      function updateHeaderOnScroll() {
        const currentScrollY = window.pageYOffset || document.documentElement.scrollTop;
        const delta = currentScrollY - lastScrollY;

        if (currentScrollY <= 30) {
          // Posisi awal paling atas: selalu tampilkan normal
          headerEl.classList.remove("header-hidden");
          headerEl.classList.remove("header-scrolled");
        } else {
          headerEl.classList.add("header-scrolled");

          if (delta > scrollThreshold && currentScrollY > 80) {
            // Scroll ke bawah: sembunyikan secara halus ke atas
            headerEl.classList.add("header-hidden");
          } else if (delta < -scrollThreshold) {
            // Scroll ke atas: tampilkan kembali secara halus dari atas
            headerEl.classList.remove("header-hidden");
          }
        }

        lastScrollY = Math.max(0, currentScrollY);
        ticking = false;
      }

      window.addEventListener("scroll", () => {
        if (!ticking) {
          window.requestAnimationFrame(updateHeaderOnScroll);
          ticking = true;
        }
      }, { passive: true });
    })();

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    (async () => {
      bindDashboardEvents();
      const isAuthed = await checkSession();
      if (isAuthed) {
        fetchData();
        fetchDataset(true);
        refreshTimer = setInterval(() => {
          fetchData();
          fetchDataset(true);
        }, 15000);
      }
    })();
