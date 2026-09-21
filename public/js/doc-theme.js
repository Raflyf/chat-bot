// Halaman kebijakan privasi: hanya menyelaraskan meta theme-color dengan
// preferensi tema tersimpan. Tidak ada tombol tema di halaman ini.
// Dipisah dari HTML karena CSP produksi melarang script inline.
(function () {
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  meta.setAttribute('content', dark ? '#000000' : '#f2f2f7');
})();
