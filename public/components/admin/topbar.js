/**
 * SiPresensi - Admin Topbar Component
 * Komponen header/topbar untuk halaman admin
 */

const AdminTopbar = {
  // Render topbar HTML
  render(pageTitle = 'Dashboard SiPresensi', userInfo = {}) {
    const defaultUser = {
      name: 'Hj. Endang Triwati',
      role: 'Admin Kepegawaian',
      avatar: ''
    };
    
    const user = { ...defaultUser, ...userInfo };
    
    return `
      <header class="topbar">
        <h1 class="page-title">${pageTitle}</h1>
        <div class="topbar-right">
          <label class="search">
            <svg class="i" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" placeholder="Cari siswa, guru, kelas...">
          </label>
          <a class="bell" href="notifikasi.html" aria-label="Notifikasi">
            <svg class="i" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
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
            <div>
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
  window.AdminTopbar = AdminTopbar;
}