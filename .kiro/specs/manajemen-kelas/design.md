# Manajemen Kelas — Design

**Feature**: Class Management Interface
**Date**: 2026-11-16
**Status**: Approved

## Overview

Petugas SiPresensi akan memiliki halaman dashboard khusus untuk mengelola kelas, dengan tampilan yang konsisten dengan halaman petugas lain (data-akun.html). Halaman ini mengintegrasikan backend API kelas.js yang sudah exist, ditambah helper functions untuk parser tingkat dan validasi wali ganda.

## Architecture

### Frontend Structure

```
src/pages/petugas/manajemen-kelas.html
  ├── Layout: .app.kelas-page (100dvh, flex column)
  ├── Topbar (sticky)
  ├── Main content (flex-grow)
  │   ├── Toolbar (filter tingkat, search, tombol Tambah)
  │   ├── Stats (3 kartu: total, with wali, without wali)
  │   └── Table Card
  │       ├── Scroll container (flex-grow)
  │       ├── Table (sticky header)
  │       └── Footer count
  └── Modal (inline, hidden by default)

Styling:
  └── public/styles/kelas.css (extend shared.css)
```

### Backend Architecture

#### New Helpers: `utils/kelas-tingkat.js`

```javascript
/**
 * Parse tingkat (X, XI, XII) dari nama kelas
 * @param {string} name - Nama kelas, e.g., "X-A", "XI Bisnis", "XII-IPA"
 * @returns {string|null} - 'X', 'XI', 'XII', atau null jika tidak valid
 */
export function parseTingkat(name) {
  if (!name) return null;
  // Regex: word boundary + X/XI/XII + non-word char (atau end)
  const match = String(name).match(/\b(XII|XI|X)\b/);
  return match ? match[1] : null;
}

/**
 * Validasi apakah nama kelas dimulai dengan prefix tingkat valid
 * @param {string} name
 * @returns {boolean}
 */
export function isValidTingkatPrefix(name) {
  return parseTingkat(name) !== null;
}
```

#### Updated: `routes/kelas.js`

**GET /api/kelas**
```
Query params:
  ?q=<searchTerm>    (cari nama kelas atau wali)
  ?tingkat=<X|XI|XII> (filter tingkat)

Response:
{
  success: true,
  count: 15,
  stats: {
    total: 15,
    withWali: 12,
    withoutWali: 3
  },
  data: [
    {
      id: "kls-xxx",
      name: "X-A",
      tingkat: "X",
      totalSiswa: 36,
      waliKelas: "Budi Santoso",
      waliKelasId: "usr-123",
      waliStatus: "ada",  // 'ada' | 'belum'
      ruangan: "Gedung A"
    },
    ...
  ]
}
```

**POST /api/kelas** (requireRole: 'petugas')
```
Body:
{
  name: "X-B",
  totalSiswa: 36,
  waliKelasId: "usr-456" (optional, null untuk tanpa wali),
  ruangan: "Gedung B"
}

Validasi Backend:
  1. name wajib & trim
  2. parseTingkat(name) !== null → error 400
  3. findKelasByName(name) → error 409 jika duplikat
  4. Jika waliKelasId: validasi guru exist, check tidak jadi wali kelas lain
  5. Jika error wali ganda → 409 + pesan kelas yang pakai guru

Response success:
{
  success: true,
  message: "Data kelas berhasil ditambahkan.",
  data: { id, name, tingkat, totalSiswa, waliKelas, waliKelasId, waliStatus, ruangan }
}
```

**PUT /api/kelas/{id}** (requireRole: 'petugas')
```
Body: { name?, totalSiswa?, waliKelasId?, ruangan? }

Validasi:
  1. Kelas harus exist
  2. Jika name berubah: check unik, validasi tingkat
  3. Jika waliKelasId berubah: validasi guru exist, check tidak jadi wali lain
  4. Sinkronkan wali_kelas dari guru.name

Response: { success, message, data }
```

**DELETE /api/kelas/{id}** (requireRole: 'petugas')
```
Proses:
  1. Check countKelasReferences(kelas.name)
  2. Jika ada referensi → 409 + daftar relasi
  3. Hapus dari DB

Response: { success, message, data }
```

#### Updated: `data/db.js`

**Existing functions** (sudah ada, perlu verify):
- `getKelas()` → return all
- `findKelasByName(name)` → return 1 or null
- `findKelasByIdOrName(idOrName)` → return 1 or null
- `findGuruByIdOrNip(id)` → return guru
- `addKelas(payload)` → save wali_kelas_id
- `updateKelas(id, payload)` → save wali_kelas_id
- `deleteKelas(id)` → delete by id
- `countKelasReferences(name)` → { siswa, absensi, jadwal, izin, akun }

