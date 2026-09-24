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

// Observer animasi reveal pada saat elemen masuk ke viewport
(function() {
  if (typeof window === "undefined") return;

  function initRevealObserver() {
    var targets = document.querySelectorAll(
      ".section-title-wrap, .feature-card, .dashboard-teaser, footer"
    );
    if (!targets.length) return;

    // Reveal dua arah permanen (scroll atas dan bawah)
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
        } else {
          // Reset status revealed saat keluar viewport agar beranimasi kembali saat digulir ulang
          entry.target.classList.remove("revealed");
        }
      });
    }, {
      threshold: 0.08,
      rootMargin: "0px 0px -25px 0px"
    });

    targets.forEach(function(el) {
      el.classList.add("reveal-init");
      observer.observe(el);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRevealObserver);
  } else {
    initRevealObserver();
  }
})();
