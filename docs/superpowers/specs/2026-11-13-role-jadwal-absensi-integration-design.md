# SiPresensi Role, Jadwal, and Attendance Integration

Date: 2026-11-13
Status: Proposed (pending approval)
Approach: A, reuse the existing `guru` table

## Intent

Make the existing Petugas to Guru to Siswa flows work from the current Supabase data. The application already has the pages and most of the endpoints, but the relational links and schedule tables are missing. As a result, schedules, teacher data scoping, wali-kelas approval, and the student time display cannot work.

The change must use the current Supabase database, preserve the current UI, and leave the RFID/device code untouched.

## Goals

- A student sees only their own class schedule from `jadwal_mapel` and `jam_pelajaran`, including subject, teacher, day, start, and end times.
- The student dashboard shows the configured operational `jam_masuk` and `jam_pulang` from `pengaturan`. Actual tap times remain in attendance records.
- A teacher sees only their own teaching schedule. The teacher is resolved from the login account through `guru.user_id`, with a NIP fallback for older rows.
- A teacher sees only students, attendance, and recap data for classes they teach.
- A teacher can approve or reject leave requests only for classes where they are the wali kelas.
- Petugas manages classes (including the wali), teachers, students, subjects through teacher `mapel`, and schedules. Changes are visible immediately to the relevant teacher and student views.
- Authorization is enforced in the backend, not only hidden in the frontend.
- RFID, tracker, device authentication, discovery, and scan sessions remain unchanged.

## Non-goals

- No new schedule, attendance, or RFID endpoint when an existing one can be extended.
- No duplicate tables for data that already has a table.
- No redesign of the dashboards, sidebars, or existing page layout.
- No change to the RFID device auth, discovery, scan-session, or tracker workflow.
- No replacement of the existing leave-approval and attendance RPC workflow.
- No hardcoded or dummy data. The migration seeds only from actual `users` and `siswa` rows.

## Anti-goals

- A teacher approves another class's leave by calling the API directly.
- A student sees another class's schedule.
- A teacher sees the whole school's students or recap.
- Renaming or deleting a class leaves students or schedules orphaned.
- Changing a class schedule changes the operational `jam_masuk` or `jam_pulang`.
- The migration deletes or rewrites production attendance history.
- The RFID or IoT endpoints change behavior.

## Current state (audit findings)

### Database

- `users`: `id`, `email`, `password`, `name`, `role`, `title`, `nip`, `nis`, `kelas`, `phone`, `avatar`, `created_at`.
  - Current data has one `guru` account (`id = 1`, name Endang Kusuma, `nip` is NULL), four `siswa`, one `petugas`, and no active admin account.
  - `role` is a plain `VARCHAR(20)` with default `'siswa'`; it is **not** an enum in the live database. A probe insert with `role = 'admin'` succeeded, so `admin` is a valid stored value today.
- `guru`: table exists but is empty. Intended columns: `id`, `nip` (unique, not null), `name`, `mapel` (not null), `phone`, `email`.
- `kelas`: table exists but is empty. Intended columns: `id`, `name` (unique, not null), `total_siswa`, `wali_kelas` (free text), `ruangan`.
- `siswa`: `kelas` is free text, currently `XII IPA 1` and `XII IPS 1`. There is no foreign key to `kelas`.
- `jadwal_mapel` and `jam_pelajaran`: do not exist. The existing `2026110709_jadwal_mapel_schema_final_rev3.sql` migration is blocked because it refuses to run when `guru` or `kelas` is empty.
- `pengajuan_izin`: `id VARCHAR(50)`; `kelas` is text; `reviewed_by VARCHAR(100)` is a name string; `reviewed_at` and `review_note` exist. There is no reviewer ID. Live rows store names such as `Endang Kusuma` in `reviewed_by`, which cannot identify an account.
- `pengaturan`: `jam_masuk` and `jam_pulang` are strings such as `07:00 WIB`.

### Backend

- `routes/jadwal.js` already implements CRUD and role scoping, but resolves a teacher by NIP only and returns 503 when the schedule schema is missing.
- `routes/guru.js` allows any authenticated user to list all teachers, and allows any teacher to create, update, or delete teacher records.
- `routes/kelas.js` allows any authenticated user to list all classes, and does not allow `petugas` to write.
- `routes/siswa.js` lists all students for any guru, admin, or petugas, without class scoping.
- `routes/absensi.js` lets any guru read or save any class. `/riwayat` is accessible to any authenticated user. `/rekap-bulanan` is unscoped, performs one query per student, and uses hardcoded totals and 2024 defaults.
- `routes/stats.js` `/overview` is unscoped and open to any authenticated user. `/siswa` uses the latest `student_logs` row as today's record and returns the actual check-in time as `jamMasuk`.
- `routes/izin.js` lets any guru or admin list and review every leave request. Only the reviewer name is saved.
- `routes/pengaturan.js` already supports the petugas configuration flow; this will be verified and kept.

### Frontend

