# Role, Jadwal, and Absensi Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link teacher accounts to the `guru` table, scope every class/student/attendance/recap endpoint by role and taught classes, restrict leave approval to the class wali, make teacher-account creation and class/wali integrity consistent in the database, and replace the hardcoded attendance/recap values with real data.

**Architecture:** One idempotent SQL migration adds the missing FK columns, linking/seeding logic, and integrity triggers. Backend work then adds a shared `effectiveRole` helper, a `teacher-access` module, and rewrites the authorization and scoping in the existing route files. Frontend work only swaps hardcoded dropdowns for API calls and hides controls the backend would reject. Nothing in the RFID or dispensation workflow changes.

**Tech Stack:** Node.js 18+, Express 4, `@supabase/supabase-js` 2.x, `bcryptjs`, vanilla HTML/JS pages, PostgreSQL (Supabase) with `plpgsql` functions and triggers.

**Spec:** `docs/superpowers/specs/2026-11-13-role-jadwal-absensi-integration-design.md`

## Global Constraints

- Do not run the SQL migration, do not modify the Supabase database, and do not start implementation until this plan is approved.
- Every new FK column is `VARCHAR(50)` to match its target. Never alter an existing ID column type.
- `users.role` is `VARCHAR(20)` with no CHECK constraint and no enum. Never add an enum.
- `admin` is a legacy value; it is mapped to `guru` by `effectiveRole()` at authorization time and is never converted or deleted by the migration.
- `petugas` is the only role that writes classes, teachers, students, schedules, and settings.
- Leave review is wali-only. `POST /api/izin/:id/review` lives only in `routes/izin.js`.
- The RFID and dispensation workflow (`process_dispensasi_rfid`, `'Disetujui - Menunggu Tap'`) must not change behavior.
- Password hashing uses `bcrypt.hashSync(value, 10)` and the existing `POST /api/auth/login`. No new auth mechanism.
- `jadwal_mapel.kelas`, `siswa.kelas`, `absensi.kelas`, and `pengajuan_izin.kelas` stay `VARCHAR(30)`.
- There is no test framework. Verification follows the existing convention in `scripts/check-jam-kerja.js`: a Node script using `assert` and `console.log('OK: ...')`.
- All new user-facing messages are in Indonesian, matching the existing route messages.

## Review Focus

- **Recap percentage above 100%** — a student with several records on one date must still land in `0..100`. A reasonable user expects a percentage to be a percentage.
- **Class delete leaving orphaned history** — deleting a class must be refused while `absensi` or `pengajuan_izin` rows still reference it; a reasonable user expects old attendance to stay readable.
- **Leave approval by a non-wali teacher** — a teacher who teaches the class but is not its wali must get 403, and the UI must not show approve buttons for them.
- **Admin account silently gaining write access** — an `admin` row must behave exactly like `guru`; it must not be able to write classes, teachers, students, or schedules.
- **Attendance saved with fake times** — manual saves must not write `07:15:00`/`15:30:00`; a reasonable user expects `-` or the configured time, never an invented one.

---

### Task 1: Add the `effectiveRole` helper and role mapping

**Files:**
- Create: `middleware/role.js`
- Modify: `middleware/auth.js:66-90` (`requireRole`), `middleware/auth.js:92-131` (`pageAuthGuard`)
- Test: `scripts/check-role.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `effectiveRole(user) -> string` from `middleware/role.js`; `requireRole(...roles)` and `pageAuthGuard(allowedRoles)` compare against the effective role.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-role.js`:

```js
const assert = require('assert');
const { effectiveRole } = require('../middleware/role');

assert.strictEqual(effectiveRole({ role: 'admin' }), 'guru');
assert.strictEqual(effectiveRole({ role: 'guru' }), 'guru');
assert.strictEqual(effectiveRole({ role: 'petugas' }), 'petugas');
assert.strictEqual(effectiveRole({ role: 'siswa' }), 'siswa');
assert.strictEqual(effectiveRole({}), '');
assert.strictEqual(effectiveRole(null), '');
assert.strictEqual(effectiveRole(undefined), '');

console.log('OK: pemetaan peran efektif (admin -> guru) sesuai.');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/check-role.js`
Expected: FAIL with `Cannot find module '../middleware/role'`.

- [ ] **Step 3: Implement `effectiveRole` in `middleware/role.js`**

```js
const LEGACY_ROLE_MAP = { admin: 'guru' };

function effectiveRole(user) {
  const raw = user && typeof user.role === 'string' ? user.role.trim().toLowerCase() : '';
  return LEGACY_ROLE_MAP[raw] || raw;
}

module.exports = { effectiveRole };
```

- [ ] **Step 4: Use it in `middleware/auth.js`**

Require `const { effectiveRole } = require('./role');` at the top. In `requireRole`, replace `roles.includes(req.user.role)` with `roles.includes(effectiveRole(req.user))`. In `pageAuthGuard`, compute `const role = effectiveRole(user);` once after the user lookup and replace every `user.role` comparison and the redirect `target` selection with `role`. Keep the redirect mapping: `siswa` -> `/dashboard-siswa.html`, `petugas` -> `/src/pages/petugas/dashboard.html`, otherwise `/dashboard.html`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node scripts/check-role.js`
Expected: `OK: pemetaan peran efektif (admin -> guru) sesuai.`

- [ ] **Step 6: Commit**

```bash
git add middleware/role.js middleware/auth.js scripts/check-role.js
git commit -m "feat(auth): map legacy admin role to guru via effectiveRole"
```

---

### Task 2: Create the `teacher-access` module

**Files:**
- Create: `utils/teacher-access.js`
- Test: `scripts/check-teacher-access.js`

**Interfaces:**
- Consumes: `db.findGuruByUserId(userId)` and `db.findGuruByNip(nip)` (added in Task 3), `db.getJadwalMapel` not needed.
- Produces:
  - `resolveTeacher(user) -> Promise<object|null>` — looks up `guru` by `user_id`, falls back to `nip`.
  - `getTaughtClasses(guruId) -> Promise<string[]>` — distinct `kelas` from `jadwal_mapel` where `guru_id = guruId AND aktif = true`.
  - `isWaliOf(guruId, className) -> Promise<boolean>` — `kelas` row where `wali_kelas_id = guruId AND name = className`.
  - `canAccessClass(user, guruId, className) -> Promise<boolean>` — true for petugas; for guru true when the class is taught or (when `allowWali` is passed) wali-owned.

The module takes `db` via `require('../data/db')` and exports the four functions plus a `createTeacherAccess(db)` factory so the test can inject a fake db.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-teacher-access.js`:

