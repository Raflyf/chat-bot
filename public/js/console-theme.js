// Kontrol tema konsol. Dipisah dari HTML karena CSP produksi melarang
// script inline (script-src 'self').
(function () {
  var btn = document.getElementById('btn-theme-toggle');
  var label = document.getElementById('theme-icon');
  if (!btn) return;

  function paint() {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    var sun = btn.querySelector('.theme-icon-sun');
    var moon = btn.querySelector('.theme-icon-moon');
    if (sun) sun.style.display = dark ? 'inline-block' : 'none';
    if (moon) moon.style.display = dark ? 'none' : 'inline-block';
    var isEn = (document.documentElement.lang || 'id') === 'en';
    if (label) {
      if (isEn) {
        label.textContent = dark ? 'Light' : 'Dark';
      } else {
        label.textContent = dark ? 'Terang' : 'Gelap';
      }
    }
    btn.setAttribute('aria-label', dark ? (isEn ? 'Switch to light theme' : 'Ganti ke tema terang') : (isEn ? 'Switch to dark theme' : 'Ganti ke tema gelap'));
    btn.setAttribute('title', dark ? (isEn ? 'Switch to light theme' : 'Ganti ke tema terang') : (isEn ? 'Switch to dark theme' : 'Ganti ke tema gelap'));
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#020814' : '#f2f2f7');
  }
  paint();

  btn.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('freeaibot-theme', next); } catch (e) {}
    paint();
  });

  window.updateThemeUI = paint;
})();

/* Escape menutup modal reset. Gerbang login sengaja tidak ditutup dengan Escape:
   halaman ini butuh PIN untuk dibuka. */
(function () {
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    var reset = document.getElementById('reset-modal');
    if (reset && !reset.classList.contains('hidden')) {
      var back = document.getElementById('btn-back-reset');
      if (back) back.click();
    }
  });
})();
