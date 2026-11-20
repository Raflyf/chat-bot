/**
 * PENANDA STATUS WHATSAPP DI LANDING PAGE
 *
 * KENAPA ADA:
 *   Landing page mengklaim "Online 24/7". Saat WhatsApp Cloud API terblokir Meta
 *   (mis. payment method belum tertaut -> error 141006), klaim itu MENYESATKAN:
 *   pengguna mengirim pesan ke WhatsApp tetapi tidak pernah menerima balasan.
 *
 * YANG DILAKUKAN:
 *   - Membaca `/api/health` (field `whatsapp_maintenance`).
 *   - Bila WhatsApp sedang pemeliharaan, label status diubah menjadi
 *     "Telegram Online · WhatsApp Maintenance" + pill diberi warna peringatan.
 *   - Tetap ramah bila endpoint tidak tersedia (diamkan, tidak error).
 *
 * CATATAN: modul ini hanya menyentuh tampilan. Tidak ada data sensitif.
 */
(function () {
  if (typeof window === 'undefined') return;

  var KUNCI = 'nav.status';
  var KUNCI_CTA_WA = 'hero.cta.wa';
  var WA_CADANGAN_DEFAULT = 'https://wa.me/6287789587654';
  var WA_URL_AMAN = /^https:\/\/wa\.me\/\d{8,16}$/;

  function teksPeringatan() {
    // Sama untuk ID & EN supaya tidak perlu menunggu kamus i18n dimuat.
    return 'Telegram Online · WhatsApp Maintenance';
  }

  function cariElemenI18n(kunci, root) {
    var scope = root || document;
    var semua = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < semua.length; i++) {
      if (semua[i].getAttribute('data-i18n') === kunci) return semua[i];
    }
    return null;
  }

  function terapkan() {
    if (!window.__waMaintenance) return;
    // Cari elemen status berdasarkan NILAI atributnya (bukan menyusun selector
    // dengan konkatenasi) supaya pemeriksa kelengkapan i18n tidak salah membaca
    // potongan kode sebagai kunci terjemahan.
    var el = cariElemenI18n(KUNCI);
    if (el) {
      el.textContent = teksPeringatan();
      var pill = el.closest ? el.closest('.status-pill') : null;
      if (pill) {
        pill.classList.add('status-pill--warn');
        var alasan = window.__waMaintenanceAlasan ? ' (' + window.__waMaintenanceAlasan + ')' : '';
        pill.setAttribute('title', 'WhatsApp sedang pemeliharaan' + alasan + '. Telegram aktif normal.');
      }
    }

    var waBtn = document.querySelector('a.btn-wa');
    if (waBtn) {
      waBtn.setAttribute('href', window.__waBackupUrl || WA_CADANGAN_DEFAULT);
      waBtn.setAttribute('title', 'Bot WA utama sedang pemeliharaan — dialihkan ke WhatsApp cadangan.');
      var ctaLabel = cariElemenI18n(KUNCI_CTA_WA, waBtn);
      if (ctaLabel) {
        var lang = (document.documentElement && document.documentElement.lang) || 'id';
        ctaLabel.textContent = lang === 'en'
          ? 'Start Chat on WhatsApp (Backup)'
          : 'Mulai Chat di WhatsApp (Cadangan)';
      }
    }
  }

  function cek() {
    try {
      fetch('/api/health', { cache: 'no-store' })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (d) {
          if (!d || !d.whatsapp_maintenance) return;
          window.__waMaintenance = true;
          window.__waMaintenanceAlasan = d.whatsapp_maintenance_alasan || '';
          window.__waBackupUrl = (typeof d.whatsapp_backup_url === 'string' && WA_URL_AMAN.test(d.whatsapp_backup_url))
            ? d.whatsapp_backup_url
            : WA_CADANGAN_DEFAULT;
          terapkan();
        })
        .catch(function () { /* status opsional: jangan ganggu halaman */ });
    } catch (e) { /* fetch tidak tersedia: abaikan */ }
  }

  // Terapkan ulang setelah pengguna berganti bahasa (i18n menimpa textContent).
  var asliSetLanguage = window.setLanguage;
  if (typeof asliSetLanguage === 'function') {
    window.setLanguage = function (lang) {
      var hasil = asliSetLanguage(lang);
      terapkan();
      return hasil;
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cek);
  } else {
    cek();
  }
})();