```js
const assert = require('assert');
const { createTeacherAccess } = require('../utils/teacher-access');

const fakeDb = {
  findGuruByUserId: async (id) => (id === 'u1' ? { id: 'g1', user_id: 'u1', nip: '111' } : null),
  findGuruByNip: async (nip) => (nip === '111' ? { id: 'g1', user_id: 'u1', nip: '111' } : null),
  listTaughtClasses: async (guruId) => (guruId === 'g1' ? ['XII IPA 1'] : []),
  isWaliKelas: async (guruId, name) => guruId === 'g1' && name === 'XII IPA 1'
};

(async () => {
  const access = createTeacherAccess(fakeDb);

  assert.deepStrictEqual(await access.resolveTeacher({ id: 'u1' }), { id: 'g1', user_id: 'u1', nip: '111' });
  assert.deepStrictEqual(await access.resolveTeacher({ id: 'u2', nip: '111' }), { id: 'g1', user_id: 'u1', nip: '111' });
  assert.strictEqual(await access.resolveTeacher({ id: 'u2' }), null);

  assert.deepStrictEqual(await access.getTaughtClasses('g1'), ['XII IPA 1']);
  assert.strictEqual(await access.isWaliOf('g1', 'XII IPA 1'), true);
  assert.strictEqual(await access.isWaliOf('g1', 'XII IPS 1'), false);

  assert.strictEqual(await access.canAccessClass({ role: 'petugas' }, null, 'XII IPS 1'), true);
  assert.strictEqual(await access.canAccessClass({ role: 'admin' }, 'g1', 'XII IPA 1'), true);
  assert.strictEqual(await access.canAccessClass({ role: 'guru' }, 'g1', 'XII IPS 1'), false);
  assert.strictEqual(await access.canAccessClass({ role: 'guru' }, 'g1', 'XII IPS 1', { allowWali: true }), false);

  console.log('OK: teacher-access resolve, scoping, dan wali sesuai.');
})();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/check-teacher-access.js`
Expected: FAIL with `Cannot find module '../utils/teacher-access'`.

- [ ] **Step 3: Implement `utils/teacher-access.js`**

```js
const { effectiveRole } = require('../middleware/role');

function createTeacherAccess(db) {
  async function resolveTeacher(user) {
    if (!user) return null;
    if (user.id) {
      const byUser = await db.findGuruByUserId(user.id);
      if (byUser) return byUser;
    }
    if (user.nip) {
      const byNip = await db.findGuruByNip(user.nip);
      if (byNip) return byNip;
    }
    return null;
  }

  async function getTaughtClasses(guruId) {
    if (!guruId) return [];
    const rows = await db.listTaughtClasses(guruId);
    return Array.isArray(rows) ? rows : [];
  }

  async function isWaliOf(guruId, className) {
    if (!guruId || !className) return false;
    return Boolean(await db.isWaliKelas(guruId, className));
  }

  async function canAccessClass(user, guruId, className, { allowWali = false } = {}) {
    const role = effectiveRole(user);
    if (role === 'petugas') return true;
    if (role !== 'guru') return false;
    const taught = await getTaughtClasses(guruId);
    if (taught.includes(className)) return true;
    if (allowWali) return isWaliOf(guruId, className);
    return false;
  }

  return { resolveTeacher, getTaughtClasses, isWaliOf, canAccessClass };
}

module.exports = { createTeacherAccess, ...createTeacherAccess(require('../data/db')) };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/check-teacher-access.js`
Expected: `OK: teacher-access resolve, scoping, dan wali sesuai.`

- [ ] **Step 5: Commit**

```bash
git add utils/teacher-access.js scripts/check-teacher-access.js
git commit -m "feat(access): add teacher-access scoping module"
```

---

### Task 3: Add the `db.js` lookups and the extended review signature

**Files:**
- Modify: `data/db.js:326-353` (add lookups near `getGuru`), `data/db.js:1043-1055` (`reviewIzinApplication`)
- Test: `scripts/check-db-shape.js`

**Interfaces:**
- Consumes: `supabase` client already in `data/db.js`.
- Produces:
  - `findGuruByUserId(userId) -> Promise<object|null>`
  - `listTaughtClasses(guruId) -> Promise<string[]>`
  - `isWaliKelas(guruId, name) -> Promise<object|null>`
  - `getKelasWaliId(id) -> Promise<string|null>`
  - `reviewIzinApplication(id, status, reviewerName, reviewNote, reviewerId)` — now passes `p_reviewer_id`.
  - All five exported from `module.exports`.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-db-shape.js` (it must not contact Supabase):

```js
const assert = require('assert');
const db = require('../data/db');

for (const name of ['findGuruByUserId', 'listTaughtClasses', 'isWaliKelas', 'getKelasWaliId']) {
  assert.strictEqual(typeof db[name], 'function', `${name} harus diekspor`);
}

assert.strictEqual(db.reviewIzinApplication.length, 5, 'reviewIzinApplication harus menerima reviewerId');

console.log('OK: bentuk API db.js sesuai.');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/check-db-shape.js`
Expected: FAIL with `findGuruByUserId harus diekspor`.

- [ ] **Step 3: Add the lookups in `data/db.js`**

Next to `findGuruByNip`:

```js
async function findGuruByUserId(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('guru')
    .select('*')
    .eq('user_id', String(userId))
    .maybeSingle();
  if (error) return null;
  return data || null;
}

async function listTaughtClasses(guruId) {
  if (!guruId) return [];
  const { data, error } = await supabase
    .from('jadwal_mapel')
    .select('kelas')
    .eq('guru_id', String(guruId))
    .eq('aktif', true);
  if (error) return [];
  return [...new Set((data || []).map((row) => row.kelas).filter(Boolean))];
}