- `src/pages/petugas/jadwal.html` exists and uses `/api/jadwal` and `/api/jadwal/options`. It will work once the data foundation exists.
- `src/pages/student/jadwal.html` uses `/api/jadwal` and already has loading, empty, and error states.
- `src/pages/admin/data-kelas.html` exists, but the wali is a free-text input, the page guard allows only guru/admin, and the page is not linked from the petugas sidebar.
- `src/pages/petugas/data-guru.html` manages the `guru` table only and does not create a login account.
- `src/pages/petugas/data-siswa.html` creates and updates linked student accounts, but uses hardcoded class options.
- `src/pages/admin/absensi.html` uses hardcoded class and subject options and shows approval buttons to every guru/admin.
- `src/pages/admin/rekap-bulanan.html` uses hardcoded month and class options, has no teacher scoping, and does not show late counts or check-in/check-out details.
- `src/pages/admin/riwayat-absensi.html` uses hardcoded class options and a single date filter.
- `src/pages/student/dashboardsiswa.html` displays the `jamMasuk` value returned by `/api/stats/siswa`.

## Approaches considered

### A. Reuse the existing `guru` table (chosen)

Add `guru.user_id` to link a login account to a teacher profile. Add `kelas.wali_kelas_id` to link a class to its wali. Add `pengajuan_izin.reviewed_by_id` to store the reviewer account. Write one idempotent migration that creates the missing schedule tables and seeds `guru` and `kelas` from actual `users` and `siswa` rows.

This matches the existing rev3 schedule schema and the existing Data Guru page. It avoids duplicate tables and keeps the current UI.

### B. Use `users` directly as teacher and wali identity

Change the schedule foreign key to `users.id` and remove the dependency on `guru`. This would require rewriting the rev3 schedule schema, the schedule queries, and the teacher-profile page. It has fewer joins but does not fit the existing design. Rejected.

### C. Keep free-text `wali_kelas` and compare names

This is the fastest change, but it cannot reliably authorize a reviewer. Names can change, be duplicated, or be edited independently of the login account. It does not satisfy the backend authorization requirement. Rejected.

## Data model changes

New migration: `supabase-migrations/2026111301_role_jadwal_integration.sql`.

The migration is idempotent and safe on the current database. It does not drop existing production tables and does not delete rows.

#### Verified ID types

These are confirmed from the live database and `supabase-setup.sql`; all are `VARCHAR(50)` today:

| Table | Primary key | Type |
| --- | --- | --- |
| `users` | `id` | `VARCHAR(50)` |
| `guru` | `id` | `VARCHAR(50)` |
| `kelas` | `id` | `VARCHAR(50)` |
| `siswa` | `id` | `VARCHAR(50)` |
| `pengajuan_izin` | `id` | `VARCHAR(50)` |
| `jam_pelajaran` | `id` | `VARCHAR(50)` |
| `jadwal_mapel` | `id` | `VARCHAR(50)` |

Live sample values are `'1'`, `'usr-petugas'`, and `'usr-sis-1791820035351'`, so the 50-character width is already in use and must not be narrowed.

Rules for the new foreign keys:

- Every new FK column must be declared `VARCHAR(50)` to match its target. `guru.user_id -> users.id`, `kelas.wali_kelas_id -> guru(id)`, `pengajuan_izin.reviewed_by_id -> users(id)`, `jadwal_mapel.guru_id -> guru(id)`, and `jadwal_mapel.jam_ke_id -> jam_pelajaran(id)`.
- New generated IDs must fit in 50 characters. `'guru-' || users.id` can reach 55 characters, so it must be truncated with `LEFT(..., 50)`. The exact collision handling is specified under `guru` below.
- Do not alter the type of any existing ID column. `users.id`, `guru.id`, `kelas.id`, `pengajuan_izin.id`, and `siswa.id` keep `VARCHAR(50)`.
- `pengajuan_izin.reviewed_by` stays `VARCHAR(100)`; it is a name, not a key.
- Before creating each FK, check that the target rows exist and that the source column exists. Use `ADD COLUMN IF NOT EXISTS` and a guarded `DO` block around `ADD CONSTRAINT`, because the migration will be re-run.
- `kelas.name` is `VARCHAR(50)` but `jadwal_mapel.kelas`, `siswa.kelas`, `absensi.kelas`, and `pengajuan_izin.kelas` are `VARCHAR(30)`. The rename trigger must reject a new class name longer than 30 characters with `KELAS_NAME_TOO_LONG_FOR_REFERENCES` before it copies the name anywhere.

### 1. `guru`

- Add `user_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL`.
- Add a unique partial index on `user_id` where `user_id IS NOT NULL`.
- Link existing teacher rows to accounts by NIP first.
- Insert missing teacher rows for accounts with `role = 'guru'`:
  - Candidate IDs, in order: `LEFT('guru-' || users.id, 50)` then `'guru-' || SUBSTR(MD5(users.id), 1, 16)`. Both are checked against existing `guru.id` values before use.
  - Use the first candidate that is free. If the first candidate is taken by a row whose `user_id` is the same account, treat it as already linked and do not insert.
  - If the second candidate is also taken, raise `GURU_ID_COLLISION: tidak dapat membuat ID guru unik untuk user <users.id>` and abort the whole migration. Never overwrite an existing `guru` row, never merge two different teacher profiles, and never pick a third silent fallback.
  - `guru.id` is `VARCHAR(50)`. The migration runs inside a transaction, so an abort leaves the database unchanged.
  - `nip = COALESCE(NULLIF(users.nip, ''), 'GURU-' || UPPER(SUBSTR(MD5(users.id), 1, 8)))`. The result is at most 30 characters, matching `guru.nip VARCHAR(30)`.
  - `name = users.name`.
  - `mapel = 'Belum Ditentukan'` until Petugas edits it.
  - `phone = users.phone`, `email = users.email`.
  - `user_id = users.id`.
