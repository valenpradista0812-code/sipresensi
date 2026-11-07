const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const statsRoutes = require('./routes/stats');
const siswaRoutes = require('./routes/siswa');
const iotRoutes = require('./routes/iot');
const guruRoutes = require('./routes/guru');
const kelasRoutes = require('./routes/kelas');
const absensiRoutes = require('./routes/absensi');
const pengaturanRoutes = require('./routes/pengaturan');
const notifikasiRoutes = require('./routes/notifikasi');
const izinRoutes = require('./routes/izin');

const { pageAuthGuard, optionalAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static assets (CSS, JS, images, SVG, etc.) - serve public folder
app.use('/public', express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/siswa', siswaRoutes);
app.use('/api/iot', iotRoutes);
app.use('/api/guru', guruRoutes);
app.use('/api/kelas', kelasRoutes);
app.use('/api/absensi', absensiRoutes);
app.use('/api/pengaturan', pengaturanRoutes);
app.use('/api/notifikasi', notifikasiRoutes);
app.use('/api/izin', izinRoutes);

// Root Route handler
app.get('/', optionalAuth, (req, res) => {
  if (req.user) {
    if (req.user.role === 'siswa') {
      return res.redirect('/src/pages/student/dashboardsiswa.html');
    }
    return res.redirect('/src/pages/admin/dashboard.html');
  }
  return res.redirect('/src/pages/auth/login.html');
});

// Direct logout route
app.get('/logout', (req, res) => {
  res.clearCookie('sipresensi_token', { path: '/' });
  res.redirect('/src/pages/auth/login.html');
});

// ==========================================
// AUTH PAGES
// ==========================================

// Login page guard: if already logged in, redirect to appropriate dashboard
app.get('/login.html', optionalAuth, (req, res, next) => {
  if (req.user) {
    if (req.user.role === 'siswa') {
      return res.redirect('/src/pages/student/dashboardsiswa.html');
    }
    return res.redirect('/src/pages/admin/dashboard.html');
  }
  res.sendFile(path.join(__dirname, 'src/pages/auth/login.html'));
});

app.get('/src/pages/auth/login.html', optionalAuth, (req, res, next) => {
  if (req.user) {
    if (req.user.role === 'siswa') {
      return res.redirect('/src/pages/student/dashboardsiswa.html');
    }
    return res.redirect('/src/pages/admin/dashboard.html');
  }
  res.sendFile(path.join(__dirname, 'src/pages/auth/login.html'));
});

// ==========================================
// ADMIN / GURU PAGES
// ==========================================
const adminPages = [
  { old: '/dashboard.html', new: '/src/pages/admin/dashboard.html' },
  { old: '/data-siswa.html', new: '/src/pages/admin/data-siswa.html' },
  { old: '/data-guru.html', new: '/src/pages/admin/data-guru.html' },
  { old: '/data-kelas.html', new: '/src/pages/admin/data-kelas.html' },
  { old: '/absensi.html', new: '/src/pages/admin/absensi.html' },
  { old: '/riwayat-absensi.html', new: '/src/pages/admin/riwayat-absensi.html' },
  { old: '/rekap-bulanan.html', new: '/src/pages/admin/rekap-bulanan.html' },
  { old: '/profil-sekolah.html', new: '/src/pages/admin/profil-sekolah.html' },
  { old: '/pengaturan.html', new: '/src/pages/admin/pengaturan.html' },
  { old: '/notifikasi.html', new: '/src/pages/admin/notifikasi.html' }
];

// Register both old and new paths for admin pages
adminPages.forEach(page => {
  // Old path (for backward compatibility)
  app.get(page.old, pageAuthGuard(['guru', 'admin']), (req, res) => {
    const filePath = path.join(__dirname, 'src/pages/admin', path.basename(page.old));
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Halaman tidak ditemukan');
    }
    res.sendFile(filePath);
  });

  // New path
  app.get(page.new, pageAuthGuard(['guru', 'admin']), (req, res) => {
    const filePath = path.join(__dirname, page.new);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Halaman tidak ditemukan');
    }
    res.sendFile(filePath);
  });
});

// ==========================================
// STUDENT PAGES
// ==========================================
const studentPages = [
  { old: '/dashboard-siswa.html', new: '/src/pages/student/dashboardsiswa.html' },
  { old: '/dashboardsiswa.html', new: '/src/pages/student/dashboardsiswa.html' },
  { old: '/detail-absensi.html', new: '/src/pages/student/detail-absensi.html' },
  { old: '/profil-siswa.html', new: '/src/pages/student/profil.html' },
  { old: '/notifikasi-siswa.html', new: '/src/pages/student/notifikasi.html' }
];

// Register both old and new paths for student pages
studentPages.forEach(page => {
  // Old path (for backward compatibility)
  app.get(page.old, pageAuthGuard(['siswa', 'guru', 'admin']), (req, res) => {
    const filePath = path.join(__dirname, page.new);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Halaman tidak ditemukan');
    }
    res.sendFile(filePath);
  });

  // New path
  app.get(page.new, pageAuthGuard(['siswa', 'guru', 'admin']), (req, res) => {
    const filePath = path.join(__dirname, page.new);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Halaman tidak ditemukan');
    }
    res.sendFile(filePath);
  });
});

// Serve source assets only after guarded page routes.
app.use('/src', express.static(path.join(__dirname, 'src')));

// 404 fallback
app.use((req, res) => {
  if (req.accepts('html')) {
    return res.status(404).send('<h3>404 - Halaman tidak ditemukan</h3><p><a href="/">Kembali ke beranda</a></p>');
  }
  res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan.' });
});

// Start Server with auto-fallback if port is in use
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`=================================================`);
    console.log(`  SiPresensi Backend Server is running!`);
    console.log(`  Local URL: http://localhost:${port}`);
    console.log(`=================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Port ${port} sedang digunakan] Mencoba port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(Number(PORT));

module.exports = app;