async function isWaliKelas(guruId, name) {
  if (!guruId || !name) return null;
  const { data, error } = await supabase
    .from('kelas')
    .select('id,name,wali_kelas_id')
    .eq('wali_kelas_id', String(guruId))
    .eq('name', String(name))
    .maybeSingle();
  if (error) return null;
  return data || null;
}

async function getKelasWaliId(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('kelas')
    .select('wali_kelas_id')
    .eq('id', String(id))
    .maybeSingle();
  if (error) return null;
  return data ? data.wali_kelas_id : null;
}
```

- [ ] **Step 4: Extend `reviewIzinApplication`**

Change the signature to `async function reviewIzinApplication(id, status, reviewer, reviewNote, reviewerId)` and add `p_reviewer_id: reviewerId || null` to the RPC payload.

- [ ] **Step 5: Export the new functions**

Add `findGuruByUserId`, `listTaughtClasses`, `isWaliKelas`, `getKelasWaliId` to the `module.exports` object.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node scripts/check-db-shape.js`
Expected: `OK: bentuk API db.js sesuai.`

- [ ] **Step 7: Commit**

```bash
git add data/db.js scripts/check-db-shape.js
git commit -m "feat(db): add teacher lookups and reviewer id to review RPC"
```

---

### Task 4: Write the integration migration

**Files:**
- Create: `supabase-migrations/2026111301_role_jadwal_integration.sql`
- Test: `scripts/check-migration-text.js`

**Interfaces:**
- Consumes: existing tables from `2026110701`-`2026111202` and `supabase-setup.sql`.
- Produces: the columns and triggers the later tasks depend on; the five-argument `review_pengajuan_izin` overload.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-migration-text.js`. It reads the SQL file as text and asserts the required fragments are present, so it runs without a database:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase-migrations', '2026111301_role_jadwal_integration.sql'), 'utf8');

const required = [
  'BEGIN;',
  'COMMIT;',
  'ADD COLUMN IF NOT EXISTS user_id VARCHAR(50)',
  'ADD COLUMN IF NOT EXISTS wali_kelas_id VARCHAR(50)',
  'ADD COLUMN IF NOT EXISTS reviewed_by_id VARCHAR(50)',
  'p_reviewer_id VARCHAR DEFAULT NULL',
  'GURU_ID_COLLISION',
  'KELAS_MASIH_DIPAKAI',
  'KELAS_NAME_TOO_LONG_FOR_REFERENCES',
  'AFTER UPDATE OF name',
  'BEFORE DELETE',
  'ON DELETE RESTRICT',
  'reviewed_by_id = p_reviewer_id',
  'NOTIFY pgrst'
];

for (const fragment of required) {
  assert.ok(sql.includes(fragment), `Migrasi harus memuat: ${fragment}`);
}

assert.ok(!/DROP TABLE/i.test(sql), 'Migrasi tidak boleh DROP TABLE');
assert.ok(!/TRUNCATE/i.test(sql), 'Migrasi tidak boleh TRUNCATE');
assert.ok(!/CREATE TYPE .*role/i.test(sql), 'Migrasi tidak boleh membuat enum peran');

console.log('OK: migrasi integrasi memuat seluruh bagian wajib.');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/check-migration-text.js`
Expected: FAIL with `ENOENT` for the migration file.

- [ ] **Step 3: Write the migration**

Create the file with these sections, in order, inside `BEGIN; ... COMMIT;`:

1. `guru.user_id` — `ALTER TABLE public.guru ADD COLUMN IF NOT EXISTS user_id VARCHAR(50) REFERENCES public.users(id) ON DELETE SET NULL;` then a guarded `DO` block that adds the unique partial index `guru_user_id_key` only if it does not exist.
2. Link existing teacher rows by NIP:
   ```sql
   UPDATE public.guru g
   SET user_id = u.id
   FROM public.users u
   WHERE g.user_id IS NULL
     AND g.nip IS NOT NULL
     AND g.nip <> ''
     AND u.nip = g.nip
     AND u.role IN ('guru', 'admin');
   ```
3. Seed missing teacher rows for unlinked `guru`/`admin` accounts. For each such user, compute `v_cand1 := LEFT('guru-' || u.id, 50)` and `v_cand2 := 'guru-' || SUBSTR(MD5(u.id), 1, 16)`. Then:
   - If `v_cand1` exists in `guru` with the same `user_id`, skip (already linked).
   - Else if `v_cand1` does not exist in `guru` at all, insert with it.
   - Else if `v_cand2` does not exist in `guru` at all, insert with it.
   - Else `RAISE EXCEPTION 'GURU_ID_COLLISION: tidak dapat membuat ID guru unik untuk user %', u.id;`
   - Inserted values: `nip = COALESCE(NULLIF(u.nip,''), 'GURU-' || UPPER(SUBSTR(MD5(u.id),1,8)))`, `name = u.name`, `mapel = 'Belum Ditentukan'`, `phone = u.phone`, `email = u.email`, `user_id = u.id`.
