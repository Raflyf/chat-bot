// Smooth Scroll Lenis ringan dengan kompensasi DOM_DELTA_LINE (Firefox Windows)
(function () {
  if (typeof window === "undefined") return;

  function initSmoothScroll() {
    if (typeof window.Lenis !== "function") return;
    if (window.__lenisInstance) return;

    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    var lenis = new window.Lenis({
      lerp: 0.13,
      orientation: "vertical",
      gestureOrientation: "vertical",
      smoothWheel: true,
      syncTouch: false,
      wheelMultiplier: 1.15,
      touchMultiplier: 1.5,
      infinite: false,
      virtualScroll: function (data) {
        if (
          data &&
          data.event &&
          data.event.type === "wheel" &&
          data.event.deltaMode === 1
        ) {
          data.deltaY *= 1.9;
        }
      },
      prevent: function (node) {
        if (!node || !node.closest) return false;
        return Boolean(
          node.closest(".keys-list-scroll, .glass-select-menu, .table-wrap, .modal-backdrop")
        );
      }
    });

    window.__lenisInstance = lenis;

    var rafId = null;

    function raf(time) {
      if (document.hidden) {
        rafId = null;
        return;
      }
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }

    function startLoop() {
      if (document.hidden || rafId !== null) return;
      rafId = requestAnimationFrame(raf);
    }

    function stopLoop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stopLoop();
        lenis.stop();
      } else {
        lenis.time = 0;
        lenis.start();
        startLoop();
      }
    });

    startLoop();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSmoothScroll);
  } else {
    initSmoothScroll();
  }
})();