- If a teacher row with the same NIP already exists and has no `user_id`, link that row instead of inserting a duplicate.

### 2. `kelas`

- Add `wali_kelas_id VARCHAR(50) REFERENCES guru(id) ON DELETE SET NULL`.
- Add an index on `wali_kelas_id`.
- Seed classes from the distinct class names in `siswa.kelas` and `users.kelas` for student accounts:
  - ID: `'kls-' || UPPER(SUBSTR(MD5(name), 1, 10))`.
  - `name`: the actual class name.
  - `total_siswa`: count of matching `siswa` rows.
  - `wali_kelas`: `'Belum Ditentukan'` on insert.
  - `ruangan`: `'-'` on insert.
- `ON CONFLICT (name) DO UPDATE` only refreshes `total_siswa`. It does not overwrite an existing wali assignment.
- Add a trigger on `siswa` insert, class update, and delete to recompute `kelas.total_siswa` for the affected old and new class names. This keeps the Data Kelas card accurate after a student moves.

### 3. `pengajuan_izin`

- Add `reviewed_by_id VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL`.
- Add an index.
- The reviewer ID must be written atomically with the status change. A follow-up update after the RPC is rejected because it can leave `status = 'Disetujui'` with `reviewed_by_id IS NULL`.
- Do not replace the RPC. Create a new overload in the same migration:

  ```
  public.review_pengajuan_izin(
    p_id VARCHAR, p_status VARCHAR, p_reviewer VARCHAR,
    p_review_note VARCHAR DEFAULT NULL, p_reviewer_id VARCHAR DEFAULT NULL
  )
  ```

  It is a copy of the current `2026110708_rfid_dispensasi_workflow.sql` body with one change: the `UPDATE public.pengajuan_izin` also sets `reviewed_by_id = p_reviewer_id`. The status logic, `same_day` dispensation branch, `'Disetujui - Menunggu Tap'`, the attendance upsert, and every exception code stay identical.
- The four-argument overload is kept so existing callers still work. PostgREST resolves a five-key JSON body to the five-argument overload, so `data/db.js` must pass `p_reviewer_id` explicitly.
- `routes/izin.js` passes `req.user.id`. The route must not write `reviewed_by_id` itself.
- The reviewer name stays in `reviewed_by` for display and history. The new ID column is the authoritative reviewer link.
- Old rows keep `reviewed_by_id = NULL`. Do not backfill by name, because two accounts can share a name.
- After the migration, verify the new function body contains `reviewed_by_id` using `SELECT prosrc FROM pg_proc WHERE proname = 'review_pengajuan_izin';`. If the schema cache still serves the old function, run `NOTIFY pgrst, 'reload schema';`.

### 4. Schedule schema

Create `jam_pelajaran` and `jadwal_mapel` using the definitions from `2026110709_jadwal_mapel_schema_final_rev3.sql`, with `IF NOT EXISTS` guards:

- `jam_pelajaran`: `id`, `jam_ke`, `waktu_mulai`, `waktu_selesai`, `durasi_menit`, `deskripsi`, `aktif`, timestamps.
- `jadwal_mapel`: `id`, `guru_id` (FK to `guru.id` with `ON DELETE RESTRICT`), `jam_ke_id`, `nip`, `name_guru`, `mapel`, `kelas`, `hari`, `jam_mulai`, `jam_selesai`, `ruangan`, `catatan`, `aktif`, `version`, `created_by`, timestamps.
- `jadwal_mapel.kelas` stays `VARCHAR(30)` to match `siswa.kelas`, `absensi.kelas`, and `pengajuan_izin.kelas`. It is not widened. Class names that need to be longer than 30 characters are out of scope; the rename guard rejects them with a clear error.
- Create `check_time_overlap` before the validation trigger.
- Create `validate_kelas_exists`, `validate_jadwal_mapel`, and `validate_jam_pelajaran`.
- Create the insert/update triggers and indexes.
- Seed the standard eight `jam_pelajaran` rows.
- Do not include the rev3 pre-check that blocks when `guru` or `kelas` is empty; this migration seeds those first.
- Keep RLS disabled on these tables, matching rev3, because the Express backend uses the service role.

### 5. Integrity triggers

- On `kelas` rename: use a single `AFTER UPDATE OF name` trigger function that owns the whole cascade. Do not use `BEFORE UPDATE`. `validate_kelas_exists` and the `jadwal_mapel` validation trigger both read `public.kelas` and must see the new name already committed to the row.
  - A `BEFORE UPDATE OF name` guard only rejects a new name longer than 30 characters (`KELAS_NAME_TOO_LONG_FOR_REFERENCES`) and returns `NEW`. It never updates other tables.
  - The `AFTER UPDATE OF name` function runs one ordered `UPDATE` per referencing table: `siswa.kelas`, `users.kelas` (only `role = 'siswa'`), `jadwal_mapel.kelas`, `absensi.kelas`, `pengajuan_izin.kelas`. It skips a table if the column or table is missing. All statements run in the same transaction as the rename.
  - If any cascade fails, the rename rolls back. The API sees one transaction, not a partial rename.
  - `absensi` has `UNIQUE (nis, date, kelas)` and `pengajuan_izin` has the active-dispensasi partial index. An update that would collide with an existing record on the new class name is caught by the unique index and aborts the rename. The route maps the SQLSTATE to HTTP 409 instead of crashing.
