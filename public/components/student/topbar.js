/**
 * SiPresensi - Student Topbar Component
 * Komponen header/topbar untuk halaman siswa
 */

const StudentTopbar = {
  // Render topbar HTML
  render(pageTitle = 'Dashboard Siswa', userInfo = {}) {
    const defaultUser = {
      name: 'siswa',
      role: 'Siswa',
      avatar: ''
    };
    
    const user = { ...defaultUser, ...userInfo };
    
    return `
      <header class="topbar">
        <div class="topbar-left">
          <button class="hamburger" id="hamburger" aria-label="Buka menu">
            <svg class="i" viewBox="0 0 24 24" aria-hidden="true">
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <div class="brand-mobile">
            <svg class="i" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="2" width="16" height="20" rx="2"/>
              <path d="M9 22v-4h6v4"/>
              <path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>
            </svg>
            <span>SiPresensi</span>
          </div>
          <div class="titles">
            <h1 class="page-title" data-i18n="dashboard">${pageTitle}</h1>
            <div class="period" id="current-date"></div>
          </div>
        </div>
        <div class="topbar-right">
          <a class="bell" href="javascript:void(0)" aria-label="Notifikasi" id="bell-btn">
            <svg class="i" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span class="badge" id="notif-badge" style="display:none">0</span>
          </a>
          <div class="user">
            <div class="avatar">
              <svg viewBox="0 0 40 40" role="img" aria-label="Foto ${user.name}">
                <rect width="40" height="40" fill="#cbd5e1"/>
                <path d="M6 40c1-9 7-13 14-13s13 4 14 13z" fill="#1f2937"/>
                <ellipse cx="20" cy="17" rx="10" ry="11" fill="#1f2937"/>
                <ellipse cx="20" cy="18" rx="6.5" ry="7.5" fill="#f1c9a5"/>
                <path d="M13.5 15c2-4 11-4 13 0-3-1.5-10-1.5-13 0z" fill="#1f2937"/>
              </svg>
            </div>
            <div class="user-info">
              <div class="user-name">${user.name}</div>
              <div class="user-role">${user.role}</div>
            </div>
          </div>
        </div>
      </header>
    `;
  }
};

// Export untuk digunakan di browser
if (typeof window !== 'undefined') {
  window.StudentTopbar = StudentTopbar;
}