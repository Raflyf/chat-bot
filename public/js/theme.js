// Kontrol tema untuk halaman landing: tombol ganti tema dan penyesuaian meta
// theme-color. Dipisah dari HTML karena CSP produksi melarang script inline.
(function () {
  var root = document.documentElement;
  var toggle = document.getElementById('themeToggle');

  function paint() {
    var dark = root.getAttribute('data-theme') === 'dark';
    // Ikon diganti oleh CSS lewat [data-theme]; di sini hanya labelnya,
    // supaya pembaca layar menyebut aksi yang akan terjadi.
    if (toggle) toggle.setAttribute('aria-label', dark ? 'Ganti ke tema terang' : 'Ganti ke tema gelap');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#000000' : '#f2f2f7');
  }
  paint();

  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('freeaibot-theme', next); } catch (e) {}
      paint();
    });
  }

  /* Menu ponsel: tombol buka/tutup, Escape menutup, klik di luar menutup. */
  var navToggle = document.getElementById('navToggle');
  var nav = document.getElementById('siteNav');

  function closeNav() {
    if (!nav || !navToggle) return;
    nav.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  }

  if (navToggle && nav) {
    navToggle.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var open = nav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    document.addEventListener('click', function (ev) {
      if (!nav.classList.contains('open')) return;
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