**Verify**:
- `addKelas()` harus save field `wali_kelas_id` (saat ini mungkin belum)
- `updateKelas()` harus handle wali_kelas_id + sinkron nama guru
- `countKelasReferences()` harus return exact count

#### Error Response Formats

```javascript
// 400 Bad Request
{ success: false, message: "Nama kelas wajib diisi." }

// 404 Not Found
{ success: false, message: "Data kelas tidak ditemukan." }

// 409 Conflict (duplikat atau wali ganda)
{
  success: false,
  message: "Kelas dengan nama tersebut sudah ada." 
  // atau
  message: "Guru Budi Santoso sudah menjadi wali kelas X-A. Satu guru hanya dapat menjadi wali satu kelas."
  // atau
  message: "Kelas masih dipakai oleh: siswa, jadwal, izin"
}

// 403 Forbidden
{ success: false, message: "Anda tidak memiliki akses ke halaman ini." }
```

### Frontend Page: `manajemen-kelas.html`

#### Layout

```html
<body class="petugas admin">
  <div class="app kelas-page">
    <!-- Sidebar -->
    <div id="sidebar-container"></div>
    
    <div class="main">
      <!-- Topbar -->
      <header class="topbar">
        <h1 class="page-title">Manajemen Kelas</h1>
        <!-- User avatar, notifications -->
      </header>
      
      <main class="content">
        <!-- Toolbar: filter, search, add button -->
        <div class="toolbar kelas-toolbar">
          <div class="toolbar-left">
            <!-- Filter tingkat -->
            <div class="kelas-filter-wrap">
              <select id="filter-kelas-tingkat" aria-label="Filter kelas berdasarkan tingkat">
                <option value="">Semua Tingkat</option>
                <option value="X">Kelas X</option>
                <option value="XI">Kelas XI</option>
                <option value="XII">Kelas XII</option>
              </select>
              <svg class="chevron"><!-- dropdown arrow --></svg>
            </div>
            <!-- Search -->
            <div class="kelas-search">
              <input type="search" id="search-kelas-input" placeholder="Cari nama kelas atau wali...">
            </div>
          </div>
          <!-- Add button -->
          <button class="btn btn-primary" id="btn-add-kelas">+ Tambah Kelas</button>
        </div>
        
        <!-- Statistics Cards -->
        <div class="stats stats-3">
          <div class="stat-card">
            <div class="stat-label">Total Kelas</div>
            <div class="stat-value" id="stat-total">-</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Kelas dengan Wali</div>
            <div class="stat-value" id="stat-with-wali">-</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Kelas Tanpa Wali</div>
            <div class="stat-value" id="stat-without-wali">-</div>
          </div>
        </div>
        
        <!-- Table Card -->
        <section class="card table-card kelas-table-card">
          <div class="table-scroll kelas-table-scroll" id="kelas-table-scroll" tabindex="0">
            <table class="kelas-table" id="kelas-table">
              <thead>
                <tr>
                  <th>No</th>
                  <th>Nama Kelas</th>
                  <th>Tingkat</th>
                  <th>Wali Kelas</th>
                  <th>Status Wali</th>
                  <th>Total Siswa</th>
                  <th class="right">Aksi</th>
                </tr>
              </thead>
              <tbody id="kelas-tbody" aria-live="polite">
                <tr><td colspan="7" style="text-align:center; padding:24px;">Memuat data kelas...</td></tr>
              </tbody>
            </table>
          </div>
          <div class="table-foot kelas-foot">
            <span id="kelas-foot-count">Menampilkan data kelas</span>
          </div>
        </section>
      </main>
    </div>
  </div>
  
  <!-- Modal Tambah / Edit Kelas -->
  <div id="modal-kelas" role="dialog" aria-modal="true">
    <div class="modal-content">
      <div class="modal-header">
        <h3 id="kelas-modal-title">Tambah Kelas Baru</h3>
        <button type="button" id="kelas-modal-close">&times;</button>
      </div>
      <form id="form-kelas">
        <input type="hidden" id="kelas-edit-id">
        
        <!-- Nama Kelas -->
        <div>
          <label>Nama Kelas *</label>
          <input type="text" id="m-nama-kelas" placeholder="Contoh: X-A, XI Bisnis, XII-IPA" required>
          <small id="m-tingkat-hint">Tingkat akan terdeteksi otomatis</small>
          <small id="m-tingkat-error" style="color:red;"></small>
        </div>
        
        <!-- Tingkat (readonly, auto-detect) -->
        <div>
          <label>Tingkat (Auto-detect)</label>
          <input type="text" id="m-tingkat" readonly placeholder="X / XI / XII">
        </div>
        
        <!-- Wali Kelas -->
        <div>
          <label>Wali Kelas (Opsional)</label>
          <select id="m-wali-kelas">
            <option value="">Tanpa Wali</option>
            <!-- Guru options loaded dynamically -->
          </select>
          <small>Satu guru hanya dapat menjadi wali satu kelas</small>
        </div>
        
        <!-- Total Siswa -->
        <div>
          <label>Total Siswa</label>
          <input type="number" id="m-total-siswa" value="36" min="1">
        </div>
        
        <!-- Ruangan -->
        <div>
          <label>Ruangan</label>
          <input type="text" id="m-ruangan" placeholder="Gedung Sekolah">
        </div>
        
        <!-- Buttons -->
        <div class="modal-actions">
          <button type="button" id="kelas-modal-cancel" class="btn btn-secondary">Batal</button>
          <button type="submit" id="kelas-modal-save" class="btn btn-primary">Simpan</button>
        </div>
      </form>
    </div>
  </div>
</body>
```

