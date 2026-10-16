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

  function teksPeringatan() {
    // Sama untuk ID & EN supaya tidak perlu menunggu kamus i18n dimuat.
    return 'Telegram Online · WhatsApp Maintenance';
  }

  function terapkan() {
    if (!window.__waMaintenance) return;
    // Cari elemen status berdasarkan NILAI atributnya (bukan menyusun selector
    // dengan konkatenasi) supaya pemeriksa kelengkapan i18n tidak salah membaca
    // potongan kode sebagai kunci terjemahan.
    var semua = document.querySelectorAll('[data-i18n]');
    var el = null;
    for (var i = 0; i < semua.length; i++) {
      if (semua[i].getAttribute('data-i18n') === KUNCI) { el = semua[i]; break; }
    }
    if (!el) return;
    el.textContent = teksPeringatan();
    var pill = el.closest ? el.closest('.status-pill') : null;
    if (pill) {
      pill.classList.add('status-pill--warn');
      pill.setAttribute('title', 'WhatsApp sedang pemeliharaan (payment method Meta). Telegram aktif normal.');
    }
  }

  function cek() {
    try {
      fetch('/api/health', { cache: 'no-store' })
        .then(function (r) { return r.json().catch(function () { return null; }); })
        .then(function (d) {
          if (!d || !d.whatsapp_maintenance) return;
          window.__waMaintenance = true;
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
