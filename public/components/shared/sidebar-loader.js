/**
 * SiPresensi - Sidebar Loader
 * Memuat sidebar HTML secara dinamis berdasarkan role user
 */

document.addEventListener('DOMContentLoaded', function() {
  // Cek role user via class di body
  const bodyClass = document.body.className;
  let role = 'admin'; // default
  if (bodyClass.includes('siswa')) {
    role = 'student';
  } else if (bodyClass.includes('admin') || bodyClass.includes('guru')) {
    role = 'admin';
  }

  // Container sidebar
  const container = document.getElementById('sidebar-container');
  if (!container) return;

  // Load sidebar sesuai role
  loadSidebar(role, container);
});

async function loadSidebar(role, container) {
  try {
    const path = role === 'student' 
      ? '/public/components/student/sidebar.html' 
      : '/public/components/admin/sidebar.html';
    
    const response = await fetch(path);
    if (!response.ok) throw new Error('Failed to load sidebar');
    
    const html = await response.text();
    container.innerHTML = html;
    
    // Handle active state dan mobile sidebar logic
    handleSidebarLogic();
  } catch (err) {
    console.error('Sidebar load error:', err);
    container.innerHTML = '<p style="color:red; padding:20px;">Gagal memuat sidebar</p>';
  }
}

function handleSidebarLogic() {
  // Hamburger toggle (untuk mobile)
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const hamburger = document.getElementById('hamburger');
  const closeBtn = document.getElementById('sidebar-close');

  if (sidebar && hamburger) {
    // Set up hamburger toggle
    hamburger.addEventListener('click', () => {
      sidebar.classList.add('open');
      overlay.classList.add('show');
      document.body.classList.add('no-scroll');
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
      document.body.classList.remove('no-scroll');
    });
  }

  if (overlay) {
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
      document.body.classList.remove('no-scroll');
    });
  }

  // Set active menu item
  const currentPath = window.location.pathname;
  const currentPage = currentPath.split('/').pop();

  sidebar.querySelectorAll('.nav a').forEach(link => {
    const href = link.getAttribute('href');
    const pageName = href.split('/').pop();
    
    if (pageName === currentPage || (currentPage === '' && pageName === 'dashboard.html')) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}