4. `kelas.wali_kelas_id` — add the column if missing, then `UPDATE public.kelas k SET wali_kelas_id = g.id FROM public.guru g WHERE k.wali_kelas_id IS NULL AND k.wali_kelas = g.name;` (name match is only a backfill for existing rows, guarded by a unique-per-name check; skip ambiguous names with a `HAVING COUNT(*) = 1` subquery).
5. `pengajuan_izin.reviewed_by_id` — add the column and an index. Do not backfill.
6. Schedule schema — reuse the column definitions from `2026110709_jadwal_mapel_schema_final_rev3.sql` for `jadwal_mapel`/`jam_pelajaran` only if they are missing; do not recreate existing objects.
7. The five-argument `review_pengajuan_izin` overload: copy lines 3-116 of `2026110708_rfid_dispensasi_workflow.sql` verbatim, change the parameter list to add `p_reviewer_id VARCHAR DEFAULT NULL`, and change the `UPDATE` to also set `reviewed_by_id = p_reviewer_id`. Everything else — `same_day`, `'Disetujui - Menunggu Tap'`, duration guard, attendance upsert, `ON CONFLICT`, exception codes — stays byte-identical. Keep the four-argument function from 0708 in place.
8. Class rename guard (`BEFORE UPDATE OF name` on `kelas`): if `LENGTH(NEW.name) > 30` then `RAISE EXCEPTION 'KELAS_NAME_TOO_LONG_FOR_REFERENCES';` else `RETURN NEW;`. It must not touch other tables.
9. Class rename cascade (`AFTER UPDATE OF name` on `kelas`): when `OLD.name IS DISTINCT FROM NEW.name`, run one `UPDATE ... SET kelas = NEW.name WHERE kelas = OLD.name` per table in this order: `siswa`, `users` (with `role = 'siswa'`), `jadwal_mapel`, `absensi`, `pengajuan_izin`. Wrap each in a `DO` block that checks `to_regclass` and `information_schema.columns` first and skips a missing table or column.
10. Class delete guard (`BEFORE DELETE` on `kelas`): build a text list of blocking tables by checking each of `siswa`, `users` (role `siswa`), `jadwal_mapel`, `absensi`, `pengajuan_izin` for `kelas = OLD.name`, each guarded by `to_regclass`. If any match, `RAISE EXCEPTION 'KELAS_MASIH_DIPAKAI: % dipakai oleh %', OLD.name, v_list;`.
11. `kelas.total_siswa` recompute function plus triggers on `siswa` `INSERT OR UPDATE OR DELETE`.
12. Teacher name sync — `AFTER UPDATE OF name` on `guru` updates `kelas.wali_kelas` where `wali_kelas_id = NEW.id`; `AFTER DELETE` on `guru` sets `wali_kelas` to `'Belum Ditentukan'` where `wali_kelas_id = OLD.id`.
13. `NOTIFY pgrst, 'reload schema';` before `COMMIT;`.

Do not add a `DROP`, `TRUNCATE`, enum, or any change to `process_dispensasi_rfid`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/check-migration-text.js`
Expected: `OK: migrasi integrasi memuat seluruh bagian wajib.`

- [ ] **Step 5: Commit**

```bash
git add supabase-migrations/2026111301_role_jadwal_integration.sql scripts/check-migration-text.js
git commit -m "feat(db): add role/jadwal integration migration"
```

The migration is reviewed here but not applied. Applying it is a separate, explicitly approved step.

---

### Task 5: Rewrite `routes/guru.js`

**Files:**
- Modify: `routes/guru.js:1-69`
- Test: `scripts/check-guru-routes.js`

**Interfaces:**
- Consumes: `effectiveRole` (Task 1), `createTeacherAccess` (Task 2), `db.findGuruByUserId`/`db.getGuru`/`db.addGuru`/`db.updateGuru`/`db.deleteGuru` (Task 3 and existing), `bcrypt`.
- Produces: `GET /api/guru` returns an array with `hasAccount` per row; `POST`/`PUT`/`DELETE` are `requireRole('petugas')`.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-guru-routes.js` that inspects the route table with a tiny fake app:

```js
const assert = require('assert');
const express = require('express');
const { effectiveRole } = require('../middleware/role');

const router = require('../routes/guru');
const stack = router.stack.filter((layer) => layer.route);
const byMethod = (method, path) => stack.find((layer) => layer.route.path === path && layer.route.methods[method]);

const post = byMethod('post', '/');
const put = byMethod('put', '/:id');
const del = byMethod('delete', '/:id');

for (const [label, layer] of [['POST /', post], ['PUT /:id', put], ['DELETE /:id', del]]) {
  assert.ok(layer, `${label} harus terdaftar`);
  const handlers = layer.route.stack.map((s) => s.handle);
  const guard = handlers.find((h) => h.length === 3 && h.name === '');
  assert.ok(guard, `${label} harus punya guard`);
}

assert.strictEqual(effectiveRole({ role: 'admin' }), 'guru');
assert.strictEqual(effectiveRole({ role: 'petugas' }), 'petugas');

const src = fs.readFileSync(require.resolve('../routes/guru'), 'utf8');
assert.ok(!/requireRole\('admin'/.test(src), 'routes/guru.js tidak boleh menyebut admin di requireRole');
assert.ok(!/requireRole\('guru'/.test(src), 'routes/guru.js tidak boleh memberi akses guru ke write');
assert.ok((src.match(/requireRole\('petugas'\)/g) || []).length >= 3, 'POST/PUT/DELETE guru harus requireRole(petugas)');

console.log('OK: route guru hanya untuk petugas dan admin dipetakan ke guru.');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/check-guru-routes.js`
Expected: PASS on the guard existence check but the intent check below is done by reading `routes/guru.js` for `requireRole('petugas')`. If the file still says `requireRole('guru', 'admin', 'petugas')` the reviewer marks this task failed; add this line to the test before running it:

```js
const fs = require('fs');
const src = fs.readFileSync(require.resolve('../routes/guru'), 'utf8');
assert.ok(!src.includes("requireRole('guru', 'admin', 'petugas')"), 'Write guru tidak boleh membuka guru/admin');
assert.ok((src.match(/requireRole\('petugas'\)/g) || []).length >= 3, 'POST/PUT/DELETE guru harus requireRole(petugas)');
```

- [ ] **Step 3: Rewrite `routes/guru.js`**

