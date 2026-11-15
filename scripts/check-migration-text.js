const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase-migrations', '2026111301_role_jadwal_integration.sql'), 'utf8');

const required = [
  'BEGIN;',
  'COMMIT;',
  'ADD COLUMN IF NOT EXISTS user_id VARCHAR(50)',
  'ADD COLUMN IF NOT EXISTS wali_kelas_id VARCHAR(50)',
  'ADD COLUMN IF NOT EXISTS reviewed_by_id VARCHAR(50)',
  'p_reviewer_id VARCHAR DEFAULT NULL',
  'GURU_ID_COLLISION',
  'KELAS_MASIH_DIPAKAI',
  'KELAS_NAME_TOO_LONG_FOR_REFERENCES',
  'AFTER UPDATE OF name',
  'BEFORE DELETE',
  'ON DELETE RESTRICT',
  'reviewed_by_id = p_reviewer_id',
  'NOTIFY pgrst'
];

for (const fragment of required) {
  assert.ok(sql.includes(fragment), `Migrasi harus memuat: ${fragment}`);
}

assert.ok(!/DROP TABLE/i.test(sql), 'Migrasi tidak boleh DROP TABLE');
assert.ok(!/TRUNCATE/i.test(sql), 'Migrasi tidak boleh TRUNCATE');
assert.ok(!/CREATE TYPE .*role/i.test(sql), 'Migrasi tidak boleh membuat enum peran');
assert.ok(!/process_dispensasi_rfid/i.test(sql), 'Migrasi tidak boleh menyentuh process_dispensasi_rfid');

// Cek jumlah placeholder RAISE pada migrasi jadwal aktif agar tidak gagal
// kompilasi PL/pgSQL (mis. 5 placeholder dengan 4 argumen).
const jadwalSql = fs.readFileSync(path.join(__dirname, '..', 'supabase-migrations', '2026110709_jadwal_mapel_schema_final_rev3.sql'), 'utf8');
for (const marker of ['JADWAL_GURU_CONFLICT', 'JADWAL_KELAS_CONFLICT']) {
  const line = jadwalSql.split('\n').find((row) => row.includes(marker) && row.includes('RAISE EXCEPTION'));
  assert.ok(line, `Migrasi jadwal harus memuat RAISE ${marker}`);
  const firstQuote = line.indexOf("'");
  const secondQuote = line.indexOf("'", firstQuote + 1);
  const format = line.slice(firstQuote + 1, secondQuote);
  const placeholders = (format.match(/%/g) || []).length;
  const args = line.slice(secondQuote + 1).split(',').map((part) => part.trim()).filter(Boolean);
  assert.strictEqual(placeholders, args.length, `Placeholder RAISE ${marker} harus sama dengan jumlah argumen`);
}

console.log('OK: migrasi integrasi memuat seluruh bagian wajib.');