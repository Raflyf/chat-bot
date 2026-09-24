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
      "feat.subheading": "Backed by free provider stack (Groq, Gemini, OpenRouter, Ollama) with automated failover.",
      "feat.1.title": "Sub-Second Voice Note Transcription",
      "feat.1.desc": "Send voice notes on WhatsApp or Telegram. Groq Whisper model transcribes voice to text instantly (~500ms) and AI answers naturally.",
      "feat.2.title": "PDF & Word Document Analysis",
      "feat.2.desc": "Upload .pdf or .docx files. AI reads tables, charts, chapters, and source code up to dozens of pages for summarizing, analyzing, or evaluating.",
      "feat.3.title": "Contextual Photo & Sticker Analysis",
      "feat.3.desc": "Analyzed by Google Gemini Vision. Capable of reading homework photos, flowcharts, graphs, screenshots, and understanding WhatsApp sticker expressions.",
      "feat.4.title": "Persistent Memory & Distillation",
      "feat.4.desc": "Backed by Supabase PostgreSQL with Row Level Security. The bot remembers previous conversation context and user speech preferences.",
      "feat.5.title": "4-Provider Failover Chain",
      "feat.5.desc": "If a model hits rate limit, the system automatically switches to the next provider (Groq → Gemini → OpenRouter → Ollama) in milliseconds.",
      "feat.6.title": "Genuine Interaction Without Templates",
      "feat.6.desc": "Free of robotic clichés and rigid formats. Interacts fluidly like a close friend and an insightful discussion partner.",
      "teaser.title": "Monitoring Console & AI Training Dataset",
      "teaser.desc": "Monitor API key pool usage, daily quotas, conversation traffic, and download chat logs in JSONL/CSV format for AI model fine-tuning.",
      "teaser.btn": "Access Admin Dashboard",
      "footer.text": "FreeAIBot Production Suite • Vercel Serverless • Supabase Engine • Version v0.80.0",

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
      "dash.download.csv": "Download CSV"
    }
  };

  var ID_STORAGE = {};

  function initI18n() {
    // Simpan teks asli ID dari DOM saat pertama kali load
    var nodes = document.querySelectorAll("[data-i18n]");
    nodes.forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (key && !(key in ID_STORAGE)) {
        ID_STORAGE[key] = el.textContent.trim();
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

  window.setLanguage = applyLanguage;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initI18n);
  } else {
    initI18n();
  }
})();
