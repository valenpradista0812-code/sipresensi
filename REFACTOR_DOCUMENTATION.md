# SiPresensi - Dokumentasi Refactor Struktur Folder

## 📋 Ringkasan Perubahan

Refactor ini telah mengorganisir ulang project SiPresensi menjadi struktur yang lebih modular, mudah dikelola, dan scalable. Pemisahan yang jelas antara tampilan admin dan siswa, serta komponen yang dapat digunakan kembali, membuat maintenance menjadi lebih efisien.

---

## 📁 Struktur Folder Akhir

```
sipresensi/
├── public/                           # File publik yang dapat diakses klien
│   ├── components/                   # Komponen UI yang reusable
│   │   ├── shared/                   # Komponen bersama (admin & siswa)
│   │   │   ├── toast.js              # Komponen notifikasi toast
│   │   │   └── utils.js              # Utility functions bersama
│   │   ├── admin/                    # Komponen khusus admin
│   │   │   ├── sidebar.js            # Sidebar admin dengan 10 menu items
│   │   │   └── topbar.js             # Header/topbar admin
│   │   └── student/                  # Komponen khusus siswa
│   │       ├── sidebar.js            # Sidebar siswa dengan 2 menu items
│   │       └── topbar.js             # Header/topbar siswa
│   ├── layouts/                      # Layout templates
│   │   ├── admin-layout.js           # Template layout admin
│   │   └── student-layout.js         # Template layout siswa
│   └── styles/                       # File CSS
│       ├── shared.css                # CSS bersama (style-g.css)
│       ├── admin.css                 # CSS admin (style.css)
│       └── student.css               # CSS siswa (siswa.css)
│
├── src/                              # Source code
│   ├── pages/                        # Halaman aplikasi
│   │   ├── admin/                    # Halaman untuk admin/guru
│   │   │   ├── dashboard.html        # Dashboard admin
│   │   │   ├── data-siswa.html       # Manajemen data siswa
│   │   │   ├── data-guru.html        # Manajemen data guru
│   │   │   ├── data-kelas.html       # Manajemen data kelas
│   │   │   ├── absensi.html          # Input absensi
│   │   │   ├── riwayat-absensi.html  # Riwayat absensi
│   │   │   ├── rekap-bulanan.html    # Rekap bulanan
│   │   │   ├── profil-sekolah.html   # Profil sekolah
│   │   │   ├── pengaturan.html       # Pengaturan sistem
│   │   │   └── notifikasi.html       # Notifikasi
│   │   ├── student/                  # Halaman untuk siswa
│   │   │   ├── dashboard.html        # Dashboard siswa
│   │   │   └── detail-absensi.html   # Detail absensi siswa
│   │   └── auth/                     # Halaman autentikasi
│   │       └── login.html            # Halaman login
│   ├── js/                           # JavaScript client-side
│   │   ├── admin/                    # JS untuk admin (siap untuk ekspansi)
│   │   ├── student/                  # JS untuk siswa (siap untuk ekspansi)
│   │   ├── shared/                   # JS bersama (siap untuk ekspansi)
│   │   ├── app-core.js               # Core logic admin
│   │   ├── script-siswa.js           # Logic siswa
│   │   └── script.js                 # Utility scripts
│   └── utils/                        # Utility functions (siap untuk ekspansi)
│
├── routes/                           # Backend API routes
│   ├── auth.js
│   ├── stats.js
│   ├── siswa.js
│   ├── iot.js
│   ├── guru.js
│   ├── kelas.js
│   ├── absensi.js
│   ├── pengaturan.js
│   └── notifikasi.js
│
├── middleware/                       # Express middleware
│   └── auth.js                       # Autentikasi & otorisasi
│
├── data/                             # Data files (database, cache, dll)
├── server.js                         # Main server file
├── init-db.js                        # Database initialization
├── package.json
├── .env                              # Environment variables
└── README.md
```

---

## 🔄 File yang Dipindahkan

### Halaman Admin (10 halaman)
| File Lama | File Baru |
|-----------|-----------|
| `dashboard.html` | `src/pages/admin/dashboard.html` |
| `data-siswa.html` | `src/pages/admin/data-siswa.html` |
| `data-guru.html` | `src/pages/admin/data-guru.html` |
| `data-kelas.html` | `src/pages/admin/data-kelas.html` |
| `absensi.html` | `src/pages/admin/absensi.html` |
| `riwayat-absensi.html` | `src/pages/admin/riwayat-absensi.html` |
| `rekap-bulanan.html` | `src/pages/admin/rekap-bulanan.html` |
| `notifikasi.html` | `src/pages/admin/notifikasi.html` |
| `profil-sekolah.html` | `src/pages/admin/profil-sekolah.html` |
| `pengaturan.html` | `src/pages/admin/pengaturan.html` |

### Halaman Siswa (2 halaman)
| File Lama | File Baru |
|-----------|-----------|
| `dashboard-siswa.html` | `src/pages/student/dashboard.html` |
| `detail-absensi.html` | `src/pages/student/detail-absensi.html` |

