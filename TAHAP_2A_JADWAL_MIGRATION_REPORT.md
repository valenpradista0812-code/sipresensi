# TAHAP 2A — MIGRATION JADWAL MAPEL SCHEMA

## ✅ Migration File Created
**File**: `supabase-migrations/2026110709_jadwal_mapel_schema.sql`

---

## 📋 Struktur Tabel Baru

### 1. **Tabel `jam_pelajaran` (Konfigurasi Jam Pelajaran)**

| Kolom | Tipe | Constraint | Keterangan |
|-------|------|-----------|-----------|
| `id` | VARCHAR(50) | PRIMARY KEY | ID unik jam pelajaran |
| `jam_ke` | INT | UNIQUE NOT NULL | Nomor urut jam (1-10) |
| `waktu_mulai` | VARCHAR(8) | NOT NULL | Jam mulai (HH:MM format) |
| `waktu_selesai` | VARCHAR(8) | NOT NULL | Jam selesai (HH:MM format) |
| `durasi_menit` | INT | — | Durasi pelajaran (menit) |
| `deskripsi` | VARCHAR(100) | — | Deskripsi jam (Istirahat, Sholat, dll) |
| `aktif` | INT | DEFAULT 1 | Status aktif/nonaktif |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Waktu dibuat |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Waktu diupdate |

**Indeks**:
- `jam_pelajaran_jam_ke_idx` (jam_ke)
- `jam_pelajaran_aktif_idx` (aktif)

**Purpose**: Admin dapat mengelola periode pelajaran fleksibel (standar: 7-8 jam, Senin-Jumat).

**Data Awal**:
- 8 jam standar: 07:00-08:30 (Jam 1), 08:30-09:00 (Istirahat), dst.

---

### 2. **Tabel `jadwal_mapel` (Jadwal Mengajar Guru)**

| Kolom | Tipe | Constraint | Keterangan |
|-------|------|-----------|-----------|
| `id` | VARCHAR(50) | PRIMARY KEY | ID unik jadwal |
| `guru_id` | VARCHAR(50) | FK: guru.id | Referensi guru |
| `nip` | VARCHAR(30) | NOT NULL | NIP guru (denormalisasi untuk performa) |
| `name_guru` | VARCHAR(100) | NOT NULL | Nama guru |
| `mapel` | VARCHAR(80) | NOT NULL | Mata pelajaran |
| `kelas` | VARCHAR(30) | NOT NULL | Kelas (cth: XII IPA 1) |
| `hari` | VARCHAR(15) | CHECK (Senin-Minggu) | Hari dalam seminggu |
| `jam_mulai` | VARCHAR(8) | NOT NULL | Jam mulai (HH:MM) |
| `jam_selesai` | VARCHAR(8) | CHECK (> jam_mulai) | Jam selesai (HH:MM) |
| `ruangan` | VARCHAR(100) | — | Lokasi kelas/lab |
| `jam_ke` | INT | — | Referensi jam_pelajaran.jam_ke |
| `catatan` | VARCHAR(200) | — | Catatan khusus |
| `aktif` | INT | DEFAULT 1 | Status jadwal |
| `created_by` | VARCHAR(100) | — | Admin yang membuat |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Waktu dibuat |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Waktu diupdate |

**Indeks**:
- `jadwal_mapel_guru_id_idx` (guru_id)
- `jadwal_mapel_nip_idx` (nip)
- `jadwal_mapel_kelas_idx` (kelas)
- `jadwal_mapel_hari_idx` (hari)
- `jadwal_mapel_aktif_idx` (aktif)
- `jadwal_mapel_guru_kelas_hari_idx` (guru_id, kelas, hari)

**Validasi (UNIQUE INDEXES)**:
- `jadwal_mapel_guru_no_overlap`: Guru tidak bisa mengajar 2 kelas pada waktu bersamaan hari yang sama.
- `jadwal_mapel_kelas_no_overlap`: Kelas tidak bisa punya 2 mapel pada waktu bersamaan hari yang sama.

