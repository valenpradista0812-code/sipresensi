# Implementation Plan

> **Feature:** izin-approval-dan-wali-akun
> **Design:** `docs/superpowers/specs/2026-11-18-izin-approval-dan-wali-akun-design.md` (Section 4)
> **Plan:** `docs/superpowers/plans/2026-11-18-izin-approval-dan-wali-akun.md` (Tasks 4 & 5)
> **Status:** Backend ~95% complete. Two gaps remain.

## Bug Condition

**C(X):** The `PUT /api/akun/:id` endpoint in `routes/akun.js` receives `isWaliKelas` and
`waliKelasId` in the request body but does NOT process them. `parseWaliAssignment` is
never called; `db.assignWaliKelas` and `db.clearWaliKelas` are never invoked. Editing a
guru account to add, remove, or change wali kelas status silently has no effect on the
database. The `POST /` endpoint handles this correctly and can be used as a reference.

Additionally, `src/pages/petugas/data-akun.html` has no wali checkbox or dropdown in the
modal, does not send `isWaliKelas`/`waliKelasId` in the payload, and does not display
wali status in the table. So the UI cannot even trigger the PUT gap — the wali form
fields are entirely missing.

**Counterexample:** `PUT /api/akun/usr-guru-123` with body
`{ "isWaliKelas": true, "waliKelasId": "kls-1" }` → response 200 "success", but the
`kelas` table `wali_kelas_id` for kls-1 remains unchanged (the POST endpoint would have
set it correctly).

## Expected Behavior (Design Section 4)

- `PUT /api/akun/:id` with `isWaliKelas: true` → assign guru to selected class (move from
  old class if any) via `db.assignWaliKelas`.
- `PUT /api/akun/:id` with `isWaliKelas: false` → `db.clearWaliKelas(guruId)`.
- `PUT /api/akun/:id` without `isWaliKelas` field → no wali change (compatibility).
- Modal shows **Jadikan Wali Kelas** checkbox + **Kelas Wali** dropdown for role guru
  only; dropdown appears only when checkbox is checked.
- Dropdown options include current wali labels (e.g. `X-Dev A — wali: Endang Kusuma`
  or `X-Dev A — belum ada wali`).
- Edit modal pre-fills checkbox and dropdown from `waliKelasId`.
- Form submit sends `isWaliKelas` (boolean) and `waliKelasId` (string|null) for guru.
- When assigning a class that already has a different wali, show `SiPresensi.confirm`
  before proceeding.
- Table "Kelas" column shows `Wali <nama kelas>` for guru who are wali, `-` otherwise.

## Preservation Requirements

- Non-guru accounts (siswa, petugas) are unaffected by wali logic (`parseWaliAssignment`
  returns `{ skip: true }` for non-guru roles).
- `PUT /api/akun/:id` with no `isWaliKelas` field must not change existing wali status
  (`parseWaliAssignment` returns `{ skip: true }` when key absent).
- Existing `POST /api/akun` endpoint wali handling remains unchanged.
- Non-wali profile sync (name, email, NIP, mapel, phone, password) continues to work
  in both POST and PUT endpoints.
- All existing check scripts (`check-db-shape.js`, `check-teacher-access.js`,
  `check-izin-approval.js`, `check-wali-akun.js`, `check-akun-management.js`,
  `check-frontend-text.js`, etc.) must continue to pass.

---

