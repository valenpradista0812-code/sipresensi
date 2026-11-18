# Manajemen Kelas — Implementation Tasks

## Phase Overview
- **Backend**: Fix/verify DB functions, implement parser, validate API endpoints
- **Frontend**: Build manajemen-kelas.html page with all CRUD UI + state management
- **Integration**: Update sidebar, implement kelas dropdown sync, verify guards

## Task Breakdown

### Phase 1: Backend Preparation (Verify & Enhance)

#### 1.1 Implement tingkat parser helper
- **File**: `utils/kelas-tingkat.js` (create new)
- **Requirements**:
  - `parseTingkat(name)`: Extract X/XI/XII from nama kelas, return string or null
  - `isValidTingkatPrefix(name)`: Boolean check if valid prefix exists
  - Test cases:
    - "X-A" → "X"
    - "XI Bisnis" → "XI"
    - "XII-IPA" → "XII"
    - "Kelas 1" → null (invalid)
    - "" → null
- **Verification**: Node script can call parseTingkat() and verify regex
- **Status**: Not started

#### 1.2 Fix `db.addKelas()` to save `wali_kelas_id`
- **File**: `data/db.js` → `addKelas()` function
- **Current Issue**: Function does not persist `wali_kelas_id` field
- **Fix**:
  - Accept `waliKelasId` in payload
  - Convert to `wali_kelas_id` for Supabase
  - If null or empty, set to null; set `wali_kelas` to "Belum Ditentukan"
  - If guru ID provided, validate guru exists via `findGuruByIdOrNip()`
- **Verification**: Test INSERT with wali_kelas_id, check Supabase schema
- **Status**: Not started

#### 1.3 Fix `db.updateKelas()` to handle `wali_kelas_id` changes
- **File**: `data/db.js` → `updateKelas()` function
- **Current Issue**: Function does not handle `waliKelasId` or sync `wali_kelas` from guru name
- **Fix**:
  - Accept `waliKelasId` in payload (can be null to unassign)
  - If `waliKelasId` provided:
    - If null/empty: set `wali_kelas_id = null`, `wali_kelas = "Belum Ditentukan"`
    - If value: lookup guru via `findGuruByIdOrNip()`, set both fields
  - Return updated record with both fields
- **Verification**: Test UPDATE with guru name sync, check record
- **Status**: Not started

#### 1.4 Verify `db.countKelasReferences()` returns exact counts
- **File**: `data/db.js` → `countKelasReferences()` function
- **Requirements**: Already implemented, verify it:
  - Counts siswa, jadwal, absensi, izin, akun (users with kelas)
  - Returns object: `{ siswa: N, jadwal: N, absensi: N, izin: N, akun: N }`
  - Uses Supabase `count: 'exact'` option
- **Verification**: Call function with known kelas name, check counts match DB
- **Status**: Likely already done

#### 1.5 Update `routes/kelas.js` GET endpoint to return stats + tingkat
- **File**: `routes/kelas.js` → `GET /api/kelas` handler
- **Requirements**:
  - Add query param: `?tingkat=X` or `?tingkat=XI` or `?tingkat=XII`
  - Filter by tingkat if provided (use `parseTingkat()` helper)
  - Add search param: `?q=<term>` (search nama kelas or wali_kelas)
  - Calculate stats: `{ total, withWali, withoutWali }`
  - Add to each response item: `tingkat`, `waliStatus` (ada/belum)
  - Response format:
    ```json
    {
      success: true,
      count: N,
      stats: { total, withWali, withoutWali },
      data: [ { id, name, tingkat, totalSiswa, waliKelas, waliKelasId, waliStatus, ruangan }, ... ]
    }
    ```
- **Verification**: Test endpoint with query params, check filter works
- **Status**: Not started

#### 1.6 Enhance `routes/kelas.js` POST to validate wali ganda + return updated schema
- **File**: `routes/kelas.js` → `POST /api/kelas` handler
- **Requirements**:
  - Accept `waliKelasId` in request body
  - After name validation:
    - If `waliKelasId` provided, check `findKelasByWaliId(waliKelasId)` → if exists, return 409
    - Message: "Guru {nama} sudah menjadi wali kelas {nama_kelas}. Satu guru hanya dapat menjadi wali satu kelas."
  - Call `db.addKelas()` with waliKelasId
  - Return response with `tingkat`, `waliStatus`
