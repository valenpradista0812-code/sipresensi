const jwt = require('jsonwebtoken');
const db = require('../data/db');

const JWT_SECRET = process.env.JWT_SECRET || (
  process.env.NODE_ENV === 'production'
    ? null
    : require('crypto').randomBytes(32).toString('hex')
);

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET harus disetel di environment production.');
}

function extractToken(req) {
  // Check cookies first
  if (req.cookies && req.cookies.sipresensi_token) {
    return req.cookies.sipresensi_token;
  }
  // Check authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  return null;
}

// Middleware for API routes: returns JSON error on failure
async function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Silakan login terlebih dahulu.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ success: false, message: 'Sesi telah kedaluwarsa, silakan login kembali.' });
  }

  let user;
  try {
    user = await db.findUserById(decoded.id);
  } catch (err) {
    console.error('Authentication user lookup failed:', err);
    return res.status(503).json({ success: false, message: 'Layanan autentikasi sementara tidak tersedia.' });
  }
  if (!user) {
    return res.status(401).json({ success: false, message: 'Pengguna tidak ditemukan.' });
  }

  const { password, ...safeUser } = user;
  req.user = safeUser;
  return next();
}

// Optional Auth (doesn't fail if no token)
async function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.findUserById(decoded.id);
    if (user) {
      const { password, ...safeUser } = user;
      req.user = safeUser;
    } else {
      req.user = null;
    }
  } catch (err) {
    req.user = null;
  }
  next();
}

// Middleware to enforce specific roles on API
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Silakan login terlebih dahulu.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke halaman atau aksi ini.' });
    }
    next();
  };
}

// Middleware for HTML Page Navigation (Page Route Guards)
function pageAuthGuard(allowedRoles = []) {
  return async (req, res, next) => {
    const token = extractToken(req);
    if (!token) {
      return res.redirect(`/login.html?redirect=${encodeURIComponent(req.originalUrl)}`);
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await db.findUserById(decoded.id);
      if (!user) {
        res.clearCookie('sipresensi_token', { path: '/' });
        return res.redirect(`/login.html?redirect=${encodeURIComponent(req.originalUrl)}`);
      }

      req.user = user;

      // If specific roles are required
      if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
        const target = user.role === 'siswa' ? '/dashboard-siswa.html' : '/dashboard.html';
        if (req.path === target) {
          return res.status(403).send('Akses ditolak: peran tidak sesuai.');
        }
        return res.redirect(target);
      }

      next();
    } catch (err) {
      res.clearCookie('sipresensi_token', { path: '/' });
      return res.redirect(`/login.html?redirect=${encodeURIComponent(req.originalUrl)}`);
    }
  };
}

module.exports = {
  JWT_SECRET,
  authenticate,
  optionalAuth,
  requireRole,
  pageAuthGuard
};