- On `kelas` delete (`BEFORE DELETE`): run one reference check across all five referencing stores and raise `KELAS_MASIH_DIPAKAI` with the list of tables that still use the class if any exist. The checked stores are:
  - `siswa` where `kelas = OLD.name`
  - `users` where `role = 'siswa' AND kelas = OLD.name`
  - `jadwal_mapel` where `kelas = OLD.name`
  - `absensi` where `kelas = OLD.name` (historical records)
  - `pengajuan_izin` where `kelas = OLD.name` (historical records)
  - Each check is guarded by an existence test on the table and column, so the trigger also runs before a table exists.
  - The exception message names the blocking tables, for example `KELAS_MASIH_DIPAKAI: XII IPA 1 dipakai oleh siswa, absensi, pengajuan_izin`.
  - `absensi` and `pengajuan_izin` are included because deleting the class would otherwise leave historical rows pointing at a class name that no longer exists. History must stay readable.
  - The route also pre-checks the same five stores and returns 409 with the same table list before reaching the trigger. The trigger is the authoritative guard; the route pre-check only improves the message.
  - No `ON DELETE CASCADE` and no `ON DELETE SET NULL` is added to any class reference. A referenced class is never deleted; Petugas must rename or empty it first.
- On `guru` name update: use `AFTER UPDATE OF name` to update `kelas.wali_kelas` for rows where `wali_kelas_id` matches. On `guru` delete, use `AFTER DELETE` to set the text back to `'Belum Ditentukan'`; the foreign key already sets `wali_kelas_id` to NULL. `AFTER` is used so the trigger never fights the FK action.
- `jadwal_mapel.guru_id` remains `ON DELETE RESTRICT`, so a teacher with schedules cannot be deleted.

## Backend design

Add `utils/teacher-access.js`:

- `getTeacherProfile(user)`: return null when the role is not `guru`; otherwise look up `guru.user_id`, then fall back to `guru.nip`.
- `getTaughtClassNames(teacherId)`: distinct `jadwal_mapel.kelas` for the teacher where `aktif = 1`.
- `getWaliClassNames(teacherId)`: `kelas.name` where `wali_kelas_id = teacherId`.
- `getVisibleClassNames(user)`: resolves the effective role first. For guru (and therefore legacy admin), the union of taught and wali classes; for petugas, all classes; for a student, their own class. An `admin` value never reaches the "all classes" branch because `effectiveRole()` maps it to `guru` before the comparison.
- `assertClassAllowed(...)`: a small helper used by the routes.

Extend `data/db.js`:

- `findGuruByUserId(userId)`.
- `getSiswa` accepts `kelasList` and returns an empty array when the list is empty.
- `getKelasForTeacher(teacherId)` returns taught and wali classes with the current student counts.
- `getAbsensi` and `getAbsensiRiwayat` accept `kelasList`.
- `getIzinApplications(nis, { excludeApproved, kelasList })`.
- `reviewIzinApplication(id, status, reviewerName, reviewNote, reviewerId)` passes `p_reviewer_id`; there is no separate `setIzinReviewerId`.
- A range query for attendance by class list, used by the recap to avoid one query per student.

### `routes/jadwal.js`

- `GET /`:
  - Guru (including legacy `admin`, after `effectiveRole`): resolve the teacher profile through `guru.user_id` (fallback NIP), force `guruId` to the resolved teacher, and ignore any `guruId` query parameter. An `admin` account that resolves to no teacher row gets an empty schedule list, never all schedules.
  - Siswa: force `kelas` to the student's class.
  - Petugas: all filters, as today.
- `GET /options`: petugas only. The current `requireRole('admin', 'petugas')` (`routes/jadwal.js:94`) becomes `requireRole('petugas')`; a legacy `admin` therefore loses this read, matching the Guru column.
- `POST`, `PUT`, `DELETE`: petugas only. The current `requireRole('admin', 'petugas')` (`routes/jadwal.js:148`, `:159`, `:171`) becomes `requireRole('petugas')`. A legacy `admin` loses these writes, matching Guru.
- Validate that the selected subject belongs to the teacher's `mapel`.
- Return a 503 message that names the new migration when the schedule schema is missing.
- Join `guru` on `guru_id` and return the current teacher name and NIP as `name_guru` and `nip`, falling back to the snapshot columns. The schedule table still stores the snapshot for history; the API presents the current teacher identity. Optionally join `jam_pelajaran` to expose `jam_ke` and `deskripsi`; `jam_mulai` and `jam_selesai` remain the display source of truth.

### `routes/guru.js`