- [ ] 1. Add wali kelas assignment/clearing to routes/akun.js PUT /:id endpoint

  The `PUT /:id` handler currently syncs the user record and guru/siswa profile but
  never processes wali fields. The `POST /` handler already does this correctly —
  use it as the reference pattern.

  - [ ] 1.1 Add wali handling block after the profile sync try/catch in PUT /:id
    - The profile sync block ends around the line after `await db.updateUser(account.id, { title: ... })`
      for guru, inside the inner `try { ... } catch (profileError) { ... }`.
    - After that try/catch (but before the final `const fresh = await db.findUserById(...)`),
      add the wali handling block.
    - Guard with `if (account.role === 'guru' && profiles.guru)` so non-guru accounts
      skip wali logic entirely.
    - Call `parseWaliAssignment(account.role, req.body)` to get the wali result.
    - If `waliResult.assign`: validate kelas exists via `db.findKelasByIdOrName(waliResult.kelasId)`;
      if not found, return `res.status(400).json({ success: false, message: 'Kelas wali tidak ditemukan.' })`;
      then call `db.assignWaliKelas(targetKelas.id, { id: profiles.guru.id, name: profiles.guru.name })`.
    - If `waliResult.clear`: call `db.clearWaliKelas(profiles.guru.id)`.
    - If `waliResult.skip`: no change (compatibility — preserves existing wali status).
    - If `waliResult.error`: return `res.status(400).json({ success: false, message: waliResult.error })`.
    - _Bug_Condition: isBugCondition(input) where input = PUT request body with isWaliKelas=true and waliKelasId set, but endpoint ignores them_
    - _Expected_Behavior: expectedBehavior(result) from design Section 4 — isWaliKelas:true → assign; isWaliKelas:false → clear; field absent → skip_
    - _Preservation: Non-guru accounts skip wali; field absent → no change; existing POST / handling unchanged; profile sync continues to work_
    - _Reference: See POST / handler lines ~155-165 in routes/akun.js for the working pattern_
    - _Reference: Implementation plan Task 4 Step 8_
    - _Requirements: Design Section 4_

  - [ ] 1.2 Verify the PUT endpoint now handles all three wali cases
    - Test assign case: PUT with `isWaliKelas: true, waliKelasId: "<existing-class-id>"` → wali_kelas_id updated.
    - Test clear case: PUT with `isWaliKelas: false` → wali_kelas_id set to null for that guru.
    - Test skip case: PUT without `isWaliKelas` field → wali_kelas_id unchanged.
    - Test error case: PUT with `isWaliKelas: true` but no `waliKelasId` → 400 "Pilih kelas wali terlebih dahulu."
    - Test non-guru case: PUT on a siswa account with `isWaliKelas: true` → no wali logic runs (parseWaliAssignment returns skip).
    - _Preservation: Verify non-wali fields (name, email, NIP, mapel) still sync correctly after adding wali block_
    - _Requirements: Design Section 4, Error Handling section_

- [ ] 2. Implement wali kelas UI in src/pages/petugas/data-akun.html

  The modal form currently has no wali checkbox, no wali dropdown, and the form submit
  handler does not send `isWaliKelas` or `waliKelasId`. The table does not show wali
  status. All of these need to be added per Design Section 4 and Implementation Plan
  Task 5.

  - [ ] 2.1 Add checkbox and dropdown HTML elements in the modal
    - Insert after the `a-field-guru-mapel` div and before the `a-field-siswa-nis` div.
    - Add a div `id="a-field-wali-check"` containing a checkbox `id="a-is-wali"` with label
      "Jadikan Wali Kelas" (initially `display:none`).
    - Add a div `id="a-field-wali-kelas"` containing a `<select id="a-wali-kelas-id">` with
      label "Kelas Wali" (initially `display:none`).
    - _Requirements: Design Section 4, Implementation Plan Task 5 Step 1_

  - [ ] 2.2 Update toggleRoleFields(role) to show/hide wali checkbox for guru
    - Show `a-field-wali-check` when `role === 'guru'`, hide otherwise.
    - When role is not guru, uncheck `a-is-wali` and hide `a-field-wali-kelas`.
    - The wali dropdown visibility is controlled by the checkbox, not by toggleRoleFields.
    - _Preservation: Existing guru/siswa/petugas field toggling must still work_
    - _Requirements: Design Section 4, Implementation Plan Task 5 Step 2_

  - [ ] 2.3 Add event listener on the wali checkbox to show/hide the dropdown
    - On `change` event of `a-is-wali`: show `a-field-wali-kelas` when checked, hide when unchecked.
    - _Requirements: Design Section 4, Implementation Plan Task 5 Step 3_

  - [ ] 2.4 Update loadKelasOptions to also populate the wali dropdown with current wali labels
    - After fetching `/api/kelas`, populate `a-wali-kelas-id` select with all classes.
    - Each option label includes the current wali: `"<kelas-name> — wali: <wali-name>"` or
      `"<kelas-name> — belum ada wali"` when wali is absent or "Belum Ditentukan".
    - Each option carries `data-name`, `data-current-wali`, and `data-current-wali-id`
      attributes for use in the confirm dialog (Task 2.7).
    - _Requirements: Design Section 4, Implementation Plan Task 5 Step 4_

  - [ ] 2.5 Update openAddModal() to reset wali state
    - Uncheck `a-is-wali`, hide `a-field-wali-kelas`, reset `a-wali-kelas-id` to empty.
    - _Preservation: Existing field resets (name, email, NIP, etc.) must still work_
    - _Requirements: Design Section 4, Implementation Plan Task 5 Step 5_

  - [ ] 2.6 Update openEditModal(u) to populate checkbox and dropdown from waliKelasId
    - When `u.role === 'guru'`: set `a-is-wali` checked = `!!u.waliKelasId`, show/hide
      `a-field-wali-kelas` accordingly, set `a-wali-kelas-id` value = `u.waliKelasId || ''`.
    - Store `u.waliKelasId` in a closure variable (e.g. `let editingWaliGuruId`) for use
      in the confirm dialog during form submit.
    - _Preservation: Existing field population (name, email, NIP, mapel, etc.) must still work_
    - _Requirements: Design Section 4, Implementation Plan Task 5 Step 6_

  - [ ] 2.7 Update form submit handler to send isWaliKelas and waliKelasId for guru
    - In the `role === 'guru'` block of the submit handler, add `payload.isWaliKelas` and
      `payload.waliKelasId` to the payload.
    - `payload.isWaliKelas` = checked state of `a-is-wali`.
    - `payload.waliKelasId` = value of `a-wali-kelas-id` when checked, `null` when unchecked.
    - When `isWaliKelas` is checked and `waliKelasId` is set, check if the selected class
      already has a different wali (using `data-current-wali-id` from the option).
    - If the class has a different wali (current-wali-id !== editingWaliGuruId), show
      `SiPresensi.confirm`: "Kelas <name> saat ini diwali oleh <current-wali>. Ganti wali
      ke <payload.name>?" with confirmText "Ya, Ganti" and cancelText "Batal".
    - If user cancels, abort the submit (return early).
    - _Preservation: Existing payload fields (name, email, NIP, mapel, phone, password) must still be sent_
    - _Preservation: Siswa and petugas submit paths must be unchanged_
    - _Requirements: Design Section 4, Implementation Plan Task 5 Step 7_

  - [ ] 2.8 Update renderTable to show wali status for guru in the Kelas column
    - For guru accounts: show `Wali <waliKelas>` when `u.waliKelas` is set, show `-` otherwise.
    - For siswa accounts: show `u.kelas` as before (unchanged).
    - For petugas accounts: show `-` as before (unchanged).
    - _Preservation: Non-guru rows must render exactly as before_
    - _Requirements: Design Section 4, Implementation Plan Task 5 Step 8_

