/**
 * SiPresensi - Student Layout Component
 * Layout wrapper untuk semua halaman siswa
 */

const StudentLayout = {
  // Render layout dengan konten
  render(options = {}) {
    const {
      pageTitle = 'Dashboard Siswa',
      currentPage = '',
      userInfo = {},
      content = ''
    } = options;

    return `
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle} - SiPresensi</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/public/styles/student.css">
</head>
<body>
<div class="app">
  ${StudentSidebar.render(currentPage)}
  
  <div class="main">
    ${StudentTopbar.render(pageTitle, userInfo)}
    
    <main class="content">
      ${content}
    </main>
  </div>
</div>

<script src="/public/components/student/sidebar.js"></script>
<script src="/public/components/student/topbar.js"></script>
<script src="/public/components/shared/toast.js"></script>
<script src="/public/components/shared/utils.js"></script>
<script src="/src/js/script-siswa.js"></script>
</body>
</html>
    `;
  },

  // Inject konten ke dalam layout yang sudah ada
  injectContent(contentSelector, content) {
    const contentElement = document.querySelector(contentSelector);
    if (contentElement) {
      contentElement.innerHTML = content;
    }
  }
};

// Export untuk digunakan di browser
if (typeof window !== 'undefined') {
  window.StudentLayout = StudentLayout;
}