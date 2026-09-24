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
    // Sisa percobaan: tulis ke span di dalam baris, dan warnai sesuai sisa.
    // Dipakai dashboard.js supaya ikon di baris itu tidak terhapus.
    function setAttemptsText(text, remaining) {
      const span = document.getElementById("attempts-text");
      if (span) span.textContent = text;
      const box = document.getElementById("attempts-label");
      if (!box) return;
      box.classList.remove("low", "empty");
      if (typeof remaining === "number") {
        if (remaining <= 0) box.classList.add("empty");
        else if (remaining <= 2) box.classList.add("low");
      }
    }

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
            setAttemptsText(`Sisa percobaan: ${data.remaining_attempts} kali`, data.remaining_attempts);
          }
          if (data.is_locked) {
            setAttemptsText("Terkunci 1 menit. Pakai reset lewat email.", 0);
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
        try {
          fetch("/api/admin-otp?action=logout", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-admin-token": token },
            body: JSON.stringify({ action: "logout", session_token: token }),
          }).catch(() => {});
        } catch (_) {}
      }
      clearStoredToken();
      window.location.href = "/";
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
            setAttemptsText("Terkunci. Tunggu sebentar.", 0);
          } else if (data.remaining_attempts !== undefined) {
            setAttemptsText(`Sisa percobaan: ${data.remaining_attempts} kali`, data.remaining_attempts);
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
      // BUG YANG DIPERBAIKI: selector di sini dulu menulis `.matrix-filter-pill`,
      // kelas yang TIDAK PERNAH ada di dashboard.html (markup-nya memakai
      // `.pill-filter-btn`). querySelectorAll karena itu selalu mengembalikan
      // daftar kosong, sehingga tombol di bagian "Distribusi Model LLM" tidak
      // pernah menerima kelas `active` — data ikut berubah saat rentang diganti,
      // tetapi tombol yang tersorot tetap "Hari ini". Diverifikasi: kelas
      // `.matrix-filter-pill` muncul 2x di JS ini, 0x di HTML, 4x di CSS.
      document.querySelectorAll("#matrix-time-filters .pill-filter-btn").forEach(btn => {
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
      if (btnIcon) btnIcon.classList.add("spinning");

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
        const prev = statsCache.get(cacheKey);
        statsCache.set(cacheKey, data);
        cachedDashboardData = data;
        // Hindari rebuild DOM ganda tiap tick 15 dtk: render ulang hanya bila
        // payload benar-benar berubah (audit P-4).
        if (!prev || JSON.stringify(prev) !== JSON.stringify(data)) {
          renderDashboard(data);
        }
      } catch (err) {
        console.error("Gagal mengambil metrik:", err);
      } finally {
        if (btnIcon) btnIcon.classList.remove("spinning");
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

      // Waktu sinkron terakhir. Satu sumber dengan header supaya tidak ada dua
      // timestamp berbeda di satu layar (temuan verifikasi visual).
      (function () {
        var st = document.getElementById("sync-time");
        if (st) st.textContent = formatTime(data.serverTime) + " WIB";
      })();

      // KPI Titles & Values
      document.getElementById("kpi-title-msgs").textContent = `Pesan (${rangeLabel})`;
      document.getElementById("kpi-today-msgs").textContent = (data.summary.totalMessagesPeriod ?? data.summary.totalMessagesToday ?? 0).toLocaleString();
      document.getElementById("kpi-total-msgs").textContent = (data.summary.totalMessagesAllTime ?? 0).toLocaleString();
      document.getElementById("kpi-wa").textContent = (data.summary.whatsappPeriod ?? data.summary.whatsappToday ?? 0) + " WA";
      document.getElementById("kpi-tele").textContent = (data.summary.telegramPeriod ?? data.summary.telegramToday ?? 0) + " Telegram";

      document.getElementById("kpi-title-calls").textContent = `Panggilan & Token API (${rangeLabel})`;
      const totalCalls = data.summary.totalCallsPeriod ?? data.summary.totalCallsToday ?? 0;
      const totalTokens = data.summary.totalTokensPeriod ?? 0;
      document.getElementById("kpi-calls-today").textContent = totalCalls.toLocaleString("id-ID") + " panggilan";
      document.getElementById("kpi-total-keys").textContent = `${formatTokens(totalTokens)} \u2022 ${data.summary.totalKeys} kunci terpantau`;

      document.getElementById("kpi-title-model").textContent = `Model Terpopuler (${rangeLabel})`;
      const topModel = data.modelsBreakdown && data.modelsBreakdown.length > 0
        ? data.modelsBreakdown[0].name
        : "Menunggu panggilan";
      document.getElementById("kpi-top-model").textContent = topModel;

      // Pool reset label
      const poolReset = document.getElementById("pool-reset-label");
      if (poolReset) {
        if (data.range === "today") poolReset.textContent = "Reset: 00:00 UTC (xKiro, OpenRouter, Groq, Cloudflare, Dahl) \u2022 00:00 PT (Gemini)";
        else poolReset.textContent = `Akumulasi Periode ${rangeLabel}`;
      }

      // Dynamic Section Titles
      const modelsH = document.getElementById("models-section-title");
      if (modelsH) modelsH.textContent = `Distribusi Model LLM (${rangeLabel})`;
      const mediaH = document.getElementById("media-section-title");
      if (mediaH) mediaH.textContent = `Pemrosesan Tipe Media (${rangeLabel})`;

      // Label rentang yang ikut berubah. Sebelumnya ketiga label ini ditulis
      // "hari ini" di HTML tanpa id, sehingga saat rentang diganti ke 7/14/30
      // hari teksnya tetap berbunyi "hari ini" — padahal angkanya sudah
      // menampilkan periode lain.
      const rangeWord = data.range === "today" ? "hari ini" : rangeLabel.toLowerCase();
      const labelUsed = document.getElementById("upstream-label-used");
      if (labelUsed) labelUsed.textContent = `Token terpakai ${rangeWord}`;
      const thPakai = document.getElementById("th-pemakaian");
      if (thPakai) thPakai.textContent = `Pemakaian ${rangeWord}`;
      const thSisa = document.getElementById("th-sisa");
      if (thSisa) thSisa.textContent = `Sisa kuota ${rangeWord}`;

      // Badge versi diambil dari package.json lewat API, bukan ditulis di HTML:
      // versi yang di-hardcode mudah tertinggal setiap kali rilis, dan dashboard
      // yang menampilkan versi lama membuat pemilik ragu apakah deploy berhasil.
      const versionBadge = document.querySelector(".brand-badge-version");
      if (versionBadge && data.version) versionBadge.textContent = "v" + data.version;

      // Render Pools Matrix, Dedicated Token Quota Matrix & AI Model Router Matrix
      renderPoolMatrix(data);
      renderLiveUpstreamTable(data);
      renderWebSearchPanel(data);
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
      setTimeout(initDashboardScrollReveal, 60);
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

      // Sinkronkan active state filter waktu (selector harus `.pill-filter-btn`;
      // versi lama menulis `.matrix-filter-pill` yang tidak ada di markup,
      // sehingga tombol tidak pernah tersorot — lihat catatan di setTimeRange).
      document.querySelectorAll("#matrix-time-filters .pill-filter-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-range") === currentTimeRange);
      });

      // Pemetaan frekuensi pemanggilan model dari database
      const countMap = new Map();
      modelsBreakdown.forEach(m => {
        const rawName = (m.name || "").toLowerCase();
        countMap.set(rawName, m.count || 0);
      });

      /**
       * Hitung pemakaian model dari data DB.
       *
       * PENTING — bug lama: pencocokan dua arah (`name.includes(key) || key.includes(name)`)
       * terlalu longgar. Dengan data nyata hanya 3 entri (9x qwen3.8-max, 1x nex, 1x reset),
       * SEMUA kartu menampilkan "9x" karena key pendek seperti "qwen3.8-max" dianggap cocok
       * dengan nama model apa pun yang mengandungnya — termasuk yang tidak berhubungan.
       *
       * Aturan baru: cocokkan dari key PALING SPESIFIK (terpanjang) dan utamakan kecocokan
       * penuh nama model (setelah normalisasi namespace provider). Kecocokan longgar hanya
       * dipakai bila tidak ada kecocokan spesifik sama sekali.
       */
      function getCount(matchKeys) {
        // Normalisasi: buang prefiks provider + suffix ":free" agar "xkiro/qwen/qwen3.8-max:free"
        // setara dengan "qwen/qwen3.8-max".
        const norm = (s) => String(s).toLowerCase()
          .replace(/^(xkiro|openrouter|groq|cloudflare|gemini|dahl)\//, '')
          .replace(/^@cf\//, '')
          .replace(/:free$/, '')
          .trim();
        const normEntries = [...countMap.entries()].map(([n, c]) => [norm(n), c]);

        // Urutkan key dari terpanjang (paling spesifik) ke terpendek.
        const sortedKeys = [...matchKeys].map((k) => k.toLowerCase()).sort((a, b) => b.length - a.length);

        for (const key of sortedKeys) {
          const nk = norm(key);
          // 1) Kecocokan PERSIS (paling akurat) — mis. "qwen/qwen3.8-max" === "qwen/qwen3.8-max".
          const exact = normEntries.find(([n]) => n === nk);
          if (exact) return exact[1];
          // 2) Kecocokan penuh nama model terhadap key (name mengandung key) — hanya bila
          //    key cukup spesifik (>= 12 char) agar tidak menyerap model lain.
          if (nk.length >= 12) {
            const hit = normEntries.find(([n]) => n.includes(nk));
            if (hit) return hit[1];
          }
        }
        return 0;
      }

      // Katalog model router multi-tier.
      // SINKRONISASI: setiap entri wajib punya `matchKeys` yang merujuk model NYATA di
      // config sistem (src/env.ts). Diverifikasi otomatis oleh
      // scratch/verify_v50_model_catalog.mjs — jangan tambah entri tanpa model di config.
      const catalog = [
        // --- Tier 1: xKiro Gateway (Primer Teks Runtime, TERKUNCI Qwen saja) ---
        {
          name: "Qwen 3.8 Max Free",
          provider: "XKIRO",
          tagClass: "tag-xkiro",
          capabilities: ["Text", "Reasoning", "Vision", "Fast Latency"],
          desc: "Prioritas #1 Tier 1 - Primer teks Qwen 3.8 Max (free), latensi ~0,15s via xKiro Gateway; vision prioritas #8 rantai multimodal",
          matchKeys: ["xkiro/qwen/qwen3.8-max:free", "qwen/qwen3.8-max:free", "qwen3.8-max"],
        },
        {
          name: "Qwen 3.8 Omni Flash Free",
          provider: "XKIRO",
          tagClass: "tag-xkiro",
          capabilities: ["Vision", "Multimodal"],
          desc: "Vision prioritas #11 (jaring terakhir) - Model omni xKiro terbaru. Uji 22 Sep pada 10 stiker nyata: benar saat berhasil, tapi tidak andal (2/5 pada gambar baru, sisanya timeout) sehingga sengaja ditaruh paling akhir",
          matchKeys: ["xkiro/qwen/qwen3.8-omni-flash:free", "qwen/qwen3.8-omni-flash:free", "qwen3.8-omni-flash"],
        },
        {
          name: "Qwen 3 VL Plus Free",
          provider: "XKIRO",
          tagClass: "tag-xkiro",
          capabilities: ["Vision", "Multimodal"],
          desc: "Vision prioritas #9 - Model visual khusus xKiro. Uji 22 Sep: terbaca benar (Upin & Ipin), rata-rata 5,3s pada gambar baru",
          matchKeys: ["xkiro/qwen/qwen3-vl-plus:free", "qwen/qwen3-vl-plus:free", "qwen3-vl-plus"],
        },
        {
          name: "Qwen 3.5 Omni Flash Free",
          provider: "XKIRO",
          tagClass: "tag-xkiro",
          capabilities: ["Vision", "Multimodal"],
          desc: "Vision prioritas #10 - Generasi omni sebelumnya, terbukti andal. Uji 22 Sep: terbaca benar, rata-rata 10,2s pada gambar baru",
          matchKeys: ["xkiro/qwen/qwen3.5-omni-flash:free", "qwen/qwen3.5-omni-flash:free", "qwen3.5-omni-flash"],
        },
        {
          name: "Qwen 3.6 Max Preview Free",
          provider: "XKIRO",
          tagClass: "tag-xkiro",
          capabilities: ["Text", "Reasoning", "Backup"],
          desc: "Cadangan #1 Tier 1 xKiro - uji lanjutan 3/3 lolos (0 pelanggaran), latensi 3,6s; dipercepat sebagai backup utama",
          matchKeys: ["xkiro/qwen/qwen3.6-max-preview:free", "qwen/qwen3.6-max-preview:free", "qwen3.6-max-preview"],
        },
        {
          name: "Qwen 3.7 Max Free",
          provider: "XKIRO",
          tagClass: "tag-xkiro",
          capabilities: ["Text", "Reasoning", "Backup"],
          desc: "Cadangan #2 Tier 1 xKiro - uji lanjutan 3/3 lolos (0 pelanggaran), latensi 3,0s",
          matchKeys: ["xkiro/qwen/qwen3.7-max:free", "qwen/qwen3.7-max:free", "qwen3.7-max"],
        },
        // --- Tier 2: Cloudflare Workers AI (Qwen 3.8 27B) ---
        {
          name: "Qwen 3.8 27B (CF)",
          provider: "CLOUDFLARE",
          tagClass: "tag-cloudflare",
          capabilities: ["Text", "Reasoning", "Vision"],
          desc: "Prioritas #1 Tier 2 - Primer teks Cloudflare Workers AI; uji lanjutan P2 & P4 lolos (P3 gagal: jawab 12 jam utk soal 6 jam - dicatat sebagai kelemahan yang diterima)",
          matchKeys: ["cloudflare/@cf/qwen/qwen3.8-27b", "@cf/qwen/qwen3.8-27b", "cf/qwen/qwen3.8-27b"],
        },
        {
          name: "Nemotron 3 120B A12B (CF)",
          provider: "CLOUDFLARE",
          tagClass: "tag-cloudflare",
          capabilities: ["Text", "Reasoning", "Fast"],
          desc: "Cadangan #1 Tier 2 - uji lanjutan 3/3 lolos (0 pelanggaran), 891ms = tercepat di CF setelah primary",
          matchKeys: ["cloudflare/@cf/nvidia/nemotron-3-120b-a12b", "@cf/nvidia/nemotron-3-120b-a12b", "nemotron-3-120b"],
        },
        {
          name: "GPT-OSS 20B (CF)",
          provider: "CLOUDFLARE",
          tagClass: "tag-cloudflare",
          capabilities: ["Text", "Reasoning"],
          desc: "Cadangan #2 Tier 2 - uji lanjutan 3/3 lolos (0 pelanggaran), 1227ms",
          matchKeys: ["cloudflare/@cf/openai/gpt-oss-20b", "@cf/openai/gpt-oss-20b", "gpt-oss-20b"],
        },
        {
          name: "Llama 4 Scout 17B (CF)",
          provider: "CLOUDFLARE",
          tagClass: "tag-cloudflare",
          capabilities: ["Vision", "Multimodal", "Fast"],
          desc: "Vision prioritas #2 - uji gambar 2 blok BENAR dalam 716ms = TERCEPAT di seluruh rantai vision Cloudflare",
          matchKeys: ["cloudflare/@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/meta/llama-4-scout-17b-16e-instruct", "llama-4-scout"],
        },
        {
          name: "Mistral Small 3.1 24B (CF)",
          provider: "CLOUDFLARE",
          tagClass: "tag-cloudflare",
          capabilities: ["Vision", "Multimodal"],
          desc: "Vision prioritas #3 - uji gambar 2 blok BENAR dalam 2151ms",
          matchKeys: ["cloudflare/@cf/mistralai/mistral-small-3.1-24b-instruct", "@cf/mistralai/mistral-small-3.1-24b-instruct", "mistral-small-3.1"],
        },
        // --- Tier 3: Groq Cloud API (LPU Inference Engine) ---
        {
          name: "Qwen 3.8 27B",
          provider: "GROQ",
          tagClass: "tag-groq",
          capabilities: ["Text", "Reasoning", "Vision", "LPU Speed"],
          desc: "Prioritas #1 Tier 3 - 370ms = TERCEPAT dari seluruh 89 model yang diuji (uji lanjutan 3/3 lolos, 0 pelanggaran); vision prioritas #1 rantai multimodal",
          matchKeys: ["groq/qwen/qwen3.8-27b", "groq/qwen3.8", "qwen/qwen3.8-27b", "qwen3.8-27b"],
        },
        {
          name: "GPT-OSS 120B",
          provider: "GROQ",
          tagClass: "tag-groq",
          capabilities: ["Text", "Reasoning", "LPU Speed"],
          desc: "Prioritas #2 Tier 3 - Penalaran kuat GPT-OSS 120B di LPU Groq (jalur teks)",
          matchKeys: ["groq/openai/gpt-oss-120b", "openai/gpt-oss-120b", "gpt-oss-120b"],
        },
        {
          name: "Groq Whisper Turbo",
          provider: "GROQ",
          tagClass: "tag-groq",
          capabilities: ["Voice Note (VN)"],
          desc: "Transkripsi Voice Note audio sub-detik ~500ms",
          matchKeys: ["whisper-large-v3-turbo", "whisper-large-v3", "whisper", "groq/whisper"],
        },
        // --- Tier 4: OpenRouter AI (Free Models) ---
        {
          name: "Nex N2.5 Mini Free",
          provider: "OPENROUTER",
          tagClass: "tag-openrouter",
          capabilities: ["Text", "Reasoning", "Fast"],
          desc: "Prioritas #1 Tier 4 - Primer teks OpenRouter; uji lanjutan 3/3 lolos (0 pelanggaran), 506ms = TERCEPAT di katalog OpenRouter",
          matchKeys: ["openrouter/nex-agi/nex-n2.5-mini:free", "nex-agi/nex-n2.5-mini:free", "nex-n2.5-mini"],
        },
        {
          name: "Ling 3.0 Flash Fin Free",
          provider: "OPENROUTER",
          tagClass: "tag-openrouter",
          capabilities: ["Text", "Reasoning", "Finance"],
          desc: "Cadangan #1 Tier 4 - uji lanjutan 3/3 lolos (0 pelanggaran), 1041ms; spesialis domain finansial",
          matchKeys: ["openrouter/inclusionai/ling-3.0-flash-fin:free", "inclusionai/ling-3.0-flash-fin:free", "ling-3.0-flash-fin"],
        },
        // Catatan: parser PDF OpenRouter (plugin file-parser) tetap aktif di kode media.ts
        // tetapi BUKAN model katalog -- model :free deepseek-v4-flash-0731 sudah tidak ada.
        // --- Tier 5: Dahl Global API (1 Miliar Token Pool) ---
        {
          name: "DeepSeek V4 Flash 0731",
          provider: "DAHL",
          tagClass: "tag-dahl",
          capabilities: ["Fast Reasoning", "Text", "Code"],
          desc: "Prioritas #1 Tier 5 - SOTA Reasoning kilat & 1 Miliar Token Pool; uji lanjutan: sempat 429 saat concurrency penuh (dicatat)",
          matchKeys: ["dahl/deepseek-ai/deepseek-v4-flash-0731", "deepseek-ai/deepseek-v4-flash-0731"],
        },
        // CATATAN: GLM-5.3-Flash & MiniMax-M2.7 DIHAPUS dari katalog 21 Sep -- uji lanjutan
        // membuktikan keduanya tidak layak (GLM: KOSONG 27,6 dtk; MiniMax: bocorkan <think>).
        // Dahl kini 1 model teks; bila gagal, rantai langsung failover ke Gemini.
        // --- Tier 6: Google Gemini API (1M Konteks) ---
        {
          name: "Gemini 3.8 Flash",
          provider: "GEMINI",
          tagClass: "tag-gemini",
          capabilities: ["Text", "Reasoning", "PDF & Video"],
          desc: "Prioritas #1 Tier 6 - Primer teks & dokumen/video native (1M konteks); dikecualikan dari rantai foto karena hang saat menerima gambar",
          matchKeys: ["gemini/gemini-3.8-flash", "gemini-3.8-flash"],
        },
        {
          name: "Gemini 3.6 Flash",
          provider: "GEMINI",
          tagClass: "tag-gemini",
          capabilities: ["Vision", "PDF & Video", "Audio VN"],
          desc: "Vision prioritas #6 - Vision native, PDF, video & audio (1M konteks)",
          matchKeys: ["gemini/gemini-3.6-flash", "gemini-3.6-flash"],
        },
        {
          name: "Gemini 2.5 Flash",
          provider: "GEMINI",
          tagClass: "tag-gemini",
          capabilities: ["Vision", "PDF & Video", "Audio VN"],
          desc: "Vision prioritas #8 - Vision native stabil, cadangan terakhir jalur Gemini",
          matchKeys: ["gemini/gemini-2.5-flash", "gemini-2.5-flash"],
        },
        {
          name: "Gemini 3.1 Flash Lite",
          provider: "GEMINI",
          tagClass: "tag-gemini",
          capabilities: ["Vision", "PDF & Video", "Audio VN", "Fast"],
          desc: "Cadangan #1 Tier 6 + vision prioritas #5 - uji 3/3 lolos, 1106ms teks / 1213ms gambar / 3429ms PDF",
          matchKeys: ["gemini/gemini-3.1-flash-lite", "gemini-3.1-flash-lite"],
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

        const providerKey = (c.provider || "").toLowerCase();

        return `
          <div class="${cardClass}" data-provider="${providerKey}">
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
            // Metrik BINDING: mana yang lebih dulu habis (RPD panggilan vs TPD token).
            // Bar & warna memakai metrik binding agar konsisten dengan badge status —
            // sebelumnya bar bisa 22% (panggilan) padahal key sudah CAPPED karena token 100%.
            const hasTokenCap = (k.tokenCap || 0) > 0 && (k.tokensUsed || 0) > 0;
            const bindingPct = typeof k.bindingPercent === "number" ? k.bindingPercent : Math.max(k.percent || 0, k.tokenPercent || 0);
            const bindingIsToken = (k.bindingMetric === "tokens") || (!k.bindingMetric && (k.tokenPercent || 0) > (k.percent || 0));

            let progressColor = "progress-emerald";
            if (k.status === "capped" || bindingPct >= 100) progressColor = "progress-rose";
            else if (k.status === "warning" || bindingPct >= 80) progressColor = "progress-amber";

            const statusLabel = k.status === "capped" ? "Capped" : k.status === "warning" ? "Waspada" : "Optimal";
            const cleanSuffix = k.suffix.startsWith("...") ? k.suffix : "..." + k.suffix;
            const capLabel = k.cap > 0 ? `${k.used.toLocaleString("id-ID")} / ${k.cap.toLocaleString("id-ID")} panggilan (${k.percent}%)` : `${k.used.toLocaleString()} calls`;

            // Baris kedua: info TOKEN bila provider punya batas token (xKiro/Dahl/Groq).
            // Inilah yang membuat dashboard jujur: key ...6386 tampil "112/500 panggilan (22%)"
            // SEKALIGUS "1.004.173 / 1.000.000 token (100%)" — tidak lagi menyesatkan.
            // Limit diambil dari endpoint provider (v0.49) — ditandai "live" atau "dokumentasi".
            let tokenLine = "";
            if (k.officialLimitLabel) {
              const srcTag = k.limitIsLive
                ? '<span style="color: #34d399;"> • limit live dari endpoint</span>'
                : '<span style="color: #fbbf24;"> • limit dari dokumentasi resmi</span>';
              tokenLine += `<div style="font-size: 0.66rem; color: var(--text-dim); margin-top: 2px;">Batas resmi: ${escapeHtml(k.officialLimitLabel)}${srcTag}</div>`;
            }
            if (hasTokenCap) {
              const tokenPct = k.tokenPercent || 0;
              const tokenColor = tokenPct >= 100 ? "#fb7185" : tokenPct >= 80 ? "#fbbf24" : "#34d399";
              // Angka saja sulit dibaca sekilas ("178.330 / 200.000 token (89%)"),
              // jadi ditambah bar tipis di bawah teks: panjangnya menunjukkan
              // porsi terpakai, warnanya mengikuti ambang yang sama dengan angka.
              tokenLine = `<div class="key-token-line">
                <div class="key-token-head">
                  <span class="key-token-label">Token</span>
                  <span style="color: ${tokenColor};">${(k.tokensUsed || 0).toLocaleString("id-ID")} / ${(k.tokenCap || 0).toLocaleString("id-ID")} (${tokenPct}%)</span>
                  ${bindingIsToken && bindingPct >= 80 ? '<span class="key-token-binding">BATAS TOKEN</span>' : ""}
                </div>
                <div class="key-token-bar" role="img" aria-label="Pemakaian token ${tokenPct} persen">
                  <span style="width: ${Math.min(100, tokenPct)}%; background: ${tokenColor};"></span>
                </div>
              </div>`;
            } else if ((k.cap || 0) > 0) {
              // Provider tanpa batas token (Cloudflare, Gemini, OpenRouter) hanya
              // punya batas panggilan. Sebelumnya mereka tampil tanpa baris
              // terukur sama sekali, sehingga bar hanya terlihat di xKiro/Dahl.
              // Sekarang setiap kunci punya baris bar: panggilan bila token tidak
              // dibatasi, token bila dibatasi — jadi semua provider konsisten.
              const callPct = Math.min(100, k.percent || 0);
              const callColor = callPct >= 100 ? "#fb7185" : callPct >= 80 ? "#fbbf24" : "#34d399";
              tokenLine = `<div class="key-token-line">
                <div class="key-token-head">
                  <span class="key-token-label">Panggilan</span>
                  <span style="color: ${callColor};">${(k.used || 0).toLocaleString("id-ID")} / ${(k.cap || 0).toLocaleString("id-ID")} (${k.percent || 0}%)</span>
                  ${!bindingIsToken && bindingPct >= 80 ? '<span class="key-token-binding">BATAS PANGGILAN</span>' : ""}
                </div>
                <div class="key-token-bar" role="img" aria-label="Pemakaian panggilan ${k.percent || 0} persen">
                  <span style="width: ${callPct}%; background: ${callColor};"></span>
                </div>
              </div>`;
            }

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
                  <div class="progress-bar-fill ${progressColor}" style="width: ${Math.min(100, bindingPct)}%"></div>
                </div>
                ${tokenLine}
              </div>
            `;
          });
        }

        // Angka utama = pemakaian HARIAN (cap provider bersifat harian). Saat rentang
        // bukan "hari ini", akumulasi periode ditampilkan sebagai info sekunder agar
        // tidak tertukar dengan kuota harian (temuan user pada filter "Semua").
        const usedValue = p.usedTodayDaily ?? p.usedToday ?? p.usedPeriod ?? 0;
        const usedPeriodValue = p.usedPeriod ?? usedValue;
        const showPeriodInfo = usedPeriodValue > usedValue;
        const capInfo = p.totalCap > 0 ? `Batas: ${p.totalCap.toLocaleString("id-ID")} panggilan` : "Uncapped";
        // Konteks token pada header kartu: provider yang dibatasi TOKEN (xKiro/Dahl/Groq)
        // tidak boleh hanya menampilkan panggilan — pengguna perlu tahu batas mana yang mengikat.
        const hasTokenContext = (p.totalTokenCap || 0) > 0 && (p.totalTokensUsed || 0) > 0;
        const providerTokenPct = p.tokenPercent || 0;
        const providerTokenColor = providerTokenPct >= 100 ? "#fb7185" : providerTokenPct >= 80 ? "#fbbf24" : "#34d399";
        const tokenContextHtml = hasTokenContext
          ? `<div class="provider-token-block">
              <div class="provider-token-head">
                <span class="provider-token-label">Pemakaian token</span>
                <span style="color: ${providerTokenColor};">${formatTokens(p.totalTokensUsed)} / ${formatTokens(p.totalTokenCap)} (${providerTokenPct}%)</span>
              </div>
              <div class="provider-token-bar" role="img" aria-label="Pemakaian token provider ${providerTokenPct} persen">
                <span style="width: ${Math.min(100, providerTokenPct)}%; background: ${providerTokenColor};"></span>
              </div>
              ${p.cappedKeys > 0 ? `<div class="provider-token-note">${p.cappedKeys} kunci sudah habis kuotanya</div>` : ""}
            </div>`
          : "";
        // Kalau hari ini belum ada pemakaian tapi provider ini pernah dipakai,
        // sebutkan kapan. Tanpa ini, "0" terbaca seperti data rusak.
        const lastUsedLabel = (() => {
          if (usedValue > 0 || !p.lastUsedAt) return "";
          const d = new Date(p.lastUsedAt);
          if (isNaN(d.getTime())) return "";
          const now = new Date();
          const sameYear = d.getFullYear() === now.getFullYear();
          const fmt = d.toLocaleDateString("id-ID", sameYear
            ? { day: "numeric", month: "short" }
            : { day: "numeric", month: "short", year: "numeric" });
          const jam = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
          return `<div class="provider-last-used">Terakhir dipakai ${escapeHtml(fmt)}, ${escapeHtml(jam)}</div>`;
        })();

        const providerLiveBadge = p.isLiveSynced
          ? `<span class="badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; font-size: 0.68rem; font-weight: 700; border: 1px solid rgba(56, 189, 248, 0.25); padding: 2px 7px; border-radius: 9999px; margin-left: 6px;">● Live Remote Sync</span>`
          : "";

        // Kalau kuncinya banyak (Dahl 10), daftar dibatasi tingginya dan bisa digulir
        // supaya kartu tidak memanjang ke bawah. Tombol lipat membuka daftar penuh.
        const collapsible = filteredKeys.length > 4;
        const listClass = collapsible ? "keys-list keys-list-scroll" : "keys-list";
        const toggleHtml = collapsible
          ? `<button type="button" class="keys-toggle" data-toggle-keys aria-expanded="false">
               <span>Lihat semua ${filteredKeys.length} kunci</span>
               <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M3 5.5L7 9.5l4-4"/></svg>
             </button>`
          : "";

        // Warna penyedia sebagai penanda: penyedia yang sama selalu dikenali
        // dari warnanya, di kartu ini maupun di halaman lain.
        card.dataset.provider = p.kind;

        card.innerHTML = `
          <div class="provider-header">
            <div>
              <div class="provider-name" style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                <span class="provider-dot" aria-hidden="true"></span>
                <span>${escapeHtml(p.displayName)}</span>
                ${providerLiveBadge}
              </div>
              ${lastUsedLabel}
            </div>
            <div class="provider-summary-stat">
              <div class="provider-usage-text">${usedValue.toLocaleString()} Calls</div>
              <div class="provider-cap-text">${typeof p.keyCount === "number" ? p.keyCount : (p.keys || []).length} kunci &bull; ${capInfo}</div>
              ${showPeriodInfo ? `<div style="font-size: 0.66rem; color: var(--text-dim); margin-top: 1px;">Hari ini • ${usedPeriodValue.toLocaleString()} total periode</div>` : ""}
              ${tokenContextHtml}
            </div>
          </div>
          <div class="${listClass}">
            ${keysHtml}
          </div>
          ${toggleHtml}
        `;
        poolGrid.appendChild(card);

        // Tombol lipat: buka/tutup daftar kunci penuh.
        const toggleBtn = card.querySelector("[data-toggle-keys]");
        if (toggleBtn) {
          toggleBtn.addEventListener("click", () => {
            const list = card.querySelector(".keys-list");
            const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
            const next = !expanded;
            toggleBtn.setAttribute("aria-expanded", next ? "true" : "false");
            list.classList.toggle("keys-list-scroll", !next);
            const label = toggleBtn.querySelector("span");
            if (label) label.textContent = next ? "Ringkas daftar kunci" : `Lihat semua ${filteredKeys.length} kunci`;
          });
        }
      });
    }

    /**
 * Panel pemakaian WEB SEARCH xKiro.
 *
 * Kenapa panel terpisah: web search memakai kuota yang TERPISAH dari kuota token
 * (10 pencarian per kunci per hari, diukur langsung dari respons provider —
 * kunci membalas 429 pada pencarian ke-11). Karena itu ia tidak bisa dibaca dari
 * angka token; tanpa panel ini jatah pencarian bisa habis tanpa terlihat.
 *
 * Semua angka di sini berasal dari `webSearch` di /api/stats, yang diturunkan
 * dari penghitung runtime + status kunci yang sedang kehabisan kuota. Tidak ada
 * angka yang dikarang: bila data belum ada, panel menampilkan tanda pisah.
 */