#### JavaScript Logic

```javascript
// State
let allKelas = [];
let allGuru = [];
let requestSeq = 0;

// Load kelas dengan filter & stats
async function loadKelas({ showLoading = false } = {}) {
  const seq = ++requestSeq;
  if (showLoading) tbody.innerHTML = messageRow('Memuat data kelas...');
  
  try {
    const params = new URLSearchParams({
      q: searchInput.value.trim(),
      tingkat: filterTingkat.value
    });
    const res = await fetch(`/api/kelas?${params}`, { cache: 'no-store' });
    const json = await res.json();
    
    if (seq !== requestSeq) return;
    if (!json.success) throw new Error(json.message || 'Gagal memuat kelas');
    
    allKelas = json.data || [];
    updateStats(json.stats);
    renderTable(allKelas);
  } catch (err) {
    if (seq !== requestSeq) return;
    tbody.innerHTML = messageRow(err.message, '#ef4444');
  }
}

// Update stats cards
function updateStats({ total, withWali, withoutWali }) {
  document.getElementById('stat-total').textContent = total || 0;
  document.getElementById('stat-with-wali').textContent = withWali || 0;
  document.getElementById('stat-without-wali').textContent = withoutWali || 0;
}

// Render table rows
function renderTable(list) {
  if (!list.length) {
    tbody.innerHTML = messageRow('Tidak ada kelas yang cocok.');
    return;
  }
  
  const fragment = document.createDocumentFragment();
  list.forEach((k, idx) => {
    const tr = document.createElement('tr');
    const statusBadge = k.waliStatus === 'ada' 
      ? '<span class="badge badge-green">Ada wali</span>'
      : '<span class="badge badge-gray">Belum ada wali</span>';
    
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td class="bold">${escapeHtml(k.name)}</td>
      <td>${k.tingkat || '-'}</td>
      <td>${escapeHtml(k.waliKelas || 'Belum Ditentukan')}</td>
      <td>${statusBadge}</td>
      <td>${k.totalSiswa || 0}</td>
      <td class="right">
        <button class="btn-edit" data-id="${k.id}">Edit</button>
        <button class="btn-delete" data-id="${k.id}">Hapus</button>
      </td>
    `;
    
    tr.querySelector('.btn-edit').addEventListener('click', () => openEditModal(k));
    tr.querySelector('.btn-delete').addEventListener('click', () => deleteKelas(k));
    fragment.appendChild(tr);
  });
  
  tbody.replaceChildren(fragment);
}

// Open add modal
function openAddModal() {
  editId.value = '';
  document.getElementById('m-nama-kelas').value = '';
  document.getElementById('m-tingkat').value = '';
  document.getElementById('m-wali-kelas').value = '';
  document.getElementById('m-total-siswa').value = '36';
  document.getElementById('m-ruangan').value = '';
  modal.style.display = 'flex';
}

// Open edit modal
function openEditModal(kelas) {
  editId.value = kelas.id;
  document.getElementById('m-nama-kelas').value = kelas.name;
  document.getElementById('m-tingkat').value = kelas.tingkat || '';
  document.getElementById('m-wali-kelas').value = kelas.waliKelasId || '';
  document.getElementById('m-total-siswa').value = kelas.totalSiswa;
  document.getElementById('m-ruangan').value = kelas.ruangan || '';
  modal.style.display = 'flex';
}

