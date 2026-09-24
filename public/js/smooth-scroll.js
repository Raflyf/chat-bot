// Smooth Scroll via Lenis (Lightweight & 60-120fps GPU accelerated)
(function () {
  if (typeof window === "undefined") return;

  function initLenis() {
    if (typeof window.Lenis !== "function") return;

    // Prevent double initialization
    if (window.__lenisInstance) return;

    var lenis = new window.Lenis({
      duration: 1.15,
      easing: function (t) {
        return Math.min(1, 1.001 - Math.pow(2, -10 * t));
      },
      orientation: "vertical",
      gestureOrientation: "vertical",
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.25,
      infinite: false,
    });

    window.__lenisInstance = lenis;

    function raf(time) {
      if (!document.hidden) {
        lenis.raf(time);
      }
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    // Pause on hidden tab to save CPU / battery (Rule 9c compliance)
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        lenis.stop();
      } else {
        lenis.start();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initLenis);
  } else {
    initLenis();
  }
})();
