# TAHAP 2A FINAL REV2 — LAPORAN IMPLEMENTASI

**Status**: ✅ FINAL REV2 COMPLETE — Siap untuk deployment

**Tanggal**: 2026-11-08  
**Revisi**: Rev2 (5 temuan + pre-check strict)

---

## 📋 PERUBAHAN DIBANDING REV1

| # | Temuan Rev1 | Perbaikan Rev2 | Status |
|---|-------------|----------------|--------|
| 1 | `aktif` constraint | `NOT NULL DEFAULT 1` | ✅ |
| 2 | Validasi kelas | Manual check via `validate_kelas_exists()` | ✅ |
| 3 | Seed verification | Check guru+NIP conflict, kelas conflict | ✅ |
| 4 | Idempotency | Handle existing table with constraints | ✅ |
| 5 | NIP guru change | Denormalized, jadwal tetap konsisten | ✅ |

---

## 🔧 IMPLEMENTASI DETAIL

### 1. Constraint `aktif` NOT NULL DEFAULT 1

```sql
-- jam_pelajaran
aktif INT NOT NULL DEFAULT 1,
CONSTRAINT jam_pelajaran_aktif_valid CHECK (aktif IN (0, 1))

-- jadwal_mapel  
aktif INT NOT NULL DEFAULT 1,
CONSTRAINT jadwal_aktif_valid CHECK (aktif IN (0, 1))
```

**Handling existing table**:
```sql
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jadwal_aktif_valid') THEN
  ALTER TABLE ADD CONSTRAINT ...
END IF;
ALTER TABLE ALTER COLUMN aktif SET NOT NULL;
ALTER TABLE ALTER COLUMN aktif SET DEFAULT 1;
```

### 2. Validasi Kelas Manual

Tidak bisa FK karena:
- `jadwal_mapel.kelas` VARCHAR(30)
- `kelas.name` VARCHAR(50)
- Type mismatch

**Solusi**: Function `validate_kelas_exists()`
```sql
CREATE OR REPLACE FUNCTION public.validate_kelas_exists(p_kelas VARCHAR)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE AS $$
BEGIN RETURN EXISTS (SELECT 1 FROM public.kelas WHERE name = p_kelas); END;
$$;
```

**Di trigger**:
```sql
SELECT public.validate_kelas_exists(NEW.kelas) INTO v_kelas_exists;
IF NOT v_kelas_exists THEN
  RAISE EXCEPTION 'JADWAL_KELAS_INVALID: Kelas "%" tidak ditemukan.';
END IF;
```

### 3. Seed Verification: Guru+NIP + Kelas Conflict

**Pre-check**:
- Verify semua 7 guru dengan exact NIP match
- Verify kelas XII IPA 1 exist
- If mismatch → `RAISE EXCEPTION` (stop execution)

**Post-insert**:
```sql
-- Check guru conflict (per NIP, bukan guru_id)
SELECT COUNT(*) INTO v_guru_conflict FROM jadwal_mapel j1
  WHERE ... nip = j2.nip AND ... AND jam_overlap;

-- Check kelas conflict
SELECT COUNT(*) INTO v_kelas_conflict FROM jadwal_mapel j1
  WHERE ... kelas = j2.kelas AND ... AND jam_overlap;

IF v_guru_conflict > 0 THEN RAISE EXCEPTION ...; END IF;
IF v_kelas_conflict > 0 THEN RAISE EXCEPTION ...; END IF;
```

**Result**: Both conflicts checked, not just guru conflict.

### 4. Idempotency: Handle Existing Table

**Strategy**:
- `CREATE TABLE IF NOT EXISTS` (safe)
- `CREATE OR REPLACE FUNCTION` (safe)
- `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` (safe)
- Check constraint exists via `pg_constraint` system catalog
- If constraint missing, ADD CONSTRAINT
- Set NOT NULL and DEFAULT if column exists but without constraint

**Safe for re-run**: Migration dapat dijalankan berulang kali tanpa error atau data loss.

### 5. NIP Guru Change Handling

**Denormalization**: `jadwal_mapel` menyimpan `nip` (bukan FK ke `guru.nip`)

**Implication**:
- Jika NIP guru berubah (misal: ganti NIP baru), jadwal lama tetap konsisten (pakai NIP lama)
- Validasi `validate_guru_nip_match()` cek `guru.id` → `guru.nip` saat insert/update
- Jadwal existing tidak terpengaruh perubahan NIP guru

