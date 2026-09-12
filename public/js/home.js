// Keamanan Sesi Admin: Saat pengguna berada di halaman utama / beranda,
// sesi admin dimusnahkan sehingga kunjungan berikutnya ke panel admin wajib memasukkan Master PIN.
(function() {
  try {
    sessionStorage.removeItem("freeaibot_admin_session_token");
    sessionStorage.removeItem("freeaibot_admin_session_exp");
    localStorage.removeItem("freeaibot_admin_session_token");
    localStorage.removeItem("freeaibot_admin_session_exp");
  } catch (_) {}
})();
