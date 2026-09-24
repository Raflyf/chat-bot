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

    var prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!("IntersectionObserver" in window) || prefersReduced) {
      targets.forEach(function(el) {
        el.classList.add("revealed");
      });
      return;
    }

    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: "0px 0px -40px 0px"
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
