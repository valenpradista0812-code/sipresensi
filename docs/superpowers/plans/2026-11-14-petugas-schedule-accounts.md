# Petugas Schedule and Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persisted multi-student schedule assignments and make the existing Petugas account hub reliably manage all three roles.

**Architecture:** Add a normalized schedule-student join relation while retaining current class-based schedule fields and conflict trigger. Extend current schedule APIs/UI and existing `/api/akun` synchronization/duplicate validation; do not create a replacement account page.

**Tech Stack:** Existing Express, Supabase JS, bcryptjs, browser JavaScript, Node assert scripts, PostgreSQL SQL migration file.

**Spec:** `docs/superpowers/specs/2026-11-14-petugas-schedule-accounts-design.md`

## Global Constraints

- Do not run migrations or alter any production database.
- Do not modify RFID, ESP32, tracker, or attendance behavior.
- Preserve effectiveRole and Petugas-only account authorization.
- No dependencies or duplicate account-management page.
- Keep class-wide existing schedules visible; selected-student schedules are scoped to assigned students.

## Review Focus

- A selected student from another class or a forged invalid student ID must be rejected; test in Task 1.
- Updating student assignments must replace old links and deletion must not leave links behind; test persistence behavior and migration cascade in Task 1.
- Student schedule queries must include matching class-wide legacy schedules and explicitly assigned schedules without leaking schedules assigned to other students; test in Task 1.
- Duplicate NIS/NIP during edits must return conflict without modifying profiles; test in Task 2.
- Guru/Siswa profile sync errors or duplicate-account requests must not expose passwords or broaden write access; test API route guards and safe response in Task 2.

---

### Task 1: Student-specific schedule assignments

**Files:**
- Create: `supabase-migrations/2026111401_jadwal_siswa.sql`
- Modify: `routes/jadwal.js`
- Modify: `data/db.js`
- Modify: `src/pages/petugas/jadwal.html`
- Test: `scripts/check-jadwal-siswa.js`

**Interfaces:**
- `GET /api/jadwal/options` adds `students`, each with `id`, `nis`, `name`, and `kelas`.
- Schedule create/update accepts `siswaIds: string[]`; `GET /api/jadwal` returns `siswa_ids: string[]` for Petugas schedule editing.
- DB helpers validate selected siswa IDs/class, synchronize relation rows, and select student-visible schedules.

- [ ] **Step 1: Write a failing assertion script** for rejected cross-class assignments, replacement of a schedule's student links, class-wide plus assigned student visibility without cross-student leakage, and retaining the existing teacher/class conflict rules.
- [ ] **Step 2: Run `node scripts/check-jadwal-siswa.js`** and confirm it fails because the relationship and behavior are not implemented.
- [ ] **Step 3: Add the join-table migration** with foreign keys to `jadwal_mapel(id)` and `siswa(id)`, composite uniqueness, cascading link deletion, and an index by student; do not execute it.
- [ ] **Step 4: Implement DB helpers** for list students for schedule options, load assigned IDs, validate IDs belong to the submitted class, sync assignments after schedule insert/update, fetch schedule data for a student (class-wide rows without explicit links plus assigned rows), and delete relations through cascade.
- [ ] **Step 5: Integrate the schedule API**: include student options/IDs, validate `siswaIds` as an array, reject missing/cross-class IDs, save links for create/update, and scope student reads while retaining existing conflict errors and Petugas guards.
- [ ] **Step 6: Update the existing modal** with searchable multi-select showing name, NIS/NISN, and class; send selected IDs on save and restore them on edit. Keep existing day/teacher/subject/time validation.
- [ ] **Step 7: Run `node scripts/check-jadwal-siswa.js`, `node --check routes/jadwal.js`, and `node --check data/db.js`**; all must pass without database access.

### Task 2: Unified account CRUD reliability

**Files:**
- Modify: `routes/akun.js`
- Modify: `data/db.js` only if a query helper is needed
- Modify: `src/pages/petugas/data-akun.html` only for required role-specific fields/validation
- Test: `scripts/check-akun-management.js`

**Interfaces:**
- Existing routes and page remain canonical: `GET/POST /api/akun`, `PUT/DELETE /api/akun/:id`.
- Create/edit rejects duplicate NIP/NIS among both user accounts and role profiles (excluding the edited account/profile).
- Successful Guru/Siswa edits synchronize all submitted identity/profile fields without changing role; password changes continue through bcrypt hashing.

- [ ] **Step 1: Write a failing assertion script** for three-role creation payload acceptance, duplicate NIS/NIP conflicts on create and edit, Siswa/Guru field synchronization, bcrypt use, password omission from responses, and Petugas-only guards.
- [ ] **Step 2: Run `node scripts/check-akun-management.js`** and confirm the missing duplicate/profile-sync cases fail.
- [ ] **Step 3: Implement duplicate checks** against `users`, `siswa`, and `guru` for submitted NIS/NIP, excluding the current account/profile on update; return HTTP 409 on duplicates.
- [ ] **Step 4: Synchronize Siswa profile fields** (NIS, name, class, email, phone) and Guru profile fields (NIP, name, mapel, email, phone) after account updates, preserving role immutability and password hashing.
- [ ] **Step 5: Keep the existing single account page** and expose/validate only fields needed for the selected role; ensure add/edit renders existing role filter and all three roles.
- [ ] **Step 6: Run `node scripts/check-akun-management.js`, `node --check routes/akun.js`, and existing role/account guard scripts**; all must pass.

### Task 3: Integrated regression verification

**Files:**
- No additional files unless a regression exposes a required fix.

- [ ] **Step 1: Run all existing `scripts/check-*.js` scripts** and both new focused scripts; report each command's actual result.
- [ ] **Step 2: Run Node syntax checks for all changed JavaScript files.**
- [ ] **Step 3: Confirm `package.json` has no lint/typecheck script and do not run `npm run db:init` or any database command.**
- [ ] **Step 4: Inspect final diff/status** and ensure migration file is unexecuted, changes are limited to requested features, and existing conflict checks remain.
