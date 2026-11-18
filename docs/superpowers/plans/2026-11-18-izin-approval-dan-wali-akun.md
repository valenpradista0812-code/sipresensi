# Izin Approval oleh Guru Pengajar + Penugasan Wali dari Manajemen Akun — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guru mapel yang sedang mengajar dan wali kelas dapat menyetujui izin siswa; guru wali melihat kelasnya di semua halaman guru; petugas dapat menetapkan wali kelas melalui form Manajemen Akun.

**Architecture:** Tambah `listWaliClasses` dan `assignWaliKelas`/`clearWaliKelas` di `data/db.js`; buat util murni `utils/izin-approval.js` untuk logika kelayakan approve; perbarui `utils/teacher-access.js` dengan `getAccessibleClasses()`; pakai helper itu di semua enam route guru; perbarui modal akun dengan checkbox wali + dropdown.

**Tech Stack:** Node.js, Express, Supabase JS v2, vanilla HTML/JS; tidak ada migrasi database baru.

**Spec:** `docs/superpowers/specs/2026-11-18-izin-approval-dan-wali-akun-design.md`

## Global Constraints

- Tidak ada tabel, kolom, atau migrasi database baru; gunakan `kelas.wali_kelas_id` dan `kelas.wali_kelas` yang sudah ada.
- Zona waktu `Asia/Jakarta` untuk semua konversi waktu; pakai `jakartaNow()` dari `utils/jam-kerja.js`.
- Fungsi baru di `data/db.js` wajib diekspor di blok `module.exports` di baris ~1186.
- Wali kelas selalu boleh approve; guru mapel hanya jika `created_at` pengajuan jatuh pada hari **dan** jam aktif jadwalnya **dan** rentang `start_date`–`end_date` pengajuan mencakup tanggal `created_at` tersebut.
- Legacy data: satu guru punya lebih dari satu kelas wali → akses dihormati semua; aturan satu-kelas hanya ditegakkan saat penyimpanan baru.
- Rollback akun: `assignWaliKelas` melakukan kompensasi sendiri; rollback pembuatan akun tidak perlu memulihkan wali kelas.
- Teks UI: checkbox label "Jadikan Wali Kelas"; teks fallback di baris izin "Menunggu persetujuan wali/guru pengajar".
- `EDITABLE_FIELDS` di `routes/akun.js` harus mencakup `isWaliKelas` dan `waliKelasId`.
- Semua check script: `node scripts/check-*.js` — tidak boleh ada yang error setelah setiap task.

## Review Focus

1. **Guru wali yang tidak mengajar kelas itu**: `getAccessibleClasses()` harus mengembalikan kelas wali di `all` sehingga `/api/absensi` tidak mengembalikan array kosong. Test ada di Task 2.
2. **Race condition approve**: dua reviewer menekan Setujui hampir bersamaan → RPC sudah menangani; tetap pastikan pesan 409 yang benar diteruskan dari `routes/izin.js`. Test ada di Task 3.
3. **Pengajuan untuk hari lain**: `start_date = besok`, `end_date = besok`, `created_at = hari ini` → guru mapel tidak boleh approve karena hari ini tidak ada dalam rentang izin. Test ada di Task 3.
4. **Assign wali ke kelas yang sudah punya wali lain**: wali lama harus kosong, wali baru tersimpan; gagal di tengah → kompensasi ke kondisi semula. Test ada di Task 4.
5. **`updateKelas` dengan `waliKelasId = null`**: kolom teks `wali_kelas` harus ikut diset `'Belum Ditentukan'`. Test ada di Task 4.

---

### Task 1: Fungsi DB baru — `listWaliClasses`, `assignWaliKelas`, `clearWaliKelas`, ekspor `findKelasByWaliId`, dan perbaikan `updateKelas`

**Files:**
- Modify: `data/db.js` (fungsi `updateKelas` bari 611–630, ekspor baris 1470–1508)
- Create: `scripts/check-db-shape.js` (hapus/ganti yang lama jika ada)

**Interfaces:**
- Produces:
  - `listWaliClasses(guruId: string): Promise<{ id: string, name: string }[]>` — kelas dengan `wali_kelas_id = guruId`.
  - `assignWaliKelas(kelasId: string, guru: { id: string, name: string }): Promise<void>` — set wali kelas target, clear kelas lama guru yang sama; kompensasi jika gagal.
  - `clearWaliKelas(guruId: string): Promise<void>` — set semua kelas guru tersebut ke `wali_kelas_id = null, wali_kelas = 'Belum Ditentukan'`.
  - `findKelasByWaliId(guruId, excludeId?): Promise<{ id, name, wali_kelas_id } | null>` — sudah ada, hanya diekspor.
  - `updateKelas(id, data)` — sekarang menangani `data.waliKelasId`: string → simpan ID + ambil nama dari `findGuruByIdOrNip`; `null` → kosongkan ID dan teks.

- [ ] **Step 1: Tulis test `scripts/check-db-shape.js`**

