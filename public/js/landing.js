// Landing page: ganti bahasa (ID/EN) dan statistik nyata dari sistem.
// Berkas terpisah karena CSP produksi hanya mengizinkan script-src 'self'
// (tidak ada script inline).
(function () {
  'use strict';

  /* ==========================================================================
     Kamus bahasa. Kunci diambil dari atribut data-i18n pada HTML.
     Bahasa utama Indonesia; Inggris disediakan lewat tombol di header.
     ========================================================================== */
  var DICT = {
    en: {
      'brand.sub': 'WhatsApp & Telegram',
      'nav.capabilities': 'Capabilities',
      'nav.status': 'System status',
      'nav.console': 'Console',
      'nav.menu': 'Open navigation menu',

      'hero.title.a': 'An AI assistant that is',
      'hero.title.b': 'always ready',
      'hero.title.c': 'in your chat.',
      'hero.lead':
        'Send a message as usual on WhatsApp or Telegram. Behind it, six AI providers are tried in order, so your message still gets answered even when one provider is busy.',
      'hero.cta.primary': 'Open monitoring console',
      'hero.cta.secondary': 'See what it handles',

      'fact.messages': 'messages stored',
      'fact.keys': 'active API keys',
      'fact.models': 'models used',
      'fact.chats': 'conversations',

      'chain.title': 'Provider chain',
      'chain.sub': 'tried in order',
      'chain.primary': 'Primary',
      'chain.standby': 'Standby',
      'chain.1.role': 'Eight keys, rotated per request',
      'chain.2.role': 'Includes the image models',
      'chain.3.role': 'Fast, tight per-minute quota',
      'chain.4.role': 'Broad standby, free models',
      'chain.5.role': 'Ten keys, large token balance',
      'chain.6.role': 'Last layer, one million token context',
      'chain.foot':
        'If one layer is full or stops responding, the system moves to the next one without you changing anything.',

      'cap.title': 'What it handles',
      'cap.lead': 'Beyond plain text, these run every day.',

      'cap.voice.title': 'Voice messages',
      'cap.voice.body':
        'The recording is transcribed first, then answered like any text message.',
      'cap.voice.p1': 'OGG and MP3 from both WhatsApp and Telegram',
      'cap.voice.p2': 'The transcript is kept in the console history',
      'cap.voice.r1': 'Recording received',
      'cap.voice.r2': 'Transcribed text',
      'cap.voice.r3': 'Answered as text',

      'cap.image.title': 'Images and stickers',
      'cap.image.body':
        'Text inside a sticker is read first. When there is no text, the image and its context are read instead.',
      'cap.image.p1': 'WhatsApp and Telegram stickers, including animated ones',
      'cap.image.p2': 'Replies do not describe your upload, they simply respond',
      'cap.image.r1': 'Upload received',
      'cap.image.r2': 'Text inside is read',
      'cap.image.r2v': 'when present',
      'cap.image.r3': 'Answered naturally',
      'cap.image.r3v': 'no description',

      'cap.doc.title': 'Documents and links',
      'cap.doc.body':
        'PDF, Word, and web page contents are read, then summarised or answered based on your question.',
      'cap.doc.p1': 'PDF, DOCX, and plain text',
      'cap.doc.p2': 'Web pages are read in full, not just the headline',
      'cap.doc.r1': 'File opened',
      'cap.doc.r2': 'Link content fetched',
      'cap.doc.r2v': 'full page',
      'cap.doc.r3': 'Summarised or answered',
      'cap.doc.r3v': 'to your question',

      'cap.memory.title': 'Conversation memory',
      'cap.memory.body':
        'Even when the answering model changes mid-conversation, the thread stays connected. Facts you mention are remembered.',
      'cap.memory.p1': 'Names, places, and habits you mention are remembered',
      'cap.memory.p2': 'Knowledge the system lacks is looked up first, then stored',
      'cap.memory.r1': 'Fact mentioned',
      'cap.memory.r1v': 'once is enough',
      'cap.memory.r2': 'Model switches',
      'cap.memory.r2v': 'thread stays',
      'cap.memory.r3': 'Recalled when relevant',
      'cap.memory.r3v': 'no leakage',

      'steps.title': 'How to use it',
      'steps.lead': 'Nothing to install on your phone.',
      'steps.1.title': 'Message the number',
      'steps.1.body': 'Save the WhatsApp number or open the Telegram bot, then send any message.',
      'steps.2.title': 'Chat as usual',
      'steps.2.body': 'Ask about the weather, request a riddle, send a photo or a document. The tone follows yours.',
      'steps.3.title': 'Watch it in the console',
      'steps.3.body': 'The console shows each key quota, which model answered, and the conversation history.',

      'status.title': 'System status today',
      'status.lead':
        'These figures come straight from the system database, not from samples. Open the console for per-key and per-model detail.',
      'status.1.label': 'Total messages',
      'status.1.note': 'Since the system started',
      'status.2.label': 'Conversations',
      'status.2.note': 'Unique conversations recorded',
      'status.3.label': 'AI providers',
      'status.3.note': 'Enabled and tried in order',
      'status.4.label': 'API keys',
      'status.4.note': 'Rotated so quota is spread evenly',
      'status.foot': 'The figures on this page refresh every minute from the system database.',

      'cta.title': 'See the inside for yourself',
      'cta.body':
        'The console shows quota, models, and conversation history as they are. Nothing is hidden.',
      'cta.primary': 'Open monitoring console',
      'cta.secondary': 'Read the capabilities again',

      'footer.desc':
        'An AI assistant for WhatsApp and Telegram. Six providers are tried in order so messages still get answered.',
      'footer.nav': 'Pages',
      'footer.legal': 'Terms',
      'footer.follow': 'Follow',
      'footer.privacy': 'Privacy policy',
      'footer.data': 'Data handling',
      'footer.contact': 'Contact',
      'footer.terms': 'Terms of use',
      'footer.version': 'version',
    },
  };

  /* Teks Indonesia disimpan dari HTML aslinya saat halaman dimuat, supaya
     berpindah balik ke Indonesia tidak perlu menyalin ulang seluruh kalimat. */
  var ID = {};
  var nodes = document.querySelectorAll('[data-i18n]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var key = el.getAttribute('data-i18n');
    if (!(key in ID)) ID[key] = el.textContent;
  }

  // Label khusus untuk atribut aria, disimpan terpisah.
  var ariaNodes = document.querySelectorAll('[data-i18n-aria]');
  var ARIA_ID = {};
  for (var j = 0; j < ariaNodes.length; j++) {
    var an = ariaNodes[j];
    var akey = an.getAttribute('data-i18n-aria');
    if (!(akey in ARIA_ID)) ARIA_ID[akey] = an.getAttribute('aria-label') || '';
  }

  var lang = 'id';
  try {
    var stored = localStorage.getItem('freeaibot-lang');
    if (stored === 'en' || stored === 'id') lang = stored;
  } catch (e) {
    lang = 'id';
  }

  function apply(next) {
    lang = next;
    var table = next === 'en' ? DICT.en : ID;

    for (var k = 0; k < nodes.length; k++) {
      var el = nodes[k];
      var key = el.getAttribute('data-i18n');
      if (table && key in table) el.textContent = table[key];
    }

    var ariaTable = next === 'en' ? DICT.en : ARIA_ID;
    for (var m = 0; m < ariaNodes.length; m++) {
      var ae = ariaNodes[m];
      var ak = ae.getAttribute('data-i18n-aria');
      if (ariaTable && ak in ariaTable) ae.setAttribute('aria-label', ariaTable[ak]);
    }

    document.documentElement.lang = next;
    var label = document.getElementById('langLabel');
    if (label) label.textContent = next === 'id' ? 'ID' : 'EN';

    try {
      localStorage.setItem('freeaibot-lang', next);
    } catch (e) {
      /* penyimpanan diblokir: bahasa tetap berlaku untuk sesi ini */
    }
  }

  var toggle = document.getElementById('langToggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      apply(lang === 'id' ? 'en' : 'id');
    });
  }

  apply(lang);

  /* ==========================================================================
     Statistik nyata. Angka diambil dari /api/public-stats yang membaca basis
     data sistem. Bila gagal, sel tetap menampilkan tanda pisah, bukan angka
     karangan (aturan R-17/R-38).
     ========================================================================== */
  function fmt(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '\u2013';
    try {
      return n.toLocaleString(lang === 'en' ? 'en-US' : 'id-ID');
    } catch (e) {
      return String(n);
    }
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function render(data) {
    if (!data || data.ok !== true) {
      // Tetap tampilkan jumlah kunci dan penyedia: itu dibaca dari konfigurasi
      // server yang sudah pasti ada, bukan dari basis data.
      if (data) {
        setText('stat-keys', fmt(data.providerKeys));
        setText('stat-keys2', fmt(data.providerKeys));
        setText('stat-providers', fmt(data.providers));
      }
      return;
    }

    setText('stat-messages', fmt(data.totalMessages));
    setText('stat-keys', fmt(data.providerKeys));
    setText('stat-models', fmt(data.activeModels));
    setText('stat-chats', fmt(data.totalChats));

    setText('stat-total', fmt(data.totalMessages));
    setText('stat-chats2', fmt(data.totalChats));
    setText('stat-providers', fmt(data.providers));
    setText('stat-keys2', fmt(data.providerKeys));

    if (data.sinceDate) {
      var since = document.getElementById('stat-since');
      if (since) {
        var d = data.sinceDate;
        since.textContent = lang === 'en' ? 'Since ' + d : 'Sejak ' + d;
      }
    }
  }

  if (typeof fetch === 'function') {
    fetch('/api/public-stats', { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(render)
      .catch(function () {
        // Gagal memuat: biarkan tanda pisah. Halaman tetap terbaca.
      });
  }

  /* Menu ponsel: buka/tutup, Escape menutup, klik di luar menutup. */
  var navToggle = document.getElementById('navToggle');
  var nav = document.getElementById('siteNav');

  function closeNav() {
    if (!nav || !navToggle) return;
    nav.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
  }

  if (navToggle && nav) {
    navToggle.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var open = nav.classList.toggle('is-open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('click', function (ev) {
      if (!nav.classList.contains('is-open')) return;
      if (nav.contains(ev.target) || navToggle.contains(ev.target)) return;
      closeNav();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') closeNav();
    });

    nav.addEventListener('click', function (ev) {
      if (ev.target.closest('a')) closeNav();
    });
  }
})();