- **Verification**: Test POST with wali ID that's already assigned, verify 409 error
- **Status**: Not started

#### 1.7 Enhance `routes/kelas.js` PUT to validate wali ganda + return updated schema
- **File**: `routes/kelas.js` → `PUT /api/kelas/:id` handler
- **Requirements**:
  - Handle `waliKelasId` in request body
  - If `waliKelasId` changes to a different guru:
    - Check `findKelasByWaliId(newWaliId, excludeId: kelas.id)` → if exists, return 409
  - Call `db.updateKelas()` with waliKelasId
  - Return response with `tingkat`, `waliStatus`
- **Verification**: Test PUT with wali swap, verify 409 if target guru already has kelas
- **Status**: Not started

#### 1.8 Verify `routes/kelas.js` DELETE blocks if references exist
- **File**: `routes/kelas.js` → `DELETE /api/kelas/:id` handler
- **Current State**: Should already call `db.countKelasReferences()`
- **Verify**:
  - Check uses `countKelasReferences(existing.name)`
  - If any count > 0, returns 409 with message listing blockers
  - Message format: "Kelas masih dipakai oleh: siswa, jadwal, izin"
- **Verification**: Create kelas + reference, try delete, verify 409 message
- **Status**: Likely already done, verify only

### Phase 2: Frontend Page Build

#### 2.1 Create `src/pages/petugas/manajemen-kelas.html` - Structure
- **File**: Create new HTML file
- **Requirements**:
  - Copy layout from `data-akun.html` as template
  - Update body class, page title, sidebar container
  - Main sections: topbar, toolbar (filter + search), stats (3 cards), table card
  - Table columns: No, Nama Kelas, Tingkat, Wali Kelas, Status Wali, Total Siswa, Aksi
  - Modal: Tambah/Edit Kelas (Nama, Tingkat auto-detect, Wali select, Total Siswa, Ruangan)
  - Scripts: sidebar-loader, app-core, manajemen-kelas-script
- **Verification**: Page loads without 404, no JS errors in console
- **Status**: Not started

#### 2.2 Create styling: `public/styles/kelas.css`
- **File**: Create new CSS file
- **Requirements**:
  - Extend `.kelas-page`, `.kelas-toolbar`, `.kelas-filter-wrap`, `.kelas-search`
  - Stats cards: `.stats`, `.stat-card`, `.stat-label`, `.stat-value`
  - Table: `.kelas-table`, `.kelas-table-scroll`, `.kelas-table-card`
  - Badges: `.badge`, `.badge-green`, `.badge-gray`
  - Modal styling (reuse pattern from data-akun.html)
  - Responsive: toolbar column on mobile, modal full-width
  - Link CSS in HTML head
- **Verification**: CSS loads, no 404, layout looks correct on desktop + mobile
- **Status**: Not started

#### 2.3 Implement JavaScript: Load kelas + render table
- **File**: Inline `<script>` in manajemen-kelas.html
- **Requirements**:
  - `loadKelas()`: Fetch `/api/kelas?q=...&tingkat=...`, handle loading/error/empty states
  - `updateStats()`: Update 3 stat cards with data from response
  - `renderTable()`: Create TR for each kelas, calc row height, add filler rows
  - Event listeners: filter change, search input (debounce 300ms)
  - Table scroll state mgmt (like data-akun.html)
  - Toast notifications via `SiPresensi.showToast()`
- **Verification**: Load page, verify table populates, filter/search works
- **Status**: Not started

#### 2.4 Implement modal: Open Tambah Kelas
- **File**: Inline script in HTML
- **Requirements**:
  - `openAddModal()`: Reset form, set modal title "Tambah Kelas Baru", show modal
  - Button listener on `#btn-add-kelas`
  - Modal open/close handlers: ESC key, click outside, cancel button
  - Load guru options dropdown via `/api/guru` endpoint
  - Display only guru that don't have any kelas (wali_kelas_id IS NULL)
- **Verification**: Click button → modal opens, dropdown shows available guru
- **Status**: Not started

