// Penetapan tema sebelum render (anti kedipan warna / anti-FOUC).
// Dimuat sebagai script blocking di dalam <head>, jadi harus dijalankan
// sebelum browser melukis halaman. Diletakkan di berkas terpisah, bukan
// inline, karena CSP produksi hanya mengizinkan script-src 'self'.
(function () {
  var stored = null;
  try { stored = localStorage.getItem('freeaibot-theme'); } catch (e) { stored = null; }
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', stored || (prefersDark ? 'dark' : 'light'));
})();
