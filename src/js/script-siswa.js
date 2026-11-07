
/* Timer dashboard dikelola satu kali oleh sinkronisasi RFID di dashboard-siswa.html. */

// 1.5) Sidebar top buttons handler (Notifikasi, Profile, Keluar)
(function () {
  const sidebarTopBtns = document.querySelectorAll('.sidebar-top-btn, .glass-top-item');
  
  if (sidebarTopBtns.length === 0) return;
  
  sidebarTopBtns.forEach(function (btn, index) {
    // Skip jika tombol sudah punya class btn-logout (sudah di-handle di atas)
    if (btn.classList.contains('btn-logout')) return;
    
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      const title = btn.getAttribute('title') || btn.getAttribute('aria-label');
      
      if (title === 'Notifikasi') {
        // Navigasi ke halaman notifikasi (sesuaikan path jika ada)
        window.location.href = '/src/pages/student/notifikasi.html';
      } else if (title === 'Profile') {
        // Navigasi ke halaman profile/pengaturan (sesuaikan path jika ada)
        window.location.href = '/src/pages/student/profil.html';
      }
    });
  });
})();

// 2) Sidebar toggle handler (Desktop & Mobile)
(function () {
  const hamburger = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');
  const sidebarClose = document.getElementById('sidebar-close');
  const sidebarOverlay = document.getElementById('sidebar-overlay');
  
  if (!hamburger || !sidebar) return;
  
  // Load sidebar state from localStorage (hanya untuk desktop)
  const sidebarState = localStorage.getItem('sipresensi_sidebar_state') || 'expanded';
  
  // Apply state hanya jika bukan mobile
  if (window.innerWidth > 768 && sidebarState === 'collapsed') {
    sidebar.classList.add('collapsed');
  }
  
  function toggleSidebar() {
    const isCollapsed = sidebar.classList.toggle('collapsed');
    localStorage.setItem('sipresensi_sidebar_state', isCollapsed ? 'collapsed' : 'expanded');
  }
  
  function openSidebarMobile() {
    sidebar.classList.add('open');
    if (sidebarOverlay) {
      sidebarOverlay.classList.add('show');
    }
    document.body.classList.add('no-scroll');
  }
  
  function closeSidebarMobile() {
    sidebar.classList.remove('open');
    if (sidebarOverlay) {
      sidebarOverlay.classList.remove('show');
    }
    document.body.classList.remove('no-scroll');
  }
  
  // Hamburger button click handler
  hamburger.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if mobile view
    const isMobileView = window.innerWidth <= 768;
    
    if (isMobileView) {
      // Mobile: toggle drawer dengan overlay
      if (sidebar.classList.contains('open')) {
        closeSidebarMobile();
      } else {
        openSidebarMobile();
      }
    } else {
      // Desktop: toggle collapse/expand TANPA overlay
      toggleSidebar();
    }
  });
  
  // Sidebar close button handler (mobile only)
  if (sidebarClose) {
    sidebarClose.addEventListener('click', function(e) {
      e.preventDefault();
      closeSidebarMobile();
    });
  }
  
  // Overlay click handler (mobile only)
  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', function(e) {
      e.preventDefault();
      closeSidebarMobile();
    });
  }
  
  // Close mobile sidebar when clicking nav links
  document.querySelectorAll('.nav a').forEach(link => {
    link.addEventListener('click', function() {
      if (window.innerWidth <= 768) {
        closeSidebarMobile();
      }
    });
  });
  
  // Handle window resize
  let resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      const isMobileView = window.innerWidth <= 768;
      
      if (isMobileView) {
        // Reset collapse state di mobile
        sidebar.classList.remove('collapsed');
      } else {
        // Close mobile drawer di desktop
        closeSidebarMobile();
        
        // Restore desktop collapsed state
        const savedState = localStorage.getItem('sipresensi_sidebar_state');
        if (savedState === 'collapsed') {
          sidebar.classList.add('collapsed');
        }
      }
    }, 250);
  });
})();