- [ ] 3. Verification — run all check scripts and verify functionality

  - [ ] 3.1 Run all existing check scripts to ensure no regressions
    - `node scripts/check-db-shape.js`
    - `node scripts/check-teacher-access.js`
    - `node scripts/check-izin-approval.js`
    - `node scripts/check-wali-akun.js`
    - `node scripts/check-akun-management.js`
    - `node scripts/check-frontend-text.js`
    - `node scripts/check-guru-routes.js`
    - `node scripts/check-kelas-routes.js`
    - `node scripts/check-role.js`
    - `node scripts/check-scoping-text.js`
    - Expected: all scripts print OK with no errors.
    - _Preservation: All previously-passing scripts must still pass after the changes_

  - [ ] 3.2 Verify the PUT endpoint works end-to-end
    - Edit a guru account via the UI, check "Jadikan Wali Kelas", select a class, save.
    - Confirm the `kelas` table `wali_kelas_id` is updated (via DB query or GET /api/akun
      showing `waliKelasId`).
    - Edit the same guru, uncheck "Jadikan Wali Kelas", save → confirm wali cleared.
    - Edit the same guru without touching the checkbox → confirm wali status unchanged.
    - Edit a siswa account → confirm no wali logic runs.
    - _Bug_Condition: Confirm the bug is fixed — PUT now processes isWaliKelas and waliKelasId_
    - _Expected_Behavior: All three cases (assign, clear, skip) work correctly_

  - [ ] 3.3 Verify the UI renders correctly
    - Open the Manajemen Akun page, click "Tambah Akun", select role "Guru" → confirm
      "Jadikan Wali Kelas" checkbox appears.
    - Check the checkbox → confirm "Kelas Wali" dropdown appears with wali labels.
    - Open edit modal for a guru who is a wali → confirm checkbox is checked and
      dropdown shows the correct class.
    - Open edit modal for a guru who is not a wali → confirm checkbox is unchecked and
      dropdown is hidden.
    - Confirm the table "Kelas" column shows "Wali <nama kelas>" for wali guru and "-"
      for non-wali guru.
    - Confirm the confirm dialog appears when assigning a class that already has a
      different wali.
    - _Requirements: Design Section 4_