// Auto-detect tingkat saat nama ketik
document.getElementById('m-nama-kelas').addEventListener('input', (e) => {
  const name = e.target.value;
  const tingkat = parseTingkat(name);
  document.getElementById('m-tingkat').value = tingkat || '';
  
  if (name && !tingkat) {
    showError('Nama kelas harus dimulai dengan X, XI, atau XII');
  } else {
    clearError();
  }
});

// Form submit
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const payload = {
    name: document.getElementById('m-nama-kelas').value.trim(),
    totalSiswa: document.getElementById('m-total-siswa').value,
    waliKelasId: document.getElementById('m-wali-kelas').value || null,
    ruangan: document.getElementById('m-ruangan').value.trim() || 'Gedung Sekolah'
  };
  
  const isEdit = !!editId.value;
  const url = isEdit ? `/api/kelas/${editId.value}` : '/api/kelas';
  const method = isEdit ? 'PUT' : 'POST';
  
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    
    if (json.success) {
      SiPresensi.showToast(json.message, 'success');
      closeModal();
      loadKelas();
      // Broadcast to other pages (reload kelas dropdowns)
      broadcastKelasUpdate();
    } else {
      SiPresensi.showToast(json.message || 'Gagal menyimpan kelas', 'error');
    }
  } catch (err) {
    SiPresensi.showToast('Gagal terhubung ke server', 'error');
  }
});

// Delete kelas
async function deleteKelas(kelas) {
  const confirmed = await SiPresensi.confirm({
    title: 'Hapus Kelas?',
    message: `Kelas ${kelas.name} akan dihapus secara permanen.`,
    confirmText: 'Ya, Hapus',
    cancelText: 'Batal'
  });
  if (!confirmed) return;
  
  try {
    const res = await fetch(`/api/kelas/${kelas.id}`, { method: 'DELETE' });
    const json = await res.json();
    
    if (json.success) {
      SiPresensi.showToast('Kelas berhasil dihapus', 'success');
      loadKelas();
      broadcastKelasUpdate();
    } else {
      SiPresensi.showToast(json.message || 'Gagal menghapus kelas', 'error');
    }
  } catch (err) {
    SiPresensi.showToast('Gagal terhubung ke server', 'error');
  }
}

// Broadcast update ke halaman lain (via localStorage)
function broadcastKelasUpdate() {
  localStorage.setItem('kelas-updated', Date.now().toString());
}

// Listen to updates from other pages
window.addEventListener('storage', (e) => {
  if (e.key === 'kelas-updated') loadKelas();
});

// Helper: parse tingkat dari nama
function parseTingkat(name) {
  if (!name) return null;
  const match = String(name).match(/\b(XII|XI|X)\b/);
  return match ? match[1] : null;
}

// Init
async function init() {
  await loadKelas({ showLoading: true });
  await loadGuruOptions();
}
init();
```

#### Styling: `public/styles/kelas.css`

```css
.kelas-page { height: 100dvh; min-height: 0; }
.kelas-page .content { flex: 1 1 auto; min-height: 0; overflow: hidden; }

.kelas-toolbar { 
  display: flex; 
  align-items: center; 
  gap: 12px; 
  margin-bottom: 12px;
}

.kelas-toolbar .toolbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1 1 auto;
}

.kelas-filter-wrap,
.kelas-search {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: #fff;
}

.kelas-search { flex: 1 1 240px; max-width: 380px; }
.kelas-search input { flex: 1; border: 0; outline: 0; padding: 10px 0; }

/* Stats cards */
.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 12px;
}

.stat-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 16px;
  text-align: center;
}

.stat-label { font-size: 12px; color: var(--muted); font-weight: 600; }
.stat-value { font-size: 28px; font-weight: 700; color: var(--text); margin-top: 4px; }

/* Table */
.kelas-table-card { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.kelas-table-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; }
.kelas-table { min-width: 900px; }

.kelas-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #fff;
  box-shadow: inset 0 -1px 0 var(--border);
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.badge-green { background: #dcfce7; color: #15803d; }
.badge-gray { background: #f1f5f9; color: #64748b; }

/* Modal */
#modal-kelas {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0,0,0,0.5);
  z-index: 9999;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}

.modal-content {
  background: #fff;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 20px 25px -5px rgba(0,0,0,0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.modal-header h3 { margin: 0; font-size: 18px; }
.modal-header button { background: none; border: none; font-size: 20px; cursor: pointer; }

.modal-content form > div {
  margin-bottom: 12px;
}

.modal-content label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
}

.modal-content input,
.modal-content select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}