// 3) Tabel log presensi riil (Halaman detail-absensi.html)
(function () {
  var table = document.getElementById("log-table");
  if (!table) return;

  var tbody = table.querySelector("tbody");
  if (!tbody) return;

  var boxes = document.querySelectorAll(".kv-box");

  function setRow(box, idx, value) {
    if (!box) return;

    var rows = box.querySelectorAll(".kv-row b")[idx];
    if (rows) rows.textContent = value;
  }

  var currentLogs = [];

  tbody.addEventListener("click", function (e) {
    var editBtn = e.target.closest(".btn-edit-izin");
    var cancelBtn = e.target.closest(".btn-cancel-izin");

    if (editBtn) {
      e.stopPropagation();
      var idx = editBtn.dataset.idx;
      var logItem = currentLogs[idx];
      var openBtn = document.getElementById("btn-ajukan-izin");
      if (openBtn) openBtn.click();
      var alasanEl = document.getElementById("alasan");
      if (alasanEl && logItem) {
        alasanEl.value = logItem.zona || logItem.keterangan || "Edit pengajuan izin";
      }
      return;
    }

    if (cancelBtn) {
      e.stopPropagation();
      var idx = cancelBtn.dataset.idx;
      if (confirm("Apakah Anda yakin ingin membatalkan pengajuan izin ini?")) {
        currentLogs.splice(idx, 1);
        renderTable(currentLogs);
      }
      return;
    }
  });

  function escapeHtml(str) {
    if (!str) return "";

    return String(str).replace(/[&<>"']/g, function (m) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[m];
    });
  }

  function renderTable(logs) {
    currentLogs = logs || [];
    tbody.innerHTML = "";

    if (currentLogs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">
            Belum ada data riwayat presensi tercatat.
          </td>
        </tr>
      `;
      return;
    }

    currentLogs.forEach(function (d, idx) {
      var tr = document.createElement("tr");

      tr.dataset.row = idx;
      tr.dataset.status = d.status || "hadir";

      if (idx === 0) {
        tr.className = "selected";
      }

      var badgeClass =
        d.status === "izin" ? "b-izin" :
        d.status === "sakit" ? "b-sakit" :
        d.status === "alfa" ? "b-alfa" :
        "b-hadir";

      var actionButtons = "";
      if (d.status === "izin" || d.status === "sakit") {
        actionButtons = `
          <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
            <button type="button" class="btn-edit-izin" data-idx="${idx}" style="background: #eff6ff; color: #3b82f6; border: 1px solid #bfdbfe; border-radius: 6px; padding: 2px 8px; font-size: 10px; font-weight: 700; cursor: pointer;">Edit</button>
            <button type="button" class="btn-cancel-izin" data-idx="${idx}" style="background: #fef2f2; color: #ef4444; border: 1px solid #fecaca; border-radius: 6px; padding: 2px 8px; font-size: 10px; font-weight: 700; cursor: pointer;">Batalkan</button>
          </div>
        `;
      }

      var ketKehadiran = '<span style="color: #10b981; font-weight: 700;"><i class="dot" style="background:#10b981; display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:6px;"></i>Tepat Waktu</span>';
      if (d.status === "late" || d.status === "terlambat") {
        ketKehadiran = '<span style="color: #f59e0b; font-weight: 700;"><i class="dot" style="background:#f59e0b; display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:6px;"></i>Terlambat</span>';
      } else if (d.status === "izin" || d.status === "sakit") {
        ketKehadiran = '<span style="color: #64748b; font-style: italic;">Izin / Diluar Sekolah</span>';
      }

      tr.innerHTML = `
        <td class="day">${escapeHtml(d.tgl || "-")}</td>
        <td><span class="t-ok">${escapeHtml(d.masuk || "-")}</span></td>
        <td>${escapeHtml(d.keluar || "-")}</td>
        <td>${escapeHtml(d.durasi || "-")}</td>
        <td>${ketKehadiran}</td>
        <td>
          <span class="badge ${badgeClass}">
            ${escapeHtml((d.status || "Hadir").toUpperCase())}
          </span>
          ${actionButtons}
        </td>
      `;

      tr.addEventListener("click", function () {
        tbody.querySelectorAll("tr.selected").forEach(function (row) {
          row.classList.remove("selected");
        });

        tr.classList.add("selected");
        selectRow(d);
      });

      tbody.appendChild(tr);
    });

    if (currentLogs.length > 0) {
      selectRow(currentLogs[0]);
    }

    // Pad with empty rows if less than 10 rows to maintain vertical height
    var minRows = 10;
    if (currentLogs.length < minRows) {
      var diff = minRows - currentLogs.length;
      for (var i = 0; i < diff; i++) {
        var emptyTr = document.createElement("tr");
        emptyTr.dataset.status = "empty";
        emptyTr.innerHTML = `
          <td class="muted">-</td>
          <td><span class="t-none">-</span></td>
          <td><span class="t-none">-</span></td>
          <td><span class="t-none">-</span></td>
          <td><span class="t-none">-</span></td>
          <td><span class="badge" style="background:#f1f5f9; color:#94a3b8;">Kosong</span></td>
        `;
        tbody.appendChild(emptyTr);
      }
    }
  }

  function selectRow(d) {
    if (!d) return;

    var insDate = document.getElementById("ins-date");

    if (insDate) {
      insDate.textContent = d.tgl || "-";
    }

    if (boxes && boxes.length >= 2) {
      setRow(boxes[0], 1, d.masuk || "-");
      setRow(boxes[1], 0, d.keluar || "-");
      setRow(boxes[1], 1, d.zona || "-");
      setRow(boxes[1], 2, d.status_text || d.status || "-");
    }
  }

  // Muat log presensi dari backend
  fetch("/api/siswa/log")
    .then(function (response) {
      return response.json();
    })
    .then(function (result) {
      if (result.success && result.data) {
        renderTable(result.data);
      }
    })
    .catch(function (error) {
      console.warn("Gagal memuat log siswa:", error);
    });
})();


// 3) Tab filter status (Semua / Hadir / Izin / Terlambat)
(function () {
  var tabs = document.getElementById("tab-status");
  var table = document.getElementById("log-table");

  if (!tabs || !table) return;

  tabs.addEventListener("click", function (event) {
    var btn = event.target.closest("button");

    if (!btn) return;

    tabs.querySelectorAll("button").forEach(function (button) {
      button.classList.remove("active");
    });

    btn.classList.add("active");

    var filter = btn.dataset.filter;

    table.querySelectorAll("tbody tr").forEach(function (row) {
      row.style.display =
        filter === "all" || row.dataset.status === filter
          ? ""
          : "none";
    });
  });
})();


// 4) Pagination (visual)
document.querySelectorAll(".pager").forEach(function (pager) {
  pager.addEventListener("click", function (event) {
    var btn = event.target.closest("button[data-page]");

    if (!btn) return;

    pager.querySelectorAll("button[data-page]").forEach(function (button) {
      button.classList.remove("active");
    });

    btn.classList.add("active");
  });
});
