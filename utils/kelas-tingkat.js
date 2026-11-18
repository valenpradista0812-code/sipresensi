/**
 * SiPresensi - Helper tingkat kelas
 * Tingkat diturunkan dari prefix nama kelas (X, XI, XII) tanpa kolom database baru.
 */

const TINGKAT_LIST = ['X', 'XI', 'XII'];

// Urutan penting: XII dan XI harus dicek sebelum X agar "XI IPA 1" tidak terbaca "X".
const TINGKAT_PATTERNS = [
  { tingkat: 'XII', pattern: /^XII(?![A-Za-z0-9])/ },
  { tingkat: 'XI', pattern: /^XI(?![A-Za-z0-9])/ },
  { tingkat: 'X', pattern: /^X(?![A-Za-z0-9])/ }
];

function normalizeName(name) {
  return String(name == null ? '' : name).trim();
}

function parseTingkat(name) {
  const clean = normalizeName(name).toUpperCase();
  if (!clean) return null;
  for (const item of TINGKAT_PATTERNS) {
    if (item.pattern.test(clean)) return item.tingkat;
  }
  return null;
}

function isValidTingkatPrefix(name) {
  return parseTingkat(name) !== null;
}

function isTingkat(value) {
  return TINGKAT_LIST.includes(String(value == null ? '' : value).trim().toUpperCase());
}

module.exports = {
  TINGKAT_LIST,
  parseTingkat,
  isValidTingkatPrefix,
  isTingkat
};
