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
      ".hero-badge, .hero-title, .hero-subtitle, .hero-cta-group, .section-title-wrap, .feature-card, .dashboard-teaser, footer"
    );
    if (!targets.length) return;

    // Reveal dua arah fisik murni (animasi meluncur ke atas dan meluncur ke bawah)
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        var el = entry.target;
        if (entry.isIntersecting) {
          el.classList.add("revealed");
        } else {
          el.classList.remove("revealed");
          // Jika berada di atas viewport, siapkan untuk meluncur ke bawah saat digulir kembali ke atas
          if (entry.boundingClientRect.top < 0) {
            el.classList.remove("reveal-from-bottom");
            el.classList.add("reveal-from-top");
          } else {
            // Jika berada di bawah viewport, siapkan untuk meluncur ke atas saat digulir ke bawah
            el.classList.remove("reveal-from-top");
            el.classList.add("reveal-from-bottom");
          }
        }
      });
    }, {
      threshold: 0.05,
      rootMargin: "-15px 0px -15px 0px"
    });

    targets.forEach(function(el) {
      el.classList.add("reveal-init");
      var rect = el.getBoundingClientRect();
      if (rect.top < 0) {
        el.classList.add("reveal-from-top");
      } else {
        el.classList.add("reveal-from-bottom");
      }
      observer.observe(el);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRevealObserver);
  } else {
    initRevealObserver();
  }
})();
