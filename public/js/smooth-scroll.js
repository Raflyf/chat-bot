// Hardware Compositor Smooth Scroll (zero main-thread wheel hijacking)
(function () {
  if (typeof window === "undefined") return;

  function initSmoothScroll() {
    if (window.__lenisInstance) return;

    // Bersihkan kelas lenis bila tersisa dan biarkan browser memakai GPU compositor thread
    var root = document.documentElement;
    if (root && root.className) {
      root.className = root.className.replace(/\blenis(?:-\w+)?\b/g, "").trim();
    }

    var paused = false;
    var compatApi = {
      isScrolling: false,
      start: function () { paused = false; },
      stop: function () { paused = true; },
      scrollTo: function (target, opts) {
        if (paused) return;
        var behavior = opts && opts.immediate ? "auto" : "smooth";
        if (typeof target === "number") {
          window.scrollTo({ top: target, behavior: behavior });
        } else if (typeof target === "string") {
          if (target === "top" || target === "start") {
            window.scrollTo({ top: 0, behavior: behavior });
          } else {
            var el = document.querySelector(target);
            if (el && el.scrollIntoView) el.scrollIntoView({ behavior: behavior });
          }
        } else if (target && target.scrollIntoView) {
          target.scrollIntoView({ behavior: behavior });
        }
      },
      on: function () { return function () {}; },
      off: function () {},
      destroy: function () { delete window.__lenisInstance; }
    };

    window.__lenisInstance = compatApi;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSmoothScroll);
  } else {
    initSmoothScroll();
  }
})();
