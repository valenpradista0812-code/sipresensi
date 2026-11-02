/**
 * SiPresensi - Path Updater Script
 * Script untuk memperbaharui semua referensi path di file HTML dan JS
 */

const fs = require('fs');
const path = require('path');

// Mapping file yang dipindahkan
const pathMappings = {
  // Dari root ke src/pages/admin
  admin: {
    'dashboard.html': '/src/pages/admin/dashboard.html',
    'data-siswa.html': '/src/pages/admin/data-siswa.html',
    'data-guru.html': '/src/pages/admin/data-guru.html',
    'data-kelas.html': '/src/pages/admin/data-kelas.html',
    'absensi.html': '/src/pages/admin/absensi.html',
    'riwayat-absensi.html': '/src/pages/admin/riwayat-absensi.html',
    'rekap-bulanan.html': '/src/pages/admin/rekap-bulanan.html',
    'profil-sekolah.html': '/src/pages/admin/profil-sekolah.html',
    'pengaturan.html': '/src/pages/admin/pengaturan.html',
    'notifikasi.html': '/src/pages/admin/notifikasi.html'
  },
  // Dari root ke src/pages/student
  student: {
    'dashboard-siswa.html': '/src/pages/student/dashboard.html',
    'detail-absensi.html': '/src/pages/student/detail-absensi.html'
  },
  // Dari root ke src/pages/auth
  auth: {
    'login.html': '/src/pages/auth/login.html'
  }
};

// Asset paths yang harus diperbarui
const assetUpdates = {
  'style-g.css': '/public/styles/shared.css',
  'style.css': '/public/styles/admin.css',
  'siswa.css': '/public/styles/student.css',
  'app-core.js': '/src/js/app-core.js',
  'script-siswa.js': '/src/js/script-siswa.js',
  'script.js': '/src/js/script.js'
};

/**
 * Update semua referensi path di sebuah file
 */
function updatePathsInFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let originalContent = content;

    // Update link href untuk CSS
    Object.entries(assetUpdates).forEach(([oldPath, newPath]) => {
      const linkRegex = new RegExp(`href=["']${oldPath}["']`, 'g');
      content = content.replace(linkRegex, `href="${newPath}"`);

      const scriptSrcRegex = new RegExp(`src=["']${oldPath}["']`, 'g');
      content = content.replace(scriptSrcRegex, `src="${newPath}"`);
    });

    // Update href di anchor tags
    const allPaths = { ...pathMappings.admin, ...pathMappings.student, ...pathMappings.auth };
    Object.entries(allPaths).forEach(([oldPath, newPath]) => {
      const hrefRegex = new RegExp(`href=["']${oldPath}["']`, 'g');
      content = content.replace(hrefRegex, `href="${newPath}"`);

      // Also handle paths without leading slash
      const hrefRegex2 = new RegExp(`href=["']${oldPath.substring(1)}["']`, 'g');
      content = content.replace(hrefRegex2, `href="${newPath}"`);
    });

    // Tulis kembali jika ada perubahan
    if (content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      return true;
    }
    return false;
  } catch (err) {
    console.error(`Error processing ${filePath}:`, err.message);
    return false;
  }
}

/**
 * Cari dan update semua file di direktori tertentu
 */
function updatePathsInDirectory(dirPath) {
  const files = fs.readdirSync(dirPath);
  let updatedCount = 0;

  files.forEach(file => {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // Rekursi ke subdirectory
      updatedCount += updatePathsInDirectory(filePath);
    } else if (file.endsWith('.html') || file.endsWith('.js')) {
      if (updatePathsInFile(filePath)) {
        console.log(`✓ Updated: ${filePath}`);
        updatedCount++;
      }
    }
  });

  return updatedCount;
}

/**
 * Main function
 */
function main() {
  console.log('🔄 Starting path update process...\n');

  // Update file di direktori src/pages
  const srcDir = path.join(__dirname, 'src/pages');
  if (fs.existsSync(srcDir)) {
    console.log('Updating files in src/pages/...');
    const count = updatePathsInDirectory(srcDir);
    console.log(`\n✓ Updated ${count} files in src/pages\n`);
  }

  // Update file di root directory
  const rootDir = __dirname;
  console.log('Updating files in root directory...');
  const rootFiles = fs.readdirSync(rootDir);
  let rootCount = 0;

  rootFiles.forEach(file => {
    const filePath = path.join(rootDir, file);
    const stat = fs.statSync(filePath);
    if (stat.isFile() && (file.endsWith('.html') || file.endsWith('.js'))) {
      if (updatePathsInFile(filePath)) {
        console.log(`✓ Updated: ${filePath}`);
        rootCount++;
      }
    }
  });

  console.log(`\n✓ Updated ${rootCount} files in root\n`);
  console.log('✅ Path update process completed!');
}

// Run the script
main();