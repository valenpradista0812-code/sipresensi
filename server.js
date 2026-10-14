const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const statsRoutes = require('./routes/stats');
const siswaRoutes = require('./routes/siswa');
const guruRoutes = require('./routes/guru');
const kelasRoutes = require('./routes/kelas');
const absensiRoutes = require('./routes/absensi');
const pengaturanRoutes = require('./routes/pengaturan');
const notifikasiRoutes = require('./routes/notifikasi');

const { pageAuthGuard, optionalAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/siswa', siswaRoutes);
app.use('/api/guru', guruRoutes);
app.use('/api/kelas', kelasRoutes);
app.use('/api/absensi', absensiRoutes);
app.use('/api/pengaturan', pengaturanRoutes);
app.use('/api/notifikasi', notifikasiRoutes);

// Root Route handler
app.get('/', optionalAuth, (req, res) => {
  if (req.user) {
    if (req.user.role === 'siswa') {
      return res.redirect('/dashboard-siswa.html');
    }
    return res.redirect('/dashboard.html');
  }
  return res.redirect('/login.html');
});

// Direct logout route
app.get('/logout', (req, res) => {
  res.clearCookie('sipresensi_token', { path: '/' });
  res.redirect('/login.html');
});

// Login page guard: if already logged in, redirect to appropriate dashboard
app.get('/login.html', optionalAuth, (req, res, next) => {
  if (req.user) {
    if (req.user.role === 'siswa') {
      return res.redirect('/dashboard-siswa.html');
    }
    return res.redirect('/dashboard.html');
  }
  res.sendFile(path.join(__dirname, 'login.html'));
});

// Teacher / Admin protected page routes
const fs = require('fs');
const guruPages = [
  '/dashboard.html',
  '/data-siswa.html',
  '/data-guru.html',
  '/data-kelas.html',
  '/absensi.html',
  '/riwayat-absensi.html',
  '/rekap-bulanan.html',
  '/profil-sekolah.html',
  '/pengaturan.html',
  '/notifikasi.html'
];

guruPages.forEach(page => {
  app.get(page, pageAuthGuard(['guru', 'admin']), (req, res, next) => {
    const filePath = path.join(__dirname, page);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Halaman tidak ditemukan');
    }
    res.sendFile(filePath);
  });
});

// Student protected page routes (accessible by siswa, and guru can view too)
const siswaPages = [
  '/dashboard-siswa.html',
  '/detail-absensi.html'
];

siswaPages.forEach(page => {
  app.get(page, pageAuthGuard(['siswa', 'guru', 'admin']), (req, res, next) => {
    res.sendFile(path.join(__dirname, page));
  });
});

// Static assets (CSS, JS, images, SVG, etc.)
app.use(express.static(path.join(__dirname)));

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
    console.log(`  Default Teacher Account: admin.endang@sman1jkt.sch.id / password123`);
    console.log(`  Default Student Account: siswa@sman1jkt.sch.id / password123`);
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