### Halaman Autentikasi (1 halaman)
| File Lama | File Baru |
|-----------|-----------|
| `login.html` | `src/pages/auth/login.html` |

### File CSS (3 file)
| File Lama | File Baru |
|-----------|-----------|
| `style-g.css` | `public/styles/shared.css` |
| `style.css` | `public/styles/admin.css` |
| `siswa.css` | `public/styles/student.css` |

### File JavaScript (3 file)
| File Lama | File Baru |
|-----------|-----------|
| `app-core.js` | `src/js/app-core.js` |
| `script-siswa.js` | `src/js/script-siswa.js` |
| `script.js` | `src/js/script.js` |

---

## 🆕 Komponen Baru yang Dibuat

### 1. **Sidebar Components** (2 file)
- `public/components/admin/sidebar.js` - Sidebar untuk halaman admin dengan 10 menu items
- `public/components/student/sidebar.js` - Sidebar untuk halaman siswa dengan 2 menu items

**Keuntungan:**
- Perubahan menu hanya perlu dilakukan di satu tempat
- Menu items secara otomatis di-generate dari array
- Dapat dengan mudah dimodifikasi, ditambah, atau dikurangi

### 2. **Topbar Components** (2 file)
- `public/components/admin/topbar.js` - Header admin dengan user info
- `public/components/student/topbar.js` - Header siswa dengan tanggal dan notifikasi

**Keuntungan:**
- Header dapat di-update secara terpusat
- User info dapat dipass sebagai parameter
- Fleksibel untuk perubahan di masa depan

### 3. **Shared Components** (2 file)
- `public/components/shared/toast.js` - Komponen notifikasi toast yang reusable
- `public/components/shared/utils.js` - Utility functions bersama

**Keuntungan:**
- Menghindari duplikasi kode
- Konsistensi UI di seluruh aplikasi
- Mudah untuk melakukan perubahan

### 4. **Layout Templates** (2 file)
- `public/layouts/admin-layout.js` - Template layout admin
- `public/layouts/student-layout.js` - Template layout siswa

**Keuntungan:**
- Layout dapat digunakan sebagai template untuk halaman baru
- Konsistensi struktur HTML di semua halaman
- Mudah mengelola assets yang di-load

---

## 🔗 Update Reference Paths

Semua referensi path di file HTML telah diperbarui:

### Asset References
```
style-g.css → /public/styles/shared.css
style.css → /public/styles/admin.css
siswa.css → /public/styles/student.css
app-core.js → /src/js/app-core.js
script-siswa.js → /src/js/script-siswa.js
script.js → /src/js/script.js
```

### Navigation Links
```
Semua anchor tag href telah diupdate untuk menunjuk ke path baru:
- dashboard.html → /src/pages/admin/dashboard.html
- data-siswa.html → /src/pages/admin/data-siswa.html
- ... (dan seterusnya untuk semua halaman)
```

---

## 🖥️ Update Server Routing

File `server.js` telah diperbarui untuk mendukung:

### 1. **Backward Compatibility**
- Path lama masih berfungsi (misal: `/dashboard.html`)
- Secara otomatis diarahkan ke path baru
- Tidak merusak link lama yang masih digunakan

### 2. **New Routing Structure**
```javascript
// Admin pages
GET /src/pages/admin/dashboard.html → Requires auth: ['guru', 'admin']
GET /src/pages/admin/data-siswa.html → Requires auth: ['guru', 'admin']
... (dan seterusnya)

// Student pages
GET /src/pages/student/dashboard.html → Requires auth: ['siswa', 'guru', 'admin']
GET /src/pages/student/detail-absensi.html → Requires auth: ['siswa', 'guru', 'admin']

// Auth pages
GET /src/pages/auth/login.html → No auth required
```

### 3. **Static Assets**
```javascript
// Serve public folder
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/src', express.static(path.join(__dirname, 'src')));

// Fallback untuk kompatibilitas
app.use(express.static(path.join(__dirname)));
```

---

## ✅ Verifikasi Perubahan

### File HTML yang Diperbarui
- ✓ 10 halaman admin (path asset & link diperbarui)
- ✓ 2 halaman siswa (path asset & link diperbarui)
- ✓ 1 halaman login (path asset & link diperbarui)

### Struktur Folder
```
✓ public/components/shared/          (2 file)
✓ public/components/admin/           (2 file)
✓ public/components/student/         (2 file)
✓ public/layouts/                    (2 file)
✓ public/styles/                     (3 file CSS)
✓ src/pages/admin/                   (10 file HTML)
✓ src/pages/student/                 (2 file HTML)
✓ src/pages/auth/                    (1 file HTML)
✓ src/js/                            (3 file JS)
```

### Backend
- ✓ server.js diperbarui dengan routing baru
- ✓ Backward compatibility tetap terjaga
- ✓ Middleware autentikasi tidak berubah

---

## 🚀 Cara Menggunakan Project Baru

### 1. **Menjalankan Server**
```bash
npm install
npm start
```