.modal-content small {
  display: block;
  font-size: 11px;
  color: var(--muted);
  margin-top: 4px;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}

@media (max-width: 640px) {
  .kelas-toolbar { flex-direction: column; align-items: stretch; }
  .kelas-toolbar .toolbar-left { flex-direction: column; width: 100%; }
  .kelas-toolbar > .btn { width: 100%; justify-content: center; }
  .modal-content { max-width: 100%; }
}
```

## Integration & Sync

### Real-time Kelas Dropdown Update

Halaman lain yang gunakan kelas dropdown (data-siswa.html, absensi.html, etc.) harus listen ke storage event:

```javascript
// Di halaman yang butuh reload kelas dropdown
window.addEventListener('storage', (e) => {
  if (e.key === 'kelas-updated') {
    // Reload kelas dropdown
    loadKelasSiswaDropdown(); // atau method exist
  }
});
```

Atau bisa pakai:
- Polling setiap 30s
- WebSocket (future)
- Service Worker + push (future)

### Sidebar Integration

Update `public/components/petugas/sidebar-content.html`:

```html
<nav class="menu" data-section="sidebar-menu">
  <a href="/src/pages/petugas/dashboard.html" data-page="dashboard">Dashboard</a>
  <a href="/src/pages/petugas/data-akun.html" data-page="data-akun">Manajemen Akun</a>
  <a href="/src/pages/petugas/data-siswa.html" data-page="data-siswa">Data Siswa</a>
  <a href="/src/pages/petugas/manajemen-kelas.html" data-page="manajemen-kelas">Manajemen Kelas</a>
  <!-- existing items -->
</nav>
```

### Guard & Routing

Update `server.js`:

```javascript
const petugasPages = {
  'dashboard': 'src/pages/petugas/dashboard.html',
  'data-akun': 'src/pages/petugas/data-akun.html',
  'data-siswa': 'src/pages/petugas/data-siswa.html',
  'manajemen-kelas': 'src/pages/petugas/manajemen-kelas.html'
};

// Guard: hanya role 'petugas' yang boleh akses
app.get('/src/pages/petugas/:page', (req, res) => {
  const { page } = req.params;
  if (!petugasPages[page]) return res.status(404).send('Not found');
  // Check role petugas
  if (req.user?.role !== 'petugas') {
    return res.status(403).send('Forbidden');
  }
  res.sendFile(path.join(__dirname, petugasPages[page]));
});
```

## Verification Plan

### Backend Verification

1. **Parser tingkat**
   - Test `parseTingkat('X-A')` → 'X'
   - Test `parseTingkat('XI Bisnis')` → 'XI'
   - Test `parseTingkat('XII-IPA')` → 'XII'
   - Test `parseTingkat('Kelas Satu')` → null
   - Ensure regex tidak match 'IX' atau 'XIII'

2. **Wali ganda check**
   - Insert kelas dengan wali A
   - Try insert kelas lain dengan wali A → 409
   - Update kelas 1 wali ke B → success
   - Check kelas 2 wali masih A → success

3. **Referensi count**
   - Create kelas + siswa referensi
   - countKelasReferences() → siswa: 1
   - Try delete kelas → 409 blocked
   - Delete siswa, retry delete kelas → success

4. **Endpoint access control**
   - Test as siswa → 403 Forbidden
   - Test as guru → 403 Forbidden (atau 200 GET only)
   - Test as petugas → 200 OK

### Frontend Verification

1. **Tingkat auto-detect**
   - Type "X-A" → field shows "X"
   - Type "XI Bisnis" → field shows "XI"
   - Type "Kelas 1" → error hint

2. **Filter & search**
   - Filter X → hanya baris tingkat X
   - Search "Wali" → cari nama wali
   - Both filter + search together

3. **Table state transitions**
   - Loading → render "Memuat..."
   - Empty → render "Tidak ada kelas"
   - Error → render error message + color red
   - Data → render rows + filler + count

4. **Modal validasi**
   - Submit kosong → browser validation error
   - Duplikat nama → toast error 409
   - Guru jadi wali ganda → toast error 409
   - Kelas masih dipakai → toast error 409

5. **Broadcast sync**
   - Add kelas di halaman → localStorage event
   - Check data-siswa.html refresh dropdown

