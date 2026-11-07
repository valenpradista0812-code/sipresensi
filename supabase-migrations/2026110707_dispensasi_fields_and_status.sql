BEGIN;

ALTER TABLE public.pengajuan_izin
  ALTER COLUMN status TYPE VARCHAR(30),
  ADD COLUMN IF NOT EXISTS same_day BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS target_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS start_event_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS return_event_id VARCHAR(100);

ALTER TABLE public.siswa
  ADD COLUMN IF NOT EXISTS last_dispensasi_tap_at TIMESTAMPTZ;

ALTER TABLE public.pengajuan_izin
  DROP CONSTRAINT IF EXISTS pengajuan_izin_status_check,
  DROP CONSTRAINT IF EXISTS pengajuan_izin_duration_minutes_check,
  DROP CONSTRAINT IF EXISTS pengajuan_izin_actual_seconds_check;

ALTER TABLE public.pengajuan_izin
  ADD CONSTRAINT pengajuan_izin_status_check
    CHECK (status IN ('Menunggu', 'Disetujui', 'Ditolak', 'Disetujui - Menunggu Tap')),
  ADD CONSTRAINT pengajuan_izin_duration_minutes_check
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440),
  ADD CONSTRAINT pengajuan_izin_actual_seconds_check
    CHECK (actual_seconds IS NULL OR actual_seconds >= 0);

CREATE INDEX IF NOT EXISTS pengajuan_izin_dispensasi_nis_status_idx
  ON public.pengajuan_izin (nis, status, start_date)
  WHERE same_day = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS pengajuan_izin_one_active_dispensasi_per_nis
  ON public.pengajuan_izin (nis)
  WHERE same_day = TRUE AND started_at IS NOT NULL AND returned_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pengajuan_izin_start_event_id_unique
  ON public.pengajuan_izin (start_event_id)
  WHERE start_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pengajuan_izin_return_event_id_unique
  ON public.pengajuan_izin (return_event_id)
  WHERE return_event_id IS NOT NULL;

DO $$
DECLARE
  v_enum_schema TEXT;
  v_enum_name TEXT;
BEGIN
  SELECT enum_namespace.nspname, enum_type.typname
  INTO v_enum_schema, v_enum_name
  FROM pg_attribute AS column_info
  JOIN pg_type AS enum_type ON enum_type.oid = column_info.atttypid
  JOIN pg_namespace AS enum_namespace ON enum_namespace.oid = enum_type.typnamespace
  WHERE column_info.attrelid = 'public.absensi'::REGCLASS
    AND column_info.attname = 'status'
    AND enum_type.typtype = 'e';

  IF v_enum_name IS NOT NULL THEN
    EXECUTE FORMAT('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L', v_enum_schema, v_enum_name, 'dispensasi');
    EXECUTE FORMAT('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L', v_enum_schema, v_enum_name, 'terlambat');
  END IF;
END $$;

COMMIT;
