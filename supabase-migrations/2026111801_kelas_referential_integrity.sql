-- =====================================================
-- Relasi kelas: perubahan nama tersinkron dan penghapusan dibatasi
-- Referensi lama dipetakan ke kelas yang sesuai atau dipulihkan sebagai kelas baru.
-- =====================================================

BEGIN;

ALTER TABLE public.users ALTER COLUMN kelas TYPE VARCHAR(50);
ALTER TABLE public.siswa ALTER COLUMN kelas TYPE VARCHAR(50);
ALTER TABLE public.absensi ALTER COLUMN kelas TYPE VARCHAR(50);
ALTER TABLE public.jadwal_mapel ALTER COLUMN kelas TYPE VARCHAR(50);
ALTER TABLE public.pengajuan_izin ALTER COLUMN kelas TYPE VARCHAR(50);

-- Canonicalize case/edge-space variants against existing class names. Missing
-- class names are restored from references so historical records remain intact.
DO $$
DECLARE
  v_class RECORD;
BEGIN
  FOR v_class IN
    WITH referenced_classes AS (
      SELECT kelas FROM public.users WHERE kelas IS NOT NULL
      UNION
      SELECT kelas FROM public.siswa WHERE kelas IS NOT NULL
      UNION
      SELECT kelas FROM public.absensi WHERE kelas IS NOT NULL
      UNION
      SELECT kelas FROM public.jadwal_mapel WHERE kelas IS NOT NULL
      UNION
      SELECT kelas FROM public.pengajuan_izin WHERE kelas IS NOT NULL
    )
    SELECT
      lower(btrim(r.kelas)) AS normalized_name,
      COALESCE(MIN(k.name), MIN(btrim(r.kelas))) AS canonical_name,
      BOOL_OR(k.id IS NOT NULL) AS class_exists
    FROM referenced_classes r
    LEFT JOIN public.kelas k ON lower(btrim(k.name)) = lower(btrim(r.kelas))
    WHERE btrim(r.kelas) <> ''
    GROUP BY lower(btrim(r.kelas))
    ORDER BY lower(btrim(r.kelas))
  LOOP
    IF length(v_class.canonical_name) > 50 THEN
      RAISE EXCEPTION 'Nama kelas referensi melebihi 50 karakter: %', v_class.canonical_name;
    END IF;

    UPDATE public.users
    SET kelas = v_class.canonical_name
    WHERE lower(btrim(kelas)) = v_class.normalized_name
      AND kelas IS DISTINCT FROM v_class.canonical_name;
    UPDATE public.siswa
    SET kelas = v_class.canonical_name
    WHERE lower(btrim(kelas)) = v_class.normalized_name
      AND kelas IS DISTINCT FROM v_class.canonical_name;
    UPDATE public.absensi
    SET kelas = v_class.canonical_name
    WHERE lower(btrim(kelas)) = v_class.normalized_name
      AND kelas IS DISTINCT FROM v_class.canonical_name;
    UPDATE public.jadwal_mapel
    SET kelas = v_class.canonical_name
    WHERE lower(btrim(kelas)) = v_class.normalized_name
      AND kelas IS DISTINCT FROM v_class.canonical_name;
    UPDATE public.pengajuan_izin
    SET kelas = v_class.canonical_name
    WHERE lower(btrim(kelas)) = v_class.normalized_name
      AND kelas IS DISTINCT FROM v_class.canonical_name;

    IF NOT v_class.class_exists THEN
      INSERT INTO public.kelas (id, name, total_siswa, wali_kelas, ruangan)
      VALUES (
        'kls-migrasi-' || md5(v_class.canonical_name),
        v_class.canonical_name,
        (SELECT COUNT(*)::INT FROM public.siswa WHERE kelas = v_class.canonical_name),
        'Belum Ditentukan',
        '-'
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  v_orphans TEXT;
  v_duplicates TEXT;
BEGIN
  SELECT string_agg(source || '=' || kelas || ' (' || jumlah || ')', ', ')
  INTO v_orphans
  FROM (
    SELECT 'users' AS source, u.kelas, COUNT(*) AS jumlah
    FROM public.users u LEFT JOIN public.kelas k ON k.name = u.kelas
    WHERE u.kelas IS NOT NULL AND k.id IS NULL GROUP BY u.kelas
    UNION ALL
    SELECT 'siswa', s.kelas, COUNT(*)
    FROM public.siswa s LEFT JOIN public.kelas k ON k.name = s.kelas
    WHERE k.id IS NULL GROUP BY s.kelas
    UNION ALL
    SELECT 'absensi', a.kelas, COUNT(*)
    FROM public.absensi a LEFT JOIN public.kelas k ON k.name = a.kelas
    WHERE k.id IS NULL GROUP BY a.kelas
    UNION ALL
    SELECT 'jadwal_mapel', j.kelas, COUNT(*)
    FROM public.jadwal_mapel j LEFT JOIN public.kelas k ON k.name = j.kelas
    WHERE k.id IS NULL GROUP BY j.kelas
    UNION ALL
    SELECT 'pengajuan_izin', i.kelas, COUNT(*)
    FROM public.pengajuan_izin i LEFT JOIN public.kelas k ON k.name = i.kelas
    WHERE k.id IS NULL GROUP BY i.kelas
  ) missing;

  IF v_orphans IS NOT NULL THEN
    RAISE EXCEPTION 'Referensi kelas yatim harus diperbaiki sebelum migrasi: %', v_orphans;
  END IF;

  IF EXISTS (SELECT 1 FROM public.kelas WHERE length(btrim(name)) = 0) THEN
    RAISE EXCEPTION 'Nama kelas kosong harus diperbaiki sebelum migrasi.';
  END IF;

  SELECT string_agg(names, ', ')
  INTO v_duplicates
  FROM (
    SELECT string_agg(name, ' / ') AS names
    FROM public.kelas
    GROUP BY lower(btrim(name))
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'Nama kelas duplikat (abaikan kapital/spasi) harus diperbaiki sebelum migrasi: %', v_duplicates;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'kelas_name_nonblank_check'
      AND conrelid = 'public.kelas'::regclass
  ) THEN
    ALTER TABLE public.kelas
      ADD CONSTRAINT kelas_name_nonblank_check CHECK (length(btrim(name)) > 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.kelas_before_rename_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF LENGTH(NEW.name) > 50 THEN
    RAISE EXCEPTION 'KELAS_NAME_TOO_LONG_FOR_REFERENCES: nama kelas maksimal 50 karakter';
  END IF;
  RETURN NEW;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS kelas_name_normalized_unique
  ON public.kelas (lower(btrim(name)));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_kelas_fkey' AND conrelid = 'public.users'::regclass) THEN
    ALTER TABLE public.users ADD CONSTRAINT users_kelas_fkey
      FOREIGN KEY (kelas) REFERENCES public.kelas(name) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'siswa_kelas_fkey' AND conrelid = 'public.siswa'::regclass) THEN
    ALTER TABLE public.siswa ADD CONSTRAINT siswa_kelas_fkey
      FOREIGN KEY (kelas) REFERENCES public.kelas(name) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'absensi_kelas_fkey' AND conrelid = 'public.absensi'::regclass) THEN
    ALTER TABLE public.absensi ADD CONSTRAINT absensi_kelas_fkey
      FOREIGN KEY (kelas) REFERENCES public.kelas(name) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jadwal_mapel_kelas_fkey' AND conrelid = 'public.jadwal_mapel'::regclass) THEN
    ALTER TABLE public.jadwal_mapel ADD CONSTRAINT jadwal_mapel_kelas_fkey
      FOREIGN KEY (kelas) REFERENCES public.kelas(name) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pengajuan_izin_kelas_fkey' AND conrelid = 'public.pengajuan_izin'::regclass) THEN
    ALTER TABLE public.pengajuan_izin ADD CONSTRAINT pengajuan_izin_kelas_fkey
      FOREIGN KEY (kelas) REFERENCES public.kelas(name) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
