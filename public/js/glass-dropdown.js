// Custom Liquid Glass Dropdown Component
// Menggantikan <select> native browser dengan dropdown glassmorphism futuristik
(function () {
  if (typeof window === "undefined") return;

  function initGlassDropdowns() {
    var selects = document.querySelectorAll("select.filter-select");
    if (!selects.length) return;

    selects.forEach(function (select) {
      if (select.dataset.glassEnhanced) return;
      select.dataset.glassEnhanced = "true";

      // Sembunyikan select native dari tampilan visual tapi tetap aksesibel di DOM
      select.classList.add("sr-only-select");

      // Wadah utama custom dropdown
      var container = document.createElement("div");
      container.className = "glass-select-container";
      container.setAttribute("data-target-select", select.id);

      // Tombol pemicu (trigger)
      var trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "glass-select-trigger";
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");

      var currentOption = select.options[select.selectedIndex] || select.options[0];
      var labelSpan = document.createElement("span");
      labelSpan.className = "glass-select-label";
      labelSpan.textContent = currentOption ? currentOption.textContent : "";

      var arrowSpan = document.createElement("span");
      arrowSpan.className = "glass-select-arrow";
      arrowSpan.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>';

      trigger.appendChild(labelSpan);
      trigger.appendChild(arrowSpan);
      container.appendChild(trigger);

      // Panel menu melayang liquid glass
      var menu = document.createElement("div");
      menu.className = "glass-select-menu";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("tabindex", "-1");

      Array.from(select.options).forEach(function (opt) {
        var item = document.createElement("div");
        item.className = "glass-select-item" + (opt.selected ? " is-selected" : "");
        item.setAttribute("role", "option");
        item.setAttribute("data-value", opt.value);
        item.setAttribute("aria-selected", opt.selected ? "true" : "false");

        var itemText = document.createElement("span");
        itemText.className = "glass-select-item-text";
        itemText.textContent = opt.textContent;

        var checkIcon = document.createElement("span");
        checkIcon.className = "glass-select-check";
        checkIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6" /></svg>';

        item.appendChild(itemText);
        item.appendChild(checkIcon);

        item.addEventListener("click", function (e) {
          e.stopPropagation();
          select.value = opt.value;
          labelSpan.textContent = opt.textContent;

          menu.querySelectorAll(".glass-select-item").forEach(function (it) {
            it.classList.remove("is-selected");
            it.setAttribute("aria-selected", "false");
          });
          item.classList.add("is-selected");
          item.setAttribute("aria-selected", "true");

          closeDropdown();

          // Kirim event change ke native select agar logika data fetcher otomatis berjalan
          var evt = new Event("change", { bubbles: true });
          select.dispatchEvent(evt);
        });

        menu.appendChild(item);
      });

      container.appendChild(menu);
      select.parentNode.insertBefore(container, select.nextSibling);

      function openDropdown() {
        document.querySelectorAll(".glass-select-container.is-open").forEach(function (c) {
          if (c !== container) {
            c.classList.remove("is-open", "align-right");
            c.querySelector(".glass-select-trigger")?.setAttribute("aria-expanded", "false");
            var pb = c.closest(".filter-dashboard-bar, .pool-section-header, .filter-group");
            if (pb) pb.classList.remove("has-open-dropdown");
          }
        });
        container.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
        var bar = container.closest(".filter-dashboard-bar, .pool-section-header, .filter-group");
        if (bar) bar.classList.add("has-open-dropdown");

        // Menu diposisikan absolut, jadi bila pemicunya ada di dekat tepi kanan,
        // menu bisa melewati batas layar dan memunculkan scroll horizontal
        // (terukur: 10px overflow pada dropdown filter di baris kanan).
        // Solusi: ukur setelah render, lalu ratakan menu ke kanan pemicu bila
        // memang akan keluar layar.
        container.classList.remove("align-right");
        var rect = menu.getBoundingClientRect();
        var margin = 8;
        if (rect.right > window.innerWidth - margin) {
          container.classList.add("align-right");
        }
      }

      function closeDropdown() {
        container.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
        var bar = container.closest(".filter-dashboard-bar, .pool-section-header, .filter-group");
        if (bar) bar.classList.remove("has-open-dropdown");
      }

      function toggleDropdown() {
        if (container.classList.contains("is-open")) {
          closeDropdown();
        } else {
          openDropdown();
        }
      }

      trigger.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleDropdown();
      });

      // Sinkronisasi otomatis jika select diubah dari kode luar
      select.addEventListener("change", function () {
        var opt = select.options[select.selectedIndex];
        if (opt) {
          labelSpan.textContent = opt.textContent;
          menu.querySelectorAll(".glass-select-item").forEach(function (it) {
            var isSel = it.getAttribute("data-value") === opt.value;
            it.classList.toggle("is-selected", isSel);
            it.setAttribute("aria-selected", isSel ? "true" : "false");
          });
        }
      });
    });

    function closeAllActiveDropdowns() {
      document.querySelectorAll(".glass-select-container.is-open").forEach(function (c) {
        c.classList.remove("is-open", "align-right");
        c.querySelector(".glass-select-trigger")?.setAttribute("aria-expanded", "false");
      });
      document.querySelectorAll(".has-open-dropdown").forEach(function (b) {
        b.classList.remove("has-open-dropdown");
      });
    }

    // Tutup saat klik di luar
    document.addEventListener("click", function (e) {
      if (!e.target.closest(".glass-select-container")) {
        closeAllActiveDropdowns();
      }
    });

    // Tutup saat tombol Escape ditekan
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeAllActiveDropdowns();
      }
    });

    // Tutup saat ukuran layar berubah: posisi tepi bisa bergeser sehingga
    // perataan yang dihitung saat dibuka menjadi tidak valid.
    window.addEventListener("resize", closeAllActiveDropdowns);
  }

  window.setupGlassDropdowns = initGlassDropdowns;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initGlassDropdowns);
  } else {
    initGlassDropdowns();
  }
})();