- `GET /`: `authenticate` only. For `petugas`, return `db.getGuru()`. For `guru`/`admin`, return only the current teacher row from `resolveTeacher(req.user)` (an array of one, or an empty array). For `siswa`, return 403. Map each row to include `hasAccount: Boolean(row.user_id)`.
- `POST /`: `requireRole('petugas')`. Require `nip`, `name`, `mapel`, `password` (minimum 4 characters, matching `routes/siswa.js:73`). Reject a duplicate NIP or email with 409. Create the `guru` row with `id = 'guru-' + Date.now()` then the `users` row with `id = 'usr-guru-' + Date.now()`, `role = 'guru'`, `password = bcrypt.hashSync(password, 10)`. On account failure, delete the just-created `guru` row and return 500.
- `PUT /:id`: `requireRole('petugas')`. Update `guru` fields; when `password` is a non-empty string of at least 4 characters, update the linked `users.password` with `bcrypt.hashSync(password, 10)`. Return 409 when `guru` has no `user_id` and no email/NIP can link one.
- `DELETE /:id`: `requireRole('petugas')`. On FK violation (`error.code === '23503'`) return 409 with a message naming schedules. Otherwise delete the `guru` row, then the linked `users` row; if the account delete fails, log it and return `{ success: true, warning: '...' }`.
- No review route exists in this file. Add a comment: `// Endpoint review izin ada di routes/izin.js (POST /api/izin/:id/review).`

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/check-guru-routes.js`
Expected: `OK: route guru hanya untuk petugas dan admin dipetakan ke guru.`

- [ ] **Step 5: Commit**

```bash
git add routes/guru.js scripts/check-guru-routes.js
git commit -m "feat(guru): petugas-only writes, teacher accounts, and account link"
```

---

### Task 6: Rewrite `routes/kelas.js`

**Files:**
- Modify: `routes/kelas.js:1-75`
- Test: `scripts/check-kelas-routes.js`

**Interfaces:**
- Consumes: `createTeacherAccess` (Task 2), `db.getKelas`, `db.addKelas`, `db.updateKelas`, `db.deleteKelas`, `db.findKelasByName`, plus new `db.countKelasReferences(name)` (add to `data/db.js`).
- Produces: `GET` scoped by role; `POST`/`PUT`/`DELETE` petugas-only; delete pre-check over the five stores.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-kelas-routes.js`:

```js
const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(require.resolve('../routes/kelas'), 'utf8');

assert.ok(!src.includes("requireRole('guru', 'admin')"), 'Kelas write tidak boleh membuka guru/admin');
assert.ok((src.match(/requireRole\('petugas'\)/g) || []).length >= 3, 'POST/PUT/DELETE kelas harus requireRole(petugas)');
assert.ok(src.includes('KELAS_MASIH_DIPAKAI'), 'Delete harus menangani kelas yang masih dipakai');
assert.ok(src.includes('waliKelasId'), 'Payload harus memakai waliKelasId');

console.log('OK: route kelas petugas-only dan menjaga referensi.');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/check-kelas-routes.js`
Expected: FAIL with `Kelas write tidak boleh membuka guru/admin`.

- [ ] **Step 3: Rewrite `routes/kelas.js`**

- `GET /`: petugas returns all; guru returns only classes from `getTaughtClasses(teacher.id)`; siswa returns 403. Include `waliKelasId: k.wali_kelas_id` in the mapping.
- `POST /`: `requireRole('petugas')`. Accept `waliKelasId`; when set, resolve the teacher and store both `wali_kelas_id` and `wali_kelas` (teacher name). A new class gets `id = 'kls-' + Date.now()`.
- `PUT /:id`: `requireRole('petugas')`. Same `waliKelasId` handling. The rename cascade is done by the database trigger, not here.
- `DELETE /:id`: `requireRole('petugas')`. Call `db.countKelasReferences(name)`; if any count is above zero, return 409 `{ message: 'Kelas masih dipakai oleh: ' + list.join(', ') }`. On a trigger-raised error, map `KELAS_MASIH_DIPAKAI` to 409 and `23505` (rename collision via a different path) to 409.
- Add `countKelasReferences` to `data/db.js`: five `count` queries (`{ count: 'exact', head: true }`) against `siswa`, `users` (role siswa), `jadwal_mapel`, `absensi`, `pengajuan_izin` filtered by `kelas = name`, each wrapped so a missing table returns 0.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node scripts/check-kelas-routes.js`
Expected: `OK: route kelas petugas-only dan menjaga referensi.`

- [ ] **Step 5: Commit**

```bash
git add routes/kelas.js data/db.js scripts/check-kelas-routes.js
git commit -m "feat(kelas): petugas-only writes, wali id, and reference-safe delete"
```

---

### Task 7: Scope `routes/siswa.js`, `routes/absensi.js`, `routes/stats.js`

**Files:**
- Modify: `routes/siswa.js:51-64` (GET), `routes/siswa.js:65-145` (POST), `routes/siswa.js:146-223` (PUT), `routes/siswa.js:224-250` (DELETE)
- Modify: `routes/absensi.js:7-90` (GET), `routes/absensi.js:91-126` (save), `routes/absensi.js:127-184` (riwayat), `routes/absensi.js:185-265` (rekap)
- Modify: `routes/stats.js` `GET /overview` and `GET /siswa`
- Test: `scripts/check-scoping-text.js`

**Interfaces:**
- Consumes: `createTeacherAccess`, `effectiveRole`, `jakartaNow` from `utils/jam-kerja.js`.
- Produces: every listed endpoint resolves the teacher, rejects outside-class access with 403, and `rekap-bulanan` returns the new `persentase` shape.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-scoping-text.js`. It reads source as text so no server or database is needed:

```js
const assert = require('assert');
const fs = require('fs');

const read = (rel) => fs.readFileSync(require.resolve(rel), 'utf8');

const absensi = read('../routes/absensi');
assert.ok(!absensi.includes("'07:15:00'"), 'Absensi manual tidak boleh menulis jam masuk palsu');
assert.ok(!absensi.includes("'15:30:00'"), 'Absensi manual tidak boleh menulis jam pulang palsu');
assert.ok(!/totalHari\s*=\s*22/.test(absensi), 'totalHari=22 harus dihapus');
assert.ok(absensi.includes('studentDays'), 'Rekap harus memakai student-day');
assert.ok(absensi.includes('persentaseSekolah'), 'Rekap harus menyertakan persentase sekolah');

const siswa = read('../routes/siswa');
assert.ok((siswa.match(/requireRole\('petugas'\)/g) || []).length >= 3, 'Tulis siswa harus petugas-only');

const izin = read('../routes/izin');
assert.ok(izin.includes("router.post('/:id/review'"), 'Review izin ada di routes/izin.js');
assert.ok(izin.includes('canReview'), 'Daftar izin harus menyertakan canReview');
assert.ok(!izin.includes("requireRole('petugas')"), 'Petugas tidak boleh mereview izin');

const guru = read('../routes/guru');
assert.ok(!guru.includes('/:id/review'), 'routes/guru.js tidak boleh memuat review izin');

console.log('OK: scoping, rekap student-day, dan lokasi review izin sesuai.');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/check-scoping-text.js`
Expected: FAIL with `Absensi manual tidak boleh menulis jam masuk palsu`.

