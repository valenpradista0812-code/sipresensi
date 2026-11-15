-- =====================================================
-- Migrasi: Integrasi Role, Jadwal, dan Absensi
-- File ini hanya membuat perubahan skema. Jangan jalankan
-- otomatis; terapkan manual setelah review.
-- =====================================================

BEGIN;

-- =====================================================
-- 1. guru.user_id - tautkan baris guru ke akun users
-- =====================================================
ALTER TABLE public.guru
  ADD COLUMN IF NOT EXISTS user_id VARCHAR(50) REFERENCES public.users(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'guru'
      AND indexname = 'guru_user_id_key'
  ) THEN
    CREATE UNIQUE INDEX guru_user_id_key ON public.guru(user_id) WHERE user_id IS NOT NULL;
  END IF;
END $$;

-- =====================================================
-- 2. Tautkan guru yang sudah ada melalui NIP
-- =====================================================
UPDATE public.guru g
SET user_id = u.id
FROM public.users u
WHERE g.user_id IS NULL
  AND g.nip <> ''
  AND u.nip = g.nip
  AND u.role IN ('guru', 'admin');

-- =====================================================
-- 3. Buat baris guru untuk akun guru/admin yang belum tertaut
-- =====================================================
DO $$
DECLARE
  u RECORD;
  v_cand1 VARCHAR(50);
  v_cand2 VARCHAR(50);
  v_nip VARCHAR(30);
BEGIN
  FOR u IN
    SELECT id, name, nip, phone, email
    FROM public.users
    WHERE role IN ('guru', 'admin')
  LOOP
    -- Sudah tertaut?
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.guru WHERE user_id = u.id);

    v_cand1 := LEFT('guru-' || u.id, 50);
    v_cand2 := 'guru-' || SUBSTR(MD5(u.id), 1, 16);
    v_nip := COALESCE(NULLIF(u.nip, ''), 'GURU-' || UPPER(SUBSTR(MD5(u.id), 1, 8)));

    IF EXISTS (SELECT 1 FROM public.guru WHERE id = v_cand1) THEN
      IF NOT EXISTS (SELECT 1 FROM public.guru WHERE id = v_cand2) THEN
        INSERT INTO public.guru (id, nip, name, mapel, phone, email, user_id)
        VALUES (v_cand2, v_nip, u.name, 'Belum Ditentukan', u.phone, u.email, u.id);
      ELSE
        RAISE EXCEPTION 'GURU_ID_COLLISION: tidak dapat membuat ID guru unik untuk user %', u.id;
      END IF;
    ELSE
      INSERT INTO public.guru (id, nip, name, mapel, phone, email, user_id)
      VALUES (v_cand1, v_nip, u.name, 'Belum Ditentukan', u.phone, u.email, u.id);
    END IF;
  END LOOP;
END $$;

-- =====================================================
-- 4. kelas.wali_kelas_id - referensi ke guru
-- =====================================================
ALTER TABLE public.kelas
  ADD COLUMN IF NOT EXISTS wali_kelas_id VARCHAR(50) REFERENCES public.guru(id) ON DELETE SET NULL;

UPDATE public.kelas k
SET wali_kelas_id = g.id
FROM public.guru g
WHERE k.wali_kelas_id IS NULL
  AND k.wali_kelas = g.name
  AND (
    SELECT COUNT(*) FROM public.guru g2 WHERE g2.name = k.wali_kelas
  ) = 1;

-- =====================================================
-- 5. pengajuan_izin.reviewed_by_id - jejak reviewer
-- =====================================================
ALTER TABLE public.pengajuan_izin
  ADD COLUMN IF NOT EXISTS reviewed_by_id VARCHAR(50) REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pengajuan_izin_reviewed_by_id_idx
  ON public.pengajuan_izin(reviewed_by_id);