- `GET /`: petugas sees all. A guru sees only their own linked teacher record. A student gets 403.
- `POST /`: petugas only. Require `nip`, `name`, `mapel`, and a password. Create the `guru` row and the linked `users` account with `role = 'guru'`; set `guru.user_id`. If an account with the same NIP or email already exists, link it instead of duplicating. Password hashing uses `bcrypt.hashSync(value, 10)`, the same mechanism as `routes/siswa.js`; authentication stays `POST /api/auth/login`. Account ID: `'usr-guru-'` plus a unique suffix, at most 50 characters.
- `PUT /:id`: petugas only. Sync the teacher profile and the linked account (name, email, NIP, optional password). Rehash a non-empty password with `bcrypt.hashSync(value, 10)`; an empty password field keeps the current one. The class wali text is kept in sync by the database trigger.
- `DELETE /:id`: petugas only. A teacher with schedules is protected by the foreign key; return 409 with a clear message. After the teacher row is deleted, delete the linked `users` account so a deleted teacher does not remain a login-only orphan. If the account delete fails, log it and return a warning in the response.

This adds account creation to the existing Data Guru flow. It does not create a new page.

`routes/guru.js` contains **no** leave-review logic. `POST /api/izin/:id/review` lives only in `routes/izin.js`.

### `routes/kelas.js`

- `GET /`: petugas sees all. A guru sees only classes they teach; wali-only classes are not returned here because attendance, recap, and student pages must not offer classes those APIs reject. A legacy `admin` account gets the same guru-scoped list, never all classes. A student gets 403; their own class comes from `req.user.kelas` or `siswa.kelas`. The response includes `waliKelasId`.
- `POST` and `PUT`: petugas only. Accept `waliKelasId`; resolve the teacher and set `wali_kelas_id` and `wali_kelas` (the teacher name). Validate the unique class name.
- `DELETE`: petugas only. Pre-check the same five references as the trigger (`siswa.kelas`, `users.kelas` for students, `jadwal_mapel.kelas`, `absensi.kelas`, `pengajuan_izin.kelas`) and return 409 listing the blocking tables. The `BEFORE DELETE` trigger remains the authoritative guard.
- Add `petugas` to the write roles and remove `guru`.

### `routes/siswa.js`

- `GET /`: petugas sees all. A guru sees only students in classes they teach. If the requested `kelas` is outside that set, return 403. If the teacher has no taught classes, return an empty array with an informative message.
- `POST`, `PUT`, `DELETE`: petugas only.
- The existing `PUT` already updates `users.kelas`, so a student's schedule access changes immediately after a class change.
- RFID UID handling remains unchanged.

### `routes/absensi.js`

- `GET /`: a student sees their own records. A guru sees only taught classes and the requested class is validated. Petugas sees any class. Replace the hardcoded `XII IPA 1`, `Matematika`, and UTC date defaults with the actual first class and `jakartaNow().date`, or require an explicit class filter.
- `POST /save`: petugas can save any class; a guru can save only taught classes. Do not change the existing attendance workflow beyond authorization. Replace the hardcoded check-in/check-out times with the configured values or `'-'` so manual records do not contain fake times.
- `GET /riwayat`: petugas and guru only; a student gets 403. A guru is limited to taught classes. Support `startDate` and `endDate`, which the database layer already accepts.
- `GET /rekap-bulanan`: petugas sees all; a guru is limited to taught classes. Parse the month label or explicit `startDate`/`endDate`, fetch the records once, and group by NIS in memory. Counts are mutually exclusive: `hadir` = status `hadir`, `terlambat` = status `terlambat`, `izin` = status `izin`, `sakit` = status `sakit`, `alfa` = status `alfa`, `dispensasi` = status `dispensasi`. `totalHadir` = `hadir + terlambat`. Include a `details` array with date, status, check-in, and check-out. Remove the fixed `totalHari = 22` and the 2024 defaults. `totalHari` is replaced by `hariEfektif`, defined below.

The percentage formula is fixed. The current code divides non-alfa records by the day count (`absensi.js:221`), which can exceed 100% because a student can have several records per day (different `mapel`). The new definition:

- `hariEfektif` = the number of distinct dates in the range that have at least one attendance record for the selected classes. This is a school-day proxy and is displayed as-is.
- Per student, `studentDays` = the number of distinct `date` values that have at least one record for that NIS in the range. Records with different `mapel` on the same date count once.
- Per student, `nonAlfaDays` = the number of those dates where at least one record is not `alfa`. `alfaDays` = `studentDays - nonAlfaDays`.
- `persentase` = `studentDays > 0 ? round(nonAlfaDays * 1000 / studentDays) / 10 : null`. It is a percentage in `0..100`. Return `null` (not `100`) when the student has no records, so the UI can show `-`.
- The school-level `persentaseSekolah` = `round(SUM(nonAlfaDays) * 1000 / SUM(studentDays)) / 10`, with `null` when the denominator is `0`. It is not computed from per-student percentages.
- The status counts stay record-based and mutually exclusive; they are not divided by anything. Label them `hadir`, `terlambat`, `izin`, `sakit`, `alfa`, `dispensasi` in the response.
- Return both metrics and their labels: `persentaseHariHadir` uses `nonAlfaDays`, and `persentaseHadirSaja` uses dates whose records are all `hadir`/`terlambat`. The recap page shows `persentaseHariHadir` by default. This makes "non-alfa" and "actually present" visibly different instead of hiding the choice.
- A self-check must assert every `persentase` is `0..100` for a student with two records on the same date, and assert that `sum` of status counts equals the number of records, not the number of dates.
- Use `utils/jam-kerja.js` for the Jakarta timezone and status logic.