function renderWebSearchPanel(data) {
  const panel = document.getElementById("websearch-panel");
  if (!panel) return;

  const ws = data && data.webSearch;
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  if (!ws || typeof ws !== "object") {
    setText("websearch-sub", "Data belum tersedia");
    setText("websearch-used", "–");
    setText("websearch-remaining", "–");
    setText("websearch-keys", "–");
    setText("websearch-cap", "–");
    return;
  }

  const capTotal = ws.capTotal || 0;
  // Pemakaian diambil dari angka DATABASE (persisten), bukan penghitung
  // in-memory: di serverless setiap request bisa dilayani instance baru yang
  // penghitungnya mulai dari 0, sehingga "terpakai" akan selalu terbaca 0.
  const used = typeof ws.usedToday === "number" ? ws.usedToday : null;
  const usedPct = used !== null && capTotal > 0
    ? Math.min(100, Math.round((used / capTotal) * 100))
    : (ws.usedPercent || 0);
  const remaining = typeof ws.remainingToday === "number" ? ws.remainingToday : Math.max(0, capTotal - (used || 0));
  const keysTotal = ws.keysTotal || 0;
  const keysAvailable = typeof ws.keysAvailable === "number" ? ws.keysAvailable : keysTotal;
  const cooling = ws.keysCoolingDown || 0;

  // Warna bar mengikuti TINGKAT PEMAKAIAN dengan ambang yang SAMA di seluruh
  // dashboard (bar token per kunci, bar token provider, dan bar web search):
  //   < 80%   hijau  (masih lega)
  //   >= 80%  kuning (menipis, siapkan cadangan)
  //   >= 100% merah  (habis)
  // Ambang seragam penting: sebelumnya bar web search memakai 50/80, sehingga
  // kuning di satu tempat berarti beda dengan kuning di tempat lain.
  const barColor = usedPct >= 100 ? "#fb7185" : usedPct >= 80 ? "#fbbf24" : "#34d399";
  const fill = document.getElementById("websearch-bar-fill");
  const bar = fill ? fill.parentElement : null;
  if (fill) {
    fill.style.width = usedPct + "%";
    fill.style.background = barColor;
  }
  // Pembaca layar tidak bisa "melihat" panjang bar, jadi nilainya diberikan
  // sebagai atribut: role progressbar + valuenow/min/max.
  if (bar) {
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuenow", String(used === null ? usedPct : used));
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(capTotal));
    bar.setAttribute("aria-valuetext", `${used} dari ${capTotal} pencarian terpakai (${usedPct}%)`);
    bar.setAttribute("aria-label", "Pemakaian jatah web search hari ini");
  }

  // Bar diberi label "terpakai" + persen eksplisit: tanpa persen, pengguna tetap
  // harus menghitung sendiri, dan bar jadi hiasan bukan informasi.
  // Bila angka pemakaian tidak tersedia (DB tidak terbaca), tampilkan tanda
  // pisah — bukan 0. Angka 0 yang salah lebih menyesatkan daripada tanda pisah.
  setText("websearch-used", used === null ? "–" : used.toLocaleString("id-ID"));
  setText("websearch-used-note", used === null
    ? `dari ${capTotal.toLocaleString("id-ID")} pencarian`
    : `dari ${capTotal.toLocaleString("id-ID")} pencarian • ${usedPct}% terpakai`);
  setText("websearch-remaining", remaining.toLocaleString("id-ID"));
  setText("websearch-remaining-note", used === null
    ? `${Math.max(0, 100 - usedPct)}% jatah tersisa (perkiraan dari kunci siap pakai)`
    : `${Math.max(0, 100 - usedPct)}% jatah masih tersisa`);
  setText("websearch-keys", `${keysAvailable} / ${keysTotal}`);
  setText("websearch-cap", (ws.capPerKey || 0).toLocaleString("id-ID"));

  // Subjudul menjelaskan KENAPA angka bisa rendah: kunci yang kehabisan kuota
  // dinonaktifkan 1 jam lalu aktif sendiri, jadi ini keadaan sementara.
  // Waktu pemulihan dihitung SEKALI di sini lalu dipakai di subjudul dan catatan
  // kaki. Sebelumnya kedua tempat menyebut waktu dengan gaya berbeda ("dalam 1 jam"
  // vs "sekitar 17.34"), sehingga pembaca mengira itu dua kejadian berbeda.
  const nextAt = ws.nextRecoveryAt ? new Date(ws.nextRecoveryAt) : null;
  const jamPulih = nextAt && !isNaN(nextAt.getTime())
    ? nextAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
    : null;

  const sub = document.getElementById("websearch-sub");
  if (sub) {
    if (cooling > 0) {
      sub.textContent = jamPulih
        ? `${cooling} dari ${keysTotal} kunci sedang kehabisan kuota — kunci pertama aktif lagi sekitar pukul ${jamPulih}`
        : `${cooling} dari ${keysTotal} kunci sedang kehabisan kuota, aktif lagi otomatis`;
    } else {
      sub.textContent = "Pencarian dicoba lewat xKiro lebih dulu, mesin cadangan dipakai bila jatah habis";
    }
  }

  // Catatan kunci cukup menyebut APA yang terjadi pada kunci itu; jumlah kunci
  // istirahat sudah disebut di subjudul, jadi tidak diulang lagi di sini.
  const keysNote = document.getElementById("websearch-keys-note");
  if (keysNote) {
    keysNote.textContent = cooling > 0 ? "sisanya istirahat sementara" : "semua kunci tersedia";
  }

  const foot = document.getElementById("websearch-foot");
  if (foot) {
    // Catatan ini menyebut SUMBER angka, supaya pemilik produk tahu seberapa
    // jauh ia bisa mempercayainya: pemakaian dari database (bertahan lintas
    // instance), jumlah kunci dari respons nyata provider.
    // Sebut SUMBER angkanya: pemilik produk perlu tahu seberapa jauh angka ini
    // bisa dipercaya. Angka langsung dari provider lebih akurat daripada hitungan
    // kita sendiri (yang bisa terlewat saat instance serverless berbeda).
    const sumber = ws.usedSource === "provider"
      ? "Angka diambil langsung dari laporan penyedia di setiap pencarian, jadi paling akurat."
      : "Penyedia belum melaporkan sisanya, jadi angka ini dihitung dari catatan harian di database.";
    foot.textContent =
      `Web search memakai kuota terpisah dari kuota token: ${ws.capPerKey} pencarian per kunci per hari. ` +
      sumber +
      ` Bila jatah xKiro habis, bot otomatis memakai mesin pencari cadangan tanpa kuota.`;
  }
}