```js
// Verifikasi ekspor fungsi-fungsi baru ada dan bertipe function
const db = require('../data/db');
const assert = require('assert');
assert.strictEqual(typeof db.listWaliClasses,   'function', 'listWaliClasses harus diekspor');
assert.strictEqual(typeof db.assignWaliKelas,   'function', 'assignWaliKelas harus diekspor');
assert.strictEqual(typeof db.clearWaliKelas,    'function', 'clearWaliKelas harus diekspor');
assert.strictEqual(typeof db.findKelasByWaliId, 'function', 'findKelasByWaliId harus diekspor');
console.log('OK: semua fungsi DB baru diekspor.');
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```
node scripts/check-db-shape.js
```
Expected: AssertionError "listWaliClasses harus diekspor"

- [ ] **Step 3: Implementasi `listWaliClasses(guruId)` di `data/db.js` setelah fungsi `isWaliKelas` (sekitar baris 423)**

Query: `supabase.from('kelas').select('id,name').eq('wali_kelas_id', String(guruId)).order('name')`.
Kembalikan `data || []`. Error → log dan kembalikan `[]`.

- [ ] **Step 4: Implementasi `assignWaliKelas(kelasId, guru)` di `data/db.js`**

Algoritma:
1. Cari kelas target: `findKelasByIdOrName(kelasId)`. Jika tidak ada → throw `Error('Kelas wali tidak ditemukan.')`.
2. Catat `previousWaliId = targetKelas.wali_kelas_id` (untuk kompensasi target).
3. Cari kelas lama guru: `findKelasByWaliId(guru.id, targetKelas.id)` → simpan sebagai `previousGuruKelas`.
4. Update kelas target: `supabase.from('kelas').update({ wali_kelas_id: guru.id, wali_kelas: guru.name }).eq('id', targetKelas.id)`. Jika error → throw (belum ada yang berubah secara permanen, tidak perlu kompensasi).
5. Jika `previousGuruKelas`: clear kelas lama: `supabase.from('kelas').update({ wali_kelas_id: null, wali_kelas: 'Belum Ditentukan' }).eq('id', previousGuruKelas.id)`.
   Jika langkah 5 error: kompensasi target (kembalikan `wali_kelas_id/wali_kelas` ke `previousWaliId`), kemudian throw.

- [ ] **Step 5: Implementasi `clearWaliKelas(guruId)` di `data/db.js`**

```js
async function clearWaliKelas(guruId) {
  if (!guruId) return;
  const { error } = await supabase
    .from('kelas')
    .update({ wali_kelas_id: null, wali_kelas: 'Belum Ditentukan' })
    .eq('wali_kelas_id', String(guruId));
  if (error) throw error;
}
```

- [ ] **Step 6: Perbaiki `updateKelas(id, data)` — tangani `data.waliKelasId`**

Tambahkan blok di dalam `updateKelas` sebelum query update:
```js
if (data.waliKelasId !== undefined) {
  if (data.waliKelasId === null || data.waliKelasId === '') {
    payload.wali_kelas_id = null;
    payload.wali_kelas   = 'Belum Ditentukan';
  } else {
    const waliGuru = await findGuruByIdOrNip(String(data.waliKelasId));
    payload.wali_kelas_id = waliGuru ? waliGuru.id : null;
    payload.wali_kelas    = waliGuru ? waliGuru.name : 'Belum Ditentukan';
  }
}
```

- [ ] **Step 7: Ekspor `findKelasByWaliId`, `listWaliClasses`, `assignWaliKelas`, `clearWaliKelas` di `module.exports`**

Tambahkan di blok ekspor kelas (sekitar baris 1471):
```js
findKelasByWaliId,
listWaliClasses,
assignWaliKelas,
clearWaliKelas,
```

- [ ] **Step 8: Jalankan test, pastikan LULUS**

```
node scripts/check-db-shape.js
```
Expected: `OK: semua fungsi DB baru diekspor.`

- [ ] **Step 9: Jalankan semua check script lama**

```
node scripts/check-teacher-access.js && node scripts/check-guru-routes.js && node scripts/check-kelas-routes.js
```
Expected: semua OK, tidak ada error.

- [ ] **Step 10: Commit**

```
git add data/db.js scripts/check-db-shape.js
git commit -m "feat(db): listWaliClasses, assignWaliKelas, clearWaliKelas; fix updateKelas waliKelasId"
```

---

### Task 2: Helper `getAccessibleClasses` di `utils/teacher-access.js` + perbarui semua route guru

**Files:**
- Modify: `utils/teacher-access.js`
- Modify: `routes/kelas.js` (baris 37–41)
- Modify: `routes/absensi.js` (baris 33–47, 175–186, 250–296)
- Modify: `routes/stats.js` (baris 50–64)
- Modify: `routes/siswa.js` (baris 63–71)
- Modify: `routes/izin.js` (baris 57–74) — hanya scoping; aturan `canReview` diperbarui di Task 3
- Modify: `scripts/check-teacher-access.js`

**Interfaces:**
- Consumes: `db.listWaliClasses(guruId)` (Task 1), `db.listTaughtClasses(guruId)` (sudah ada).
- Produces:
  - `getWaliClasses(guruId: string): Promise<string[]>` — nama kelas wali.
  - `getAccessibleClasses(guruId: string): Promise<{ taught: string[], wali: string[], all: string[] }>` — `all` = union unik.
  - Semua exports lama tetap ada (`resolveTeacher`, `getTaughtClasses`, `isWaliOf`, `canAccessClass`).

- [ ] **Step 1: Perbarui `scripts/check-teacher-access.js` — tambah case wali-only**

Tambah ke `fakeDb`:
```js
listWaliClasses: async (guruId) => guruId === 'g1' ? [{ id: 'kls-1', name: 'XII IPS 1' }] : [],
```

Tambah assertion setelah blok lama:
```js
// getWaliClasses
assert.deepStrictEqual(await access.getWaliClasses('g1'), ['XII IPS 1']);
assert.deepStrictEqual(await access.getWaliClasses('g99'), []);