### `routes/stats.js`

- `GET /overview`: petugas sees the whole school. A guru sees only taught classes. A student gets 403. Use `jakartaNow().date` and apply the class filter to the totals, weekly chart, and recent list. If a teacher has no classes, return zeros and empty arrays.
- `GET /siswa`: use `jakartaNow().date` and `findAbsensiByNisDate` as today's source. Return the configured `jamMasuk`, `targetPulang`, and `batasMasuk` from `pengaturan`, plus the actual `checkIn` and `checkOut` separately. Keep `logs` for history. Do not use `student_logs[0]` as today's record.

### `routes/izin.js`

Mounted at `/api/izin` in `server.js`. All leave endpoints below live here, including the review endpoint. They are not implemented in `routes/guru.js`.

- `GET /`: a student sees their own applications. A guru sees applications for taught and wali classes. A legacy `admin` account maps to guru, so it sees the same set, not the whole school. Petugas gets 403. Add `canReview` to each item: true only when the user is the wali of that class.
- `GET /:id`: apply the same class checks. A student can only read their own.
- `POST /:id/review` (`POST /api/izin/:id/review`, implemented in `routes/izin.js`): a guru (including a legacy `admin` account, which maps to guru) must be the wali of `application.kelas`; otherwise return 403 before calling the RPC. Petugas gets 403. Call the extended RPC with `p_reviewer_id = req.user.id` so the status, `reviewed_by`, `reviewed_by_id`, `reviewed_at`, and `review_note` are written by one `UPDATE`. Return `reviewed_by_id` in the response so the UI and tests can confirm it was stored. Do not write `reviewed_by_id` in a separate request. Do not change the RFID or dispensation workflow.
- `reviewed_at` and `review_note` remain handled by the extended RPC.

### `routes/pengaturan.js`

- `GET /`: any authenticated user may read settings, unchanged.
- `POST /`: petugas only. The current `requireRole('guru', 'admin', 'petugas')` (`routes/pengaturan.js:34`) is narrowed to `requireRole('petugas')`; `admin` maps to guru and therefore loses this write, matching the matrix.
- `POST /profil-sekolah`: petugas only. The current `requireRole('guru', 'admin')` (`routes/pengaturan.js:61`) becomes `requireRole('petugas')`.
- Keep `jam_masuk` and `jam_pulang` as the single source for the dashboard and RFID time rules. Only the authorization changes; the stored values and readers are unchanged.

## Frontend design

The existing layout and styling are kept.

### `src/pages/admin/data-kelas.html`

- Replace the free-text `k-wali` input with a `k-wali-id` select populated from `GET /api/guru`. Include `Belum Ditentukan`.
- Send `waliKelasId` in the create and update payloads.
- Display the teacher name from `waliKelas`.
- Allow `petugas` to open the page and add a `Data Kelas` link to the petugas sidebar. No new page is created.

### `src/pages/petugas/data-guru.html`

- Add a password input. It is required for a new teacher and optional when editing.
- Show whether the teacher has a linked login account.
- Keep the existing table and modal layout.

### `src/pages/petugas/jadwal.html`

- No layout change.
- Add an informative empty state when there are no teachers, classes, or subjects: direct the Petugas to complete Data Guru and Data Kelas first.

### `src/pages/admin/absensi.html`

- Populate class options from `/api/kelas` instead of the hardcoded list. For a guru, the API returns only taught classes.
- Populate the subject options from the available teacher or schedule data, or remove the hardcoded static list while keeping the filter functional.
- Render the approve and reject buttons only when `application.canReview` is true. Otherwise show a non-clickable `Hanya wali kelas` note. The backend remains authoritative.

### `src/pages/admin/rekap-bulanan.html`

- Populate class options from `/api/kelas`.
- Keep the month filter and add the late count.
- Show a detail view for the `details` array so check-in and check-out times are visible.
- A guru sees only taught classes.

### `src/pages/admin/riwayat-absensi.html`

- Populate class options from `/api/kelas`.
- Replace the single date filter with start and end date inputs while keeping the existing filter layout.
- Call `/api/absensi/riwayat?startDate=...&endDate=...`.

### `src/pages/petugas/data-siswa.html`

- Populate the class dropdowns from `/api/kelas` instead of the hardcoded list.
- Keep the existing add, edit, and RFID flows.

### `src/pages/student/jadwal.html`

- No structural change. The existing loading, empty, and error states will now receive data.
- Optionally show the student's class in the subtitle from `/api/auth/me`.

### `src/pages/student/dashboardsiswa.html`

- No structural change. The API now returns the configured times.
- Optionally show the actual check-in time in the existing note.

### Sidebars and page guards

- Add the existing Data Kelas page to the petugas sidebar.
- Allow `petugas` in the page guard for `src/pages/admin/data-kelas.html`.
- Ensure a guru sees only the menus they can use. The current guru role receives the admin sidebar; hide teacher-irrelevant items with role-based conditions instead of redesigning the sidebar.
- Do not change the student sidebar.

## Role model

The system has three primary roles: `siswa`, `guru`, and `petugas`.

- `siswa`: their own class schedule, their own attendance, their own leave applications.
- `guru`: taught-class scoping for students, attendance, and recap; wali-only leave approval.
- `petugas`: school-wide operational management (classes, teachers, students, schedules, settings) but no leave approval.