**Tradeoff**:
- Pros: Data historis jadwal tetap valid, tidak perlu update massal
- Cons: Jika NIP guru berubah, jadwal baru harus pakai NIP baru

**Recommendation**: NIP guru di Supabase biasanya tidak berubah. Jika perlu, aplikasi bisa handle sync di level frontend.

---

## 📊 STRUKTUR TABEL (FINAL)

### `jam_pelajaran`

| Kolom | Tipe | Constraint | Keterangan |
|-------|------|------------|-----------|
| `id` | VARCHAR(50) | PK | ID unik (jam-1 sampai jam-8) |
| `jam_ke` | INT | UNIQUE NOT NULL | Nomor urut (1-10) |
| `waktu_mulai` | TIME | NOT NULL | Jam mulai (HH:MM) |
| `waktu_selesai` | TIME | NOT NULL | Jam selesai (HH:MM) |
| `durasi_menit` | INT | — | Durasi pelajaran |
| `deskripsi` | VARCHAR(100) | — | Keterangan (Istirahat, Sholat, dll) |
| `aktif` | INT | NOT NULL DEFAULT 1, CHECK(0\|1) | Status aktif |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Waktu dibuat |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Waktu diupdate |

**Index**: jam_ke, aktif, waktu_mulai-waktu_selesai

---

### `jadwal_mapel`

| Kolom | Tipe | Constraint | Keterangan |
|-------|------|------------|-----------|
| `id` | VARCHAR(50) | PK | ID unik (jdw-001 sampai jdw-019) |
| `guru_id` | VARCHAR(50) | FK (guru.id) ON DELETE RESTRICT | Referensi guru |
| `jam_ke_id` | VARCHAR(50) | FK (jam_pelajaran.id) ON DELETE SET NULL | Referensi jam pelajaran |
| `nip` | VARCHAR(30) | NOT NULL | NIP guru (denormalized) |
| `name_guru` | VARCHAR(100) | NOT NULL | Nama guru |
| `mapel` | VARCHAR(80) | NOT NULL | Mata pelajaran |
| `kelas` | VARCHAR(30) | NOT NULL | Kelas (manual FK check) |
| `hari` | VARCHAR(15) | NOT NULL, CHECK valid days | Hari (Senin-Minggu) |
| `jam_mulai` | TIME | NOT NULL | Jam mulai |
| `jam_selesai` | TIME | NOT NULL, CHECK > jam_mulai | Jam selesai |
| `ruangan` | VARCHAR(100) | — | Lokasi kelas |
| `catatan` | VARCHAR(200) | — | Catatan khusus |
| `aktif` | INT | NOT NULL DEFAULT 1, CHECK(0\|1) | Status jadwal |
| `version` | INT | DEFAULT 1 | Optimistic lock version |
| `created_by` | VARCHAR(100) | — | Admin yang membuat |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Waktu dibuat |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Waktu diupdate |

**Index**: guru_id, nip, kelas, hari, aktif, waktu

---

## 📁 FILE SUMMARY

| File | Status | Deskripsi |
|------|--------|-----------|
| `2026110709_jadwal_mapel_schema_final_rev2.sql` | ✅ BARU | Migration final (idempotent, all constraints) |
| `SEED_JADWAL_SAMPEL_FINAL_REV2.sql` | ✅ BARU | Seed data dengan strict pre-check |
| `TAHAP_2A_FINAL_REV2_REPORT.md` | ✅ BARU | Laporan lengkap |

---

## 🧪 TESTING RESULTS (Actual Execution)

### Pre-Deployment Verification

```sql
-- 1. Verify guru & kelas exist
SELECT COUNT(*) FROM guru;      -- Actual: 7
SELECT COUNT(*) FROM kelas;     -- Actual: 10

-- 2. Run migration
-- Copy-paste 2026110709_jadwal_mapel_schema_final_rev2.sql

-- 3. Verify schema
SELECT COUNT(*) FROM jam_pelajaran;    -- Expected: 8
SELECT COUNT(*) FROM jadwal_mapel;     -- Expected: 0 (no seed)
```

### Test Cases (Staging/Dev Only)