// getAccessibleClasses — g1 mengajar XII IPA 1, wali XII IPS 1
const cls = await access.getAccessibleClasses('g1');
assert.deepStrictEqual(cls.taught, ['XII IPA 1']);
assert.deepStrictEqual(cls.wali,   ['XII IPS 1']);
assert.ok(cls.all.includes('XII IPA 1') && cls.all.includes('XII IPS 1'), 'all harus gabungan');
assert.strictEqual(cls.all.length, 2, 'tidak ada duplikat di all');

// guru tanpa kelas ajar maupun wali
const empty = await access.getAccessibleClasses('g99');
assert.deepStrictEqual(empty.all, []);

console.log('OK: teacher-access resolve, scoping, wali, dan getAccessibleClasses sesuai.');
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```
node scripts/check-teacher-access.js
```
Expected: TypeError "access.getWaliClasses is not a function"

- [ ] **Step 3: Implementasi `getWaliClasses` dan `getAccessibleClasses` di `utils/teacher-access.js`**

Tambahkan di dalam `createTeacherAccess(db)`:
```js
async function getWaliClasses(guruId) {
  if (!guruId) return [];
  const rows = await db.listWaliClasses(guruId);
  return (rows || []).map(r => r.name);
}

async function getAccessibleClasses(guruId) {
  const [taught, wali] = await Promise.all([
    getTaughtClasses(guruId),
    getWaliClasses(guruId)
  ]);
  const all = [...new Set([...taught, ...wali])];
  return { taught, wali, all };
}
```

Perbarui `return` di akhir `createTeacherAccess`:
```js
return { resolveTeacher, getTaughtClasses, isWaliOf, canAccessClass, getWaliClasses, getAccessibleClasses };
```

Dan perbarui baris terakhir module agar juga mengekspor dua fungsi baru:
```js
module.exports = { createTeacherAccess, ...createTeacherAccess(require('../data/db')) };
```
(tidak perlu ubah jika spread sudah mencakup semua return dari factory)

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```
node scripts/check-teacher-access.js
```
Expected: `OK: teacher-access resolve, scoping, wali, dan getAccessibleClasses sesuai.`

- [ ] **Step 5: Perbarui `routes/kelas.js` — guru melihat kelas ajar + kelas wali**

Ganti blok `if (role === 'guru')` (baris 37–41):
```js
if (role === 'guru') {
  const teacher = await resolveTeacher(req.user);
  const { all } = teacher ? await getAccessibleClasses(teacher.id) : { all: [] };
  list = list.filter((k) => all.includes(k.name));
}
```

Perbarui import di baris 6: tambah `getAccessibleClasses`.

- [ ] **Step 6: Perbarui `routes/absensi.js` — GET / (baris 33–47)**

Ganti blok `if (role === 'guru')`:
```js
if (role === 'guru') {
  teacher = await resolveTeacher(req.user);
  const { all, taught } = teacher
    ? await getAccessibleClasses(teacher.id)
    : { all: [], taught: [] };
  if (all.length === 0) {
    return res.json({ success: true, filter: { kelas, tanggal, mapel }, count: 0, data: [] });
  }
  if (kelas && !all.includes(kelas)) {
    return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke kelas tersebut.' });
  }
  // taught dipakai sebagai default jika kelas tidak dipilih
  taught_ref = taught;   // simpan untuk default kelas baris 44
  accessible = all;      // simpan untuk validasi
}
const targetKelas = kelas || (role === 'guru' ? (taught_ref[0] || accessible[0]) : null);
```

Catatan implementation: gunakan variabel lokal `taught_ref` dan `accessible` yang dideklarasikan di scope `try`, atau refactor dengan cara yang paling bersih; yang penting default kelas = kelas yang diajar dulu (`taught_ref[0]`), fallback ke kelas wali (`accessible[0]`).

- [ ] **Step 7: Perbarui `routes/absensi.js` — GET /riwayat (baris 175–186)**

Ganti blok `if (role === 'guru')`:
```js
if (role === 'guru') {
  const teacher = await resolveTeacher(req.user);
  const { all } = teacher ? await getAccessibleClasses(teacher.id) : { all: [] };
  if (targetKelas && !all.includes(targetKelas)) {
    return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke kelas tersebut.' });
  }
  taught = all;   // ganti variabel `taught` yang sudah ada
}
```

- [ ] **Step 8: Perbarui `routes/absensi.js` — GET /rekap-bulanan (baris 250–296)**

Ganti blok `if (role === 'guru')` untuk validasi akses dan filter siswa:
```js
if (role === 'guru') {
  const teacher = await resolveTeacher(req.user);
  const { all } = teacher ? await getAccessibleClasses(teacher.id) : { all: [] };
  if (kelas && kelas !== 'Semua Kelas' && !all.includes(kelas)) {
    return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke kelas tersebut.' });
  }
  if (all.length === 0) {
    return res.json({ success: true, filter: { ... }, summary: { ... }, count: 0, data: [] });
  }
  taught = all;   // ganti variabel `taught` yang sudah ada di scope
}
// ...
// Di blok filter siswa (baris ~295):
students = all.filter((s) => taught.includes(s.kelas));
// (taught sekarang berisi all sehingga ini tetap benar)
```

- [ ] **Step 9: Perbarui `routes/stats.js` — GET /overview (baris 50–64)**

Ganti blok `if (role === 'guru')`:
```js
if (role === 'guru') {
  const teacher = await resolveTeacher(req.user);
  const { all } = teacher ? await getAccessibleClasses(teacher.id) : { all: [] };
  if (all.length === 0) {
    return res.json({ success: true, data: { totalSiswa: 0, ... } });
  }
  classFilter = all;
}
```

