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

// Observer animasi reveal pada saat elemen masuk ke viewport + jaring pengaman scroll pasif
(function() {
  if (typeof window === "undefined") return;

  function initRevealObserver() {
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    if (!("IntersectionObserver" in window)) return;

    var targets = document.querySelectorAll(
      ".section-title-wrap, .feature-card, .dashboard-teaser, .lapor-card, footer"
    );
    if (!targets.length) return;

    var remaining = new Set();
    var observer = null;
    var rafPending = false;

    function detachFallbacks() {
      window.removeEventListener("scroll", scheduleCheck, { passive: true });
      window.removeEventListener("resize", scheduleCheck, { passive: true });
      window.removeEventListener("load", scheduleCheck);
    }

    function revealEl(el) {
      el.classList.add("revealed");
      if (observer) observer.unobserve(el);
      remaining.delete(el);
      if (remaining.size === 0) detachFallbacks();
    }

    observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        revealEl(entry.target);
      });
    }, {
      threshold: 0,
      rootMargin: "120px 0px 120px 0px"
    });

    function checkRemaining() {
      rafPending = false;
      if (!remaining.size) {
        detachFallbacks();
        return;
      }
      var vh = window.innerHeight || document.documentElement.clientHeight || 800;
      var toReveal = [];
      remaining.forEach(function(el) {
        if (el.getBoundingClientRect().top < vh + 120) {
          toReveal.push(el);
        }
      });
      toReveal.forEach(revealEl);
    }

    function scheduleCheck() {
      if (rafPending || !remaining.size) return;
      rafPending = true;
      requestAnimationFrame(checkRemaining);
    }

    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var rectCache = new Array(targets.length);
    targets.forEach(function(el, i) {
      rectCache[i] = el.getBoundingClientRect().top;
    });

    targets.forEach(function(el, i) {
      if (rectCache[i] < vh + 80) {
        // Sudah terlihat saat load: jangan sembunyikan dulu
        return;
      }
      el.classList.add("reveal-init", "reveal-from-bottom");
      remaining.add(el);
      observer.observe(el);
    });

    if (remaining.size > 0) {
      window.addEventListener("scroll", scheduleCheck, { passive: true });
      window.addEventListener("resize", scheduleCheck, { passive: true });
      window.addEventListener("load", scheduleCheck);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initRevealObserver);
  } else {
    initRevealObserver();
  }
})();
