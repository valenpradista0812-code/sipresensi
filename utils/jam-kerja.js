/**
 * Utilitas jam kerja absensi sekolah.
 * Semua perhitungan waktu memakai zona waktu Asia/Jakarta.
 */

const TIME_ZONE = 'Asia/Jakarta';
const DEFAULT_JAM_MASUK = '07:00';
const DEFAULT_JAM_PULANG = '15:00';

function timeToMinutes(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function minutesToClock(minutes) {
  if (!Number.isFinite(minutes)) return null;
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function toWibLabel(value) {
  const minutes = timeToMinutes(value);
  if (minutes === null) return value;
  return `${minutesToClock(minutes)} WIB`;
}

function jakartaNow(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});

  const hour = Number(parts.hour);
  const minute = Number(parts.minute);

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    clock: `${parts.hour}:${parts.minute}`,
    minutes: hour * 60 + minute
  };
}

function readJamKerja(settings = {}) {
  const jamMasuk = timeToMinutes(settings.jamMasuk) ?? timeToMinutes(DEFAULT_JAM_MASUK);
  const jamPulang = timeToMinutes(settings.jamPulang) ?? timeToMinutes(DEFAULT_JAM_PULANG);
  return {
    jamMasuk,
    jamPulang,
    jamMasukLabel: toWibLabel(minutesToClock(jamMasuk)),
    jamPulangLabel: toWibLabel(minutesToClock(jamPulang))
  };
}

function statusMasuk(nowMinutes, jamMasuk) {
  return nowMinutes > jamMasuk ? 'terlambat' : 'hadir';
}

function evaluasiTapAbsensi({ nowMinutes, jamMasuk, jamPulang, sudahMasuk, sudahPulang }) {
  if (sudahPulang) return { action: 'tolak-pulang' };
  if (sudahMasuk) {
    if (nowMinutes < jamPulang) return { action: 'tolak-belum-pulang' };
    return {
      action: 'pulang',
      isOvertime: nowMinutes > jamPulang,
      overtimeMinutes: Math.max(0, nowMinutes - jamPulang)
    };
  }
  if (nowMinutes > jamPulang) return { action: 'tolak-lewat-pulang' };
  return { action: 'masuk', status: statusMasuk(nowMinutes, jamMasuk) };
}

module.exports = {
  TIME_ZONE,
  DEFAULT_JAM_MASUK,
  DEFAULT_JAM_PULANG,
  timeToMinutes,
  minutesToClock,
  toWibLabel,
  jakartaNow,
  readJamKerja,
  statusMasuk,
  evaluasiTapAbsensi
};