- [ ] **Step 10: Perbarui `routes/siswa.js` — GET / (baris 63–71)**

Ganti blok `if (role === 'guru')`:
```js
if (role === 'guru') {
  const teacher = await resolveTeacher(req.user);
  const { all } = teacher ? await getAccessibleClasses(teacher.id) : { all: [] };
  const requested = typeof req.query.kelas === 'string' && req.query.kelas.trim()
    ? req.query.kelas.trim() : null;
  if (requested && !all.includes(requested)) {
    return res.status(403).json({ success: false, message: 'Kelas tersebut bukan kelas yang dapat Anda akses.' });
  }
  list = all.length === 0 ? [] : list.filter((s) => all.includes(s.kelas));
}
```

- [ ] **Step 11: Perbarui `routes/izin.js` — scoping GET / pakai `getAccessibleClasses`**

Ganti bagian guru di `GET /` (baris 57–75):
```js
const teacher = await resolveTeacher(req.user);
if (!teacher) return res.json({ success: true, data: [] });
const { all, wali: waliClasses } = await getAccessibleClasses(teacher.id);

const data = await db.getIzinApplications(undefined, { excludeApproved: true });
const visible = [];
for (const app of (data || [])) {
  if (!app.kelas || !all.includes(app.kelas)) continue;
  const isWali = waliClasses.includes(app.kelas);
  // canReview masih sementara = isWali; Task 3 akan melengkapi dengan cek jadwal
  visible.push({ ...app, canReview: isWali });
}
return res.json({ success: true, data: visible });
```

Perbarui import baris 7: tambah `getAccessibleClasses`.

- [ ] **Step 12: Jalankan semua check script**

```
node scripts/check-teacher-access.js
node scripts/check-guru-routes.js
node scripts/check-kelas-routes.js
node scripts/check-db-shape.js
```
Expected: semua OK.

- [ ] **Step 13: Commit**

```
git add utils/teacher-access.js routes/kelas.js routes/absensi.js routes/stats.js routes/siswa.js routes/izin.js scripts/check-teacher-access.js
git commit -m "feat(access): getAccessibleClasses wali+ajar; perbarui semua route guru"
```

---

### Task 3: Util `utils/izin-approval.js` + aturan `canReview` + endpoint review

**Files:**
- Create: `utils/izin-approval.js`
- Modify: `routes/izin.js` (GET /, GET /:id, POST /:id/review)
- Modify: `src/pages/admin/absensi.html` (baris 512 — teks fallback)
- Create: `scripts/check-izin-approval.js`

**Interfaces:**
- Consumes: `jakartaNow(date?)` dari `utils/jam-kerja.js`; `timeToMinutes(str)` dari `utils/jam-kerja.js`.
- Produces (semua fungsi murni, tanpa sisi efek):
  - `submissionMoment(application): { date: string, dayName: string, minutes: number } | null`
    — konversi `application.created_at` ke zona Jakarta. `dayName` = nama hari Indonesia (`'Senin'`…`'Minggu'`).
  - `scheduleCoversSubmission(schedule, moment): boolean`
    — `schedule.hari === moment.dayName && startMin <= moment.minutes && moment.minutes < endMin`.
  - `applicationIncludesDate(application, date: string): boolean`
    — `application.start_date <= date <= application.end_date`.
  - `isTeacherTeachingAtSubmission(application, schedules: array): boolean`
    — ada satu jadwal yang `scheduleCoversSubmission` **dan** `applicationIncludesDate(app, moment.date)`.
  - `canReviewIzin({ isWali: boolean, application, schedules: array }): boolean`
    — `isWali || isTeacherTeachingAtSubmission(application, schedules)`.

- [ ] **Step 1: Tulis `scripts/check-izin-approval.js`**

