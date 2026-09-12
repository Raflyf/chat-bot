// Fast-path otentikasi sinkron sebelum halaman di-render (Anti-Flicker / Anti-FOUC)
    // Sesi wajib tersimpan hanya di sessionStorage (hancur saat tab ditutup) dan dibatasi maksimal 15 menit
    (function() {
      try {
        // Hapus residu persistent token lama dari localStorage
        localStorage.removeItem("freeaibot_admin_session_token");
        localStorage.removeItem("freeaibot_admin_session_exp");

        var token = sessionStorage.getItem("freeaibot_admin_session_token");
        var exp = Number(sessionStorage.getItem("freeaibot_admin_session_exp") || 0);
        var now = Date.now();

        if (token && exp && now < exp) {
          document.documentElement.classList.add("authenticated");
        } else {
          // Token tidak ada atau sudah kedaluwarsa (> 15 menit)
          sessionStorage.removeItem("freeaibot_admin_session_token");
          sessionStorage.removeItem("freeaibot_admin_session_exp");
          document.documentElement.classList.add("not-authenticated");
        }
      } catch (e) {
        document.documentElement.classList.add("not-authenticated");
      }
    })();