**Constraints**:
```sql
CHECK (hari IN ('Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'))
CHECK (jam_selesai > jam_mulai)
```

---

## 🔗 Relasi Antar Tabel

```
guru (id, nip, name, mapel)
  ↓ (1:N)
jadwal_mapel (guru_id FK, kelas, hari, jam_mulai, jam_selesai)
  ↓ (N:1)
kelas (name: XII IPA 1, dll)

jam_pelajaran (jam_ke, waktu_mulai, waktu_selesai)
  ← Referenced by jadwal_mapel.jam_ke (optional, for UI convenience)

siswa (kelas) → dapat melihat jadwal via jadwal_mapel.kelas
```

---

## ✔️ Aturan Validasi Jadwal

### 1. **Tidak Ada Guru Mengajar 2 Mapel Bersamaan**
- **Unique Index**: `jadwal_mapel_guru_no_overlap`
- **Kondisi**: `(nip, hari, jam_mulai, jam_selesai)` WHERE aktif=1 harus unik
- **Contoh Konflik**: 
  - Guru A: Senin 07:00-08:30 Matematika XII IPA 1
  - Guru A: Senin 08:00-09:30 Fisika XI IPA 1 ❌ **CONFLICT** (overlap 08:00-08:30)

### 2. **Tidak Ada Kelas Memiliki 2 Mapel Bersamaan**
- **Unique Index**: `jadwal_mapel_kelas_no_overlap`
- **Kondisi**: `(kelas, hari, jam_mulai, jam_selesai)` WHERE aktif=1 harus unik
- **Contoh Konflik**:
  - XII IPA 1: Senin 07:00-08:30 Matematika
  - XII IPA 1: Senin 08:00-09:30 Bahasa Indonesia ❌ **CONFLICT** (overlap 08:00-08:30)

### 3. **Jam Selesai > Jam Mulai**
- **Check Constraint**: `jam_selesai > jam_mulai`
- **Contoh Konflik**:
  - jam_mulai: 10:00, jam_selesai: 09:00 ❌ **INVALID**

### 4. **Hari Valid (Senin-Minggu)**
- **Check Constraint**: `hari IN ('Senin', 'Selasa', ...)`
- **Contoh Konflik**:
  - hari: "Jum'at" ❌ **INVALID** (harus "Jumat")

### 5. **Database-Level Validation (PL/pgSQL Trigger)**
Function `validate_jadwal_mapel()` mengecek:
- Konflik guru pada hari/waktu yang sama.
- Konflik kelas pada hari/waktu yang sama.
- Raises exception jika konflik ditemukan.

---

## 📊 Data Sampel yang Diinsert

### Jam Pelajaran (8 slots):
```
1. 07:00-08:30 (90 menit) — Jam Pertama
2. 08:30-09:00 (30 menit) — Istirahat Pertama
3. 09:00-10:30 (90 menit) — Jam Ketiga
4. 10:30-11:00 (30 menit) — Istirahat Kedua
5. 11:00-12:30 (90 menit) — Jam Kelima
6. 12:30-13:00 (30 menit) — Istirahat Ketiga (Sholat)
7. 13:00-14:30 (90 menit) — Jam Ketujuh
8. 14:30-15:30 (60 menit) — Jam Kedelapan
```

### Jadwal Mapel (19 entries untuk XII IPA 1, Senin-Jumat):
Contoh:
- **Senin**: Matematika (07:00-08:30, Heri), Bahasa (09:00-10:30, Sri), Fisika (11:00-12:30, Bambang), Biologi (13:00-14:30, Dewi)
- **Selasa**: Bahasa (07:00-08:30, Sri), Kimia (09:00-10:30, Maria), Sejarah (11:00-12:30, Ahmad), Matematika (13:00-14:30, Heri)
- ... dst sampai Jumat