```js
const assert = require('assert');
const { submissionMoment, scheduleCoversSubmission,
        applicationIncludesDate, isTeacherTeachingAtSubmission,
        canReviewIzin } = require('../utils/izin-approval');

// submissionMoment: timestamp UTC Senin 07:30 Jakarta (UTC+7 → 00:30Z Senin)
// 2026-11-16 adalah Senin
const app1 = { created_at: '2026-11-16T00:30:00.000Z', start_date: '2026-11-16', end_date: '2026-11-16' };
const mom1 = submissionMoment(app1);
assert.strictEqual(mom1.date,    '2026-11-16');
assert.strictEqual(mom1.dayName, 'Senin');
assert.strictEqual(mom1.minutes, 7 * 60 + 30);

// invalid timestamp
assert.strictEqual(submissionMoment({ created_at: 'bukan-tanggal' }), null);

const sched = { hari: 'Senin', jam_mulai: '07:00:00', jam_selesai: '09:00:00' };

// scheduleCoversSubmission: 07:30 masuk rentang 07:00–09:00
assert.strictEqual(scheduleCoversSubmission(sched, mom1), true);

// tepat jam_selesai = eksklusif
const momEnd = { date: '2026-11-16', dayName: 'Senin', minutes: 9 * 60 };
assert.strictEqual(scheduleCoversSubmission(sched, momEnd), false);

// hari berbeda
const momSelasa = { date: '2026-11-17', dayName: 'Selasa', minutes: 7 * 60 + 30 };
assert.strictEqual(scheduleCoversSubmission(sched, momSelasa), false);

// applicationIncludesDate
assert.strictEqual(applicationIncludesDate(app1, '2026-11-16'), true);
assert.strictEqual(applicationIncludesDate(app1, '2026-11-17'), false);

// izin untuk hari lain: created_at Senin, tapi start_date Selasa
const appFuture = { created_at: '2026-11-16T00:30:00.000Z', start_date: '2026-11-17', end_date: '2026-11-17' };
assert.strictEqual(isTeacherTeachingAtSubmission(appFuture, [sched]), false, 'Izin hari lain: guru tidak boleh');

// izin hari ini, sedang mengajar
assert.strictEqual(isTeacherTeachingAtSubmission(app1, [sched]), true);

// wali selalu boleh
assert.strictEqual(canReviewIzin({ isWali: true,  application: appFuture, schedules: []    }), true);
assert.strictEqual(canReviewIzin({ isWali: false, application: appFuture, schedules: [sched] }), false);
assert.strictEqual(canReviewIzin({ isWali: false, application: app1,      schedules: [sched] }), true);

console.log('OK: izin-approval semua kasus lulus.');
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```
node scripts/check-izin-approval.js
```
Expected: `Cannot find module '../utils/izin-approval'`

- [ ] **Step 3: Implementasi `utils/izin-approval.js`**

Nama hari Indonesia (index 0 = Minggu): `['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu']`.

`submissionMoment(application)`:
- Parse `application.created_at` sebagai JS Date.
- Jika `isNaN(d.getTime())` → return `null`.
- Pakai `jakartaNow(d)` yang sudah menerima `date` parameter untuk mendapat `{ date, minutes }`.
- Hitung `dayName` dari nama hari Indonesia sesuai hari Jakarta.

`scheduleCoversSubmission(schedule, moment)`:
- `timeToMinutes(schedule.jam_mulai)`, `timeToMinutes(schedule.jam_selesai)`.
- Jika salah satu `null` → `false`.
- `schedule.hari === moment.dayName && startMin <= moment.minutes && moment.minutes < endMin`.

`applicationIncludesDate(application, date)`:
- `application.start_date <= date && date <= application.end_date`.

`isTeacherTeachingAtSubmission(application, schedules)`:
- `const mom = submissionMoment(application)` → jika null → false.
- `if (!applicationIncludesDate(application, mom.date)) return false`.
- `return schedules.some(s => scheduleCoversSubmission(s, mom))`.

`canReviewIzin({ isWali, application, schedules })`:
- `return isWali || isTeacherTeachingAtSubmission(application, schedules)`.

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```
node scripts/check-izin-approval.js
```
Expected: `OK: izin-approval semua kasus lulus.`

- [ ] **Step 5: Perbarui `routes/izin.js` — GET / (lengkapi `canReview` dengan cek jadwal)**

Setelah `getAccessibleClasses`, ambil jadwal aktif guru sekali:
```js
let schedulesByClass = {};
try {
  const schedules = await db.getJadwal({ guruId: teacher.id, activeOnly: true });
  for (const s of schedules) {
    if (!schedulesByClass[s.kelas]) schedulesByClass[s.kelas] = [];
    schedulesByClass[s.kelas].push(s);
  }
} catch (schedErr) {
  console.error('getJadwal untuk izin-approval error:', schedErr.message);
  // biarkan schedulesByClass kosong; wali tetap bisa approve
}

// Di dalam loop:
const isWali = waliClasses.includes(app.kelas);
const canReview = canReviewIzin({
  isWali,
  application: app,
  schedules: schedulesByClass[app.kelas] || []
});
visible.push({ ...app, canReview });
```

Perbarui import baris atas: tambah `const { canReviewIzin } = require('../utils/izin-approval');`

- [ ] **Step 6: Perbarui `routes/izin.js` — GET /:id (batasi guru ke kelas `all`)**

Setelah baris `if (!application || ...)`, tambah untuk role guru:
```js
if (role === 'guru') {
  const teacher = await resolveTeacher(req.user);
  if (!teacher) return res.status(403).json({ ... });
  const { all } = await getAccessibleClasses(teacher.id);
  if (!all.includes(application.kelas)) {
    return res.status(404).json({ success: false, message: 'Pengajuan izin tidak ditemukan.' });
  }
}
```

- [ ] **Step 7: Perbarui `routes/izin.js` — POST /:id/review (izinkan wali ATAU guru pengajar)**

Ganti blok `const wali = await isWaliOf(...)` dan error 403 (baris 190–193):
```js
const { all, wali: waliClasses } = await getAccessibleClasses(teacher.id);
const isWali = waliClasses.includes(application.kelas);

let schedules = [];
try {
  schedules = await db.getJadwal({ guruId: teacher.id, kelas: application.kelas, activeOnly: true });
} catch (e) { /* jadwal tidak tersedia → hanya wali yang bisa */ }

