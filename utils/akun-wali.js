function parseWaliAssignment(role, body = {}) {
  if (role !== 'guru') return { skip: true };
  if (!('isWaliKelas' in body)) return { skip: true };
  if (body.isWaliKelas === true) {
    const kelasId = body.waliKelasId ? String(body.waliKelasId).trim() : '';
    if (!kelasId) return { error: 'Pilih kelas wali terlebih dahulu.' };
    return { assign: true, kelasId };
  }
  return { clear: true };
}

module.exports = { parseWaliAssignment };
