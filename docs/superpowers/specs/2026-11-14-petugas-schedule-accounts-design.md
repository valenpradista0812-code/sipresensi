# Petugas Schedule and Account Design

## Intent
Improve Petugas schedule creation so multiple students can be explicitly assigned, and make the existing unified account page reliable for Guru, Siswa, and Petugas.

## Goals
- Search students by name/NIS/NISN/class and select multiple students for a schedule.
- Persist those student links and scope student schedule visibility to class-wide legacy schedules plus explicitly assigned schedules.
- Keep existing schedule validation and clash enforcement.
- Use existing `/data-akun.html` and `/api/akun` for account CRUD, including role filtering, role-specific fields, duplicate NIP/NIS validation, and profile synchronization.
- Preserve effectiveRole and Petugas-only account authorization.

## Non-goals and constraints
- Do not create a duplicate account-management page.
- Do not modify RFID, ESP32, tracker, or attendance behavior.
- Do not run migrations or alter any production database.
- Keep existing class-wide schedules visible to students in the matching class; a schedule with selected students is visible only to those students, in addition to class-wide legacy schedules.

## Approaches
- Select multiple classes in place of students: rejected because the request requires student identity and persistence.
- Add a normalized schedule-student relation and preserve current class-wide rows: selected because it represents explicit assignments with minimal disruption to existing data and read semantics.
- Rebuild schedule storage around student lists: rejected as unnecessary and would risk existing schedule behavior.

## Design
Add a SQL migration file creating a many-to-many relation between `jadwal_mapel` and `siswa`, with foreign keys and an index; do not execute it. Extend existing schedule options to include student display data, existing schedule reads to include linked students, and create/update/delete persistence paths to validate and save links. Validate selected students against the schedule's selected class. Student reads retain unassigned existing class schedules while including explicitly assigned schedules. The existing DB trigger remains responsible for teacher/class time conflicts.

Retain `/src/pages/petugas/data-akun.html` and its role-based form. Tighten `/api/akun` duplicate checking for username/email, NIP, and NIS across users and profile tables on create and update; synchronize changed Siswa and Guru fields to existing profiles. Keep bcrypt password hashing and all Petugas route guards.

Add local assertion-based regression checks using the repository's existing scripts convention. Verify data-level schedule filtering/persistence paths, account duplicate checks/profile sync design, role authorization conventions, and unchanged conflict validation statically or through focused helper tests where feasible. Run existing scripts and Node syntax checks; there are no configured lint/typecheck scripts. Never run migrations.

## Calls left to implementer
Use the existing Supabase query patterns, preserve API response/error conventions, sanitize rendered student data, and add no dependencies or unrelated UI features.
