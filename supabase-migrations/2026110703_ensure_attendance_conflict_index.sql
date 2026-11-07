BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.absensi
    GROUP BY nis, date, kelas
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate absensi (nis, date, kelas) rows; resolve duplicates before applying this migration';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS absensi_nis_date_kelas_unique
  ON public.absensi (nis, date, kelas);

NOTIFY pgrst, 'reload schema';

COMMIT;
