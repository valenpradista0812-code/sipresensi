/**
 * SiPresensi - Sidebar Loader
 * Memuat sidebar HTML dari file terpisah secara dinamis
 */

(function() {
  // Tunggu DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
  } else {
    initSidebar();
  }

  async function initSidebar() {
    const container = document.getElementById('sidebar-container');
    if (!container) return;

    // Tentukan role dari body class atau URL
    let role = 'admin';
    if (document.body.classList.contains('siswa')) {
      role = 'student';
    }

    // Load sidebar HTML
    try {
      const path = role === 'student' 
        ? '/public/components/student/sidebar-content.html' 
        : '/public/components/admin/sidebar-content.html';
      
      const response = await fetch(path);
      if (!response.ok) throw new Error('Failed to load sidebar');
      
      const html = await response.text();
      container.innerHTML = html;
      
      // Setup sidebar logic (active state, mobile toggle, dll)
      setupSidebarLogic();
    } catch (err) {
      console.error('Sidebar loader error:', err);
    }
  }

  function setupSidebarLogic() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const hamburger = document.getElementById('hamburger');
    const closeBtn = document.getElementById('sidebar-close');

    if (!sidebar) return;

    // Hamburger toggle untuk mobile
    if (hamburger) {
      hamburger.addEventListener('click', (e) => {
        e.stopPropagation();
        sidebar.classList.add('open');
        if (overlay) overlay.classList.add('show');
        document.body.classList.add('no-scroll');
      });
    }

    // Close button
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.classList.remove('no-scroll');
      });
    }

    // Overlay click
    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
        document.body.classList.remove('no-scroll');
      });
    }

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.classList.remove('no-scroll');
      }
    });

    // Set active menu item berdasarkan URL
    const currentPath = window.location.pathname;
    const currentFile = currentPath.split('/').pop() || 'dashboard.html';

    sidebar.querySelectorAll('.nav a').forEach(link => {
      const href = link.getAttribute('href');
      const linkFile = href.split('/').pop();
      
      if (linkFile === currentFile) {
        link.classList.add('active');
      }
    });

    // Close sidebar saat link diklik (mobile)
    sidebar.querySelectorAll('.nav a').forEach(link => {
      link.addEventListener('click', () => {
        if (window.innerWidth <= 640) {
          sidebar.classList.remove('open');
          if (overlay) overlay.classList.remove('show');
          document.body.classList.remove('no-scroll');
        }
      });
    });

    // Close sidebar saat resize ke desktop
    window.addEventListener('resize', () => {
      if (window.innerWidth > 640) {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('show');
        document.body.classList.remove('no-scroll');
      }
    });
  }
})();
