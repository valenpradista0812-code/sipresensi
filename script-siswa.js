/* SiPresensi (Siswa) - Tracker Waktu Interaktif & Log Presensi Riil */

// 1) Tracker Waktu Berkelanjutan (Persistent & Non-stop across page/logout)
(function () {
  var timerDisplay = document.getElementById("timer-count");
  var trackerClickArea = document.getElementById("tracker-display");
  var toggleBtn = document.getElementById("btn-toggle-tracker");
  var statusText = document.getElementById("status-text");
  var trackerHint = document.getElementById("tracker-hint");
  var statusPill = document.getElementById("status-pill");

  if (!timerDisplay) return;

  var timerInterval = null;
  var isRunning = false;
  var startTime = 0;

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatTime(totalSeconds) {
    if (totalSeconds < 0) totalSeconds = 0;
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    return pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
  }

  function getTrackerKey() {
    var user = (window.SiPresensi && window.SiPresensi.getUser) ? window.SiPresensi.getUser() : null;
    var nis = (user && user.nis) ? user.nis : (localStorage.getItem('sipresensi_last_nis') || 'active_student');
    return 'sipresensi_tracker_' + nis;
  }

  function updateRunningUI() {
    if (toggleBtn) {
      toggleBtn.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Hentikan Tracker';
      toggleBtn.style.backgroundColor = "#ef4444";
      toggleBtn.style.color = "#ffffff";
      toggleBtn.style.borderColor = "#ef4444";
    }
    if (statusText) statusText.textContent = "Tracker Berjalan";
    if (statusPill) {
      statusPill.className = "pill pill-green";
    }
    if (trackerHint) trackerHint.innerHTML = "⏸ Ketuk untuk <b>Menghentikan</b>";
    timerDisplay.style.color = "#10b981";
  }

  function updateStoppedUI() {
    if (toggleBtn) {
      toggleBtn.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg> Mulai Tracker';
      toggleBtn.style.backgroundColor = "";
      toggleBtn.style.color = "";
      toggleBtn.style.borderColor = "";
    }
    if (statusText) statusText.textContent = "Siap Memulai";
    if (statusPill) {
      statusPill.className = "pill";
    }
    if (trackerHint) trackerHint.innerHTML = "👇 Ketuk di sini atau tombol di bawah untuk <b>Mulai</b>";
    timerDisplay.style.color = "#1e293b";
  }

  function startTicking(savedStartTime) {
    isRunning = true;
    startTime = Number(savedStartTime) || Date.now();
    updateRunningUI();

    if (timerInterval) clearInterval(timerInterval);

    // Update segera agar tampilan tidak tertunda
    var elapsed = Math.floor((Date.now() - startTime) / 1000);
    timerDisplay.textContent = formatTime(elapsed);

    timerInterval = setInterval(function () {
      var currentElapsed = Math.floor((Date.now() - startTime) / 1000);
      timerDisplay.textContent = formatTime(currentElapsed);
    }, 1000);
  }

  function stopTicking() {
    isRunning = false;
    if (timerInterval) clearInterval(timerInterval);
    updateStoppedUI();
  }

  // Inisialisasi status tracker dari LocalStorage & Sinkronisasi Backend Supabase
  function initTracker() {
    var key = getTrackerKey();
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(key) || 'null');
    } catch (e) {}

    // 1. Jika ada tracker aktif di localStorage, langsung jalankan stopwatch secara instan
    if (saved && saved.isRunning && saved.startTime) {
      startTicking(saved.startTime);
    } else {
      updateStoppedUI();
    }

    // 2. Sinkronkan dengan database di server
    fetch('/api/siswa/tracker')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.success) {
          if (res.isRunning && res.startTime) {
            localStorage.setItem(key, JSON.stringify({ isRunning: true, startTime: res.startTime }));
            startTicking(res.startTime);
          } else if (!saved || !saved.isRunning) {
            stopTicking();
          }
        }
      })
      .catch(function (err) {
        console.warn('Gagal cek status tracker dari backend:', err);
      });
  }

  // Handler Mulai / Hentikan Tracker
  async function toggleTracker() {
    var key = getTrackerKey();

    if (!isRunning) {
      // 1. MULAI TRACKER
      var newStartTime = Date.now();
      localStorage.setItem(key, JSON.stringify({ isRunning: true, startTime: newStartTime }));
      startTicking(newStartTime);

      if (window.SiPresensi && window.SiPresensi.showToast) {
        window.SiPresensi.showToast('Tracker waktu dimulai! Waktu akan terus berjalan.', 'success');
      }

      // Catat ke backend database
      try {
        const res = await fetch('/api/siswa/tracker/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startTime: newStartTime })
        });
        const json = await res.json();
        if (json.success && json.startTime) {
          startTime = Number(json.startTime);
          localStorage.setItem(key, JSON.stringify({ isRunning: true, startTime: startTime }));
        }
      } catch (err) {
        console.warn('Gagal mencatat tracker start ke server:', err);
      }
    } else {
      // 2. HENTIKAN TRACKER
      if (!confirm('Apakah Anda yakin ingin menghentikan tracker dan menyimpan waktu belajar Anda?')) {
        return;
      }

      stopTicking();
      localStorage.removeItem(key);

      if (window.SiPresensi && window.SiPresensi.showToast) {
        window.SiPresensi.showToast('Menyimpan waktu belajar ke database...', 'info');
      }

      // Kirim perintah stop ke backend database
      try {
        const res = await fetch('/api/siswa/tracker/stop', { method: 'POST' });
        const json = await res.json();
        if (json.success) {
          if (window.SiPresensi && window.SiPresensi.showToast) {
            window.SiPresensi.showToast(json.message || 'Waktu belajar berhasil disimpan!', 'success');
          }
          setTimeout(function () {
            window.location.reload();
          }, 1200);
        }
      } catch (err) {
        if (window.SiPresensi && window.SiPresensi.showToast) {
          window.SiPresensi.showToast('Gagal menghubungi server saat menyimpan tracker.', 'error');
        }
      }
    }
  }

  if (trackerClickArea) {
    trackerClickArea.addEventListener("click", toggleTracker);
  }

  if (toggleBtn) {
    toggleBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleTracker();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTracker);
  } else {
    initTracker();
  }
})();