const allowed = canReviewIzin({ isWali, application, schedules });
if (!allowed) {
  return res.status(403).json({
    success: false,
    message: 'Hanya wali kelas atau guru yang sedang mengajar di kelas ini saat pengajuan dibuat yang dapat mengonfirmasi.'
  });
}
```

- [ ] **Step 8: Perbarui teks fallback di `src/pages/admin/absensi.html` baris 512**

Ganti:
```
confirmationCell.textContent = 'Hanya wali kelas';
```
Menjadi:
```
confirmationCell.textContent = 'Menunggu persetujuan wali/guru pengajar';
```

- [ ] **Step 9: Jalankan semua check script**

```
node scripts/check-izin-approval.js
node scripts/check-teacher-access.js
node scripts/check-db-shape.js
node scripts/check-frontend-text.js
```
Expected: semua OK.

- [ ] **Step 10: Commit**

```
git add utils/izin-approval.js routes/izin.js src/pages/admin/absensi.html scripts/check-izin-approval.js
git commit -m "feat(izin): canReview untuk wali dan guru pengajar; izin-approval util"
```

---

### Task 4: Penugasan wali dari `routes/akun.js` + util `utils/akun-wali.js`

**Files:**
- Create: `utils/akun-wali.js`
- Modify: `routes/akun.js` (EDITABLE_FIELDS, GET /, POST /, PUT /:id)
- Create: `scripts/check-wali-akun.js`

**Interfaces:**
- Consumes: `db.listWaliClasses`, `db.assignWaliKelas`, `db.clearWaliKelas`, `db.findKelasByIdOrName` (semua dari Task 1); `db.getGuru()` (sudah ada).
- Produces:
  - `parseWaliAssignment(role, body): { skip: true } | { assign: true, kelasId: string } | { clear: true } | { error: string }`
    — `role !== 'guru'` → `{ skip }`. `body.isWaliKelas === true && !body.waliKelasId` → `{ error: 'Pilih kelas wali terlebih dahulu.' }`. `body.isWaliKelas === true && body.waliKelasId` → `{ assign, kelasId }`. `body.isWaliKelas === false` → `{ clear }`. `isWaliKelas` tidak ada di body → `{ skip }`.
  - `GET /api/akun` — setiap akun guru mengandung `waliKelas: string|null` dan `waliKelasId: string|null`.
  - `POST /api/akun` dan `PUT /api/akun/:id` — menerima `isWaliKelas` dan `waliKelasId`.

- [ ] **Step 1: Tulis `scripts/check-wali-akun.js`**

```js
const assert = require('assert');
const { parseWaliAssignment } = require('../utils/akun-wali');

// bukan guru → skip
assert.deepStrictEqual(parseWaliAssignment('siswa', { isWaliKelas: true, waliKelasId: 'kls-1' }), { skip: true });

// guru, isWaliKelas tidak dikirim → skip
assert.deepStrictEqual(parseWaliAssignment('guru', {}), { skip: true });

// guru, isWaliKelas: true tanpa kelasId → error
const e = parseWaliAssignment('guru', { isWaliKelas: true });
assert.ok(e.error, 'harus error jika tanpa kelasId');

// guru, isWaliKelas: true dengan kelasId → assign
assert.deepStrictEqual(parseWaliAssignment('guru', { isWaliKelas: true, waliKelasId: 'kls-1' }), { assign: true, kelasId: 'kls-1' });

// guru, isWaliKelas: false → clear
assert.deepStrictEqual(parseWaliAssignment('guru', { isWaliKelas: false }), { clear: true });

console.log('OK: parseWaliAssignment semua kasus lulus.');
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

```
node scripts/check-wali-akun.js
```
Expected: `Cannot find module '../utils/akun-wali'`

- [ ] **Step 3: Implementasi `utils/akun-wali.js`**

```js
function parseWaliAssignment(role, body = {}) {
  if (role !== 'guru') return { skip: true };
  if (!('isWaliKelas' in body)) return { skip: true };
  if (body.isWaliKelas === true) {
    const kelasId = body.waliKelasId ? String(body.waliKelasId).trim() : '';
    if (!kelasId) return { error: 'Pilih kelas wali terlebih dahulu.' };
    return { assign: true, kelasId };
  }
  return { clear: true };
}
module.exports = { parseWaliAssignment };
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

```
node scripts/check-wali-akun.js
```
Expected: `OK: parseWaliAssignment semua kasus lulus.`

- [ ] **Step 5: Perbarui `routes/akun.js` — tambah `isWaliKelas` dan `waliKelasId` ke `EDITABLE_FIELDS`**

```js
const EDITABLE_FIELDS = ['name', 'email', 'password', 'phone', 'nip', 'mapel', 'nis', 'kelas', 'isWaliKelas', 'waliKelasId'];
```

Import `parseWaliAssignment` di atas:
```js
const { parseWaliAssignment } = require('../utils/akun-wali');
```

- [ ] **Step 6: Perbarui `routes/akun.js` — GET / → tambah `waliKelas` dan `waliKelasId` untuk akun guru**

Ubah `enrichAccount` atau tambah enrichment setelah `profileMaps` di `GET /`:

Ambil semua kelas sekali: `const kelasList = await db.getKelas()`.

Buat map `guruId → kelas pertama (urut nama)`:
```js
const waliMap = {};
for (const k of kelasList) {
  if (k.wali_kelas_id && !waliMap[k.wali_kelas_id]) {
    waliMap[k.wali_kelas_id] = { waliKelas: k.name, waliKelasId: k.id };
  }
}
```

Di dalam loop `data.map`, setelah `enrichAccount`:
```js
if (account.role === 'guru' && enriched.profileId) {
  const wali = waliMap[enriched.profileId] || null;
  enriched.waliKelas   = wali ? wali.waliKelas   : null;
  enriched.waliKelasId = wali ? wali.waliKelasId : null;
}
```

Catatan: `enriched.profileId` adalah `guru.id`, bukan `users.id`. Map key adalah `guru.id`.

- [ ] **Step 7: Perbarui `routes/akun.js` — POST / → assign wali setelah profil guru dibuat**

Setelah `profile = await db.addGuru(...)` berhasil, tambahkan:
```js
const waliResult = parseWaliAssignment(data.role, req.body);
if (waliResult.assign) {
  const targetKelas = await db.findKelasByIdOrName(waliResult.kelasId);
  if (!targetKelas) throw Object.assign(new Error('Kelas wali tidak ditemukan.'), { statusCode: 400 });
  await db.assignWaliKelas(targetKelas.id, { id: profile.id, name: profile.name });
}
```

Jika throw, rollback yang sudah ada menghapus profil dan akun.

Tambah ke response: `waliKelas: targetKelas?.name || null` (jika assign berhasil).

- [ ] **Step 8: Perbarui `routes/akun.js` — PUT /:id → assign atau clear wali**

Setelah sinkronisasi profil guru berhasil, tambahkan blok wali:
```js
if (account.role === 'guru' && profiles.guru) {
  const waliResult = parseWaliAssignment(account.role, req.body);
  if (waliResult.assign) {
    const targetKelas = await db.findKelasByIdOrName(waliResult.kelasId);
    if (!targetKelas) {
      return res.status(400).json({ success: false, message: 'Kelas wali tidak ditemukan.' });
    }
    await db.assignWaliKelas(targetKelas.id, { id: profiles.guru.id, name: profiles.guru.name });
  } else if (waliResult.clear) {
    await db.clearWaliKelas(profiles.guru.id);
  }
  // waliResult.skip → tidak ada perubahan wali
}
```

- [ ] **Step 9: Jalankan semua check script**

```
node scripts/check-wali-akun.js
node scripts/check-akun-management.js
node scripts/check-db-shape.js
```
Expected: semua OK.

- [ ] **Step 10: Commit**

```
git add utils/akun-wali.js routes/akun.js scripts/check-wali-akun.js
git commit -m "feat(akun): penugasan wali kelas dari Manajemen Akun; parseWaliAssignment util"
```

---

### Task 5: UI `src/pages/petugas/data-akun.html` — checkbox Wali Kelas + dropdown

**Files:**
- Modify: `src/pages/petugas/data-akun.html`

**Interfaces:**
- Consumes: `GET /api/akun` yang sekarang mengembalikan `waliKelas` dan `waliKelasId` per akun guru (Task 4); `GET /api/kelas` yang mengembalikan `waliKelas` di tiap kelas.
- Produces: payload `POST/PUT /api/akun` menyertakan `isWaliKelas: bool` dan `waliKelasId: string|null` untuk role guru.

- [ ] **Step 1: Tambah elemen HTML — checkbox dan dropdown wali kelas**

Sisipkan setelah div `a-field-guru-mapel` (setelah baris ~258) dan sebelum `a-field-siswa-nis`:

```html
<div id="a-field-wali-check" style="margin-bottom:8px; display:none;">
  <label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; cursor:pointer;">
    <input type="checkbox" id="a-is-wali" style="width:16px; height:16px; cursor:pointer;">
    Jadikan Wali Kelas
  </label>