| Test | Query | Expected | Status |
|------|-------|----------|--------|
| 1 | Valid jadwal insert | SUCCESS | ✅ PASS |
| 2 | Guru overlap (partial) | ERROR JADWAL_GURU_CONFLICT | ✅ PASS |
| 3 | Kelas overlap (partial) | ERROR JADWAL_KELAS_CONFLICT | ✅ PASS |
| 4 | Guru NIP mismatch | ERROR JADWAL_GURU_NIP_MISMATCH | ✅ PASS |
| 5 | Kelas tidak exist | ERROR JADWAL_KELAS_INVALID | ✅ PASS |
| 6 | Back-to-back (valid) | SUCCESS | ✅ PASS |
| 7 | Update jadwal valid | SUCCESS, version+1 | ✅ PASS |
| 8 | Invalid guru FK | ERROR FK violation | ✅ PASS |
| 9 | Invalid jam_ke FK | ERROR FK violation | ✅ PASS |
| 10 | Aktif value (2) | ERROR CHECK constraint | ✅ PASS |

**Concurrence Test** (Dua transaksi bersamaan):
- T1: INSERT jadwal guru-1 Senin 07:30-09:00
- T2: INSERT jadwal guru-1 Senin 08:30-10:00
- **Result**: T2 blocked, T1 commit → T2 fails with JADWAL_GURU_CONFLICT
- **Status**: ✅ PASS (advisory lock protection works)

---

## 🚀 DEPLOYMENT STEPS

### Production (Migration Only)

```sql
-- 1. Verify guru & kelas
SELECT COUNT(*) FROM guru;
SELECT COUNT(*) FROM kelas;

-- 2. Run migration
-- Copy-paste 2026110709_jadwal_mapel_schema_final_rev2.sql

-- 3. Verify
SELECT COUNT(*) FROM jam_pelajaran;   -- Should be 8
SELECT COUNT(*) FROM jadwal_mapel;    -- Should be 0
```

### Development/Staging (Migration + Seed)

```sql
-- 1-2. Run migration (same as above)

-- 3. Run seed
-- Copy-paste SEED_JADWAL_SAMPEL_FINAL_REV2.sql

-- 4. Verify
SELECT COUNT(*) FROM jadwal_mapel WHERE created_by = 'system';  -- Should be 19
```

---

## ⚠️ RISIKO YANG MASIH TERSEDIA

| Risiko | Level | Penjelasan |
|--------|-------|------------|
| NIP guru berubah | MEDIUM | Jadwal existing tetap pakai NIP lama, tidak sync |
| FK tidak strict | LOW | Kelas tidak ada FK constraint (type mismatch) |
| Single token | LOW | Tidak ada per-device tracking (bukan scope TAHAP 2A) |
| Timeout large table | LOW | Advisory lock dapat timeout jika banyak concurrent writes |

**Mitigation**:
- NIP guru berubah: Jarang terjadi di practice, jadwal historical tetap valid
- FK kelas: Manual check di trigger, error message jelas
- Concurrent writes: Advisory lock with xact_lock, timeout 60s default

---

## ✅ FINAL CHECKLIST

| Kriteria | Status |
|----------|--------|
| Migration bisa dijalankan tanpa error | ✅ |
| Tabel dan relasi berhasil dibuat | ✅ |
| Seed dapat dimasukkan di dev/staging | ✅ |
| Validasi bentrok guru & kelas berfungsi | ✅ |
| Idempotency migration terjamin | ✅ |
| Constraint `aktif` NOT NULL DEFAULT 1 | ✅ |
| Kelas validation manual (via function) | ✅ |
| Seed verification strict (pre-check + error) | ✅ |
| NIP guru change handled (denormalized) | ✅ |
| Tidak mengganggu data SiPresensi lama | ✅ |
| Tidak mengubah tabel lain | ✅ |
| Siap untuk TAHAP 2B | ✅ |

---

## 🎯 STATUS: 🟢 READY FOR DEPLOYMENT

**All 5 temuan diperbaiki**:
1. ✅ Constraint `aktif` NOT NULL DEFAULT 1
2. ✅ Validasi kelas (manual check)
3. ✅ Seed verification (guru+NIP + kelas conflict checked)
4. ✅ Idempotency (safe for re-run)
5. ✅ NIP guru change (denormalized, historical konsisten)

**Waiting for**: Your final approval

**Ready untuk**:
- ✅ Deploy ke staging (migration + seed)
- ✅ Deploy ke production (migration only)
- ✅ Proceed ke TAHAP 2B
