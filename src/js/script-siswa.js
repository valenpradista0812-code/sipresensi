
/* Timer dashboard dikelola satu kali oleh sinkronisasi RFID di dashboard-siswa.html. */

// 0) Modal Dialog HTML Injection
(function () {
  if (document.getElementById('sipresensi-modal-container')) return;
  
  const modalHTML = `
    <div id="sipresensi-modal-container" style="
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    ">
      <div style="
        background: white;
        border-radius: 12px;
        padding: 24px;
        max-width: 400px;
        width: 90%;
        box-shadow: 0 20px 25px rgba(0, 0, 0, 0.15);
        animation: slideUp 0.3s ease;
      ">
        <div style="margin-bottom: 16px;">
          <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 700; color: #0f172a;">
            Konfirmasi Logout
          </h3>
          <p style="margin: 0; font-size: 14px; color: #64748b;">
            Apakah Anda yakin ingin keluar dari sistem?
          </p>
        </div>
        
        <div style="display: flex; gap: 12px; margin-top: 24px;">
          <button id="modal-cancel-btn" style="
            flex: 1;
            padding: 10px 16px;
            border: 1px solid #e2e8f0;
            background: white;
            color: #0f172a;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 14px;
          " onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='white'">
            Batal
          </button>
          <button id="modal-logout-btn" style="
            flex: 1;
            padding: 10px 16px;
            border: none;
            background: #ef4444;
            color: white;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 14px;
          " onmouseover="this.style.background='#dc2626'" onmouseout="this.style.background='#ef4444'">
            Logout
          </button>
        </div>
      </div>
    </div>
    <style>
      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    </style>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHTML);
})();

// 1) Logout handler
(function () {
  const logoutBtn = document.querySelector('.btn-logout');
  const modalContainer = document.getElementById('sipresensi-modal-container');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');
  const modalLogoutBtn = document.getElementById('modal-logout-btn');
  
  if (!logoutBtn) return;
  
  function showModal() {
    if (modalContainer) {
      modalContainer.style.display = 'flex';
    }
  }
  
  function hideModal() {
    if (modalContainer) {
      modalContainer.style.display = 'none';
    }
  }
  
  function performLogout() {
    hideModal();
    fetch('/api/auth/logout', { method: 'POST' })
      .then(function (response) {
        // Clear cookie dan redirect ke login
        window.location.href = '/login.html';
      })
      .catch(function (error) {
        console.error('Logout error:', error);
        // Jika ada error, tetap redirect ke login
        window.location.href = '/login.html';
      });
  }
  
  // Logout button click handler
  logoutBtn.addEventListener('click', function (e) {
    e.preventDefault();
    showModal();
  });
  
  // Cancel button click handler
  if (modalCancelBtn) {
    modalCancelBtn.addEventListener('click', hideModal);
  }
  
  // Logout confirmation button click handler
  if (modalLogoutBtn) {
    modalLogoutBtn.addEventListener('click', performLogout);
  }
  
  // Close modal when clicking outside (backdrop)
  if (modalContainer) {
    modalContainer.addEventListener('click', function (e) {
      if (e.target === modalContainer) {
        hideModal();
      }
    });
  }
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

      tr.innerHTML = `
        <td class="day">${escapeHtml(d.tgl || "-")}</td>
        <td><span class="t-ok">${escapeHtml(d.masuk || "-")}</span></td>
        <td>${escapeHtml(d.keluar || "-")}</td>
        <td>${escapeHtml(d.durasi || "-")}</td>
        <td>
          <span class="loc">
            <i class="dot"></i>
            ${escapeHtml(d.zona || "Gedung Sekolah")}
          </span>
        </td>
        <td>
          <span class="badge ${badgeClass}">
            ${escapeHtml((d.status || "Hadir").toUpperCase())}
          </span>
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
