-- Allow students to be unassigned and save class membership atomically.
-- Run after 2026111801_kelas_referential_integrity.sql.

BEGIN;

DO $$
DECLARE
  v_duplicate_wali TEXT;
BEGIN
  SELECT string_agg(duplicate_wali, ', ')
  INTO v_duplicate_wali
  FROM (
    SELECT g.name || ' (' || g.id || ')' AS duplicate_wali
    FROM public.guru g
    JOIN public.kelas k ON k.wali_kelas_id = g.id
    GROUP BY g.id, g.name
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_duplicate_wali IS NOT NULL THEN
    RAISE EXCEPTION 'Guru wali kelas ganda harus diperbaiki sebelum migrasi: %', v_duplicate_wali;
  END IF;
END $$;

ALTER TABLE public.siswa ALTER COLUMN kelas DROP NOT NULL;
UPDATE public.siswa SET rfid_uid = NULL WHERE rfid_uid IS NOT NULL AND btrim(rfid_uid) = '';

DO $$
DECLARE
  v_duplicate_uids TEXT;
BEGIN
  SELECT string_agg(normalized_uid || ' [' || student_ids || ']', ', ')
  INTO v_duplicate_uids
  FROM (
    SELECT
      btrim(regexp_replace(regexp_replace(upper(btrim(rfid_uid)), '(:|[[:space:]])+', '-', 'g'), '-+', '-', 'g'), '-') AS normalized_uid,
      string_agg(id, ', ') AS student_ids
    FROM public.siswa
    WHERE rfid_uid IS NOT NULL AND btrim(rfid_uid) <> ''
    GROUP BY btrim(regexp_replace(regexp_replace(upper(btrim(rfid_uid)), '(:|[[:space:]])+', '-', 'g'), '-+', '-', 'g'), '-')
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_duplicate_uids IS NOT NULL THEN
    RAISE EXCEPTION 'UID RFID duplikat setelah normalisasi harus diperbaiki sebelum migrasi: %', v_duplicate_uids;
  END IF;
END $$;

UPDATE public.siswa
SET rfid_uid = btrim(regexp_replace(regexp_replace(upper(btrim(rfid_uid)), '(:|[[:space:]])+', '-', 'g'), '-+', '-', 'g'), '-')
WHERE rfid_uid IS NOT NULL AND btrim(rfid_uid) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS siswa_rfid_uid_normalized_unique
  ON public.siswa (
    btrim(regexp_replace(regexp_replace(upper(btrim(rfid_uid)), '(:|[[:space:]])+', '-', 'g'), '-+', '-', 'g'), '-')
  )
  WHERE rfid_uid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS kelas_wali_kelas_id_unique
  ON public.kelas (wali_kelas_id)
  WHERE wali_kelas_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.save_kelas_roster(
  p_class_id VARCHAR,
  p_name VARCHAR,
  p_wali_kelas_id VARCHAR,
  p_ruangan VARCHAR,
  p_student_ids TEXT[],
  p_create BOOLEAN DEFAULT FALSE
)
RETURNS SETOF public.kelas
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class public.kelas%ROWTYPE;
  v_wali_name VARCHAR(100);
  v_student_ids TEXT[] := COALESCE(p_student_ids, ARRAY[]::TEXT[]);
  v_found_count BIGINT;
  v_unique_count BIGINT;
BEGIN
  IF p_class_id IS NULL OR length(btrim(p_class_id)) = 0
     OR p_name IS NULL OR length(btrim(p_name)) = 0 OR length(btrim(p_name)) > 50
     OR length(COALESCE(p_ruangan, '')) > 100 THEN
    RAISE EXCEPTION 'DATA_KELAS_TIDAK_VALID' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT selected.student_id) INTO v_unique_count
  FROM unnest(v_student_ids) AS selected(student_id);
  IF v_unique_count <> cardinality(v_student_ids) THEN
    RAISE EXCEPTION 'SISWA_DUPLIKAT' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_found_count
  FROM public.siswa
  WHERE id = ANY(v_student_ids);
  IF v_found_count <> cardinality(v_student_ids) THEN
    RAISE EXCEPTION 'SISWA_TIDAK_DITEMUKAN' USING ERRCODE = '23503';
  END IF;

  IF p_wali_kelas_id IS NOT NULL THEN
    SELECT name INTO v_wali_name
    FROM public.guru
    WHERE id = p_wali_kelas_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'GURU_WALI_TIDAK_DITEMUKAN' USING ERRCODE = '23503';
    END IF;
  ELSE
    v_wali_name := 'Belum Ditentukan';
  END IF;

  -- Serialize roster writes so concurrent transfers cannot leave stale counts or assignments.
  PERFORM id FROM public.kelas ORDER BY id FOR UPDATE;

  IF p_wali_kelas_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.kelas
    WHERE wali_kelas_id = p_wali_kelas_id
      AND (p_create OR id <> p_class_id)
  ) THEN
    RAISE EXCEPTION 'WALI_KELAS_SUDAH_DIPAKAI' USING ERRCODE = '23514';
  END IF;

  IF p_create THEN
    INSERT INTO public.kelas (id, name, total_siswa, wali_kelas, wali_kelas_id, ruangan)
    VALUES (p_class_id, btrim(p_name), 0, v_wali_name, p_wali_kelas_id, COALESCE(NULLIF(btrim(p_ruangan), ''), '-'))
    RETURNING * INTO v_class;
  ELSE
    SELECT * INTO v_class
    FROM public.kelas
    WHERE id = p_class_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'KELAS_TIDAK_DITEMUKAN' USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.kelas
    SET name = btrim(p_name),
        wali_kelas = v_wali_name,
        wali_kelas_id = p_wali_kelas_id,
        ruangan = COALESCE(NULLIF(btrim(p_ruangan), ''), '-')
    WHERE id = p_class_id
    RETURNING * INTO v_class;
  END IF;

  PERFORM id
  FROM public.siswa
  WHERE kelas = v_class.name OR id = ANY(v_student_ids)
  ORDER BY id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_found_count
  FROM public.siswa
  WHERE id = ANY(v_student_ids);
  IF v_found_count <> cardinality(v_student_ids) THEN
    RAISE EXCEPTION 'SISWA_TIDAK_DITEMUKAN' USING ERRCODE = '23503';
  END IF;

  UPDATE public.users u
  SET kelas = NULL, title = 'Siswa'
  FROM public.siswa s
  WHERE u.role = 'siswa'
    AND u.nis = s.nis
    AND s.kelas = v_class.name
    AND NOT (s.id = ANY(v_student_ids));

  UPDATE public.siswa
  SET kelas = NULL
  WHERE kelas = v_class.name
    AND NOT (id = ANY(v_student_ids));

  UPDATE public.siswa
  SET kelas = v_class.name
  WHERE id = ANY(v_student_ids);

  UPDATE public.users u
  SET kelas = v_class.name, title = 'Siswa - ' || v_class.name
  FROM public.siswa s
  WHERE u.role = 'siswa'
    AND u.nis = s.nis
    AND s.id = ANY(v_student_ids);

  UPDATE public.kelas
  SET total_siswa = (SELECT COUNT(*) FROM public.siswa WHERE kelas = v_class.name)
  WHERE id = p_class_id;

  RETURN QUERY SELECT * FROM public.kelas WHERE id = p_class_id;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
