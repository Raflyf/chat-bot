// Smooth Scroll via Lenis (Demand-driven RAF loop for 60-120fps without idle overhead)
(function () {
  if (typeof window === "undefined") return;

  function initLenis() {
    if (typeof window.Lenis !== "function") return;
    if (window.__lenisInstance) return;

    var lenis = new window.Lenis({
      duration: 1.05,
      easing: function (t) {
        return Math.min(1, 1.001 - Math.pow(2, -10 * t));
      },
      orientation: "vertical",
      gestureOrientation: "vertical",
      smoothWheel: true,
      wheelMultiplier: 1.0,
      touchMultiplier: 1.5,
      infinite: false,
      prevent: function (node) {
        if (!node || !node.closest) return false;
        return Boolean(
          node.closest(".keys-list-scroll, .glass-select-menu, .table-wrap, .modal-backdrop")
        );
      }
    });

    window.__lenisInstance = lenis;

    var rafId = null;
    var lastFrameActive = false;

    function raf(time) {
      rafId = null;
      if (document.hidden) return;
      lenis.raf(time);
      var stillActive = Boolean(lenis.isScrolling || lenis.animate?.isRunning);
      if (stillActive || lastFrameActive) {
        lastFrameActive = Boolean(lenis.isScrolling || lenis.animate?.isRunning);
        if (lastFrameActive) {
          rafId = requestAnimationFrame(raf);
        }
      }
    }

    function kickRaf() {
      if (document.hidden || rafId !== null) return;
      lastFrameActive = true;
      rafId = requestAnimationFrame(raf);
    }

    function stopRaf() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      lastFrameActive = false;
    }

    lenis.on("virtual-scroll", kickRaf);
    lenis.on("scroll", kickRaf);
    window.addEventListener("wheel", kickRaf, { passive: true });
    window.addEventListener("touchstart", kickRaf, { passive: true });
    window.addEventListener("keydown", function (e) {
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "PageDown" ||
        e.key === "PageUp" ||
        e.key === "Home" ||
        e.key === "End" ||
        e.key === " "
      ) {
        kickRaf();
      }
    }, { passive: true });

    // Pause on hidden tab to save CPU / battery
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        stopRaf();
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