#### 2.5 Implement modal: Open Edit Kelas
- **File**: Inline script in HTML
- **Requirements**:
  - `openEditModal(kelas)`: Populate form with kelas data, set modal title
  - Edit button on each table row
  - Modal title: "Ubah Kelas: {name}"
  - Pre-populate: Nama, Tingkat (readonly), Wali select (current value selected), etc.
  - Guru dropdown: show available + current guru
- **Verification**: Click edit → modal opens with data, submit endpoint is PUT
- **Status**: Not started

#### 2.6 Implement form: Tingkat auto-detect
- **File**: Inline script in HTML
- **Requirements**:
  - Helper `parseTingkat(name)`: Extract tingkat from name (call utils or inline)
  - On input `#m-nama-kelas`, call `parseTingkat()`
  - Update `#m-tingkat` field with result (or clear if null)
  - Show validation hint or error if invalid
  - Show error: "Nama kelas harus dimulai dengan X, XI, atau XII." if invalid
  - Clear error when valid
- **Verification**: Type "X-A" → field auto-fills "X", type "Kelas 1" → shows error
- **Status**: Not started

#### 2.7 Implement form validation: Name duplicate check
- **File**: Inline script in HTML
- **Requirements**:
  - On form submit, check if name (trimmed) already exists in `allKelas` list
  - If duplicate and not editing same record, show error toast
  - Also backend will 409, catch and display via toast
- **Verification**: Try add duplicate name → error toast shows
- **Status**: Not started

#### 2.8 Implement form submit: Create/Update kelas
- **File**: Inline script in HTML
- **Requirements**:
  - Form submit handler
  - Build payload: `{ name, totalSiswa, waliKelasId, ruangan }`
  - POST `/api/kelas` for new, PUT `/api/kelas/{id}` for edit
  - Handle response:
    - Success: close modal, show toast, reload kelas, broadcast update
    - Error 400/409: show toast with message
    - Error 500: generic "failed to connect" toast
- **Verification**: Create kelas → toast success, table updates; edit kelas → same; error handles 409
- **Status**: Not started

#### 2.9 Implement delete: Confirmation + call DELETE endpoint
- **File**: Inline script in HTML
- **Requirements**:
  - Delete button on each row
  - Click → `SiPresensi.confirm()` dialog: "Hapus Kelas? {name} akan dihapus permanen."
  - User confirms → disable button, call DELETE `/api/kelas/{id}`
  - Handle response:
    - Success: show toast, reload table, broadcast update
    - Error 409: show toast with blockers message (e.g., "masih dipakai oleh siswa, izin")
    - Error 500: generic error toast
  - Re-enable button after response
- **Verification**: Delete kelas → confirmation, API call, table updates
- **Status**: Not started

#### 2.10 Implement broadcast: Real-time kelas dropdown sync
- **File**: Inline script in HTML
- **Requirements**:
  - After successful POST/PUT/DELETE, call `broadcastKelasUpdate()`
  - Function: `localStorage.setItem('kelas-updated', Date.now())`
  - Listen: `window.addEventListener('storage', (e) => { if (e.key === 'kelas-updated') ... })`
  - Other pages (data-siswa.html, akun.html, etc.) listen to this event and reload their kelas dropdowns
- **Verification**: Add kelas → check localStorage event fired
- **Status**: Not started

### Phase 3: Integration & Verification

#### 3.1 Update sidebar: Add "Manajemen Kelas" menu item
- **File**: `public/components/petugas/sidebar-content.html`
- **Requirements**:
  - Add menu item: `<a href="/src/pages/petugas/manajemen-kelas.html" data-page="manajemen-kelas">Manajemen Kelas</a>`
  - Position: after "Data Siswa" or logical order
  - Active highlight via `data-page="manajemen-kelas"` JS selector
- **Verification**: Sidebar shows menu item, click → navigate to manajemen-kelas.html
- **Status**: Not started

#### 3.2 Update server.js: Add route guard for manajemen-kelas page
- **File**: `server.js` (or wherever page routing is)
- **Requirements**:
  - Add to `petugasPages` object:
    ```javascript
    'manajemen-kelas': 'src/pages/petugas/manajemen-kelas.html'
    ```
  - Guard checks: `req.user?.role === 'petugas'`
  - Non-petugas gets 403 Forbidden
- **Verification**: Access as petugas → 200 OK, as siswa → 403
- **Status**: Not started

