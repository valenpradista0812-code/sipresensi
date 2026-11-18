function normalizeRfidUid(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const uid = String(value).trim().toUpperCase().replace(/[:\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!/^[0-9A-F]{2}(?:-[0-9A-F]{2}){3,9}$/.test(uid)) {
    const error = new Error('Format UID RFID tidak valid. Contoh: 08-AB-12-CD.');
    error.statusCode = 400;
    throw error;
  }
  return uid;
}

function isRfidUniqueViolation(error) {
  return error?.code === '23505' &&
    /rfid_uid/i.test(`${error.constraint || ''} ${error.message || ''} ${error.details || ''}`);
}

module.exports = { normalizeRfidUid, isRfidUniqueViolation };