</div>
<div id="a-field-wali-kelas" style="margin-bottom:12px; display:none;">
  <label style="display:block; font-size:13px; font-weight:600; margin-bottom:4px;">Kelas Wali</label>
  <select id="a-wali-kelas-id" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:14px; box-sizing:border-box;">
    <option value="">Pilih kelas...</option>
  </select>
</div>
```

- [ ] **Step 2: Perbarui `toggleRoleFields(role)` — tampilkan elemen wali saat role guru**

```js
document.getElementById('a-field-wali-check').style.display = role === 'guru' ? 'block' : 'none';
// a-field-wali-kelas diatur oleh checkbox, bukan oleh role
if (role !== 'guru') {
  document.getElementById('a-is-wali').checked = false;
  document.getElementById('a-field-wali-kelas').style.display = 'none';
}
```

- [ ] **Step 3: Tambah event listener checkbox wali**

```js
document.getElementById('a-is-wali').addEventListener('change', function() {
  document.getElementById('a-field-wali-kelas').style.display = this.checked ? 'block' : 'none';
});
```

- [ ] **Step 4: Perbarui `loadKelasOptions()` — isi juga dropdown wali dengan label wali saat ini**

Rename/duplikat fungsi atau tambah fungsi baru `loadWaliKelasOptions(kelasList)`:
```js
async function loadWaliKelasOptions(kelasList) {
  const sel = document.getElementById('a-wali-kelas-id');
  sel.innerHTML = '<option value="">Pilih kelas...</option>' +
    kelasList.map((k) => {
      const waliLabel = k.waliKelas && k.waliKelas !== 'Belum Ditentukan'
        ? `— wali: ${k.waliKelas}` : '— belum ada wali';
      return `<option value="${k.id}" data-name="${escapeHtml(k.name)}" data-current-wali="${escapeHtml(k.waliKelas || '')}" data-current-wali-id="${escapeHtml(k.waliKelasId || '')}">${escapeHtml(k.name)} ${escapeHtml(waliLabel)}</option>`;
    }).join('');
}
```

Panggil `loadWaliKelasOptions` saat memuat kelas (setelah fetch `/api/kelas`).

- [ ] **Step 5: Perbarui `openAddModal()` — reset state wali**

```js
document.getElementById('a-is-wali').checked = false;
document.getElementById('a-field-wali-kelas').style.display = 'none';
document.getElementById('a-wali-kelas-id').value = '';
```

- [ ] **Step 6: Perbarui `openEditModal(u)` — isi checkbox dan kelas wali dari data akun guru**

```js
if (u.role === 'guru') {
  const isWali = !!u.waliKelasId;
  document.getElementById('a-is-wali').checked = isWali;
  document.getElementById('a-field-wali-kelas').style.display = isWali ? 'block' : 'none';
  document.getElementById('a-wali-kelas-id').value = u.waliKelasId || '';
}
```

- [ ] **Step 7: Perbarui handler `form submit` — tambah `isWaliKelas` dan `waliKelasId` ke payload guru + konfirmasi ganti wali**

Di blok `role === 'guru'`:
```js
const isWaliChecked = document.getElementById('a-is-wali').checked;
payload.isWaliKelas = isWaliChecked;
payload.waliKelasId = isWaliChecked ? (document.getElementById('a-wali-kelas-id').value || null) : null;