`admin` is a **legacy value**, not a fourth role. The live database has no `admin` row today, `users.role` is `VARCHAR(20)` with no CHECK constraint, and a probe insert of `role = 'admin'` succeeded. Because the value is technically storable, the design handles it explicitly instead of leaving it undefined:

- `requireRole(...roles)` and `pageAuthGuard(...roles)` map an incoming `admin` to `guru` before comparing. One small helper, `effectiveRole(user)`, does this and is used by both.
- An `admin` account therefore gets exactly guru permissions: taught classes, wali-only leave approval, no class/teacher/schedule/student writes.
- Wherever this document says "admin" in an endpoint rule, it means "an account whose effective role is guru". The authorization matrix keeps the Admin column only as a reference for readers who still have such an account; its value is always identical to the Guru column by construction.
- No endpoint is written with `requireRole('admin', ...)` as a permitted role. Every existing `requireRole('admin', ...)` call is removed: reads that a guru may perform become `requireRole('guru', 'petugas')` (or `authenticate` plus class scoping), and writes become `requireRole('petugas')`. Listing `admin` in `requireRole` would be harmless after mapping but is forbidden so the code cannot diverge from the matrix. The full inventory of calls to rewrite is in the plan (Task 9).
- Petugas remains the only role that writes classes, teachers, students, and schedules. This is a deliberate change from the current code, where some write endpoints accept `admin`/`guru`; those calls are rewritten to `petugas`.
- The migration does not convert or delete existing `admin` rows, and it does not add `admin` to any enum. There is no enum.
- New accounts can only be created as `siswa`, `guru`, or `petugas`. The create-teacher path writes `role = 'guru'`.

Decided (approved by the human partner): `admin` is legacy and maps to `guru` via `effectiveRole()`. Existing `admin` rows are **not** converted to `petugas` automatically, and none are converted to `guru` by the migration either; the mapping happens at authorization time. If an admin row exists later, it keeps its stored value and behaves as a guru. This is the least-privilege default and needs no data change.

## Authorization matrix

Admin below is legacy and resolves to Guru; it must never have more access than Guru.

The Admin column is a **literal copy** of the Guru column. It is not an independent policy; if the two ever differ, the Guru column wins and the code is wrong. `requireRole()`/`pageAuthGuard()` never compare the raw stored value, only `effectiveRole(user)`, so an `admin` row cannot reach an endpoint a `guru` row cannot reach.

| Data | Admin (= Guru) | Petugas | Guru | Siswa |
| --- | --- | --- | --- | --- |
| Classes list | taught classes only | all | taught classes only | no (own via auth) |
| Class write | no | yes | no | no |
| Teacher list | own | all | own | no |
| Teacher write | no | yes | no | no |
| Students list | taught classes | all | taught classes | no |
| Student write | no | yes | no | no |
| Schedule list | own | all | own | own class |
| Schedule write | no | yes | no | no |
| Attendance list | taught classes | all | taught classes | own |
| Attendance save | taught classes | all | taught classes | no |
| Recap and history | taught classes | all | taught classes | own via `/api/absensi` and `/api/stats/siswa` |
| Leave list | taught + wali | no | taught + wali | own |
| Leave review | wali only | no | wali only | no |
| Settings | no | yes | no | no |

Every row that says "taught classes only", "own", or "no" applies identically to `admin` because `admin` has no stored capability of its own. In particular, `admin` does **not** see all classes, all teachers, or all students. Those were the three cells that previously gave `admin` more than `guru`, and they are now corrected.

## Testing plan

Use the current data and create only the minimum real data needed (a schedule and a wali assignment). Do not add dummy students.

1. Apply the migration. Set the existing teacher's `mapel` through Data Guru and assign that teacher as wali of `XII IPA 1`.
2. Create a schedule for `XII IPA 1`, that teacher, that subject, Monday 07:00-08:30.
3. Log in as a `XII IPA 1` student. `/api/jadwal` returns only that class; the student schedule page shows it.
4. Log in as the teacher. `/api/jadwal` returns only their schedule. `/api/siswa` returns only `XII IPA 1` students. `/api/siswa?kelas=XII IPS 1` returns 403.
5. Teacher recap: `XII IPA 1` works; `XII IPS 1` returns 403. Verify hadir, terlambat, izin, sakit, alfa, and the check-in/check-out details.
6. Recap percentage: pick a student with two records on the same date (for example `hadir` in one `mapel` and `izin` in another). Confirm that `studentDays` counts the date once, that the sum of status counts equals the record count, and that every `persentase` and `persentaseSekolah` is between `0` and `100`. Confirm a student with no records gets `persentase: null`, not `100`.
7. Leave approval: use a `XII IPA 1` application. The wali can approve. A teacher who is not the wali gets 403. Verify the reviewer name and `reviewed_by_id` are set by the same call, and that `SELECT status, reviewed_by, reviewed_by_id FROM pengajuan_izin WHERE id = ...` shows all three values with no `NULL` reviewer ID.
8. Dispensation regression: create a same-day `dispensasi` application, approve it, and confirm the status is `Disetujui - Menunggu Tap`, `reviewed_by_id` is set, and `process_dispensasi_rfid` still responds. This proves the copied RPC kept the dispensation branch.
9. Student dashboard: compare `/api/stats/siswa` `jamMasuk` and `targetPulang` with `GET /api/pengaturan`. Change the settings as Petugas, reload, and confirm the change.
10. Class change: move a student from `XII IPA 1` to `XII IPS 1`. Their schedule changes and the teacher's student list changes.
11. Class rename and delete: renaming updates student and schedule references in one transaction. Confirm a schedule insert for the new name still passes `validate_jadwal_mapel` after the rename. Confirm renaming to more than 30 characters is rejected. Deleting a referenced class returns 409. Confirm a rename that would collide with an existing `absensi` unique key rolls back with 409 and changes nothing.
12. Role check: confirm a `petugas` account cannot review leave, and an account with `role = 'admin'` behaves exactly like a guru (no class, teacher, student, or schedule writes).
13. Teacher account: create a teacher through Data Guru with a password. Confirm the `users.password` value starts with `$2` (bcrypt), that login works through `POST /api/auth/login`, and that the plain password is not stored.
14. RFID regression: run `node scripts/check-jam-kerja.js`. Do not run destructive RFID tests. Confirm the IoT endpoints and scan-session behavior are unchanged.

