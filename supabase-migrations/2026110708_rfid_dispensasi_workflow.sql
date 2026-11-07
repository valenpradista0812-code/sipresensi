BEGIN;

CREATE OR REPLACE FUNCTION public.review_pengajuan_izin(
  p_id VARCHAR,
  p_status VARCHAR,
  p_reviewer VARCHAR,
  p_review_note VARCHAR DEFAULT NULL
)
RETURNS SETOF public.pengajuan_izin
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_application public.pengajuan_izin%ROWTYPE;
  v_date DATE;
  v_duration_days INTEGER;
  v_rows_affected INTEGER;
  v_attendance_status public.absensi.status%TYPE;
  v_application_status VARCHAR(30);
BEGIN
  IF p_status NOT IN ('Disetujui', 'Ditolak') THEN
    RAISE EXCEPTION 'INVALID_REVIEW_STATUS';
  END IF;

  IF p_status = 'Disetujui' THEN
    v_application_status := CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.pengajuan_izin AS requested
        WHERE requested.id = p_id
          AND requested.same_day = TRUE
          AND LOWER(requested.type) = 'dispensasi'
      ) THEN 'Disetujui - Menunggu Tap'
      ELSE 'Disetujui'
    END;
  ELSE
    v_application_status := 'Ditolak';
  END IF;

  UPDATE public.pengajuan_izin
  SET status = v_application_status,
      reviewed_by = p_reviewer,
      reviewed_at = NOW(),
      review_note = p_review_note,
      updated_at = NOW()
  WHERE id = p_id AND status = 'Menunggu'
  RETURNING * INTO v_application;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPLICATION_ALREADY_REVIEWED_OR_NOT_FOUND';
  END IF;

  v_duration_days := v_application.end_date - v_application.start_date + 1;
  IF NOT (v_application.same_day AND LOWER(v_application.type) = 'dispensasi')
     AND v_duration_days > 90 THEN
    RAISE EXCEPTION 'APPLICATION_DURATION_EXCEEDS_LIMIT';
  END IF;

  IF p_status = 'Disetujui'
     AND NOT (v_application.same_day AND LOWER(v_application.type) = 'dispensasi') THEN
    v_attendance_status := CASE
      WHEN LOWER(v_application.type) = 'sakit' THEN 'sakit'
      ELSE 'izin'
    END;

    FOR v_date IN
      SELECT day_value::DATE
      FROM generate_series(
        v_application.start_date::TIMESTAMP,
        v_application.end_date::TIMESTAMP,
        INTERVAL '1 day'
      ) AS days(day_value)
    LOOP
      INSERT INTO public.absensi (
        id, date, kelas, mapel, nis, student_name, status, check_in, check_out, note
      )
      VALUES (
        'izin-' || MD5(v_application.id || v_date::TEXT),
        v_date,
        v_application.kelas,
        NULL,
        v_application.nis,
        v_application.student_name,
        v_attendance_status,
        '-',
        '-',
        LEFT(
          FORMAT(
            '%s (%s hari, %s s.d. %s): %s',
            v_application.type,
            v_duration_days,
            v_application.start_date,
            v_application.end_date,
            v_application.reason
          ),
          200
        )
      )
      ON CONFLICT (nis, date, kelas) DO UPDATE
      SET status = EXCLUDED.status,
          student_name = EXCLUDED.student_name,
          note = EXCLUDED.note
      WHERE public.absensi.status IN ('izin', 'sakit', 'alfa');

      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      IF v_rows_affected = 0 THEN
        RAISE EXCEPTION 'ATTENDANCE_ALREADY_RECORDED_AS_PRESENT';
      END IF;
    END LOOP;
  END IF;

  RETURN NEXT v_application;
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_dispensasi_rfid(
  p_nis VARCHAR,
  p_kelas VARCHAR,
  p_student_name VARCHAR,
  p_event_id VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_application public.pengajuan_izin%ROWTYPE;
  v_now TIMESTAMPTZ := CLOCK_TIMESTAMP();
  v_local_now TIMESTAMP;
  v_target_local TIMESTAMP;
  v_local_date DATE;
  v_attendance_status public.absensi.status%TYPE;
  v_elapsed_seconds INTEGER;
  v_note VARCHAR(200);
  v_last_tap_at TIMESTAMPTZ;
BEGIN
  IF p_nis IS NULL OR BTRIM(p_nis) = '' THEN
    RAISE EXCEPTION 'DISPENSATION_STUDENT_NIS_REQUIRED';
  END IF;

  IF p_event_id IS NOT NULL AND LENGTH(p_event_id) > 100 THEN
    RAISE EXCEPTION 'DISPENSATION_EVENT_ID_INVALID';
  END IF;

  SELECT last_dispensasi_tap_at
  INTO v_last_tap_at
  FROM public.siswa
  WHERE nis = p_nis
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_event_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.pengajuan_izin
    WHERE start_event_id = p_event_id OR return_event_id = p_event_id
  ) THEN
    RETURN JSONB_BUILD_OBJECT('action', 'duplicate', 'eventId', p_event_id);
  END IF;

  IF v_last_tap_at IS NOT NULL AND v_last_tap_at > v_now - INTERVAL '10 seconds' THEN
    RETURN JSONB_BUILD_OBJECT('action', 'debounced');
  END IF;

  SELECT *
  INTO v_application
  FROM public.pengajuan_izin
  WHERE nis = p_nis
    AND same_day = TRUE
    AND LOWER(type) = 'dispensasi'
    AND started_at IS NOT NULL
    AND returned_at IS NULL
  ORDER BY started_at
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.siswa
    SET last_dispensasi_tap_at = v_now
    WHERE nis = p_nis;

    v_elapsed_seconds := GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM (v_now - v_application.started_at)))::INTEGER
    );
    v_attendance_status := CASE
      WHEN v_now <= v_application.target_end_at THEN 'hadir'
      ELSE 'terlambat'
    END;
    v_note := LEFT(
      FORMAT(
        'Dispensasi | durasi: %s menit | mulai: %s WIB | target: %s WIB | kembali: %s WIB | aktual: %s menit | alasan: %s',
        v_application.duration_minutes,
        TO_CHAR(v_application.started_at AT TIME ZONE 'Asia/Jakarta', 'HH24:MI'),
        TO_CHAR(v_application.target_end_at AT TIME ZONE 'Asia/Jakarta', 'HH24:MI'),
        TO_CHAR(v_now AT TIME ZONE 'Asia/Jakarta', 'HH24:MI'),
        FLOOR(v_elapsed_seconds / 60.0)::INTEGER,
        v_application.reason
      ),
      200
    );

    UPDATE public.pengajuan_izin
    SET returned_at = v_now,
        actual_seconds = v_elapsed_seconds,
        return_event_id = p_event_id,
        updated_at = v_now
    WHERE id = v_application.id
    RETURNING * INTO v_application;

    UPDATE public.absensi
    SET status = v_attendance_status,
        note = v_note
    WHERE nis = v_application.nis
      AND kelas = v_application.kelas
      AND date = v_application.start_date;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DISPENSATION_ATTENDANCE_RECORD_NOT_FOUND';
    END IF;

    RETURN JSONB_BUILD_OBJECT(
      'action', 'ended',
      'status', v_attendance_status::TEXT,
      'application', TO_JSONB(v_application),
      'attendanceDate', v_application.start_date,
      'returnedAt', v_application.returned_at,
      'actualSeconds', v_application.actual_seconds,
      'targetEndAt', v_application.target_end_at
    );
  END IF;

  v_local_now := v_now AT TIME ZONE 'Asia/Jakarta';
  v_local_date := v_local_now::DATE;

  SELECT *
  INTO v_application
  FROM public.pengajuan_izin
  WHERE nis = p_nis
    AND kelas = p_kelas
    AND same_day = TRUE
    AND LOWER(type) = 'dispensasi'
    AND status = 'Disetujui - Menunggu Tap'
    AND start_date = v_local_date
    AND duration_minutes BETWEEN 1 AND 1440
    AND started_at IS NULL
  ORDER BY reviewed_at, created_at
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.siswa
  SET last_dispensasi_tap_at = v_now
  WHERE nis = p_nis;

  v_target_local := v_local_now + (v_application.duration_minutes * INTERVAL '1 minute');
  IF v_target_local::DATE <> v_local_date THEN
    RAISE EXCEPTION 'DISPENSATION_DURATION_EXCEEDS_REMAINING_DAY';
  END IF;

  UPDATE public.pengajuan_izin
  SET status = 'Disetujui',
      started_at = v_now,
      target_end_at = v_target_local AT TIME ZONE 'Asia/Jakarta',
      start_event_id = p_event_id,
      updated_at = v_now
  WHERE id = v_application.id
  RETURNING * INTO v_application;

  v_note := LEFT(
    FORMAT(
      'Dispensasi | durasi: %s menit | mulai: %s WIB | target: %s WIB | alasan: %s',
      v_application.duration_minutes,
      TO_CHAR(v_application.started_at AT TIME ZONE 'Asia/Jakarta', 'HH24:MI'),
      TO_CHAR(v_application.target_end_at AT TIME ZONE 'Asia/Jakarta', 'HH24:MI'),
      v_application.reason
    ),
    200
  );

  INSERT INTO public.absensi (
    id, date, kelas, mapel, nis, student_name, status, check_in, check_out, note
  )
  VALUES (
    'disp-' || MD5(v_application.id),
    v_application.start_date,
    v_application.kelas,
    'RFID',
    v_application.nis,
    p_student_name,
    'dispensasi',
    '-',
    '-',
    v_note
  )
  ON CONFLICT (nis, date, kelas) DO UPDATE
  SET status = EXCLUDED.status,
      student_name = EXCLUDED.student_name,
      note = EXCLUDED.note;

  RETURN JSONB_BUILD_OBJECT(
    'action', 'started',
    'status', 'dispensasi',
    'application', TO_JSONB(v_application),
    'attendanceDate', v_application.start_date,
    'startedAt', v_application.started_at,
    'targetEndAt', v_application.target_end_at,
    'durationMinutes', v_application.duration_minutes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_pengajuan_izin(VARCHAR, VARCHAR, VARCHAR, VARCHAR)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_pengajuan_izin(VARCHAR, VARCHAR, VARCHAR, VARCHAR)
  TO service_role;

REVOKE ALL ON FUNCTION public.process_dispensasi_rfid(VARCHAR, VARCHAR, VARCHAR, VARCHAR)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_dispensasi_rfid(VARCHAR, VARCHAR, VARCHAR, VARCHAR)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