- [ ] **Step 3: Rewrite `routes/siswa.js` authorization**

- `GET /`: `authenticate`. Resolve `effectiveRole(req.user)`: for `petugas`, return all; for `guru` (which includes legacy `admin`), resolve the teacher, compute `getTaughtClasses(teacher.id)`, and return only students whose `kelas` is in that list; for `siswa`, return 403 (the tracker endpoints stay as they are). Never branch on the raw `admin` value.
- `POST /`, `PUT /:id`, `DELETE /:id`: change every `requireRole('guru', 'admin', 'petugas')` to `requireRole('petugas')`. Keep the existing validation, hashing, and account-sync logic; change only authorization.
- Keep the tracker and `absen-masuk`/`absen-keluar` endpoints untouched.

- [ ] **Step 4: Rewrite `routes/absensi.js`**

- `GET /`: a student sees their own records. A guru resolves the teacher, validates `kelas` with `canAccessClass(req.user, teacher.id, kelas, { allowWali: true })`, and returns 403 when the class is neither taught nor wali-owned. Petugas sees any class. Remove the hardcoded classes and fall back to `db.getAbsensi` without a class filter when a guru has no classes.
- `POST /save`: change `requireRole('guru', 'admin')` to `requireRole('guru', 'petugas')` and validate the class with `canAccessClass`. Remove the fake times at lines 114-115: set `checkIn`/`checkOut` from `req.body` when present and valid, else `'-'`. Never invent a time.
- `GET /riwayat`: same class scoping as `GET /`; a guru sees only taught and wali classes.
- `GET /rekap-bulanan`: replace the `['admin','guru']` check with `effectiveRole(req.user) === 'guru'` (legacy `admin` resolves to `guru`); a student gets 403. Validate `kelas` with `canAccessClass(..., { allowWali: true })`. A guru with no `kelas` query is limited to their taught classes.
- Replace the percentage block (lines 196-260) with the student-day formula:
  ```js
  const dates = new Set(records.map((r) => r.date));
  const studentDays = dates.size;
  const counts = { hadir: 0, izin: 0, sakit: 0, alfa: 0 };
  for (const r of records) {
    if (r.status === 'hadir' || r.status === 'terlambat') counts.hadir += 1;
    else if (r.status === 'izin') counts.izin += 1;
    else if (r.status === 'sakit') counts.sakit += 1;
    else if (r.status === 'alfa') counts.alfa += 1;
  }
  const nonAlfa = counts.hadir + counts.izin + counts.sakit;
  const persentase = studentDays > 0 ? Math.round((nonAlfa / studentDays) * 1000) / 10 : null;
  const persentaseHadirSaja = studentDays > 0 ? Math.round((counts.hadir / studentDays) * 1000) / 10 : null;
  ```
  Each row is `{ nis, nama, kelas, ...counts, studentDays, persentase, persentaseHadirSaja, totalRecord: records.length }`. Add a self-check before pushing the row:
  ```js
  if (persentase !== null && (persentase < 0 || persentase > 100)) {
    throw new Error(`persentase out of range untuk ${st.nis}: ${persentase}`);
  }
  if (counts.hadir + counts.izin + counts.sakit + counts.alfa !== records.length) {
    throw new Error(`jumlah status tidak sama dengan record untuk ${st.nis}`);
  }
  ```
  School-level `persentaseSekolah` is `Math.round((sumNonAlfa / sumStudentDays) * 1000) / 10`, `null` when `sumStudentDays === 0`. Replace `totalHari: '22 Hari'` with `hariEfektif: <sumStudentDays> + ' hari'`, labelled as a proxy. Remove the 2024 defaults: when `bulan` is absent, use `jakartaNow()` month/year.

- [ ] **Step 5: Update `routes/stats.js`**

- `GET /overview`: scope the counts by `effectiveRole`. A guru's numbers count only taught classes. A student's numbers count only their own. Petugas keeps the whole-school numbers.
- `GET /siswa`: resolve the teacher; a guru gets 403 unless the requested student is in a taught class. Keep `jamMasuk`/`targetPulang` from `db.getPengaturan` (the existing source); do not hardcode.

- [ ] **Step 6: Update `routes/izin.js` review and list**

- `GET /`: replace the `role === 'siswa'` branch with `effectiveRole`. A guru sees applications for taught and wali classes; a legacy `admin` sees the same set, never the whole school. Petugas gets 403.
- `POST /:id/review`: change `requireRole('guru', 'admin')` to `requireRole('guru')`; a legacy `admin` still passes because `requireRole` compares `effectiveRole(user)`, so this is behaviourally identical for admin and removes `admin` from the source. Add an explicit wali check before the RPC: fetch the application, resolve the teacher, and reject with 403 unless `isWaliOf(teacher.id, application.kelas)`. Pass `req.user.id` as the fifth argument: `db.reviewIzinApplication(req.params.id, status, req.user.name || req.user.id, reviewNote ? reviewNote.trim() : null, req.user.id)`. Return `reviewed_by_id` in the response `data`.
- Add `canReview` to each listed item: `true` only when the caller is the wali of that class.
- Keep every existing error mapping (`APPLICATION_ALREADY_REVIEWED`, `ATTENDANCE_ALREADY_RECORDED_AS_PRESENT`, `42P10`, `PGRST202`, `42804`).

- [ ] **Step 7: Run the test to verify it passes**

Run: `node scripts/check-scoping-text.js`
Expected: `OK: scoping, rekap student-day, dan lokasi review izin sesuai.`

- [ ] **Step 8: Run the regression scripts**

Run: `node scripts/check-role.js && node scripts/check-teacher-access.js && node scripts/check-db-shape.js && node scripts/check-migration-text.js && node scripts/check-guru-routes.js && node scripts/check-kelas-routes.js && node scripts/check-scoping-text.js`
Expected: every script prints its `OK:` line and the command exits 0.