function renderLiveUpstreamTable(data) {
      const tbody = document.getElementById("live-upstream-tbody");
      if (!tbody) return;
      tbody.innerHTML = "";

      const pools = data.pools || data.providers || [];
      let grandTotalTokenCap = 0;
      let grandTotalTokenUsed = 0;
      let grandTotalTokenRemaining = 0;
      let grandTotalUnboundedTokenUsed = 0;
      let grandTotalCloudflareRpd = 0;
      let grandTotalCloudflareUsed = 0;
      let grandTotalGroqRpd = 0;
      let grandTotalGroqUsed = 0;
      let totalAllKeys = 0;
      let totalOrUsageUsd = 0;

      const rows = [];

      pools.forEach(p => {
        if (!p.keys || p.keys.length === 0) return;

        p.keys.forEach(k => {
          totalAllKeys++;
          const cleanSuffix = k.suffix.startsWith("...") ? k.suffix : "..." + k.suffix;

          if (p.kind === "dahl") {
            const keyCap = k.tokenCap || 100000000;
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
                  <div style="font-family: var(--font-mono); font-size: 0.78rem; color: #22d3ee; font-weight: 700; margin-top: 3px;">dahl_...${escapeHtml(cleanSuffix)}</div>
                </td>
                <td>
                  <div style="font-weight: 600; color: #cbd5e1; font-size: 0.82rem;">Dahl Enterprise Cluster</div>
                  <div style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono); margin-top: 2px;">inference.dahl.global &bull; 1B Token Pool</div>
                </td>
                <td>
                  <div style="display: flex; justify-content: space-between; font-size: 0.78rem; font-family: var(--font-mono); margin-bottom: 4px;">
                    <span style="font-weight: 700; color: #fbbf24;">${keyUsed.toLocaleString("id-ID")} Token</span>
                    <span style="color: var(--text-dim);">${pct}%</span>
                  </div>
                  <div class="progress-bar-bg" style="height: 6px;">
                    <div class="progress-bar-fill ${pct >= 100 ? 'progress-rose' : pct >= 80 ? 'progress-amber' : 'progress-emerald'}" style="width: ${Math.min(100, pct)}%"></div>
                  </div>
                  <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 3px;">Limit: 100M Token/key &bull; 5.000 RPD</div>
                </td>
                <td>
                  <div style="font-size: 1.05rem; font-weight: 800; color: #34d399; font-family: var(--font-mono);">${keyRemaining.toLocaleString("id-ID")}</div>
                  <div style="font-size: 0.72rem; color: #10b981; font-weight: 600; margin-top: 2px;">● Sisa Saldo Token Key</div>
                </td>
                <td style="text-align: right;">
                  <span class="badge-bot-sync" style="margin-bottom: 4px; background: rgba(6, 182, 212, 0.15); color: #22d3ee; border-color: rgba(6, 182, 212, 0.3);">● Bot Monitored</span>
                  <div><span class="key-badge-status ${pct >= 100 ? 'status-capped' : pct >= 80 ? 'status-warning' : 'status-healthy'}">${pct >= 100 ? 'LIMIT CAP' : pct >= 80 ? 'WASPADAI' : 'OPTIMAL'}</span></div>
                </td>
              </tr>
            `);
          } else if (p.kind === "xkiro") {
            const keyCap = k.tokenCap || 5000000;
            const keyUsed = k.tokensUsed || 0;
            const keyRemaining = (k.liveRemainingTokens !== null && k.liveRemainingTokens !== undefined) ? k.liveRemainingTokens : Math.max(0, keyCap - keyUsed);
            const pct = k.tokenPercent || 0;
            // Status dari token (metrik binding untuk xKiro): key yang token hariannya
            // sudah habis WAJIB tampil CAPPED, bukan "OPTIMAL" — temuan user: key
            // ...6386 sudah 1.004.173/1.000.000 token tapi badge masih OPTIMAL.
            const xkStatusClass = pct >= 100 ? "status-capped" : pct >= 80 ? "status-warning" : "status-healthy";
            const xkStatusText = pct >= 100 ? "LIMIT TOKEN" : pct >= 80 ? "WASPADAI" : "OPTIMAL";

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
                  <div><span class="key-badge-status ${xkStatusClass}">${xkStatusText}</span></div>
                </td>
              </tr>
            `);
          } else if (p.kind === "openrouter") {
            // OpenRouter /auth/key mengembalikan `usage` = TOTAL kumulatif akun dan
            // `usage_daily` = pemakaian HARI INI. Dashboard lama memberi label
            // "Penggunaan Hari Ini" pada angka TOTAL -> menyesatkan (temuan user:
            // $0.06142 tampil sebagai pemakaian hari ini padahal usage_daily = $0).
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
                  <div style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; color: #38bdf8;">$${dailyUsd.toFixed(5)} USD</div>
                  <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">Pemakaian Hari Ini &bull; Total Akun: $${usageUsd.toFixed(5)} &bull; Free Model Route</div>
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
            const keyCapRpd = p.cap || 1000;
            const callsUsed = k.used || 0;
            const callsRemaining = Math.max(0, keyCapRpd - callsUsed);
            const pct = keyCapRpd > 0 ? Math.min(100, Math.round((callsUsed / keyCapRpd) * 100)) : 0;
            const tokensUsed = k.tokensUsed || 0;

            // Groq Free Tier resmi juga dibatasi 200K TPD — mana yang lebih dulu tercapai,
            // itulah yang menentukan status (TPD biasanya habis lebih cepat dari RPD).
            const tpdCap = 200000;
            const tpdPct = Math.min(100, Math.round((tokensUsed / tpdCap) * 100));
            const bindingPct = Math.max(pct, tpdPct);
            const tpdBinding = tpdPct > pct;

            grandTotalGroqRpd += keyCapRpd;
            grandTotalGroqUsed += callsUsed;
            grandTotalUnboundedTokenUsed += tokensUsed;

            const callCountText = callsUsed > 0 ? ` (${callsUsed.toLocaleString("id-ID")} panggilan)` : "";
            const statusClass = bindingPct >= 100 ? "status-capped" : bindingPct >= 80 ? "status-warning" : "status-healthy";
            const statusText = bindingPct >= 100
              ? (tpdBinding ? "LIMIT TPD" : "LIMIT RPD")
              : bindingPct >= 80
              ? "WASPADAI"
              : "OPTIMAL";

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
                    <span style="font-weight: 700; color: #fbbf24;">${tokensUsed.toLocaleString("id-ID")} / ${tpdCap.toLocaleString("id-ID")} Token${callCountText}</span>
                    <span style="color: var(--text-dim);">${tpdPct}% TPD &bull; ${pct}% RPD</span>
                  </div>
                  <div class="progress-bar-bg" style="height: 6px;">
                    <div class="progress-bar-fill ${bindingPct >= 100 ? 'progress-rose' : bindingPct >= 80 ? 'progress-amber' : 'progress-emerald'}" style="width: ${bindingPct}%"></div>
                  </div>
                  <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 3px;">Limit: ${keyCapRpd.toLocaleString("id-ID")} RPD &bull; 8K TPM &bull; 200K TPD (Free Tier resmi)${!k.isRealTokenData && tokensUsed > 0 ? ' &bull; <span style="color:#fbbf24;">estimasi</span>' : ''}</div>
                </td>
                <td>
                  <div style="font-size: 1.05rem; font-weight: 800; color: #34d399; font-family: var(--font-mono);">${Math.max(0, tpdCap - tokensUsed).toLocaleString("id-ID")}</div>
                  <div style="font-size: 0.72rem; color: #10b981; font-weight: 600; margin-top: 2px;">● Sisa Token Harian (TPD) &bull; ${callsRemaining.toLocaleString("id-ID")} RPD</div>
                </td>
                <td style="text-align: right;">
                  <span class="badge-bot-sync" style="margin-bottom: 4px; background: rgba(249, 115, 22, 0.15); color: #fb923c; border-color: rgba(249, 115, 22, 0.3);">● Bot Monitored</span>
                  <div><span class="key-badge-status ${statusClass}">${statusText}</span></div>
                </td>
              </tr>
            `);
          } else if (p.kind === "cloudflare") {
            // Cap per-key dari payload (120), bukan konstanta 300 yang tidak sinkron
            // dengan angka "0 / 120 panggilan" pada baris key (temuan audit dashboard).
            const keyCap = p.capPerKey || p.cap || 120;
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
                  <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 3px;">Limit: ${keyCap.toLocaleString("id-ID")} RPD (~10K Neuron/hari) &bull; Bot Monitored</div>
                </td>
                <td>
                  <div style="font-size: 1.05rem; font-weight: 800; color: #34d399; font-family: var(--font-mono);">${keyRemaining.toLocaleString("id-ID")}</div>
                  <div style="font-size: 0.72rem; color: #10b981; font-weight: 600; margin-top: 2px;">● Sisa Kuota Harian (RPD)</div>
                </td>
                <td style="text-align: right;">
                  <span class="badge-bot-sync" style="margin-bottom: 4px;">● Bot Monitored</span>
                  <div><span class="key-badge-status ${pct >= 100 ? 'status-capped' : pct >= 80 ? 'status-warning' : 'status-healthy'}">${pct >= 100 ? 'LIMIT RPD' : pct >= 80 ? 'WASPADAI' : 'OPTIMAL'}</span></div>
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
                  <div><span class="key-badge-status ${k.status === 'capped' ? 'status-capped' : k.status === 'warning' ? 'status-warning' : 'status-healthy'}">${k.status === 'capped' ? 'LIMIT RPD' : k.status === 'warning' ? 'WASPADAI' : 'OPTIMAL'}</span></div>
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
      const subEl = document.getElementById("upstream-openrouter-sub");

      if (capEl) capEl.textContent = grandTotalTokenCap.toLocaleString("id-ID") + " Token";
      if (subEl) subEl.textContent = `${pools.filter(p => (p.keys || []).length > 0).length} Provider AI Aktif`;
      if (capSubEl) {
        const extraParts = [];
        if (grandTotalGroqRpd > 0) extraParts.push(`${grandTotalGroqRpd.toLocaleString("id-ID")} RPD Groq`);
        if (grandTotalCloudflareRpd > 0) extraParts.push(`${grandTotalCloudflareRpd.toLocaleString("id-ID")} RPD Cloudflare`);
        capSubEl.textContent = extraParts.length > 0 
          ? `Dahl & xKiro Gateway (+${extraParts.join(", ")})` 
          : "Dahl & xKiro Gateway (Token Pool)";
      }
      if (usedEl) {
        // Token pool berbatas (Dahl + xKiro) ditampilkan utama agar sinkron dengan cap & sisa;
        // token provider bebas kuota (Groq) dilaporkan terpisah di subtext.
        usedEl.textContent = grandTotalTokenUsed.toLocaleString("id-ID") + " Token";
      }
      const usedSubEl = document.getElementById("upstream-total-used-sub");
      if (usedSubEl) {
        usedSubEl.textContent = grandTotalUnboundedTokenUsed > 0
          ? `Pool Dahl & xKiro • +${grandTotalUnboundedTokenUsed.toLocaleString("id-ID")} Token Bebas Kuota (Groq)`
          : "Akumulasi Global (Bot + IDE)";
      }
      if (remEl) remEl.textContent = grandTotalTokenRemaining.toLocaleString("id-ID") + " Token";
      if (pctEl && grandTotalTokenCap > 0) {
        const remainingPct = Math.round((grandTotalTokenRemaining / grandTotalTokenCap) * 100);
        pctEl.textContent = `${remainingPct}% Kuota Bersih Tersedia`;
      }
      if (orEl) {
        orEl.textContent = `${totalAllKeys} kunci aktif`;
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

        // Status provider memakai metrik BINDING (mana yang lebih dulu habis).
        // xKiro dibatasi token harian: 1.592.109/2.000.000 token = 80% padahal panggilan
        // hanya 192/1.500 = 13%. Memakai p.percent saja membuat status salah "Optimal".
        const providerBindingPct = Math.max(p.percent || 0, p.tokenPercent || 0);

        let statusBadgeClass = "status-healthy";
        let statusText = "Optimal";
        if (providerBindingPct >= 100) {
          statusBadgeClass = "status-capped";
          statusText = "Capped";
        } else if (providerBindingPct >= 80) {
          statusBadgeClass = "status-warning";
          statusText = "Waspada";
        }

        let mechanismText = "Kuota Token Harian";
        // Limit resmi per-key. xKiro TIDAK seragam (key1 1jt, key2/3 500k) — tampilkan
        // rentang nyata, bukan satu angka yang menyesatkan (temuan: tertulis "5M
        // Token/hari/key" padahal limit asli 1jt & 500k).
        const perKeyCaps = Array.isArray(p.tokenCapPerKeyList) ? p.tokenCapPerKeyList.filter((c) => c > 0) : [];
        let limitOfficial;
        if (perKeyCaps.length > 0) {
          const minCap = Math.min(...perKeyCaps);
          const maxCap = Math.max(...perKeyCaps);
          // formatTokens sudah memuat kata "Token"; buang agar tidak "1M Token-500K Token".
          const fmtNum = (n) => formatTokens(n).replace(/\s*Token$/, "");
          limitOfficial = minCap === maxCap
            ? `${fmtNum(minCap)} Token/hari/key`
            : `${fmtNum(minCap)}-${fmtNum(maxCap)} Token/hari/key`;
        } else {
          limitOfficial = `${formatTokens(p.tokenCapPerKey)}/hari/key`;
        }
        if (p.kind === "dahl") {
          mechanismText = "Pool Saldo Token (1B)";
          limitOfficial = "100M Token/key (~5K RPD)";
        } else if (p.kind === "cloudflare") {
          mechanismText = "Batas Neuron Harian";
          limitOfficial = `10.000 Neuron (~${(p.capPerKey || 300).toLocaleString()} RPD)`;
        } else if (p.kind === "groq") {
          mechanismText = "RPD + TPD (Token Harian)";
          limitOfficial = "1.000 RPD • 8K TPM • 200K TPD";
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
          </td>
          <td>
            <span style="color: #cbd5e1; font-weight: 500;">${escapeHtml(mechanismText)}</span>
          </td>
          <td>
            <span style="font-weight: 600; color: #38bdf8;">${escapeHtml(limitOfficial)}</span>
          </td>
          <td>
            <span class="tp-badge-cycle">${escapeHtml(p.resetCycle || "-")}</span>
          </td>
          <td>
            <div style="font-weight: 700; color: var(--text-main);">${usedCalls.toLocaleString()} Calls &bull; ${formatTokens(tokensUsed)}</div>
            ${(p.totalTokenCap > 0 && p.totalTokensRemaining !== undefined)
              ? `<div style="font-size: 0.72rem; color: #34d399; margin-top: 2px;">Sisa ${formatTokens(p.totalTokensRemaining)} dari ${formatTokens(p.totalTokenCap)}${p.cappedKeys > 0 ? ` &bull; <span style="color:#fb7185;font-weight:700;">${p.cappedKeys} key habis</span>` : ''}</div>`
              : ""}
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

    async function downloadDataset(format) {
      const token = getStoredToken();
      if (!token) return;

      const q = document.getElementById("dataset-search")?.value.trim() || "";
      const rangeSelect = document.getElementById("dataset-range-filter");
      const range = rangeSelect ? rangeSelect.value : "all";
      const platform = document.getElementById("dataset-platform-filter")?.value || "";
      const model = document.getElementById("dataset-model-filter")?.value || "";
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jakarta";

      // Token TIDAK ditaruh di URL (bocor ke log proxy/history browser). Unduh via
      // fetch ber-header, lalu buat blob — URL hanya hidup sesaat di memori.
      const url = `/api/dataset?format=${format}&q=${encodeURIComponent(q)}&range=${encodeURIComponent(range)}&platform=${encodeURIComponent(platform)}&model=${encodeURIComponent(model)}&tz=${encodeURIComponent(tz)}&limit=3000`;

      const filePrefix = format === "csv" ? "evaluasi_chatbot" : "training_dataset";
      const rangeLabel = range === "today" ? "hari_ini" : range === "all" ? "semua" : range;
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const dateTag = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timeTag = `${pad(now.getHours())}-${pad(now.getMinutes())}`;

      let filterSuffix = "";
      if (platform) filterSuffix += `_${platform}`;
      if (model) filterSuffix += `_${model.replace(/[^a-z0-9_-]/gi, "")}`;

      const filename = `${filePrefix}_${rangeLabel}_${dateTag}_jam_${timeTag}${filterSuffix}.${format}`;

      try {
        const res = await fetch(url, { headers: { "x-admin-token": token } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      } catch (err) {
        console.warn("[dashboard] Gagal unduh dataset:", err);
      }
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
      on("pin-form", "submit", (e) => handlePinSubmit(e));
      on("btn-open-reset", "click", openResetModal);
      on("btn-send-otp", "click", handleSendOtp);
      on("btn-resend-otp", "click", handleSendOtp);
      on("btn-submit-reset", "click", handleVerifyOtpAndReset);
      on("btn-cancel-reset", "click", closeResetModal);
      on("btn-back-reset", "click", closeResetModal);
      // Tombol "Kembali" di langkah 2 memakai ID terpisah (lihat catatan di
      // dashboard.html): ID yang sama membuat handler ini tidak pernah terpasang
      // pada tombol tersebut, jadi menekannya tidak melakukan apa pun.
      on("btn-back-reset-step2", "click", closeResetModal);

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

    function initDashboardScrollReveal() {
      if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
      const targets = document.querySelectorAll(
        ".console-head, .kpi-card, .smart-gateway-banner, .matrix-section, .provider-card, .live-upstream-card, .token-matrix-section, #dataset-section, .model-matrix-card"
      );
      if (!targets.length) return;

      if (!window._dashRevealObserver) {
        window._dashRevealObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            const el = entry.target;
            if (entry.isIntersecting) {
              el.classList.add("revealed");
            } else {
              el.classList.remove("revealed");
              if (entry.boundingClientRect.top < 0) {
                el.classList.remove("reveal-from-bottom");
                el.classList.add("reveal-from-top");
              } else {
                el.classList.remove("reveal-from-top");
                el.classList.add("reveal-from-bottom");
              }
            }
          });
        }, {
          threshold: 0.05,
          rootMargin: "-15px 0px -15px 0px"
        });
      }

      targets.forEach((el) => {
        if (!el.classList.contains("reveal-init")) {
          el.classList.add("reveal-init");
          const rect = el.getBoundingClientRect();
          if (rect.top < 0) {
            el.classList.add("reveal-from-top");
          } else {
            el.classList.add("reveal-from-bottom");
          }
          window._dashRevealObserver.observe(el);
        }
      });
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================
    (async () => {
      bindDashboardEvents();
      initDashboardScrollReveal();
      if (typeof window.setupGlassDropdowns === "function") {
        window.setupGlassDropdowns();
      }
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
