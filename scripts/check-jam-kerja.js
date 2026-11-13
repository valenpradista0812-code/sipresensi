const assert = require('assert');
const { evaluasiTapAbsensi } = require('../utils/jam-kerja');

const jamMasuk = 7 * 60;
const jamPulang = 15 * 60;
const tap = (clock, sudahMasuk = false, sudahPulang = false) => {
  const [hours, minutes] = clock.split(':').map(Number);
  return evaluasiTapAbsensi({
    nowMinutes: hours * 60 + minutes,
    jamMasuk,
    jamPulang,
    sudahMasuk,
    sudahPulang
  });
};

assert.deepStrictEqual(tap('06:50'), { action: 'masuk', status: 'hadir' });
assert.deepStrictEqual(tap('07:00'), { action: 'masuk', status: 'hadir' });
assert.deepStrictEqual(tap('07:01'), { action: 'masuk', status: 'terlambat' });
assert.deepStrictEqual(tap('08:00'), { action: 'masuk', status: 'terlambat' });
assert.deepStrictEqual(tap('10:00', true), { action: 'tolak-belum-pulang' });
assert.deepStrictEqual(tap('14:59', true), { action: 'tolak-belum-pulang' });
assert.deepStrictEqual(tap('15:00', true), { action: 'pulang', isOvertime: false, overtimeMinutes: 0 });
assert.deepStrictEqual(tap('15:30', true), { action: 'pulang', isOvertime: true, overtimeMinutes: 30 });
assert.deepStrictEqual(tap('16:00', true), { action: 'pulang', isOvertime: true, overtimeMinutes: 60 });
assert.deepStrictEqual(tap('16:00'), { action: 'tolak-lewat-pulang' });
assert.deepStrictEqual(tap('10:00', true, true), { action: 'tolak-pulang' });

console.log('OK: seluruh skenario jam masuk, penguncian, dan jam pulang sesuai.');