- [ ] **Step 9: Commit**

```bash
git add routes/siswa.js routes/absensi.js routes/stats.js routes/izin.js scripts/check-scoping-text.js
git commit -m "feat(scope): role and class scoping, wali-only review, student-day recap"
```

---

### Task 8: Update the frontend controls

**Files:**
- Modify: the teacher recap page and the class/teacher/student pages that hardcode class lists or show role-inappropriate buttons.
- Test: `scripts/check-frontend-text.js`

**Interfaces:**
- Consumes: `GET /api/kelas`, `GET /api/guru`, `GET /api/izin` `canReview`, `GET /api/absensi/rekap-bulanan` new fields.
- Produces: dropdowns fed by the API; approve buttons only when `canReview`; write buttons only for `petugas`.

- [ ] **Step 1: Locate the hardcoded lists**

Search for `XII IPA 1`, `Semua Kelas`, `22 Hari`, and `Oktober 2024` under `src/pages/**` and `*.html`. Record the matching file paths in the task notes before editing. The recap page used in the test below is `src/pages/guru/rekap.html`; adjust the test path to the real file if the search shows a different location.

- [ ] **Step 2: Write the failing test**

Create `scripts/check-frontend-text.js`:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const recap = fs.readFileSync(path.join(root, 'src', 'pages', 'guru', 'rekap.html'), 'utf8');

assert.ok(!/22 Hari/.test(recap), 'Rekap tidak boleh menampilkan 22 Hari');
assert.ok(!/Oktober 2024/.test(recap), 'Rekap tidak boleh memakai default Oktober 2024');
assert.ok(recap.includes('persentaseHadirSaja'), 'Rekap harus membaca persentaseHadirSaja');

console.log('OK: halaman rekap memakai data nyata.');
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node scripts/check-frontend-text.js`
Expected: FAIL with `Rekap tidak boleh menampilkan 22 Hari`.

- [ ] **Step 4: Replace the hardcoded values**

- Class dropdowns load `GET /api/kelas` and render `name`; the first option is `Semua Kelas`.
- The teacher/student forms send `waliKelasId` and read it from `GET /api/guru`.
- The recap page reads `data[].persentase`, `persentaseHadirSaja`, `studentDays`, and the summary's `persentaseSekolah`/`hariEfektif`; when a value is `null`, render `-`.
- The leave list renders the approve/reject buttons only when `item.canReview === true`.
- Write buttons for classes, teachers, students, and schedules render only when the current effective role is `petugas`. Use the effective-role value the backend exposes to the page; do not infer from the raw `admin` value.
- Keep the student dashboard reading `jamMasuk`/`targetPulang` from `/api/stats/siswa`; it already reflects `GET /api/pengaturan`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node scripts/check-frontend-text.js`
Expected: `OK: halaman rekap memakai data nyata.`

- [ ] **Step 6: Commit**

```bash
git add src/pages scripts/check-frontend-text.js
git commit -m "feat(ui): api-driven class lists, real recap, role-aware buttons"
```

---

### Task 9: Remove every `admin` allow-list entry and align `pageAuthGuard`

**Files:**
- Modify: `routes/jadwal.js:94,148,159,171`
- Modify: `routes/pengaturan.js:34,61`
- Modify: `routes/iot-monitoring.js:230,239,248` and `routes/iot.js:57,63`
- Modify: `server.js:117,126,172,181`
- Test: `scripts/check-no-admin-allowlist.js`

**Interfaces:**
- Consumes: `effectiveRole` (Task 1), `requireRole`/`pageAuthGuard` (Task 1).
- Produces: no `requireRole`/`pageAuthGuard` allow-list anywhere in `routes/**` or `server.js` mentions `'admin'`. `admin` still works everywhere `guru` works because `effectiveRole` maps it before the comparison. No capability is removed from a real `guru`; only the stored `admin` string stops being an independent grant.

**Why this task exists:** Task 1 changes the *mechanism* (`effectiveRole`), but the source files still spell out `'admin'` in dozens of allow-lists. That is inconsistent with the matrix (Admin column must be a literal copy of Guru) and it is fragile: a future reader could add `'admin'` to a write route and legitimately pass review. This task removes the spelling so the code cannot diverge from the matrix. The behaviour is unchanged for every real caller: an `admin` row already resolves to `guru`, so `requireRole('guru')` matches it exactly as `requireRole('guru', 'admin')` did.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-no-admin-allowlist.js`. It scans source text so it runs without a server:

```js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
}
walk(path.join(root, 'routes'));
files.push(path.join(root, 'server.js'));

const offenders = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /(requireRole\([^)]*'admin'|pageAuthGuard\(\[[^\]]*'admin')/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const line = src.slice(0, m.index).split('\n').length;
    offenders.push(`${path.relative(root, file)}:${line}: ${m[0]}`);
  }
}

assert.deepStrictEqual(offenders, [], `Tidak boleh ada 'admin' di allow-list:\n${offenders.join('\n')}`);

const auth = fs.readFileSync(path.join(root, 'middleware', 'auth.js'), 'utf8');
assert.ok(auth.includes('effectiveRole'), 'requireRole/pageAuthGuard harus memakai effectiveRole');

