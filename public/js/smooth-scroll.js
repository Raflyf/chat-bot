// Feather-light Lenis Smooth Scroll with stale-timestamp reset on wake
(function () {
  if (typeof window === "undefined") return;

  function initSmoothScroll() {
    if (typeof window.Lenis !== "function") return;
    if (window.__lenisInstance) return;

    var lenis = new window.Lenis({
      lerp: 0.14,
      orientation: "vertical",
      gestureOrientation: "vertical",
      smoothWheel: true,
      syncTouch: false,
      wheelMultiplier: 1.05,
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

    function raf(time) {
      rafId = null;
      if (document.hidden) return;
      lenis.raf(time);
      if (lenis.isScrolling || lenis.animate?.isRunning) {
        rafId = requestAnimationFrame(raf);
      }
    }

    function kickRaf() {
      if (document.hidden || rafId !== null) return;
      // Reset timestamp sebelum wake agar frame pertama tidak menghitung delta > 1 detik
      lenis.time = 0;
      rafId = requestAnimationFrame(raf);
    }

    function stopRaf() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      lenis.time = 0;
    }

    lenis.on("virtual-scroll", kickRaf);
    lenis.on("scroll", kickRaf);
    window.addEventListener("wheel", kickRaf, { passive: true });
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
    document.addEventListener("DOMContentLoaded", initSmoothScroll);
  } else {
    initSmoothScroll();
  }
})();
