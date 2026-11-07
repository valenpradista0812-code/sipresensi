BEGIN;

CREATE TABLE IF NOT EXISTS public.pengajuan_izin (
  id VARCHAR(50) PRIMARY KEY,
  nis VARCHAR(20) NOT NULL,
  student_name VARCHAR(100) NOT NULL,
  kelas VARCHAR(30) NOT NULL,
  type VARCHAR(60) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason VARCHAR(300) NOT NULL,
  proof_data TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Menunggu'
    CHECK (status IN ('Menunggu', 'Disetujui', 'Ditolak')),
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMPTZ,
  review_note VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date),
  CHECK (end_date - start_date < 90)
);

CREATE INDEX IF NOT EXISTS pengajuan_izin_nis_created_idx
  ON public.pengajuan_izin (nis, created_at DESC);

CREATE INDEX IF NOT EXISTS pengajuan_izin_status_created_idx
  ON public.pengajuan_izin (status, created_at DESC);

ALTER TABLE public.pengajuan_izin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pengajuan_izin FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pengajuan_izin TO service_role;

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
  v_attendance_status public.absensi.status%TYPE;
BEGIN
  IF p_status NOT IN ('Disetujui', 'Ditolak') THEN
    RAISE EXCEPTION 'INVALID_REVIEW_STATUS';
  END IF;

  UPDATE public.pengajuan_izin
  SET status = p_status,
      reviewed_by = p_reviewer,
      reviewed_at = NOW(),
      review_note = p_review_note,
      updated_at = NOW()
  WHERE id = p_id AND status = 'Menunggu'
  RETURNING * INTO v_application;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPLICATION_ALREADY_REVIEWED_OR_NOT_FOUND';
  END IF;

  IF v_application.end_date - v_application.start_date >= 90 THEN
    RAISE EXCEPTION 'APPLICATION_DURATION_EXCEEDS_LIMIT';
  END IF;

  IF p_status = 'Disetujui' THEN
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
      IF EXTRACT(ISODOW FROM v_date) BETWEEN 1 AND 5 THEN
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
          LEFT(v_application.type || ': ' || v_application.reason, 200)
        )
        ON CONFLICT (nis, date, kelas) DO UPDATE
        SET status = EXCLUDED.status,
            student_name = EXCLUDED.student_name,
            note = EXCLUDED.note
        WHERE public.absensi.status IN ('izin', 'sakit', 'alfa');
      END IF;
    END LOOP;
  END IF;

  RETURN NEXT v_application;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.review_pengajuan_izin(VARCHAR, VARCHAR, VARCHAR, VARCHAR)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_pengajuan_izin(VARCHAR, VARCHAR, VARCHAR, VARCHAR)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