if (isWaliChecked && payload.waliKelasId) {
  const sel = document.getElementById('a-wali-kelas-id');
  const opt = sel.options[sel.selectedIndex];
  const currentWali = opt ? opt.dataset.currentWali : '';
  const currentWaliId = opt ? opt.dataset.currentWaliId : '';
  const kelasName = opt ? opt.dataset.name : '';
  // Konfirmasi hanya jika kelas punya wali lain (bukan guru yang sedang diedit)
  if (currentWaliId && currentWaliId !== (editId.value ? u_waliGuruId : '')) {
    const confirmed = await SiPresensi.confirm({
      title: 'Ganti Wali Kelas?',
      message: `Kelas ${kelasName} saat ini diwali oleh ${currentWali}. Ganti wali ke ${payload.name}?`,
      confirmText: 'Ya, Ganti',
      cancelText: 'Batal'
    });
    if (!confirmed) return;
  }
}
```

Catatan: simpan `u.waliKelasId` saat `openEditModal` ke variabel closure `let u_waliGuruId` yang bisa diakses dari handler submit.

- [ ] **Step 8: Perbarui kolom "Kelas" di `renderTable` untuk guru**

Di template baris tabel (baris ~445):
```js
// Ganti: ${escapeHtml(u.kelas || '-')}
// Dengan:
const kelasDisplay = u.role === 'guru'
  ? (u.waliKelas ? `Wali ${u.waliKelas}` : '-')
  : (u.kelas || '-');
// ... gunakan kelasDisplay di innerHTML
```

- [ ] **Step 9: Jalankan check script**

```
node scripts/check-frontend-text.js
```
Expected: OK.

- [ ] **Step 10: Commit**

```
git add src/pages/petugas/data-akun.html
git commit -m "feat(ui): checkbox wali kelas + dropdown di modal Manajemen Akun"
```

---

### Task 6: Verifikasi akhir — jalankan seluruh check script + test manual

**Files:**
- Tidak ada file baru; hanya verifikasi.

- [ ] **Step 1: Jalankan seluruh check script**

```
node scripts/check-db-shape.js
node scripts/check-teacher-access.js
node scripts/check-izin-approval.js
node scripts/check-wali-akun.js
node scripts/check-guru-routes.js
node scripts/check-kelas-routes.js
node scripts/check-akun-management.js
node scripts/check-frontend-text.js
node scripts/check-role.js
node scripts/check-scoping-text.js
```
Expected: semua baris diakhiri `OK`.

- [ ] **Step 2: Verifikasi `getAccessibleClasses` live terhadap database**

```
node -e "
require('dotenv').config({ path: '.env' });
const { getAccessibleClasses, resolveTeacher } = require('./utils/teacher-access');
(async () => {
  const teacher = { id: 'guru-1' };
  const cls = await getAccessibleClasses(teacher.id);
  console.log('accessible:', JSON.stringify(cls));
})();
"
```
Expected: `taught` berisi `['X-Dev A']`, `wali` kosong (belum ada wali), `all` = `['X-Dev A']`.

- [ ] **Step 3: Tetapkan guru-1 sebagai wali X-Dev A lalu verifikasi ulang**

```
node -e "
require('dotenv').config({ path: '.env' });
const db = require('./data/db');
(async () => {
  await db.assignWaliKelas('kls-dev-prbnair1', { id: 'guru-1', name: 'Endang Kusuma' });
  const cls = await require('./utils/teacher-access').getAccessibleClasses('guru-1');
  console.log('setelah assign:', JSON.stringify(cls));
})();
"
```
Expected: `wali` berisi `['X-Dev A']`, `all` tetap `['X-Dev A']` (tidak duplikat).

- [ ] **Step 4: Verifikasi `canReview` pada izin yang ada**

```
node -e "
require('dotenv').config({ path: '.env' });
const db = require('./data/db');
const { canReviewIzin } = require('./utils/izin-approval');
(async () => {
  const app = await db.getIzinApplicationById('izin-d32e7e27-5e62-4e79-81c1-d1b0f1b8bbd8');
  const schedules = await db.getJadwal({ guruId: 'guru-1', kelas: app.kelas, activeOnly: true });
  console.log('app created_at:', app.created_at, '| schedules:', schedules.length);
  console.log('isWali=true:', canReviewIzin({ isWali: true, application: app, schedules }));
  console.log('isWali=false:', canReviewIzin({ isWali: false, application: app, schedules }));
})();
"
```
Expected: `isWali=true: true`; `isWali=false`: `true` jika `created_at` izin ini jatuh di jam jadwal Senin 07:00–09:00, `false` jika tidak (izin ini `2026-11-15T11:45Z` = 18:45 WIB, di luar jam 07:00–09:00 → `false`).

- [ ] **Step 5: Bersihkan wali test (opsional)**

```
node -e "
require('dotenv').config({ path: '.env' });
const db = require('./data/db');
db.clearWaliKelas('guru-1').then(() => console.log('cleared')).catch(console.error);
"
```

- [ ] **Step 6: Commit akhir + tag**

```
git add -A
git commit -m "chore: verifikasi akhir izin-approval + wali akun feature"
```
