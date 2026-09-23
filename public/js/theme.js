// Kontrol tema untuk halaman landing: tombol ganti tema dan penyesuaian meta
// theme-color. Dipisah dari HTML karena CSP produksi melarang script inline.
//
// Menu ponsel TIDAK ditangani di sini: itu tugas landing.js (kelas `is-open`).
// Sebelumnya kedua berkas menangani tombol yang sama dengan nama kelas berbeda
// (`open` vs `is-open`), sehingga menu bisa terbuka lalu langsung tertutup lagi.
// Satu pemilik per kontrol.
(function () {
  var root = document.documentElement;
  var toggle = document.getElementById('themeToggle');

  // Warna bilah peramban mengikuti latar tema, bukan warna merek.
  var THEME_COLOR = { dark: '#020814', light: '#eef2f9' };

  function paint() {
    var dark = root.getAttribute('data-theme') === 'dark';
    // Ikon diganti oleh CSS lewat [data-theme]; di sini hanya labelnya,
    // supaya pembaca layar menyebut aksi yang akan terjadi.
    if (toggle) toggle.setAttribute('aria-label', dark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light);
  }
  paint();

  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem('freeaibot-theme', next);
      } catch (e) {
        /* penyimpanan diblokir: tema tetap berlaku untuk sesi ini */
      }
      paint();
    });
  }
})();