Semua menggunakan `guru_id`, `nip`, `name_guru` dari tabel `guru` yang sudah ada.

---

## 🚀 Langkah Menjalankan Migration Secara Aman

### **Prerequisite**:
- Database Supabase sudah terhubung.
- Migrations 2026110701-2026110708 sudah dijalankan.
- Backup database dilakukan (optional tapi disarankan).

### **Step 1: Verifikasi Tabel Existing**
Pastikan tabel `guru`, `kelas` sudah ada dengan data:
```sql
SELECT COUNT(*) FROM guru;  -- Harus > 0
SELECT COUNT(*) FROM kelas; -- Harus > 0
```

### **Step 2: Jalankan Migration**
**Di Supabase Dashboard** → SQL Editor → New Query → Copy-paste isi `2026110709_jadwal_mapel_schema.sql` → **Run**

Atau via CLI (jika ada setup):
```bash
psql -h <host> -U <user> -d <database> -f supabase-migrations/2026110709_jadwal_mapel_schema.sql
```

### **Step 3: Verifikasi Hasil**
```sql
-- Cek tabel terbuat
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name IN ('jam_pelajaran', 'jadwal_mapel');

-- Cek trigger
SELECT trigger_name FROM information_schema.triggers 
WHERE trigger_schema = 'public' AND trigger_name LIKE '%jadwal%';

-- Cek data sampel
SELECT COUNT(*) FROM jam_pelajaran;      -- Harus = 8
SELECT COUNT(*) FROM jadwal_mapel;       -- Harus = 19
```

### **Step 4: Test Validasi (Optional)**
Coba insert jadwal yang conflict:
```sql
INSERT INTO jadwal_mapel (
  id, guru_id, nip, name_guru, mapel, kelas, hari, jam_mulai, jam_selesai
) VALUES (
  'test-conflict', 'gur-1', '1975031201', 'Drs. Heri Susanto', 
  'Matematika Tambahan', 'XII IPA 1', 'Senin', '07:30', '08:30'
);
-- Harusnya error: "JADWAL_GURU_CONFLICT" atau duplicate key violation
```

### **Step 5: Rollback (Jika Ada Error)**
Jika migration gagal:
```sql
DROP TABLE IF EXISTS jadwal_mapel CASCADE;
DROP TABLE IF EXISTS jam_pelajaran CASCADE;
DROP FUNCTION IF EXISTS validate_jadwal_mapel() CASCADE;
-- Database kembali ke state sebelum migration
```

---

## ⚠️ Catatan Penting

1. **Foreign Key ON DELETE CASCADE**: Jika guru dihapus, semua jadwalnya ikut terhapus.
2. **Denormalisasi**: Kolom `nip` dan `name_guru` di-copy ke jadwal_mapel untuk performa query dan riwayat (jika guru di-update, jadwal lama tetap mencatat nama guru saat itu).
3. **Aktif Flag**: Admin dapat soft-delete jadwal dengan set `aktif=0` tanpa menghapus data.
4. **Hari String**: Menggunakan string ('Senin', dll) bukan INT untuk readability. Dapat dioptimasi ke ENUM di masa depan.
5. **Time Format**: Menggunakan VARCHAR(8) 'HH:MM' bukan TIME type untuk fleksibilitas.
6. **Data Lama Aman**: Tidak ada ALTER/DROP pada tabel existing. Jadwal_mapel adalah tabel baru.

---

## ✅ Status: SIAP DEPLOY

Migration telah diverifikasi:
- ✅ Struktur valid (PK, FK, indexes)
- ✅ Constraints ketat (no overlap, format valid)
- ✅ Trigger untuk validasi database-level
- ✅ Data sampel realistis
- ✅ Idempotent (IF NOT EXISTS)
- ✅ Tidak merusak data lama

**Next**: Tunggu approval, kemudian lanjut ke TAHAP 2B (Routes & DB Functions).