### 2. **Akses Halaman**

**Admin/Guru:**
- Dashboard: http://localhost:3000/src/pages/admin/dashboard.html
- Data Siswa: http://localhost:3000/src/pages/admin/data-siswa.html
- (atau path lama masih didukung)

**Siswa:**
- Dashboard: http://localhost:3000/src/pages/student/dashboard.html
- Riwayat Absensi: http://localhost:3000/src/pages/student/detail-absensi.html

**Login:**
- http://localhost:3000/src/pages/auth/login.html
- (atau http://localhost:3000/login.html)

### 3. **Menambah Halaman Baru Admin**
```bash
# 1. Buat file HTML di: src/pages/admin/halaman-baru.html
# 2. Gunakan referensi path baru di file tersebut:
#    - CSS: /public/styles/admin.css
#    - JS: /src/js/app-core.js
#    - Links: /src/pages/admin/halaman-lain.html

# 3. Perbarui AdminSidebar di: public/components/admin/sidebar.js
#    Tambahkan item menu:
menuItems: [
  ...
  { href: 'halaman-baru.html', icon: 'icon-name', label: 'Halaman Baru' }
]

# 4. Update server.js jika diperlukan (biasanya tidak perlu)
```

### 4. **Menambah Komponen Baru Shared**
```javascript
// Buat file di: public/components/shared/nama-komponen.js
// Contoh:
const MyComponent = {
  render(options = {}) {
    return `
      <div class="my-component">
        <!-- HTML di sini -->
      </div>
    `;
  }
};

if (typeof window !== 'undefined') {
  window.MyComponent = MyComponent;
}
```

---

## 📊 Perbandingan Sebelum & Sesudah

### **Sebelum Refactor**
```
Project Root
├── login.html
├── dashboard.html
├── dashboard-siswa.html
├── data-siswa.html
├── ... (11 HTML files di root)
├── style.css
├── style-g.css
├── siswa.css
├── app-core.js
├── script-siswa.js
├── script.js
├── routes/
├── middleware/
└── data/
```

**Masalah:**
- ❌ File HTML tercampur semua di root
- ❌ Sulit membedakan halaman admin vs siswa
- ❌ CSS dan JS tidak terorganisir
- ❌ Komponen navbar/sidebar tidak reusable (duplikasi di setiap HTML)
- ❌ Sulit untuk scale dan maintain

### **Sesudah Refactor**
```
Project Root
├── public/
│   ├── components/
│   │   ├── shared/
│   │   ├── admin/
│   │   └── student/
│   ├── layouts/
│   └── styles/
├── src/
│   ├── pages/
│   │   ├── admin/
│   │   ├── student/
│   │   └── auth/
│   ├── js/
│   └── utils/
├── routes/
├── middleware/
└── data/
```

**Keuntungan:**
- ✅ Struktur terorganisir dan mudah dipahami
- ✅ Pemisahan jelas antara admin & siswa
- ✅ Komponen dapat digunakan kembali
- ✅ Asset (CSS/JS) terstruktur dengan baik
- ✅ Mudah untuk menambah halaman baru
- ✅ Backward compatible dengan path lama
- ✅ Professional & scalable architecture

---

## 🛠️ Tools & Scripts yang Dibuat

### 1. **update-html-paths.js**
Mengupdate semua referensi CSS dan JS di file HTML yang dipindahkan.

### 2. **update-html-links.js**
Mengupdate semua anchor tag href untuk menunjuk ke path baru.

### 3. **scripts/update-paths.js**
Script modular untuk future path updates (optional).

---

## 📝 Notes Penting

1. **Backward Compatibility Terjaga**
   - Semua path lama masih berfungsi
   - User tidak perlu update bookmarks
   - Gradual migration dapat dilakukan

2. **Fungsionalitas Tidak Berubah**
   - Semua fitur tetap berfungsi seperti sebelumnya
   - Autentikasi dan autorisasi tidak berubah
   - API routes tidak berubah

3. **Folder Original Masih Ada**
   - File lama (HTML, CSS, JS di root) masih ada untuk reference
   - Dapat dihapus setelah memastikan semuanya berfungsi normal

4. **CSS & JS Masih Sama**
   - File CSS dan JS tidak diubah, hanya dipindahkan
   - Styling dan functionality tetap sama

---

## 🎯 Kesimpulan

Refactor ini berhasil mencapai semua tujuan:

✅ **Navbar/Sidebar Terpisah** - Komponen reusable di `public/components/`
✅ **Pemisahan Admin & Siswa** - Jelas terlihat di struktur folder
✅ **Shared Components** - Tidak ada duplikasi kode
✅ **Struktur Rapi** - Professional dan mudah dimengerti
✅ **Fungsionalitas Terjaga** - Semua fitur masih berfungsi normal
✅ **Backward Compatible** - Path lama masih didukung
✅ **Siap untuk Development** - Mudah menambah halaman/komponen baru

---

## 📞 Support

Untuk pertanyaan atau masalah, hubungi tim development atau lihat dokumentasi di folder masing-masing.
