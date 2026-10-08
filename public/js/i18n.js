// Sistem Internasionalisasi (i18n) Bebas Slop untuk FreeAIBot
// Mendukung perpindahan bahasa ID <-> EN dengan persistensi localStorage
(function () {
  if (typeof window === "undefined") return;

  var DICTIONARY = {
    en: {
      // Landing Page
      "brand.sub": "Personal AI Assistant",
      "nav.status": "Online 24/7",
      "nav.dashboard": "Monitoring Dashboard",
      "hero.badge": "PRODUCTION SYSTEM • MULTI-PLATFORM VERIFIED",
      "hero.title": "Intelligent, Multimodal AI Assistant & Ready 24/7 Nonstop",
      "hero.sub": "Directly connected to WhatsApp and Telegram with Whisper Voice Note transcription, PDF & Word document analysis, vision image processing, and persistent conversational memory.",
      "hero.cta.wa": "Start Chat on WhatsApp",
      "hero.cta.tele": "Start Chat on Telegram",
      "hero.cta.dash": "Open Dashboard Panel",
      "feat.heading": "Limitless Full Capabilities",
      "feat.subheading": "Backed by multi-provider architecture with high-reliability automated failover.",
      "feat.1.title": "Sub-Second Voice Note Transcription",
      "feat.1.desc": "Send voice notes on WhatsApp or Telegram. Audio is transcribed to text instantly and AI answers naturally.",
      "feat.2.title": "PDF & Word Document Analysis",
      "feat.2.desc": "Upload .pdf or .docx files. AI reads tables, charts, chapters, and source code up to dozens of pages for summarizing, analyzing, or evaluating.",
      "feat.3.title": "Contextual Photo & Sticker Analysis",
      "feat.3.desc": "Analyzed by integrated multimodal vision models. Capable of reading homework photos, flowcharts, graphs, screenshots, and understanding WhatsApp sticker expressions.",
      "feat.4.title": "Persistent Memory & Distillation",
      "feat.4.desc": "Backed by Supabase PostgreSQL with Row Level Security. The bot remembers previous conversation context and user speech preferences.",
      "feat.5.title": "Automated Failover Chain",
      "feat.5.desc": "If a primary route hits capacity or disruption, the system automatically switches to the backup route in milliseconds.",
      "feat.6.title": "Genuine Interaction Without Templates",
      "feat.6.desc": "Free of robotic clichés and rigid formats. Interacts fluidly like a close friend and an insightful discussion partner.",
      "teaser.title": "Monitoring Console & AI Training Dataset",
      "teaser.desc": "Monitor API key pool usage, daily quotas, conversation traffic, and download chat logs in JSONL/CSV format for AI model fine-tuning.",
      "teaser.btn": "Access Admin Dashboard",
      // ── Form Laporan (ditambahkan 08 Okt 2026) ──
      // CATATAN: patch pertama GAGAL karena key-nya tidak ikut masuk kamus —
      // akibatnya tombol EN tidak mengubah form laporan sama sekali.
      // Selalu audit dengan: bandingkan data-i18n di HTML vs kamus ini.
      "footer.ver": "Version",
      "lapor.heading": "Something Off? Report It to Us",
      "lapor.subheading": "Bot replying off-topic, misunderstanding, or giving weird responses? Paste the conversation or attach a screenshot here. Reports go straight to the maintainer.",
      "lapor.label": "Describe the problem *",
      "lapor.placeholder": "Paste the wrong conversation, or describe what happened... (e.g. I asked to count menus from a spreadsheet, but the bot gave a usage guide instead)",
      "lapor.label.file": "Attach a screenshot (optional, max 2 MB)",
      "lapor.hintfile": "Format: PNG, JPG, WEBP, or GIF.",
      "lapor.hapusfile": "Remove image",
      "lapor.kirim": "Send Report",
      "lapor.note": "No need to enter your WhatsApp number — reports go straight to the bot maintainer.",
      // "footer.text" sengaja TIDAK ada di kamus: teks footer memuat versi
      // aplikasi yang dikirim dinamis dari /api/stats. Kalau didefinisikan di
      // sini, mengganti bahasa akan menimpanya dengan angka basi (v0.80.0).


      // Dashboard
      "dash.back": "Back to Home",
      "dash.status.full": "System active",
      "dash.status.short": "Active",
      "dash.auto": "Auto 15s",
      "dash.refresh": "Refresh",
      "dash.logout": "Lock out",
      "dash.title": "System Monitoring",
      "dash.desc": "Key quotas, responding models, and conversation history. All figures fetched directly from providers and database.",
      "dash.sync": "Last sync:",
      "dash.kpi.total": "Total Conversations",
      "dash.kpi.inbound": "Inbound Messages",
      "dash.kpi.active": "Active Models",
      "dash.kpi.keys": "Available API Keys",
      "dash.gateway.title": "Smart Gateway & Model Routing",
      "dash.matrix.title": "Model Status & Realtime Quota",
      "dash.pool.title": "Provider API Key Pools",
      "dash.upstream.title": "Upstream Provider Status",
      "dash.token.title": "Token Consumption Distribution",
      "dash.dataset.title": "AI Training Dataset",
      "dash.download.jsonl": "Download JSONL",
      "dash.download.csv": "Download CSV",
      // Kunci dinamis untuk dashboard.js (dipanggil via window.t)
      "dyn.sessionLost": "Authentication session lost or invalid (server refresh). Please enter the Master PIN again.",
      "dyn.sessionExpired": "The 15-minute admin session ended for security. Please enter the Master PIN again.",
      "dyn.authServerFail": "Failed to reach the security server. Please try again.",
      "dyn.sendingOtp": "Sending OTP code to admin email...",
      "dyn.otpNetworkErr": "Network error while sending OTP.",
      "dyn.resendOtpIn": "Resend OTP ({s})",
      "dyn.resendOtp": "Resend OTP",
      "dyn.otpMust6": "OTP code must be 6 digits.",
      "dyn.pinMust4to8": "New Master PIN must be 4 to 8 digits.",
      "dyn.pinNoMatch": "New PIN confirmation does not match.",
      "dyn.verifyingOtp": "Verifying OTP and resetting PIN...",
      "dyn.pinSaved": "New PIN saved. Please enter your new PIN.",
      "dyn.resetConnErr": "Connection error while resetting PIN.",
      "dyn.locked": "Access is locked due to too many attempts. Wait 1 minute or use Email Reset.",
      "dyn.sync": "Sync",
      "dyn.messages": "Messages",
      "dyn.callsTokens": "API Calls & Tokens",
      "dyn.keysMonitored": "keys monitored",
      "dyn.topModel": "Most Popular Model",
      "dyn.resetNote": "Reset: 00:00 UTC (Cloudflare, OpenRouter, Groq, Dahl) • 00:00 PT (Gemini) • Rolling 24h (Dahl)",
      "dyn.accumPeriod": "Period Accumulation",
      "dyn.modelDist": "LLM Model Distribution",
      "dyn.mediaTypes": "Media Type Processing",
      "dyn.datasetFail": "Failed to load history (HTTP {s}).",
      "dyn.retry": "Retry",
      "dyn.adminSessionOff": "Admin session not active.",
      "dyn.loadingData": "Loading data...",
      "dyn.noData": "No data yet",
      "dyn.prev": "Previous",
      "dyn.next": "Next",
      "dyn.verifiedAccount": "Verified Account",
      "dyn.quotaLeft": "Remaining quota",
      "dyn.usedToday": "Used today",
      "dyn.tokenLeft": "Remaining Token Balance",
      "dyn.tpdLeft": "Remaining Daily Tokens (TPD)",
      "dyn.calls": "calls",
      "dyn.neuronUsed": "neurons used (approx. {s} tokens)",
      "dyn.backup": "Backup",
      "dyn.active": "Active",
      "dyn.standby": "Standby",
      "dyn.keysActive": "active keys",
      "dyn.providersActive": "Active AI Providers",
      "dyn.cleanQuota": "Clean Quota Available",
      "dyn.searchesUsed": "{u} of {c} searches used ({p}%)",
      "dyn.quotaLeftPct": "{p}% quota still remaining",
      "dyn.quotaEstPct": "{p}% quota remaining (estimated from ready keys)",
      "dyn.allProviders": "All providers",
      "dyn.tier": "Tier",
      "dyn.totalExec": "Total Executions",
      "dyn.uptime": "Uptime",
      "dyn.latency": "Latency",
      "dyn.success": "Success",
      "dyn.quota": "Quota",
      "dyn.dailyLimit": "Daily limit",
      "dyn.hourlyLimit": "Hourly limit",
      "dyn.searchUsed": "Searches used",
      "dyn.searchLeft": "Remaining quota",
      "dyn.keysReady": "Ready-to-use keys",
      "dyn.allKeysOk": "All keys available",
      "dyn.capPerKey": "Cap per key",
      "dyn.searchPerKey": "searches per key per day",
      "dyn.waitingData": "Waiting for data",
      "dyn.globalAccum": "Global accumulation",
      "dyn.allRegistered": "All registered providers",
      "dyn.waFreeSessions": "Free sessions left this month",
      "dyn.liveSync": "Live sync",
      "dyn.neuronCap": "NEURON CAP",
      "dyn.tokenCap": "TOKEN CAP",
      "dyn.providerAndKey": "Provider and key",
      "dyn.registeredAccount": "Registered account",
      "dyn.usageToday": "Usage today",
      "dyn.quotaToday": "Remaining quota today",
      "dyn.validation": "Validation",
      "dyn.cancel": "Cancel",
      "dyn.close": "Close",
      "dyn.save": "Save",
      "dyn.confirm": "Confirm",
      "dash.auth.backHome": "Back to home",
      "dash.footer.home": "Home",
      "dash.auth.title": "Admin security gate",
      "dash.auth.sub": "Enter the Master PIN to open the monitoring console.",
      "dash.auth.submit": "Open console",
      "dash.auth.forgot": "Forgot PIN, reset via email",
      "dash.auth.backPin": "Back to PIN",
      "dash.auth.resetTitle": "Reset Master PIN",
      "dash.auth.resetSent": "Verification code sent to admin email:",
      "dash.auth.resetStep1": "The system sends a 6-digit code to the admin email. The code is valid for 10 minutes.",
      "dash.auth.sendCode": "Send code to email",
      "dash.auth.cancelReset": "Cancel, back to login",
      "dash.auth.otpLabel": "OTP code, 6 digits",
      "dash.auth.newPinLabel": "New Master PIN, 4 to 8 digits",
      "dash.auth.confirmPinLabel": "Repeat new PIN",
      "dash.auth.savePin": "Save new PIN",
      "dash.auth.resendOtp": "Resend OTP",
      "dash.auth.back": "Back",
      "dash.brand": "FreeAIBot Console",
      "dash.theme": "Light",
      "dash.filter.range": "Time range",
      "dash.range.today": "Today",
      "dash.range.7d": "7 days",
      "dash.range.14d": "14 days",
      "dash.range.30d": "30 days",
      "dash.filter.all": "All",
      "dash.filter.platform": "Platform",
      "dash.kpi.today": "Messages today",
      "dash.kpi.total": "Total messages all time",
      "dash.kpi.totalSub": "Stored in Supabase PostgreSQL",
      "dash.kpi.calls": "Provider API calls, today",
      "dash.kpi.keysMonitored": "keys monitored",
      "dash.kpi.keysMonitoredDyn": "keys monitored",
      "dash.kpi.zeroKeys": "0 keys",
      "dash.websearch.usedNote": "of 0 searches",
      "dash.websearch.remainingNote": "searches left",
      "dash.kpi.topModel": "Most used model today",
      "dash.kpi.topModelSub": "Automatic load balancing",
      "dash.pool.reset": "Daily reset 00:00 UTC",
      "dash.filter.allStatus": "All statuses",
      "dash.status.healthy": "Healthy, below 80 percent",
      "dash.status.warning": "Warning, 80 percent or above",
      "dash.status.capped": "Limit reached",
      "dash.upstream.desc": "Figures come from the official provider servers. Includes usage from the bot, IDE, and terminal sharing the same keys.",
      "dash.upstream.liveSync": "Live sync",
      "dash.upstream.totalCap": "Total daily quota cap",
      "dash.upstream.totalCapSub": "All registered providers",
      "dash.upstream.usedToday": "Tokens used today",
      "dash.upstream.usedSub": "Global accumulation",
      "dash.upstream.remaining": "Net remaining quota",
      "dash.upstream.keysConnected": "Connected keys and pools",
      "dash.upstream.waSessions": "WhatsApp Cloud sessions",
      "dash.upstream.waSessionsSub": "Free sessions left this month",
      "dash.websearch.used": "Searches used",
      "dash.websearch.remaining": "Remaining quota",
      "dash.websearch.keys": "Ready-to-use keys",
      "dash.websearch.keysOk": "All keys available",
      "dash.websearch.cap": "Cap per key",
      "dash.websearch.capNote": "searches per key per day",
      "dash.table.provider": "Provider and key",
      "dash.table.account": "Registered account",
      "dash.table.usageToday": "Usage today",
      "dash.table.remainingToday": "Remaining quota today",
      "dash.table.validation": "Validation",
      "dash.matrix.desc": "Health, average latency, and execution count of each model across the eight-tier chain.",
      "dash.matrix.total": "Total inferences",
      "dash.gateway.title": "Automatic router",
      "dash.gateway.desc": "Load distribution and automatic failover between tiers",
      "dash.gateway.how": "How the chain works",
      "dash.matrix.loading": "Loading model matrix",
      "dash.matrix.loadingSub": "Fetching inference data per model.",
      "dash.media.title": "Message types processed today",
      "dash.media.desc": "Message volume by type: text, voice notes, images, stickers, documents, and video.",
      "dash.media.text": "Text",
      "dash.media.voice": "Voice note",
      "dash.media.image": "Image",
      "dash.media.sticker": "Sticker",
      "dash.media.doc": "Document",
      "dash.media.video": "Video",
      "dash.dataset.rangeLabel": "History time range",
      "dash.dataset.desc": "Pairs of user questions and bot replies. Used to assess answer quality and prepare training data.",
      "dash.range.allTime": "All time",
      "dash.range.last7": "Last 7 days",
      "dash.range.last14": "Last 14 days",
      "dash.range.last30": "Last 30 days",
      "dash.filter.allPlatform": "All platforms",
      "dash.filter.allModel": "All models",
      "dash.table.timePlatform": "Time and platform",
      "dash.table.chatModel": "Chat and model",
      "dash.table.token": "Tokens",
      "dash.table.userQuestion": "User question",
      "dash.table.botReply": "Bot reply",
      "dash.table.action": "Action",
      "dash.dataset.loading": "Loading conversation history",
      "dash.dataset.loadingSub": "Waiting for data from the database.",
      "dash.footer.text": "FreeAIBot monitoring console · Vercel Serverless & Supabase PostgreSQL",
      "dash.footer.privacy": "Privacy policy",
    }
  };

  var ID_STORAGE = {};
  var ID_STORAGE_PH = {};

  function initI18n() {
    // Simpan teks asli ID dari DOM saat pertama kali load
    var nodes = document.querySelectorAll("[data-i18n]");
    nodes.forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (key && !(key in ID_STORAGE)) {
        ID_STORAGE[key] = el.textContent.trim();
      }
    });

    // Simpan placeholder asli (bahasa Indonesia) untuk pemulihan.
    var phNodes = document.querySelectorAll("[data-i18n-placeholder]");
    phNodes.forEach(function (el) {
      var key = el.getAttribute("data-i18n-placeholder");
      if (key && !(key in ID_STORAGE_PH)) {
        ID_STORAGE_PH[key] = el.getAttribute("placeholder") || "";
      }
    });

    var lang = "id";
    try {
      var stored = localStorage.getItem("freeaibot-lang");
      if (stored === "en" || stored === "id") lang = stored;
    } catch (e) {
      lang = "id";
    }

    applyLanguage(lang);

    var toggleBtn = document.getElementById("btn-lang-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function () {
        var current = document.documentElement.lang === "en" ? "en" : "id";
        var next = current === "id" ? "en" : "id";
        applyLanguage(next);
      });
    }
  }

  function applyLanguage(targetLang) {
    document.documentElement.lang = targetLang;

    var nodes = document.querySelectorAll("[data-i18n]");
    nodes.forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (!key) return;

      if (targetLang === "en") {
        if (DICTIONARY.en && DICTIONARY.en[key]) {
          el.textContent = DICTIONARY.en[key];
        }
      } else {
        if (ID_STORAGE[key]) {
          el.textContent = ID_STORAGE[key];
        }
      }
    });

    // Placeholder (atribut, bukan teks isi) — dipakai form laporan.
    var phNodes = document.querySelectorAll("[data-i18n-placeholder]");
    phNodes.forEach(function (el) {
      var key = el.getAttribute("data-i18n-placeholder");
      if (!key) return;
      if (targetLang === "en") {
        if (DICTIONARY.en && DICTIONARY.en[key]) el.setAttribute("placeholder", DICTIONARY.en[key]);
      } else if (ID_STORAGE_PH[key]) {
        el.setAttribute("placeholder", ID_STORAGE_PH[key]);
      }
    });

    // ── Opsi <select>: sebagian browser tidak menerapkan textContent pada
    //    <option> yang sedang tidak aktif, jadi diset eksplisit (temuan 08 Okt 2026).
    var optNodes = document.querySelectorAll("option[data-i18n]");
    optNodes.forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (!key) return;
      if (targetLang === "en") {
        if (DICTIONARY.en && DICTIONARY.en[key]) el.textContent = DICTIONARY.en[key];
      } else if (ID_STORAGE[key]) {
        el.textContent = ID_STORAGE[key];
      }
    });

    var langLabel = document.getElementById("lang-label");
    if (langLabel) {
      langLabel.textContent = targetLang === "id" ? "ID" : "EN";
    }

    var toggleBtn = document.getElementById("btn-lang-toggle");
    if (toggleBtn) {
      toggleBtn.setAttribute(
        "title",
        targetLang === "id" ? "Ganti ke Bahasa Inggris (Switch to English)" : "Switch to Indonesian (Ganti ke Bahasa Indonesia)"
      );
      toggleBtn.setAttribute(
        "aria-label",
        targetLang === "id" ? "Ganti ke Bahasa Inggris" : "Switch to Indonesian"
      );
    }

    if (window.updateThemeUI) {
      window.updateThemeUI();
    }

    try {
      localStorage.setItem("freeaibot-lang", targetLang);
    } catch (e) {}
  }

  // ── HELPER TERJEMAHAN UNTUK JS (temuan 08 Okt 2026) ──
  // dashboard.js merender ~47 teks secara DINAMIS (innerHTML), sehingga
  // data-i18n tidak menjangkau. Helper t(key, fallback) dipakai di sana.
  //
  // Kunci dinamis (dash.dyn.*) diletakkan di kamus yang sama.
  window.t = function (key, fallback) {
    var lang = document.documentElement.lang === 'en' ? 'en' : 'id';
    if (lang === 'en' && DICTIONARY.en && DICTIONARY.en[key]) return DICTIONARY.en[key];
    return fallback !== undefined ? fallback : key;
  };

  window.setLanguage = applyLanguage;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initI18n);
  } else {
    initI18n();
  }
})();
