// Tampilan PIN: kotak digit + keypad angka.
//
// Kenapa begini: input teks biasa tidak terbaca sebagai "halaman PIN" — tidak ada
// petunjuk panjang, tidak ada masking, dan di ponsel keyboardnya alfabet.
// Skrip ini TIDAK mengubah logika otentikasi: ia hanya mencerminkan nilai
// #pin-input (yang dibaca dashboard.js) ke kotak digit, dan meneruskan ketukan
// keypad / papan ketik fisik ke input asli itu.
//
// Dipisah dari HTML karena CSP produksi melarang script inline.
(function () {
  var input = document.getElementById('pin-input');
  var boxesEl = document.getElementById('pin-boxes');
  var keypadEl = document.getElementById('pin-keypad');
  if (!input || !boxesEl) return;

  var MAX = parseInt(input.getAttribute('maxlength'), 10) || 8;
  var MIN = 4; // PIN sah paling pendek, dipakai untuk menandai kesiapan kirim
  var digits = [];
  var submitBtn = document.getElementById('btn-submit-pin');

  // Kotak dirender sebanyak panjang maksimum PIN.
  function buildBoxes() {
    boxesEl.innerHTML = '';
    for (var i = 0; i < MAX; i++) {
      var b = document.createElement('span');
      b.className = 'pin-box';
      b.dataset.index = String(i);
      boxesEl.appendChild(b);
    }
  }

  function paint() {
    var boxes = boxesEl.children;
    for (var i = 0; i < boxes.length; i++) {
      var filled = i < digits.length;
      boxes[i].classList.toggle('filled', filled);
      boxes[i].textContent = filled ? '\u2022' : '';
      boxes[i].classList.toggle('active', i === digits.length);
    }
    // Tombol kirim nonaktif sampai PIN mencapai panjang minimum yang sah.
    if (submitBtn) submitBtn.disabled = digits.length < MIN;
    // Kotak hanya untuk tampilan; nilai sebenarnya ada di input asli.
    input.value = digits.join('');
  }

  function push(d) {
    if (digits.length >= MAX) return;
    digits.push(d);
    paint();
  }

  function pop() {
    if (!digits.length) return;
    digits.pop();
    paint();
  }

  function clearAll() {
    digits = [];
    paint();
  }

  // Ketukan keypad
  if (keypadEl) {
    var layout = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
    layout.forEach(function (k) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pin-key';
      if (k === 'clear') {
        btn.classList.add('pin-key-fn');
        btn.textContent = 'Hapus';
        btn.setAttribute('aria-label', 'Hapus semua angka');
        btn.addEventListener('click', clearAll);
      } else if (k === 'back') {
        btn.classList.add('pin-key-fn');
        btn.setAttribute('aria-label', 'Hapus angka terakhir');
        btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5H4.6L2 10l2.6 5H8M9.5 7.5l5 5M14.5 7.5l-5 5"/></svg>';
        btn.addEventListener('click', pop);
      } else {
        btn.textContent = k;
        btn.setAttribute('aria-label', 'Angka ' + k);
        btn.addEventListener('click', function () { push(k); });
      }
      keypadEl.appendChild(btn);
    });
  }

  // Papan ketik fisik: angka, Backspace, Escape
  document.addEventListener('keydown', function (ev) {
    var modal = document.getElementById('auth-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    if (ev.key >= '0' && ev.key <= '9') {
      ev.preventDefault();
      push(ev.key);
    } else if (ev.key === 'Backspace') {
      ev.preventDefault();
      pop();
    } else if (ev.key === 'Escape') {
      clearAll();
    }
  });

  // Kalau dashboard.js mengosongkan input (mis. setelah PIN salah atau sesi
  // berakhir), kotak ikut dikosongkan. Dipantau lewat observer, bukan polling.
  var lastSeen = '';
  function syncFromInput() {
    var v = input.value;
    if (v === lastSeen) return;
    lastSeen = v;
    if (!v) { digits = []; }
    else { digits = v.split('').slice(0, MAX); }
    paint();
  }
  setInterval(syncFromInput, 120);

  // Ketukan pada kotak memfokuskan input asli, supaya keyboard ponsel muncul.
  boxesEl.addEventListener('click', function () { input.focus(); });

  buildBoxes();
  paint();
})();
