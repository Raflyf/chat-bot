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
      ".section-title-wrap, .feature-card, .dashboard-teaser, .lapor-card, footer"
    );
    if (!targets.length) return;

    // Reveal sekali saat masuk viewport lalu unobserve agar tidak re-trigger dan freeze saat scroll bolak-balik
    var observer = new IntersectionObserver(function(entries, obs) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.classList.add("revealed");
        obs.unobserve(el);
      });
    }, {
      threshold: 0.04,
      rootMargin: "40px 0px -10px 0px"
    });

    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var rectCache = new Array(targets.length);
    targets.forEach(function(el, i) {
      rectCache[i] = el.getBoundingClientRect().top;
    });

    targets.forEach(function(el, i) {
      el.classList.add("reveal-init", "reveal-from-bottom");
      if (rectCache[i] < vh * 0.96) {
        el.classList.add("revealed");
      } else {
        observer.observe(el);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRevealObserver);
  } else {
    initRevealObserver();
  }
})();
