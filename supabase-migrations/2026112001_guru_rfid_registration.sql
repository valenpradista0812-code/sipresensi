-- Add account-level RFID registration for teachers, while keeping UIDs unique
-- across teacher and student profiles.

BEGIN;

ALTER TABLE public.guru ADD COLUMN IF NOT EXISTS rfid_uid VARCHAR(50);

DO $$
DECLARE
  v_duplicate_uids TEXT;
BEGIN
  SELECT string_agg(normalized_uid || ' [' || owners || ']', ', ')
  INTO v_duplicate_uids
  FROM (
    SELECT normalized_uid, string_agg(owner, ', ') AS owners
    FROM (
      SELECT
        btrim(regexp_replace(regexp_replace(upper(btrim(rfid_uid)), '(:|[[:space:]])+', '-', 'g'), '-+', '-', 'g'), '-') AS normalized_uid,
        'guru:' || id AS owner
      FROM public.guru
      WHERE rfid_uid IS NOT NULL AND btrim(rfid_uid) <> ''
      UNION ALL
      SELECT
        btrim(regexp_replace(regexp_replace(upper(btrim(rfid_uid)), '(:|[[:space:]])+', '-', 'g'), '-+', '-', 'g'), '-'),
        'siswa:' || id
      FROM public.siswa
      WHERE rfid_uid IS NOT NULL AND btrim(rfid_uid) <> ''
    ) assigned_cards
    GROUP BY normalized_uid
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_duplicate_uids IS NOT NULL THEN
    RAISE EXCEPTION 'UID RFID duplikat lintas akun harus diperbaiki sebelum migrasi: %', v_duplicate_uids;
  END IF;
END $$;

UPDATE public.guru
SET rfid_uid = btrim(regexp_replace(regexp_replace(upper(btrim(rfid_uid)), '(:|[[:space:]])+', '-', 'g'), '-+', '-', 'g'), '-')
WHERE rfid_uid IS NOT NULL AND btrim(rfid_uid) <> '';
UPDATE public.guru SET rfid_uid = NULL WHERE rfid_uid IS NOT NULL AND btrim(rfid_uid) = '';

CREATE UNIQUE INDEX IF NOT EXISTS guru_rfid_uid_normalized_unique
  ON public.guru (
    btrim(regexp_replace(regexp_replace(upper(btrim(rfid_uid)), '(:|[[:space:]])+', '-', 'g'), '-+', '-', 'g'), '-')
  )
  WHERE rfid_uid IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_global_rfid_uid_unique()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid TEXT;
  v_duplicate BOOLEAN;
BEGIN
  IF NEW.rfid_uid IS NULL OR btrim(NEW.rfid_uid) = '' THEN
    NEW.rfid_uid := NULL;
    RETURN NEW;
  END IF;

  v_uid := btrim(regexp_replace(regexp_replace(upper(btrim(NEW.rfid_uid)), '(:|[[:space:]])+', '-', 'g'), '-+', '-', 'g'), '-');
  NEW.rfid_uid := v_uid;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid, 0));

  IF TG_TABLE_NAME = 'guru' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.siswa
      WHERE btrim(regexp_replace(regexp_replace(upper(btrim(rfid_uid)), '(:|[[:space:]])+', '-', 'g'), '-+', '-', 'g'), '-') = v_uid
    ) INTO v_duplicate;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.guru
      WHERE btrim(regexp_replace(regexp_replace(upper(btrim(rfid_uid)), '(:|[[:space:]])+', '-', 'g'), '-+', '-', 'g'), '-') = v_uid
    ) INTO v_duplicate;
  END IF;

  IF v_duplicate THEN
    RAISE EXCEPTION 'UID RFID sudah terdaftar pada akun lain.'
      USING ERRCODE = '23505', CONSTRAINT = 'rfid_uid_global_unique';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guru_global_rfid_uid_insert ON public.guru;
CREATE TRIGGER guru_global_rfid_uid_insert
  BEFORE INSERT ON public.guru
  FOR EACH ROW EXECUTE FUNCTION public.enforce_global_rfid_uid_unique();
DROP TRIGGER IF EXISTS guru_global_rfid_uid_update ON public.guru;
CREATE TRIGGER guru_global_rfid_uid_update
  BEFORE UPDATE OF rfid_uid ON public.guru
  FOR EACH ROW EXECUTE FUNCTION public.enforce_global_rfid_uid_unique();

DROP TRIGGER IF EXISTS siswa_global_rfid_uid_insert ON public.siswa;
CREATE TRIGGER siswa_global_rfid_uid_insert
  BEFORE INSERT ON public.siswa
  FOR EACH ROW EXECUTE FUNCTION public.enforce_global_rfid_uid_unique();
DROP TRIGGER IF EXISTS siswa_global_rfid_uid_update ON public.siswa;
CREATE TRIGGER siswa_global_rfid_uid_update
  BEFORE UPDATE OF rfid_uid ON public.siswa
  FOR EACH ROW EXECUTE FUNCTION public.enforce_global_rfid_uid_unique();

NOTIFY pgrst, 'reload schema';

COMMIT;