## Rollout and operations

- The migration must be run manually in the Supabase SQL Editor. The service-role key cannot execute DDL.
- Apply changes in `C:\Users\Administrator\sipresensi`, then sync the changed files to the live `D:\sipresensi` and verify on port 3001.
- The live D copy already contains the jam-kerja changes. Do not overwrite unrelated files.
- The migration does not delete data. It only creates missing tables and fills missing teacher and class rows from actual data.
- If the migration has not been applied, schedule endpoints return 503 with the migration filename. The rest of the application continues to work.

## Open decisions and builder calls

- Teacher account creation: add a password field to Data Guru and create the linked account. Chosen because "every teacher account is linked" cannot be guaranteed otherwise.
- Subject list: derive from `guru.mapel`. No new `mata_pelajaran` table. Chosen to avoid a duplicate source.
- Leave visibility for a teacher who teaches a class but is not its wali: read-only. Approval is wali-only. Chosen to match the requirement and avoid overexposing approvals.
- Recap detail: include a `details` array and a small detail view. Chosen because the specification asks for check-in and check-out times in the recap.
- Admin leave approval: keep it, but see "Role model" below. Admin is legacy and is mapped to guru permissions; it is not a fourth role and adds no capability a guru lacks.
- Role model: three primary roles (`siswa`, `guru`, `petugas`). `admin` is a legacy value kept only for compatibility; `role = 'admin'` resolves to guru. No endpoint grants admin anything beyond guru. The `users.role` column is `VARCHAR(20)` with no CHECK constraint, so the guarantee is enforced in `requireRole`/`pageAuthGuard`, not the database.
- Class rename: an `AFTER UPDATE OF name` trigger cascades the label to current and historical references in one transaction, after the new name is visible to `validate_jadwal_mapel`. A `BEFORE UPDATE` cascade was rejected because the schedule validator reads `kelas` by name and would see a row that does not yet exist under the new name. No rows are deleted. A rename longer than 30 characters is rejected because the referencing columns are `VARCHAR(30)`.
- Teacher account creation: use `bcrypt.hashSync(value, 10)` and the existing `/api/auth/login`. No new auth mechanism. Chosen because the project already hashes this way in `routes/siswa.js` and verifies in `routes/auth.js`.
- Reviewer ID: written inside an extended `review_pengajuan_izin` overload so status and reviewer commit atomically. The old four-argument overload is kept and the dispensation branch is copied unchanged, so the RFID workflow is unaffected. A post-RPC write was rejected because it can leave a reviewed status with no reviewer ID.
- Student endpoints: `/api/kelas`, `/api/absensi/riwayat`, and `/api/absensi/rekap-bulanan` are not student endpoints. Students keep using `/api/absensi` for their own records and `/api/stats/siswa` for their dashboard summary. Chosen to avoid exposing class-level grouped data.
- `GET /api/kelas` for a guru returns taught classes only. Wali-only classes are used only by `/api/izin` for visibility and approval. Chosen so attendance and recap dropdowns never offer a class the API will reject.
- Recap counts are mutually exclusive as defined above. The percentage is student-day based (`nonAlfaDays / studentDays`) and always in `0..100`; dividing non-alfa records by the day count was rejected because several records can share a date. `null` means no records. Both a non-alfa percentage and an actually-present percentage are returned so the label is never ambiguous.
- Teacher name on schedule reads: join `guru` and present the current name/NIP; the snapshot columns remain for history. Chosen to show current identity without mutating historical schedule rows.
- `kelas.total_siswa`: maintain it with a trigger on `siswa` insert/update/delete. Chosen so the Data Kelas card stays accurate after students move.
- Teacher delete: after the teacher row is safely deleted, delete the linked `users` account. Chosen to avoid an orphan login that has no teacher profile.

## What is left to the builder

- Exact SQL for the idempotent seeding and conflict handling.
- Error message and empty-state wording.
- Whether to expose `jam_pelajaran` descriptions in the student schedule.
- The exact layout of the recap detail view within the existing styling.
- Verification of the live Supabase data after the migration is applied.