#### 3.3 Implement kelas dropdown sync: Update data-siswa.html
- **File**: `src/pages/petugas/data-siswa.html` (script section)
- **Requirements**:
  - Listen to storage event: `window.addEventListener('storage', ...)`
  - If `e.key === 'kelas-updated'`, reload kelas dropdown
  - Call existing function or implement `reloadKelasSiswaDropdown()`
- **Verification**: Manajemen-kelas add kelas → data-siswa dropdown updates without manual refresh
- **Status**: Not started

#### 3.4 Implement kelas dropdown sync: Update akun.html
- **File**: `src/pages/petugas/data-akun.html` (script section, field `#a-kelas` select)
- **Requirements**:
  - Listen to storage event for kelas update
  - Reload kelas dropdown in modal
  - Re-populate from `/api/kelas` endpoint
- **Verification**: Manajemen-kelas changes → akun.html dropdown updates
- **Status**: Not started

#### 3.5 Implement kelas dropdown sync: Update absensi.html
- **File**: `src/pages/admin/absensi.html` or equivalent
- **Requirements**:
  - Similar storage listener + dropdown reload
- **Verification**: Manajemen-kelas changes → absensi.html updates
- **Status**: Not started

#### 3.6 Create verification script: Test API endpoints
- **File**: `scripts/check-kelas-routes.js` (update or create)
- **Requirements**:
  - Test GET /api/kelas (200 for petugas/guru, 403 for siswa)
  - Test POST /api/kelas with valid payload (201, 400 for invalid)
  - Test PUT /api/kelas/{id} (200 for success, 404 for missing)
  - Test DELETE /api/kelas/{id} (200 for safe delete, 409 for referenced)
  - Test tingkat parser: parseTingkat() for edge cases
  - Test wali ganda: POST with guru already assigned → 409
  - Test countKelasReferences: Add kelas + siswa → count returns 1
  - Print summary: PASS/FAIL per test
- **Verification**: Run node script, see all tests pass
- **Status**: Not started

#### 3.7 Manual E2E test: Petugas workflows
- **Requirements**:
  - Login as petugas
  - Navigate to Manajemen Kelas
  - Create kelas "X-A" → verify appears in table
  - Create kelas "XI-B" with wali guru "Budi" → verify wali shows, stats update
  - Try create duplicate "X-A" → error toast
  - Edit "X-A" → change name to "X-C" → verify table updates
  - Delete "X-C" → confirm → verify removed
  - Check data-siswa.html dropdown → "X-A", "XI-B" should appear
  - Add siswa to "XI-B" → try delete from manajemen-kelas → error 409 "masih dipakai"
  - Verify no JS errors in console
- **Verification**: All workflows succeed, no errors
- **Status**: Not started

#### 3.8 Manual test: Security & guards
- **Requirements**:
  - Login as siswa, try access `/src/pages/petugas/manajemen-kelas.html` → 403 or redirect
  - Login as guru, try access → 403 or no write access
  - Try direct API call DELETE without petugas role → 403
  - Verify sidebar doesn't show menu item for non-petugas
- **Verification**: All guards work
- **Status**: Not started

## Task Ordering & Dependencies

```
Frontend HTML + CSS
    ↓
Backend DB functions (addKelas, updateKelas wali save)
    ↓
Backend parser + tingkat validation
    ↓
Backend API endpoints (GET with stats, POST/PUT with validation, DELETE with refs)
    ↓
Frontend JavaScript (load, render, modal, form)
    ↓
Sidebar + routing integration
    ↓
Broadcast + sync to other pages (data-siswa, akun, absensi)
    ↓
E2E testing + verification
```

## Success Criteria

All tasks complete when:
1. ✓ Manajemen-kelas.html page loads for petugas role
2. ✓ Table shows all kelas with tingkat, wali, status badges
3. ✓ Filter by tingkat + search work correctly
4. ✓ CRUD operations (Create, Read, Update, Delete) work
5. ✓ Wali assignment & ganda validation works
6. ✓ Delete blocked if kelas referenced
7. ✓ Kelas dropdown syncs real-time to other pages
8. ✓ Security: non-petugas cannot access/edit
9. ✓ No JS console errors
10. ✓ UI matches data-akun.html design pattern
11. ✓ All verification script tests pass
12. ✓ E2E workflow tests succeed

