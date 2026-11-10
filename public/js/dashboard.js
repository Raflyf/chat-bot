function modelUsageId(value) {
  const parts = String(value || '').split('#')[0].trim().toLowerCase().split('/');
  const at = parts.findIndex((part) => ['opencode', 'cloudflare', 'groq', 'dreamprompting', 'openrouter', 'gemini', 'dahl', 'nvidia', 'xkiro'].includes(part));
  return at >= 0 ? parts.slice(at).join('/') : '';
}

const SESSION_TOKEN_KEY = "freeaibot_admin_session_token";
    const SESSION_EXP_KEY = "freeaibot_admin_session_exp";

    let autoRefresh = true;
    let refreshTimer = null;
    let statsRequest = null;
    let statsGeneration = 0;
    const REFRESH_MS = 5000;
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
      // KEAMANAN (06 Okt 2026): token HANYA di sessionStorage — otomatis terhapus
      // saat tab ditutup. TIDAK pernah di localStorage (yang bertahan permanen dan
      // bisa dibaca skrip mana pun kapan saja). localStorage warisan dibersihkan.
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
          alertEl.textContent = t('dyn.sessionLost', "Sesi autentikasi terputus atau tidak valid (pembaruan server). Masukkan Master PIN kembali.");
        } else {
          alertEl.textContent = t('dyn.sessionExpired', "Sesi admin 15 menit telah berakhir untuk keamanan. Masukkan Master PIN kembali.");
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
      return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
    }

    function formatDateTime(isoString) {
      if (!isoString) return "-";
      const d = new Date(isoString);
      return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    }

    // BUG YANG DIPERBAIKI (06 Okt 2026): fungsi ini SELALU menempelkan kata
    // "Token" — termasuk untuk Cloudflare yang satuannya NEURON. Akibatnya
    // ringkasan menampilkan "4K Token / 30K Token" padahal labelnya
    // "Pemakaian neuron". Sekarang satuan bisa diberikan sebagai argumen.
    // BUG YANG DIPERBAIKI (06 Okt 2026 — LAPORAN PEMILIK PRODUK):
    // "pemakaian total nya tidak akurat, kenapa 4K neuron padahal belum sampai 4k"
    //
    // SEBAB: `maximumFractionDigits: 0` MEMBULATKAN 3.803 menjadi 3,8 -> "4K",
    // sehingga angka terlihat lebih besar dari kenyataan (menyesatkan).
    //
    // PERBAIKAN: angka di bawah 100.000 ditampilkan UTUH (3.803), bukan dibulatkan.
    // Hanya angka besar (>= 100.000) yang disingkat, dan itu pun 1 desimal
    // sehingga tetap akurat (mis. 1,2M bukan 1M).
    function formatTokens(num, satuan) {
      const u = satuan || "Token";
      const n = Number(num);
      if (!n || isNaN(n) || n <= 0) return `0 ${u}`;
      // Akurat sampai 99.999 (tampil penuh dengan pemisah ribuan).
      if (n < 100000) return `${n.toLocaleString("id-ID")} ${u}`;
      if (n < 1000000) {
        const val = (n / 1000).toLocaleString("id-ID", { maximumFractionDigits: 1 });
        return `${val}K ${u}`;
      }
      const val = (n / 1000000).toLocaleString("id-ID", { maximumFractionDigits: 1 });
      return `${val}M ${u}`;
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
          pasangAutoRefresh();
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
        alertEl.textContent = t('dyn.authServerFail', "Gagal menghubungi server keamanan. Silakan coba lagi.");
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
      alertEl.textContent = t('dyn.sendingOtp', "Mengirimkan kode OTP ke email admin...");

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
        alertEl.textContent = t('dyn.otpNetworkErr', "Terjadi kesalahan jaringan saat mengirim OTP.");
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
          resendBtn.textContent = t('dyn.resendOtp', "Kirim Ulang OTP");
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
        alertEl.textContent = t('dyn.otpMust6', "Kode OTP harus berupa 6 digit angka.");
        return;
      }

      if (newPin.length < 4 || newPin.length > 8 || !/^\d+$/.test(newPin)) {
        alertEl.className = "auth-alert auth-alert-error show";
        alertEl.textContent = t('dyn.pinMust4to8', "Master PIN baru harus berupa 4 hingga 8 digit angka.");
        return;
      }

      if (newPin !== confirmPin) {
        alertEl.className = "auth-alert auth-alert-error show";
        alertEl.textContent = t('dyn.pinNoMatch', "Konfirmasi PIN baru tidak cocok.");
        return;
      }

      const submitBtn = document.getElementById("btn-submit-reset");
      submitBtn.disabled = true;
      alertEl.className = "auth-alert auth-alert-success show";
      alertEl.textContent = t('dyn.verifyingOtp', "Memverifikasi OTP dan mereset PIN...");

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
            loginAlert.textContent = t('dyn.pinSaved', "PIN baru berhasil disimpan. Silakan masukkan PIN baru Anda.");
          }, 1500);
        } else {
          alertEl.className = "auth-alert auth-alert-error show";
          alertEl.textContent = data.message || "Gagal mereset Master PIN.";
          submitBtn.disabled = false;
        }
      } catch (err) {
        console.error("resetPin error:", err);
        alertEl.className = "auth-alert auth-alert-error show";
        alertEl.textContent = t('dyn.resetConnErr', "Kesalahan koneksi saat mereset PIN.");
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
    // VARIABEL YANG HILANG (dipulihkan 04 Okt 2026).
    //
    // Ketiga variabel ini DULU ada (terlihat di riwayat git commit 740e8db~1,
    // baris 2119-2121), tetapi ikut terhapus saat fungsi renderTokenMatrix
    // dihapus. Akibatnya renderDatasetTable() melempar:
    //   ReferenceError: DATASET_PAGE_SIZE is not defined
    // (terlihat di Console Firefox user) sehingga riwayat percakapan TIDAK PERNAH
    // tampil — tabel menggantung di status memuat.
    let currentDatasetPage = 1;
    const DATASET_PAGE_SIZE = 5;
    let cachedDatasetPairs = [];

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

    function updateFreshness(stale = false) {
      const stamp = cachedDashboardData?.serverTime;
      const age = stamp ? Date.now() - Date.parse(stamp) : Infinity;
      const late = stale || !Number.isFinite(age) || age > 20000;
      const el = document.getElementById('server-time');
      if (el) el.textContent = (stamp ? 'Snapshot ' + formatTime(stamp) + ' UTC' : 'Belum ada snapshot') + (late ? ' · data belum segar' : ' · pantau tiap 5 dtk saat terlihat');
      const label = document.getElementById('monitoring-status');
      if (label) label.textContent = late ? 'Data belum segar' : 'Terpantau 5 dtk';
      const sync = document.getElementById('sync-time');
      if (sync) sync.textContent = stamp ? formatTime(stamp) + ' UTC' : '–';
    }

    async function fetchData(force = false) {
      const token = getStoredToken();
      if (!token || document.hidden) return;
      const cacheKey = currentTimeRange + '_' + currentPlatform;
      if (statsRequest?.cacheKey === cacheKey) return;
      if (statsRequest) statsRequest.controller.abort();
      const generation = ++statsGeneration;
      const controller = new AbortController();
      statsRequest = { cacheKey, controller };
      if (!force && statsCache.has(cacheKey)) {
        cachedDashboardData = statsCache.get(cacheKey);
        renderDashboard(cachedDashboardData);
      }
      const icon = document.getElementById('btn-refresh-icon');
      icon?.classList.add('spinning');
      const deadline = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch('/api/stats?range=' + encodeURIComponent(currentTimeRange) + '&platform=' + encodeURIComponent(currentPlatform), {
          headers: { 'x-admin-token': token }, cache: 'no-store', signal: controller.signal,
        });
        if (generation !== statsGeneration || token !== getStoredToken()) return;
        if (res.status === 401) {
          const recheck = await fetch('/api/admin-otp?action=verify_session', {
            headers: { 'x-admin-token': token }, cache: 'no-store', signal: controller.signal,
          }).catch(() => null);
          if (generation !== statsGeneration || token !== getStoredToken()) return;
          if (recheck?.ok && (await recheck.json().catch(() => ({}))).valid) { updateFreshness(true); return; }
          triggerSessionExpired('auth_lost');
          return;
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (generation !== statsGeneration || token !== getStoredToken() || cacheKey !== currentTimeRange + '_' + currentPlatform) return;
        if (!data.ok) throw new Error('Data monitoring belum tersedia');
        statsCache.set(cacheKey, data);
        cachedDashboardData = data;
        renderDashboard(data);
      } catch (err) {
        if (generation === statsGeneration) { updateFreshness(true); console.error('Gagal mengambil metrik:', err); }
      } finally {
        clearTimeout(deadline);
        if (generation === statsGeneration) { statsRequest = null; icon?.classList.remove('spinning'); }
      }
    }

    function renderDashboard(data) {
      if (!data || !data.ok) return;

      const rangeLabel = data.rangeLabel || "Hari Ini";
      const platformLabel = data.platform === "whatsapp" ? " (WhatsApp)" : data.platform === "telegram" ? " (Telegram)" : "";

      updateFreshness(data.dataTruncated || !data.cooldownAvailable);

      // KPI Titles & Values
      document.getElementById("kpi-title-msgs").textContent = `Pesan (${rangeLabel})`;
      document.getElementById("kpi-today-msgs").textContent = (data.summary.totalMessagesPeriod ?? data.summary.totalMessagesToday ?? 0).toLocaleString();
      document.getElementById("kpi-total-msgs").textContent = (data.summary.totalMessagesAllTime ?? 0).toLocaleString();
      document.getElementById("kpi-wa").textContent = (data.summary.whatsappPeriod ?? data.summary.whatsappToday ?? 0) + " WA";
      document.getElementById("kpi-tele").textContent = (data.summary.telegramPeriod ?? data.summary.telegramToday ?? 0) + " Telegram";

      document.getElementById('kpi-title-calls').textContent = 'Panggilan tercatat (' + rangeLabel + '; semua platform)';
      document.getElementById('kpi-calls-today').textContent = metricNumber(data.summary.totalCallsPeriod) + ' panggilan';
      document.getElementById('kpi-total-keys').textContent = (data.summary.totalTokensPeriod == null ? 'Token belum lengkap' : metricNumber(data.summary.totalTokensPeriod) + ' token tercatat') + ' · ' + metricNumber(data.summary.totalKeys) + ' kunci + ' + metricNumber(data.summary.publicAccessCount) + ' akses publik';


      document.getElementById("kpi-title-model").textContent = `Model Terpopuler (${rangeLabel})`;
      const topModel = data.modelsBreakdown && data.modelsBreakdown.length > 0
        ? data.modelsBreakdown[0].name
        : "Menunggu panggilan";
      document.getElementById("kpi-top-model").textContent = topModel;

      // Pool reset label
      const poolReset = document.getElementById("pool-reset-label");
      if (poolReset) poolReset.textContent = "Panggilan tercatat: " + rangeLabel + " · semua platform. Bar per akses: hari ini (UTC). Balasan tersimpan memakai filter platform.";

      // Dynamic Section Titles
      const modelsH = document.getElementById("models-section-title");
      if (modelsH) modelsH.textContent = `Distribusi Model LLM (${rangeLabel})`;
      const mediaH = document.getElementById("media-section-title");
      if (mediaH) mediaH.textContent = `Pemrosesan Tipe Media (${rangeLabel})`;

      // Label rentang yang ikut berubah. Sebelumnya ketiga label ini ditulis
      // "hari ini" di HTML tanpa id, sehingga saat rentang diganti ke 7/14/30
      // hari teksnya tetap berbunyi "hari ini" — padahal angkanya sudah
      // menampilkan periode lain.
      const labelUsed = document.getElementById('upstream-label-used');
      if (labelUsed) labelUsed.textContent = 'Token tercatat hari ini (UTC)';
      const thPakai = document.getElementById('th-pemakaian');
      if (thPakai) thPakai.textContent = 'Tercatat hari ini (UTC)';
      const thSisa = document.getElementById('th-sisa');
      if (thSisa) thSisa.textContent = 'Snapshot sisa upstream';

      // Badge versi diambil dari package.json lewat API, bukan ditulis di HTML:
      // versi yang di-hardcode mudah tertinggal setiap kali rilis, dan dashboard
      // yang menampilkan versi lama membuat pemilik ragu apakah deploy berhasil.
      const versionBadge = document.querySelector(".brand-badge-version");
      if (versionBadge && data.version) versionBadge.textContent = "v" + data.version;

      // Render Pools Matrix, Dedicated Token Quota Matrix & AI Model Router Matrix
      //
      // PELINDUNG PER-PANEL (perbaikan 24 Sep): sebelumnya keenam pemanggilan ini
      // berjalan tanpa pelindung, sehingga SATU error saja (mis. variabel yang
      // belum dibuat di salah satu fungsi) menghentikan SEMUA panel berikutnya —
      // gejalanya "data tidak muncul" di banyak panel sekaligus, padahal akarnya
      // hanya satu. Sekarang tiap panel dilindungi sendiri: kalau satu gagal,
      // panel lain tetap terisi dan error-nya tercatat di konsol untuk ditelusuri.
      const panelRenders = [
        ["Pemakaian pool API key", renderPoolMatrix],
        ["Penyedia dan kunci", renderLiveUpstreamTable],
        ["Web search", renderWebSearchPanel],
        ["Distribusi model LLM", renderAiModelMatrix],
      ];
      for (const [nama, fn] of panelRenders) {
        try {
          fn(data);
        } catch (err) {
          console.error(`[dashboard] panel "${nama}" gagal dirender:`, err);
        }
      }

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

      if (totalInferensiEl) totalInferensiEl.textContent = `${totalCalls.toLocaleString()}x`;
      if (totalResolusiEl) totalResolusiEl.textContent = `${totalCalls.toLocaleString()}x`;

      // Sinkronkan active state filter waktu (selector harus `.pill-filter-btn`;
      // versi lama menulis `.matrix-filter-pill` yang tidak ada di markup,
      // sehingga tombol tidak pernah tersorot — lihat catatan di setTimeRange).
      document.querySelectorAll("#matrix-time-filters .pill-filter-btn").forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-range") === currentTimeRange);
      });

      // Identitas tetap provider-qualified; nama model sama di gateway lain tidak digabung.
      function getCount(matchKeys) {
        return modelsBreakdown.reduce((sum, row) =>
          sum + (matchKeys.includes(modelUsageId(row.name)) ? Number(row.count) || 0 : 0), 0);
      }

      const catalog = (Array.isArray(data.modelCatalog) ? data.modelCatalog : []).map((m) => ({
        name: m.model, provider: m.provider, tagClass: 'tag-' + m.provider,
        capabilities: m.capabilities, desc: m.desc, matchKeys: [m.id.toLowerCase()],
      }));

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
      const currentActive = data.activeModel || null;
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

      // Riwayat model lama tetap disimpan; hanya kartu aktif mengikuti katalog API.

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
          return item.matchKeys.includes(modelUsageId(mruKey));
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
      const __htmlGrid = orderedCatalog.map((c, i) => {
        const count = getCount(c.matchKeys);
        const isActive = Boolean(currentActive) && c.matchKeys.includes(modelUsageId(currentActive));
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
          <div class="${cardClass}" data-provider="${escapeHtml(providerKey)}">
            <div>
              <div class="card-top-row">
                <div class="card-num-group">
                  <span class="card-number">#${i + 1}</span>
                  ${activeBadge}
                </div>
                <span class="tag-provider ${escapeHtml(c.tagClass)}">${escapeHtml(c.provider)}</span>
              </div>
              <div class="card-model-name">${escapeHtml(c.name)}</div>
              ${capBadgesHtml ? `<div class="card-caps-row">${capBadgesHtml}</div>` : ""}
              <div class="card-model-desc">${escapeHtml(c.desc)}</div>
            </div>
            <div class="card-footer-row">
              <span class="card-footer-label">Balasan tersimpan</span>
              <span class="card-footer-count">${count.toLocaleString()}x</span>
            </div>
          </div>
        `;
      }).join("");

      // Tulis grid SEKALI setelah SEMUA kartu selesai dibangun.
      // Sebelumnya baris ini nyasar ke dalam map() -> ReferenceError
      // ("Cannot access '__htmlGrid' before initialization") -> seluruh
      // renderDashboard berhenti dan grid tetap menampilkan "Memuat matriks
      // model". Sekaligus pakai setHtmlIfChanged supaya tidak berkedip.
      setHtmlIfChanged(gridEl, __htmlGrid);
    }


    // ---------------------------------------------------------------------
    // TULIS DOM HANYA BILA BERUBAH (perbaikan blink 24 Sep).
    //
    // Menulis `.innerHTML` pada elemen yang isinya SAMA memaksa browser
    // membongkar dan membangun ulang seluruh subpohon DOM-nya. Efeknya:
    // kartu berkedip, animasi CSS mulai dari awal, dan sorotan/hover hilang.
    // Karena dashboard menyegarkan diri tiap 15 detik, efek ini terlihat
    // sebagai "blink blink glitch" terus-menerus.
    //
    // Helper ini membandingkan isi lebih dulu; kalau identik, DOM tidak
    // disentuh sama sekali. Dipakai untuk semua daftar/kartu/tabel yang
    // dirender ulang secara berkala.
    // ---------------------------------------------------------------------
    function setHtmlIfChanged(el, html) {
      if (!el) return false;
      if (el.__lastHtml === html) return false;
      el.innerHTML = html;
      el.__lastHtml = html;
      return true;
    }

    // Sama untuk textContent: menyetel teks yang sama tetap memicu layout ulang
    // pada sebagian browser. Bandingkan dulu.
    function setTextIfChanged(el, teks) {
      if (!el) return false;
      const s = String(teks);
      if (el.__lastText === s) return false;
      el.textContent = s;
      el.__lastText = s;
      return true;
    }

    function metricNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('id-ID') : '–';
    }

    function keyStatus(key) {
      if (key.cooldownAlasan) {
        const reason = { neuron: 'neuron habis', rpd: 'limit harian', rpm: 'limit per menit', concurrency: 'kapasitas penuh', error: 'gangguan sementara' }[key.cooldownAlasan] || key.cooldownAlasan;
        return { label: 'Cooldown', className: 'status-warning', detail: reason + (key.cooldownSampai ? ' sampai ' + formatDateTime(key.cooldownSampai) : '') };
      }
      if (key.status === 'capped') return { label: 'Dibatasi', className: 'status-capped', detail: 'Batas tercatat tercapai; bukan kunci mati permanen.' };
      if (key.status === 'warning') return { label: 'Waspada', className: 'status-warning', detail: 'Pemakaian tercatat mendekati batas; cek sumber dan tanggal.' };
      if (key.status === 'healthy') return { label: 'Terpantau', className: 'status-healthy', detail: 'Snapshot kuota tersedia; bukan jaminan inferensi berhasil.' };
      return { label: 'Belum diketahui', className: 'status-unknown', detail: 'Saldo atau kesehatan upstream belum terverifikasi.' };
    }

    function keyUsageHtml(key) {
      const measured = typeof key.tokensUsed === 'number' && Number.isFinite(key.tokensUsed);
      const unit = key.satuanToken === 'neuron' ? 'neuron' : 'token';
      const tokenLine = (measured ? metricNumber(key.tokensUsed) + ' ' + unit + (key.tokenEstimated ? ' (estimasi bot)' : ' tercatat') : 'Token belum terukur') + (key.cooldownAlasan ? ' · upstream membatasi akses' : '');
      const pct = key.bindingPercent;
      const bar = typeof pct === 'number' && Number.isFinite(pct)
        ? '<div class="progress-bar-bg" role="img" aria-label="Pemakaian tercatat ' + pct + ' persen"><div class="progress-bar-fill ' + (pct >= 100 ? 'progress-rose' : pct >= 80 ? 'progress-amber' : 'progress-emerald') + '" style="width:' + Math.min(100, Math.max(0, pct)) + '%"></div></div>' : '';
      return '<div class="key-stats">' + metricNumber(key.used) + ' panggilan tercatat hari ini (UTC)</div><div class="key-token-line">' + escapeHtml(tokenLine) + '</div>' + bar;
    }

    function renderPoolMatrix(data) {
      const grid = document.getElementById('pool-grid');
      if (!grid) return;
      const pools = (data.pools || []).filter(p => currentProviderFilter === 'all' || p.kind === currentProviderFilter);
      const html = pools.map(p => {
        const keys = (p.keys || []).filter(k => currentKeyStatusFilter === 'all' || k.status === currentKeyStatusFilter);
        const rows = keys.map(k => {
          const state = keyStatus(k);
          return '<div class="key-row"><div class="key-info-line"><div class="key-identity"><span class="key-label">' + escapeHtml(k.publicAccess ? 'public · tanpa API key' : '…' + k.suffix) + '</span><span class="key-badge-status ' + state.className + '" title="' + escapeHtml(state.detail) + '">' + state.label + '</span></div></div>' + keyUsageHtml(k) + '<div class="key-token-line">Batas: ' + escapeHtml(k.officialLimitLabel || p.tokenLimitLabel || 'Belum diketahui') + '</div></div>';
        }).join('') || '<div class="key-row">Tidak ada akses sesuai filter status.</div>';
        return '<div class="provider-card" data-provider="' + escapeHtml(p.kind) + '"><div class="provider-header"><div><div class="provider-name"><span class="provider-dot" aria-hidden="true"></span>' + escapeHtml(p.displayName) + '</div><div class="provider-last-used">' + metricNumber(p.repliesPeriod) + ' balasan tersimpan · ' + escapeHtml(data.rangeLabel || data.range) + '</div></div><div class="provider-summary-stat"><div class="provider-usage-text">' + metricNumber(p.usedPeriod) + ' panggilan tercatat</div><div class="provider-cap-text">' + escapeHtml(data.rangeLabel || data.range) + ' · semua platform</div><div class="provider-cap-text">Hari ini (UTC): ' + metricNumber(p.usedToday) + ' · ' + (p.publicAccess ? 'akses publik' : metricNumber(p.keyCount) + ' kunci') + '</div></div></div><div class="keys-list ' + (keys.length > 4 ? 'keys-list-scroll' : '') + '">' + rows + '</div>' + (keys.length > 4 ? '<button type="button" class="keys-toggle" data-toggle-keys aria-expanded="false">Lihat semua kunci</button>' : '') + '</div>';
      }).join('');
      setHtmlIfChanged(grid, html || '<p>Tidak ada pool sesuai filter.</p>');
    }


    /** Mesin pencari publik tidak memiliki saldo per API key. */
function renderWebSearchPanel(data) {
  const panel = document.getElementById('websearch-panel');
  if (!panel) return;
  const ws = data.webSearch;
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('websearch-sub', ws?.mode === 'public-engines' ? 'Mesin pencari publik tanpa API key' : 'Data pencarian belum tersedia');
  set('websearch-used', metricNumber(ws?.usedToday));
  set('websearch-used-note', 'Jumlah pencarian belum dicatat');
  set('websearch-remaining', 'Tidak berlaku');
  set('websearch-remaining-note', 'Tidak ada saldo kuota per kunci');
  set('websearch-keys', 'Tanpa key');
  set('websearch-keys-note', 'Mesin publik, tanpa autentikasi key');
  set('websearch-cap', 'Belum diketahui');
  set('websearch-foot', ws?.note || 'Ketersediaan upstream belum diukur; pembatasan layanan dapat berlaku.');
  const bar = document.getElementById('websearch-bar-fill')?.parentElement;
  if (bar) { bar.hidden = true; bar.removeAttribute('role'); bar.removeAttribute('aria-valuenow'); }
}

function renderLiveUpstreamTable(data) {
  const tbody = document.getElementById('live-upstream-tbody');
  if (!tbody) return;
  const pools = data.pools || [];
  const rows = pools.flatMap(p => (p.keys || []).map(k => {
    const state = keyStatus(k);
    const hasUpstream = !k.upstreamStale && (k.upstreamRequestsUsed != null || k.upstreamTokensUsed != null);
    const sourceTitle = hasUpstream ? 'Snapshot pemakaian upstream: ' + (k.upstreamCheckedAt || 'waktu belum diketahui') : 'Catatan bot dari provider_quota; tidak mencakup aplikasi lain. Saldo upstream belum terverifikasi.';
    const upstreamLine = hasUpstream ? '<div class="key-token-line">Snapshot upstream: ' + metricNumber(k.upstreamRequestsUsed) + ' request · ' + metricNumber(k.upstreamTokensUsed) + ' token</div>' : '';
    const remaining = k.remaining == null && k.upstreamTokensRemaining == null ? 'Belum diketahui'
      : metricNumber(k.remaining) + ' request · ' + metricNumber(k.upstreamTokensRemaining) + ' token';
    return '<tr data-provider="' + escapeHtml(p.kind) + '"><td><strong>' + escapeHtml(p.displayName) + '</strong><div class="key-token-line">' + escapeHtml(k.publicAccess ? 'public · tanpa API key' : '…' + k.suffix) + '</div></td><td>' + (p.endpoint ? escapeHtml(p.endpoint) : escapeHtml(p.primaryModel || 'Model belum diketahui')) + '<div class="key-token-line">' + metricNumber(k.usedPeriod) + ' panggilan tercatat · ' + escapeHtml(data.rangeLabel || data.range) + '</div></td><td>' + keyUsageHtml(k) + upstreamLine + '</td><td>' + escapeHtml(remaining) + '<div class="key-token-line">Batas: ' + escapeHtml(k.officialLimitLabel || p.tokenLimitLabel || 'Belum diketahui') + '</div></td><td class="upstream-validation"><span class="' + (hasUpstream ? 'badge-live-sync' : 'badge-bot-sync') + '" title="' + escapeHtml(sourceTitle) + '">' + (hasUpstream ? 'Upstream' : 'Catatan bot') + '</span><div class="key-badge-status ' + state.className + '" title="' + escapeHtml(state.detail) + '">' + state.label + '</div></td></tr>';
  }));
  setHtmlIfChanged(tbody, rows.join('') || '<tr><td colspan="5">Belum ada akses provider terkonfigurasi.</td></tr>');
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  const calls = pools.reduce((sum, p) => sum + (p.usedToday || 0), 0);
  const tokensKnown = pools.every(p => typeof p.rawTokensToday === 'number');
  const tokens = pools.reduce((sum, p) => sum + (p.rawTokensToday || 0), 0);
  const blocked = pools.flatMap(p => p.keys || []).filter(k => k.status === 'capped' || k.status === 'cooldown').length;
  const keys = pools.reduce((sum, p) => sum + (p.keyCount || 0), 0);
  const publicCount = pools.filter(p => p.publicAccess).length;
  set('upstream-total-cap', metricNumber(calls) + ' panggilan');
  set('upstream-total-cap-sub', 'Hari ini (UTC) · catatan bot · semua platform');
  set('upstream-total-used', tokensKnown ? metricNumber(tokens) + ' token' : 'Belum lengkap');
  set('upstream-total-used-sub', 'Token tercatat hari ini (UTC); bukan neuron');
  set('upstream-total-remaining', metricNumber(blocked) + ' akses');
  set('upstream-remaining-pct', 'Cooldown/batas tercatat; lainnya belum tentu sehat');
  set('upstream-openrouter-status', metricNumber(keys) + ' kunci' + (publicCount ? ' + ' + publicCount + ' publik' : ''));
  set('upstream-openrouter-sub', pools.filter(p => (p.keys || []).length).length + ' provider terkonfigurasi');
  const wa = data.summary?.whatsappMonthlySessions;
  set('upstream-wa-sessions', metricNumber(wa?.used));
  set('upstream-wa-sessions-sub', 'Estimasi sesi 24 jam dari pesan · ' + (wa?.monthLabel || 'periode belum diketahui'));
}

    function debounceDatasetSearch() {
      if (datasetSearchTimeout) clearTimeout(datasetSearchTimeout);
      datasetSearchTimeout = setTimeout(() => {
        currentDatasetPage = 1;
        fetchDataset();
      }, 350);
    }

    async function fetchDataset(force = false) {
      const token = getStoredToken();
      const tbodyEl = document.getElementById("dataset-tbody");
      const infoEl0 = document.getElementById("dataset-pagination-info");

      // BUG YANG DIPERBAIKI (04 Okt 2026, keluhan: "stuck di memuat data dan
      // tidak pernah selesai"):
      //
      // Versi lama: `if (!token) return;` -> bila token belum terbaca (mis. sesi
      // baru dipulihkan, atau key localStorage berbeda), fungsi KELUAR DIAM-DIAM
      // dan tabel tetap menampilkan "Memuat riwayat percakapan / Menunggu data
      // dari basis data" SELAMANYA — tanpa pesan, tanpa tombol coba lagi.
      //
      // Sekarang: setiap kondisi gagal MENULIS status yang jelas ke tabel,
      // sehingga user selalu tahu apa yang terjadi dan bisa mencoba lagi.
      if (!token) {
        setHtmlIfChanged(tbodyEl, `<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:2.5rem;">
          Sesi admin belum aktif.<br><span style="font-size:0.8rem;">Masukkan Master PIN untuk memuat riwayat percakapan.</span>
        </td></tr>`);
        if (infoEl0) infoEl0.textContent = "Menunggu login admin";
        return;
      }

      const q = document.getElementById("dataset-search").value.trim();
      const range = document.getElementById("dataset-range-filter")?.value || "all";
      const platform = document.getElementById("dataset-platform-filter").value;
      const model = document.getElementById("dataset-model-filter")?.value || "";

      const tz = "UTC"; // Sama dengan rentang statistik dan reset kuota.
      const cacheKey = `${range}_${platform}_${model}_${q}_${tz}`;
      if (!force && datasetCache.has(cacheKey)) {
        cachedDatasetPairs = datasetCache.get(cacheKey);
        currentDatasetPage = 1;
        renderDatasetTable();
      }

      // Tampilkan indikator memuat yang jelas (bukan pesan awal yang menggantung).
      setHtmlIfChanged(tbodyEl, `<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:2rem;">
        Memuat riwayat percakapan…</td></tr>`);

      // Batas waktu 25 detik: bila server tidak menjawab, tampilkan error +
      // tombol coba lagi. Tanpa ini, request yang menggantung membuat tabel
      // "stuck" tanpa akhir.
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 25_000);

      try {
        const url = `/api/dataset?format=json&q=${encodeURIComponent(q)}&range=${encodeURIComponent(range)}&platform=${encodeURIComponent(platform)}&model=${encodeURIComponent(model)}&tz=${encodeURIComponent(tz)}&limit=300&_t=${Date.now()}`;
        const res = await fetch(url, {
          headers: { "x-admin-token": token },
          signal: ctrl.signal,
        });
        clearTimeout(timeoutId);

        if (res.status === 401) {
          // Lakukan recheck verifikasi sesi sebelum memutuskan sesi hilang
          const recheck = await fetch("/api/admin-otp?action=verify_session", {
            headers: { "x-admin-token": token },
          }).catch(() => null);

          if (recheck && recheck.ok) {
            const recheckData = await recheck.json().catch(() => ({}));
            if (recheckData.valid) {
              // Sesi MASIH valid tapi /api/dataset menolak -> ini bukan sesi
              // hilang. Versi lama `return;` di sini -> tabel stuck selamanya.
              // Sekarang: tampilkan pesan jelas + tombol coba lagi.
              console.warn("Transient 401 pada /api/dataset terdeteksi, sesi tetap valid.");
              setHtmlIfChanged(tbodyEl, `<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:2.5rem;">
                Server menolak permintaan sementara (401). Sesi Anda masih valid.<br>
                <button type="button" class="btn btn-ghost btn-sm" style="margin-top:0.75rem;" data-action="retry-dataset">Coba lagi</button>
              </td></tr>`);
              if (infoEl0) infoEl0.textContent = "Gagal memuat — klik Coba lagi";
              return;
            }
          }

          triggerSessionExpired("auth_lost");
          return;
        }

        if (!res.ok) {
          // Status HTTP lain (500/502/504): tampilkan kode + tombol coba lagi.
          setHtmlIfChanged(tbodyEl, `<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:2.5rem;">
            Gagal memuat riwayat (HTTP ${res.status}).<br>
            <button type="button" class="btn btn-ghost btn-sm" style="margin-top:0.75rem;" data-action="retry-dataset">Coba lagi</button>
          </td></tr>`);
          if (infoEl0) infoEl0.textContent = `Gagal memuat (HTTP ${res.status})`;
          return;
        }

        const data = await res.json();
        cachedDatasetPairs = data.pairs || [];
        datasetCache.set(cacheKey, cachedDatasetPairs);
        renderDatasetTable();
      } catch (err) {
        clearTimeout(timeoutId);
        console.error("fetchDataset error:", err);
        // Termasuk AbortError (timeout) — tampilkan jelas + tombol coba lagi.
        const pesan = err && err.name === "AbortError"
          ? "Waktu habis memuat riwayat (25 detik). Server tidak menjawab."
          : "Gagal menghubungi server.";
        setHtmlIfChanged(tbodyEl, `<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:2.5rem;">
          ${pesan}<br>
          <button type="button" class="btn btn-ghost btn-sm" style="margin-top:0.75rem;" data-action="retry-dataset">Coba lagi</button>
        </td></tr>`);
        if (infoEl0) infoEl0.textContent = pesan;
      }
    }

    // Event delegation untuk tombol "Coba lagi" pada tabel riwayat.
    //
    // KENAPA TIDAK PAKAI onclick INLINE: CSP situs memakai `script-src 'self'`
    // yang MEMBLOKIR event handler inline. Terlihat di Console Firefox user:
    //   "Content-Security-Policy: blocked an event handler (script-src-attr)
    //    ... violates 'script-src self'"
    // Akibatnya tombol "Coba lagi" TIDAK berfungsi saat diklik.
    // Delegasi event di bawah ini tidak melanggar CSP.
    document.addEventListener("click", (e) => {
      const el = e.target && e.target.closest ? e.target.closest("[data-action='retry-dataset']") : null;
      if (el) {
        e.preventDefault();
        fetchDataset(true);
      }
    });

    function renderDatasetTable() {
      const tbody = document.getElementById("dataset-tbody");
      const infoEl = document.getElementById("dataset-pagination-info");
      const controlsEl = document.getElementById("dataset-pagination-controls");
      if (!tbody) return;

      const total = cachedDatasetPairs.length;
      if (total === 0) {
        setHtmlIfChanged(tbody, `<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2.5rem;">Tidak ada data percakapan yang cocok dengan filter pencarian.</td></tr>`);
        if (infoEl) infoEl.textContent = "Tidak ada percakapan ditemukan";
        setHtmlIfChanged(controlsEl, "");
        return;
      }

      const totalPages = Math.ceil(total / DATASET_PAGE_SIZE);
      if (currentDatasetPage > totalPages) currentDatasetPage = totalPages;
      if (currentDatasetPage < 1) currentDatasetPage = 1;

      const startIdx = (currentDatasetPage - 1) * DATASET_PAGE_SIZE;
      const endIdx = Math.min(startIdx + DATASET_PAGE_SIZE, total);
      const pageItems = cachedDatasetPairs.slice(startIdx, endIdx);

      // JANGAN kosongkan tbody di sini (perbaikan blink 24 Sep): baris dibangun
      // di fragmen, lalu dibandingkan; kalau sama DOM tidak disentuh.
      const __frag = document.createDocumentFragment();
      pageItems.forEach(p => {
        const tr = document.createElement("tr");

        const platformBadge = p.platform === "whatsapp"
          ? `<span class="badge badge-wa">WhatsApp</span>`
          : `<span class="badge badge-tele">Telegram</span>`;

        // Identitas pengirim: tampilkan PENUH tanpa prefix internal "wa_", dan
        // beri label supaya ID Telegram tidak terbaca sebagai nomor WhatsApp.
        const isWaChat = p.platform === "whatsapp";
        const idLabel = isWaChat ? "Nomor WA" : "ID Telegram";
        const idValue = String(p.chatId || p.chatIdMasked || "-").replace(/^(wa_|tg_)/, "");
        const idTitle = isWaChat
          ? "Nomor WhatsApp pengirim"
          : "ID internal Telegram (bukan nomor HP)";

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
            <div style="font-family: var(--font-mono); font-size: 0.775rem; color: var(--text-dim); display: flex; align-items: baseline; gap: 0.35rem; flex-wrap: wrap;">
              <span style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted);">${idLabel}</span>
              <span title="${escapeHtml(idTitle)}">${escapeHtml(idValue)}</span>
            </div>
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
        __frag.appendChild(tr);
      });

      // Bandingkan dulu: kalau isi tabel identik dengan render sebelumnya,
      // JANGAN sentuh DOM — inilah yang mencegah tabel berkedip tiap refresh.
      const __htmlBaru = (() => {
        const tmp = document.createElement("tbody");
        tmp.appendChild(__frag.cloneNode(true));
        return tmp.innerHTML;
      })();
      if (tbody.__lastHtml !== __htmlBaru) {
        tbody.innerHTML = "";
        tbody.appendChild(__frag);
        tbody.__lastHtml = __htmlBaru;
      }

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

        setHtmlIfChanged(controlsEl, paginationHtml);
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
      const tz = "UTC"; // Sama dengan rentang statistik dan reset kuota.

      // Token TIDAK ditaruh di URL (bocor ke log proxy/history browser). Unduh via
      // fetch ber-header, lalu buat blob — URL hanya hidup sesaat di memori.
      const url = `/api/dataset?format=${format}&q=${encodeURIComponent(q)}&range=${encodeURIComponent(range)}&platform=${encodeURIComponent(platform)}&model=${encodeURIComponent(model)}&tz=${encodeURIComponent(tz)}&limit=3000`;

      const filePrefix = "riwayat_percakapan";
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


    // ---------------------------------------------------------------------
    // TIMER AUTO-REFRESH TERPUSAT (perbaikan blink 24 Sep).
    //
    // BUG: ada 3 tempat memasang setInterval ke `refreshTimer` tanpa memeriksa
    // apakah sudah ada timer berjalan (saat login, saat toggle Auto, dan saat
    // init). Akibatnya timer MENUMPUK: fetchData dipanggil 2-3x beruntun tiap
    // siklus, dan karena setiap panggilan menulis ulang seluruh isi kartu
    // (innerHTML), dashboard tampak berkedip/glitch setiap refresh.
    //
    // Sekarang semua pemasangan lewat satu fungsi yang selalu membersihkan
    // timer lama lebih dulu — dijamin hanya satu timer aktif.
    // ---------------------------------------------------------------------
    function pasangAutoRefresh() {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      if (!autoRefresh || document.hidden) return;
      refreshTimer = setInterval(() => {
        updateFreshness();
        fetchData();
      }, REFRESH_MS);
    }

    function toggleAutoRefresh() {
      autoRefresh = !autoRefresh;
      const btn = document.getElementById("btn-auto");
      btn.setAttribute("aria-pressed", String(autoRefresh));
      if (autoRefresh) {
        btn.classList.add("active");
        btn.querySelector("span").textContent = "Otomatis 5 dtk";
        pasangAutoRefresh();
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
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && statsRequest) { statsRequest.controller.abort(); statsRequest = null; ++statsGeneration; }
        pasangAutoRefresh();
        if (!document.hidden) { updateFreshness(); if (autoRefresh) fetchData(true); }
      });
      document.getElementById('pool-grid')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-toggle-keys]');
        if (!button) return;
        const expanded = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(expanded));
        button.closest('.provider-card').querySelector('.keys-list').classList.toggle('keys-list-scroll', !expanded);
        button.textContent = expanded ? 'Ringkas daftar kunci' : 'Lihat semua kunci';
      });
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

      // ---------------------------------------------------------------------
      // ANIMASI MASUK HANYA SEKALI (perbaikan blink 24 Sep).
      //
      // BUG: fungsi ini dipanggil setiap kali dashboard selesai render
      // (renderDashboard -> setTimeout(initDashboardScrollReveal)). Setiap
      // panggilan menambahkan kelas `reveal-init` (opacity: 0) ke elemen yang
      // SUDAH terlihat, lalu observer baru menambahkan `revealed` beberapa saat
      // kemudian. Karena render berjalan tiap 15 detik, seluruh kartu berkedip
      // hilang-muncul — inilah "blink blink glitch" yang terlihat.
      //
      // Perbaikan: animasi masuk hanya dijalankan SEKALI per pemuatan halaman.
      // Render berikutnya (refresh data) tidak menyentuh kelas animasi, jadi
      // angka berubah mulus tanpa kedip.
      // ---------------------------------------------------------------------
      if (window._dashRevealDone) return;
      window._dashRevealDone = true;

      const targets = document.querySelectorAll(
        ".console-head, .kpi-card, .smart-gateway-banner, .matrix-section, .provider-card, .live-upstream-card, #dataset-section, .model-matrix-card"
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
        pasangAutoRefresh();
        // Dataset ikut disegarkan pada interval yang sama, tapi TIDAK di setiap
        // tick: tabel riwayat ditulis ulang penuh, dan menyegarkannya tiap 15
        // detik membuat baris tabel berkedip tanpa manfaat (datanya jarang
        // berubah). Cukup tiap 3 siklus (~45 detik).
        if (!window._datasetTick) window._datasetTick = 0;
        window._datasetTick++;
        if (window._datasetTick % 3 === 0) fetchDataset(true);
      }
    })();
