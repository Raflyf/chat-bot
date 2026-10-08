/**
 * FORM LAPORAN / KELUHAN (permintaan pemilik produk, 08 Okt 2026).
 *
 * Fungsi: pelapor menulis keluhan + opsional lampirkan tangkapan layar percakapan.
 * Tidak perlu mengisi nomor WA — laporan langsung dikirim ke pengelola bot.
 *
 * Catatan teknis:
 *  - Gambar dibaca sebagai data URL (base64) di sisi klien, lalu dikirim ke
 *    /api/laporan. Batas 2 MB ditegakkan di klien DAN server (jaga-jaga).
 *  - Gambar besar otomatis dikompres di klien (canvas) supaya hemat kuota
 *    pelapor dan mempercepat unggahan.
 */
(function () {
  'use strict';

  var MAKS_BYTES = 2 * 1024 * 1024; // 2 MB
  var form = document.getElementById('form-lapor');
  if (!form) return;

  var pesanEl = document.getElementById('lapor-pesan');
  var fileEl = document.getElementById('lapor-gambar');
  var hapusBtn = document.getElementById('lapor-hapus-gambar');
  var preview = document.getElementById('lapor-preview');
  var previewImg = document.getElementById('lapor-preview-img');
  var kirimBtn = document.getElementById('lapor-kirim');
  var statusEl = document.getElementById('lapor-status');

  var dataLampiran = '';

  function setStatus(teks, jenis) {
    if (!statusEl) return;
    statusEl.textContent = teks || '';
    statusEl.className = 'lapor-status' + (jenis ? ' is-' + jenis : '');
  }

  /** Kompres gambar besar lewat canvas agar hemat kuota (maks sisi 1600px). */
  function kompres(file) {
    return new Promise(function (resolve) {
      var pembaca = new FileReader();
      pembaca.onload = function () {
        var img = new Image();
        img.onload = function () {
          var maksSisi = 1600;
          var skala = Math.min(1, maksSisi / Math.max(img.width, img.height));
          if (skala >= 1 && file.size <= MAKS_BYTES) {
            resolve(String(pembaca.result));
            return;
          }
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * skala);
          canvas.height = Math.round(img.height * skala);
          var ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(String(pembaca.result));
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          // JPEG kualitas 0,82: cukup jelas untuk tangkapan layar, jauh lebih kecil.
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = function () { resolve(String(pembaca.result)); };
        img.src = String(pembaca.result);
      };
      pembaca.onerror = function () { resolve(''); };
      pembaca.readAsDataURL(file);
    });
  }

  function resetLampiran() {
    dataLampiran = '';
    if (fileEl) fileEl.value = '';
    if (preview) preview.hidden = true;
    if (previewImg) previewImg.removeAttribute('src');
    if (hapusBtn) hapusBtn.hidden = true;
  }

  if (fileEl) {
    fileEl.addEventListener('change', function () {
      var f = fileEl.files && fileEl.files[0];
      if (!f) {
        resetLampiran();
        return;
      }
      if (!/^image\//i.test(f.type)) {
        setStatus('Lampiran harus berupa gambar.', 'error');
        resetLampiran();
        return;
      }
      setStatus('Menyiapkan gambar…', 'info');
      kompres(f).then(function (dataUrl) {
        if (!dataUrl) {
          setStatus('Gagal membaca gambar. Coba file lain.', 'error');
          resetLampiran();
          return;
        }
        // Hitung ukuran setelah kompres (base64 -> byte).
        var b64 = dataUrl.split(',')[1] || '';
        var bytes = Math.floor((b64.length * 3) / 4);
        if (bytes > MAKS_BYTES) {
          setStatus('Gambar masih terlalu besar setelah dikompres (maks 2 MB). Coba potong dulu.', 'error');
          resetLampiran();
          return;
        }
        dataLampiran = dataUrl;
        if (previewImg) previewImg.src = dataUrl;
        if (preview) preview.hidden = false;
        if (hapusBtn) hapusBtn.hidden = false;
        setStatus('Gambar siap (' + (bytes / 1024).toFixed(0) + ' KB).', 'ok');
      });
    });
  }

  if (hapusBtn) {
    hapusBtn.addEventListener('click', function () {
      resetLampiran();
      setStatus('');
    });
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var pesan = (pesanEl && pesanEl.value ? pesanEl.value : '').trim();
    if (pesan.length < 5) {
      setStatus('Ceritakan dulu masalahnya (minimal 5 karakter).', 'error');
      if (pesanEl) pesanEl.focus();
      return;
    }
    if (pesan.length > 8000) {
      setStatus('Laporan terlalu panjang (maks 8000 karakter).', 'error');
      return;
    }

    if (kirimBtn) kirimBtn.disabled = true;
    setStatus('Mengirim…', 'info');

    fetch('/api/laporan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pesan: pesan,
        lampiran: dataLampiran || undefined,
        halaman: location.pathname,
        platform: 'landing',
      }),
    })
      .then(function (res) {
        return res.json().then(function (d) { return { ok: res.ok, d: d }; });
      })
      .then(function (r) {
        if (r.ok && r.d && r.d.ok) {
          setStatus(r.d.pesan || 'Terima kasih! Laporanmu sudah terkirim. 🙏', 'ok');
          form.reset();
          resetLampiran();
        } else {
          setStatus((r.d && r.d.error) || 'Gagal mengirim laporan. Coba lagi ya.', 'error');
        }
      })
      .catch(function () {
        setStatus('Koneksi bermasalah. Coba lagi ya.', 'error');
      })
      .finally(function () {
        if (kirimBtn) kirimBtn.disabled = false;
      });
  });
})();