-- =====================================================
-- 6. Overload review_pengajuan_izin dengan p_reviewer_id
--    (fungsi 4-argumen dari 2026110708 tetap ada)
-- =====================================================
CREATE OR REPLACE FUNCTION public.review_pengajuan_izin(
  p_id VARCHAR,
  p_status VARCHAR,
  p_reviewer VARCHAR,
  p_review_note VARCHAR DEFAULT NULL,
  p_reviewer_id VARCHAR DEFAULT NULL
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
      reviewed_by_id = p_reviewer_id,
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

-- =====================================================
-- 7. Guard panjang nama kelas saat rename
-- =====================================================
CREATE OR REPLACE FUNCTION public.kelas_before_rename_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF LENGTH(NEW.name) > 30 THEN
    RAISE EXCEPTION 'KELAS_NAME_TOO_LONG_FOR_REFERENCES: nama kelas maksimal 30 karakter';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kelas_before_rename ON public.kelas;
CREATE TRIGGER trg_kelas_before_rename
  BEFORE UPDATE OF name ON public.kelas
  FOR EACH ROW
  EXECUTE FUNCTION public.kelas_before_rename_guard();

-- =====================================================
-- 8. Cascade rename kelas ke tabel referensi
-- =====================================================
CREATE OR REPLACE FUNCTION public.kelas_after_rename_cascade()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.name IS DISTINCT FROM NEW.name THEN
    IF to_regclass('public.siswa') IS NOT NULL THEN
      UPDATE public.siswa SET kelas = NEW.name WHERE kelas = OLD.name;
    END IF;

    IF to_regclass('public.users') IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'kelas') THEN
      UPDATE public.users SET kelas = NEW.name WHERE kelas = OLD.name AND role = 'siswa';
    END IF;

    IF to_regclass('public.jadwal_mapel') IS NOT NULL THEN
      UPDATE public.jadwal_mapel SET kelas = NEW.name WHERE kelas = OLD.name;
    END IF;

    IF to_regclass('public.absensi') IS NOT NULL THEN
      UPDATE public.absensi SET kelas = NEW.name WHERE kelas = OLD.name;
    END IF;

    IF to_regclass('public.pengajuan_izin') IS NOT NULL THEN
      UPDATE public.pengajuan_izin SET kelas = NEW.name WHERE kelas = OLD.name;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kelas_after_rename ON public.kelas;
CREATE TRIGGER trg_kelas_after_rename
  AFTER UPDATE OF name ON public.kelas
  FOR EACH ROW
  EXECUTE FUNCTION public.kelas_after_rename_cascade();

-- =====================================================
-- 9. Guard delete kelas
-- =====================================================
CREATE OR REPLACE FUNCTION public.kelas_before_delete_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_blockers TEXT := '';
BEGIN
  IF to_regclass('public.siswa') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.siswa WHERE kelas = OLD.name) THEN
    v_blockers := v_blockers || 'siswa, ';
  END IF;

  IF to_regclass('public.users') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'kelas')
     AND EXISTS (SELECT 1 FROM public.users WHERE kelas = OLD.name AND role = 'siswa') THEN
    v_blockers := v_blockers || 'users, ';
  END IF;

  IF to_regclass('public.jadwal_mapel') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.jadwal_mapel WHERE kelas = OLD.name) THEN
    v_blockers := v_blockers || 'jadwal_mapel, ';
  END IF;

  IF to_regclass('public.absensi') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.absensi WHERE kelas = OLD.name) THEN
    v_blockers := v_blockers || 'absensi, ';
  END IF;

  IF to_regclass('public.pengajuan_izin') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.pengajuan_izin WHERE kelas = OLD.name) THEN
    v_blockers := v_blockers || 'pengajuan_izin, ';
  END IF;

  IF v_blockers <> '' THEN
    RAISE EXCEPTION 'KELAS_MASIH_DIPAKAI: % dipakai oleh %', OLD.name, RTRIM(v_blockers, ', ');
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_kelas_before_delete ON public.kelas;
CREATE TRIGGER trg_kelas_before_delete
  BEFORE DELETE ON public.kelas
  FOR EACH ROW
  EXECUTE FUNCTION public.kelas_before_delete_guard();

-- =====================================================
-- 10. Recompute kelas.total_siswa dari tabel siswa
-- =====================================================
CREATE OR REPLACE FUNCTION public.recompute_kelas_total_siswa(p_kelas VARCHAR)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.kelas k
  SET total_siswa = (
    SELECT COUNT(*) FROM public.siswa s WHERE s.kelas = p_kelas
  )
  WHERE k.name = p_kelas;
END;
$$;

CREATE OR REPLACE FUNCTION public.siswa_total_sync_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recompute_kelas_total_siswa(NEW.kelas);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_kelas_total_siswa(OLD.kelas);
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.kelas IS DISTINCT FROM NEW.kelas THEN
      PERFORM public.recompute_kelas_total_siswa(OLD.kelas);
    END IF;
    PERFORM public.recompute_kelas_total_siswa(NEW.kelas);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_siswa_total_sync ON public.siswa;
CREATE TRIGGER trg_siswa_total_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.siswa
  FOR EACH ROW
  EXECUTE FUNCTION public.siswa_total_sync_trigger();

-- =====================================================
-- 11. Sinkronisasi nama guru ke kelas.wali_kelas
-- =====================================================
CREATE OR REPLACE FUNCTION public.guru_name_sync_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.name IS DISTINCT FROM NEW.name THEN
    UPDATE public.kelas SET wali_kelas = NEW.name WHERE wali_kelas_id = NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.kelas SET wali_kelas = 'Belum Ditentukan' WHERE wali_kelas_id = OLD.id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_guru_name_sync ON public.guru;
CREATE TRIGGER trg_guru_name_sync
  AFTER UPDATE OF name OR DELETE ON public.guru
  FOR EACH ROW
  EXECUTE FUNCTION public.guru_name_sync_trigger();

-- =====================================================
-- 12. Reload PostgREST schema cache
-- =====================================================
NOTIFY pgrst, 'reload schema';

COMMIT;