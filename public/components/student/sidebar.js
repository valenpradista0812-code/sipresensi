/**
 * SiPresensi - Student Sidebar Component
 * Komponen sidebar untuk halaman siswa
 */

const StudentSidebar = {
  // Menu items untuk siswa
  menuItems: [
    { href: 'dashboardsiswa.html', icon: 'home', label: 'Dashboard' },
    { href: 'detail-absensi.html', icon: 'calendar', label: 'Absensi' }
  ],

  // Generate icon SVG berdasarkan tipe
  getIcon(iconName) {
    const icons = {
      'home': '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
      'calendar': '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'
    };
    return icons[iconName] || '';
  },

  // Render sidebar HTML
  render(currentPage = '') {
    const navItems = this.menuItems.map(item => {
      const isActive = currentPage === item.href ? 'active' : '';
      return `
        <a href="${item.href}" class="${isActive}">
          <svg class="i" viewBox="0 0 24 24" aria-hidden="true">${this.getIcon(item.icon)}</svg>
          <span>${item.label}</span>
        </a>
      `;
    }).join('');

    return `
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-logo">
            <svg class="i" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="2" width="16" height="20" rx="2"/>
              <path d="M9 22v-4h6v4"/>
              <path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>
            </svg>
          </div>
          <div>
            <div class="brand-name">SiPresensi</div>
            <div class="brand-sub">Sistem Absensi</div>
          </div>
        </div>
        <nav class="nav">
          ${navItems}
        </nav>
        <div class="sidebar-foot">
          v2.4.1 Stable<br>
          SMA Negeri 1 Jakarta
        </div>
      </aside>
    `;
  }
};

// Export untuk digunakan di browser
if (typeof window !== 'undefined') {
  window.StudentSidebar = StudentSidebar;
}