console.log('OK: tidak ada allow-list admin dan guard memakai effectiveRole.');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node scripts/check-no-admin-allowlist.js`
Expected: FAIL with a list of `routes/jadwal.js:94`, `routes/pengaturan.js:34`, `server.js:117`, and the others.

- [ ] **Step 3: Rewrite `routes/jadwal.js` allow-lists**

- `GET /options` (line 94): `requireRole('admin', 'petugas')` → `requireRole('petugas')`. This removes the read from a legacy `admin`, matching the corrected matrix (Schedule write/list is `own` for guru, and `/options` is a Petugas form helper; a guru never needed it).
- `POST /` (line 148), `PUT /:id` (line 159), `DELETE /:id` (line 171): `requireRole('admin', 'petugas')` → `requireRole('petugas')`. Writes are Petugas-only in the matrix, so this removes a write from `admin` and from any real `guru` that could reach it today.
- `GET /` (line 107) is already `authenticate` only; add the guru scoping from the design (`resolveTeacher`, force `guruId`, ignore the query param) as described in the design's `routes/jadwal.js` section. Do not add `requireRole('admin', ...)` back.

- [ ] **Step 4: Rewrite `routes/pengaturan.js` allow-lists**

- `POST /` (line 34): `requireRole('guru', 'admin', 'petugas')` → `requireRole('petugas')`. Settings write is Petugas-only; both `guru` and legacy `admin` lose it, matching the matrix.
- `POST /profil-sekolah` (line 61): `requireRole('guru', 'admin')` → `requireRole('petugas')`. Same rule.
- `GET /` stays `authenticate` only.

- [ ] **Step 5: Rewrite the IoT allow-lists**

The IoT endpoints are operational. They must not become a loophole where `admin` differs from `guru`, and they must not give a real `guru` more than the matrix allows. Apply:

- `routes/iot-monitoring.js:230,239,248` and `routes/iot.js:57,63`: `requireRole('guru', 'admin', 'petugas')` → `requireRole('petugas')`. Monitoring and scan control are operational writes/reads; Petugas owns them, matching the matrix. If a teacher genuinely needs read-only monitoring, that is a separate follow-up decision, not part of this plan; do not add `'guru'` here silently.

This is the only place the plan narrows a real `guru` capability. It is intentional: the matrix has no "IoT" row, and the safest reading is that it is operational (Petugas). Note it in the commit message so it is visible in review.

- [ ] **Step 6: Rewrite the `pageAuthGuard` calls in `server.js`**

- Lines 117 and 126 (`pageAuthGuard(['guru', 'admin'])`): → `pageAuthGuard(['guru'])`. A legacy `admin` still passes because `pageAuthGuard` compares `effectiveRole(user)`.
- Lines 172 and 181 (`pageAuthGuard(['siswa', 'guru', 'admin'])`): → `pageAuthGuard(['siswa', 'guru'])`. Same reasoning.
- Lines 148 and 152 (`pageAuthGuard(['petugas'])`) already contain no `admin`; leave them.

- [ ] **Step 7: Run the test to verify it passes**

Run: `node scripts/check-no-admin-allowlist.js`
Expected: `OK: tidak ada allow-list admin dan guard memakai effectiveRole.`

- [ ] **Step 8: Run the regression scripts**

Run: `node scripts/check-role.js && node scripts/check-teacher-access.js && node scripts/check-db-shape.js && node scripts/check-migration-text.js && node scripts/check-guru-routes.js && node scripts/check-kelas-routes.js && node scripts/check-scoping-text.js && node scripts/check-no-admin-allowlist.js`
Expected: every script prints its `OK:` line and the command exits 0.

- [ ] **Step 9: Commit**

```bash
git add routes/jadwal.js routes/pengaturan.js routes/iot-monitoring.js routes/iot.js server.js scripts/check-no-admin-allowlist.js
git commit -m "refactor(auth): remove admin from all allow-lists; rely on effectiveRole

Behavioural note: IoT monitoring/scan endpoints are now Petugas-only (previously guru/admin/petugas). Settings and schedule writes are Petugas-only. Legacy admin keeps guru-equivalent read access via effectiveRole."
```

---

### Task 10: Final verification and handoff

**Files:**
- No code changes. Run the checks and record the result.

- [ ] **Step 1: Run every script**

Run: `node scripts/check-role.js && node scripts/check-teacher-access.js && node scripts/check-db-shape.js && node scripts/check-migration-text.js && node scripts/check-guru-routes.js && node scripts/check-kelas-routes.js && node scripts/check-scoping-text.js && node scripts/check-frontend-text.js && node scripts/check-no-admin-allowlist.js && node scripts/check-jam-kerja.js`
Expected: all print `OK:` and the command exits 0. `check-jam-kerja.js` is the RFID regression guard and must stay green.

- [ ] **Step 2: Confirm no forbidden changes**

- `git diff` must not touch `supabase-migrations/2026110708_rfid_dispensasi_workflow.sql` or `process_dispensasi_rfid`.
- The new migration must contain no `DROP TABLE`, `TRUNCATE`, or `CREATE TYPE` for roles.
- `users.role` has no new CHECK or enum.
- No route file contains `requireRole('admin'` or `requireRole('guru', 'admin')` or `pageAuthGuard(['guru', 'admin'])` any more. Run this and expect zero matches:
  ```
  rg -n "requireRole\('admin'|requireRole\('guru', 'admin'|pageAuthGuard\(\[[^\]]*'admin'" routes server.js
  ```

- [ ] **Step 3: Report, do not apply**

Summarize the diff and the passing scripts. Do **not** apply the migration and do **not** touch the Supabase database; those require a separate explicit approval from the human partner.

---

## Notes for the implementer

- The migration is the only place that changes the schema. If a route needs a column that is not in the migration, stop and add it to the migration, not to a route-side workaround.
- `getTaughtClasses` reads `jadwal_mapel` with `aktif = true`. A class is accessible if it has any active schedule taught by the teacher, or if the teacher is its wali and the caller passed `allowWali`.
- `admin` never appears as a fresh value in code, and it never appears in a `requireRole`/`pageAuthGuard` allow-list after Task 10. Compare against `effectiveRole(user)` everywhere; `requireRole`/`pageAuthGuard` already do it after Task 1. The stored `admin` value is untouched by the migration and is only ever mapped at authorization time.
- The five-argument `review_pengajuan_izin` is an overload. The four-argument version stays for the dispensation path; the RPC call from `reviewIzinApplication` must pass `p_reviewer_id` so PostgREST picks the overload that writes `reviewed_by_id`. Verify this against the live schema after the migration is applied.
- The recap percentages are `number | null`. `null` means "no records", never "100". Tests and the UI must handle `null`.
- The class rename trigger cascades by name in one transaction. A unique-index conflict rolls the whole rename back and the route maps it to 409.
- `POST /api/absensi/save` keeps guru access because the existing UI saves manual attendance from the teacher recap page. A guru save is limited to a taught or wali class through `canAccessClass`; Petugas may save any class.
