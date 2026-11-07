BEGIN;

ALTER TABLE siswa
  ADD COLUMN IF NOT EXISTS rfid_uid VARCHAR(50);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM siswa
    WHERE rfid_uid IS NOT NULL
    GROUP BY rfid_uid
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate siswa.rfid_uid values; resolve before migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM absensi
    GROUP BY nis, date, kelas
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate absensi (nis, date, kelas) rows; resolve before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS siswa_rfid_uid_unique
  ON siswa (rfid_uid)
  WHERE rfid_uid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS absensi_nis_date_kelas_unique
  ON absensi (nis, date, kelas);

COMMIT;