// 2) Tabel log presensi riil (Halaman detail-absensi.html)
(function () {
  var table = document.getElementById("log-table");
  if (!table) return;

  var tbody = table.querySelector("tbody");
  if (!tbody) return;

  var boxes = document.querySelectorAll(".kv-box");
  function setRow(box, idx, value) {
    if (!box) return;
    var b = box.querySelectorAll(".kv-row b")[idx];
    if (b) b.textContent = value;
  }

  var currentLogs = [];

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function renderTable(logs) {
    currentLogs = logs || [];
    tbody.innerHTML = '';

    if (currentLogs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:24px; color:#94a3b8;">Belum ada data riwayat presensi tercatat.</td></tr>';
      return;
    }

    currentLogs.forEach(function (d, idx) {
      var tr = document.createElement('tr');
      tr.dataset.row = idx;
      tr.dataset.status = d.status || 'hadir';
      if (idx === 0) tr.className = 'selected';

      var badgeClass = d.status === 'izin' ? 'b-izin' : d.status === 'sakit' ? 'b-sakit' : d.status === 'alfa' ? 'b-alfa' : 'b-hadir';

      tr.innerHTML = `
        <td class="day">${escapeHtml(d.tgl || '-')}</td>
        <td><span class="t-ok">${escapeHtml(d.masuk || '-')}</span></td>
        <td>${escapeHtml(d.keluar || '-')}</td>
        <td>${escapeHtml(d.durasi || '-')}</td>
        <td><span class="loc"><i class="dot"></i>${escapeHtml(d.zona || 'Gedung Sekolah')}</span></td>
        <td><span class="badge ${badgeClass}">${escapeHtml((d.status || 'Hadir').toUpperCase())}</span></td>
      `;

      tr.addEventListener('click', function () {
        tbody.querySelectorAll('tr.selected').forEach(function (r) { r.classList.remove('selected'); });
        tr.classList.add('selected');
        selectRow(d);
      });

      tbody.appendChild(tr);
    });

    if (currentLogs.length > 0) {
      selectRow(currentLogs[0]);
    }
  }

  function selectRow(d) {
    if (!d) return;
    var insDate = document.getElementById("ins-date");
    if (insDate) insDate.textContent = d.tgl || '-';
    if (boxes && boxes.length >= 2) {
      setRow(boxes[0], 1, d.masuk || '-');
      setRow(boxes[1], 0, d.keluar || '-');
      setRow(boxes[1], 1, d.zona || '-');
      setRow(boxes[1], 2, d.status_text || d.status || '-');
    }
  }

  // Muat log dari backend
  fetch('/api/siswa/log')
    .then(function (r) { return r.json(); })
    .then(function (res) {
      if (res.success && res.data) {
        renderTable(res.data);
      }
    })
    .catch(function (err) {
      console.warn('Gagal memuat log siswa:', err);
    });
})();

// 3) Tab filter status (Semua / Hadir / Izin / Terlambat)
(function () {
  var tabs = document.getElementById("tab-status");
  var table = document.getElementById("log-table");
  if (!tabs || !table) return;

  tabs.addEventListener("click", function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    tabs.querySelectorAll("button").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");

    var f = btn.dataset.filter;
    table.querySelectorAll("tbody tr").forEach(function (tr) {
      tr.style.display = (f === "all" || tr.dataset.status === f) ? "" : "none";
    });
  });
})();

// 4) Pagination (visual)
document.querySelectorAll(".pager").forEach(function (pager) {
  pager.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-page]");
    if (!btn) return;
    pager.querySelectorAll("button[data-page]").forEach(function (b) { b.classList.remove("active"); });
    btn.classList.add("active");
  });
});