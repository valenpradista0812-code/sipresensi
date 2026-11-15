-- =====================================================
-- Migrasi: Penugasan Siswa per Jadwal
-- =====================================================
-- Menambahkan relasi banyak-ke-banyak antara jadwal_mapel dan siswa.
--
-- Aturan:
--   - Jadwal tanpa baris di jadwal_siswa tetap berlaku untuk seluruh kelas
--     (kompatibel dengan data jadwal lama).
--   - Jadwal dengan baris di jadwal_siswa hanya terlihat oleh siswa yang
--     ditugaskan pada jadwal tersebut.
--
-- File ini TIDAK dijalankan otomatis oleh aplikasi. Tinjau lalu terapkan
-- manual melalui Supabase SQL Editor. Jangan jalankan di produksi tanpa
-- persetujuan dan backup.
-- =====================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.jadwal_siswa (
  jadwal_id VARCHAR(50) NOT NULL REFERENCES public.jadwal_mapel(id) ON DELETE CASCADE,
  siswa_id  VARCHAR(50) NOT NULL REFERENCES public.siswa(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT jadwal_siswa_pkey PRIMARY KEY (jadwal_id, siswa_id)
);

CREATE INDEX IF NOT EXISTS jadwal_siswa_siswa_id_idx
  ON public.jadwal_siswa(siswa_id);

CREATE INDEX IF NOT EXISTS jadwal_siswa_jadwal_id_idx
  ON public.jadwal_siswa(jadwal_id);

-- Backend memakai service role; RLS dimatikan agar konsisten dengan tabel
-- operasional lain. Akses tetap dibatasi oleh route Express.
ALTER TABLE public.jadwal_siswa DISABLE ROW LEVEL SECURITY;

COMMIT;
