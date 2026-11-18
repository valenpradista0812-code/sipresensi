const { jakartaNow, timeToMinutes } = require('./jam-kerja');

const INDONESIAN_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function submissionMoment(application) {
  if (!application || !application.created_at) return null;
  const d = new Date(application.created_at);
  if (Number.isNaN(d.getTime())) return null;
  const now = jakartaNow(d);
  const dayName = INDONESIAN_DAYS[d.getDay()];
  return {
    date: now.date,
    dayName,
    minutes: now.minutes
  };
}

function scheduleCoversSubmission(schedule, moment) {
  if (!schedule || !moment) return false;
  if (schedule.hari !== moment.dayName) return false;
  const startMin = timeToMinutes(schedule.jam_mulai);
  const endMin = timeToMinutes(schedule.jam_selesai);
  if (startMin === null || endMin === null) return false;
  return startMin <= moment.minutes && moment.minutes < endMin;
}

function applicationIncludesDate(application, date) {
  if (!application || !date) return false;
  const start = application.start_date;
  const end = application.end_date;
  if (!start || !end) return false;
  return start <= date && date <= end;
}

function isTeacherTeachingAtSubmission(application, schedules) {
  const mom = submissionMoment(application);
  if (!mom) return false;
  if (!applicationIncludesDate(application, mom.date)) return false;
  const list = Array.isArray(schedules) ? schedules : [];
  return list.some((s) => scheduleCoversSubmission(s, mom));
}

function canReviewIzin({ isWali, application, schedules }) {
  if (isWali) return true;
  return isTeacherTeachingAtSubmission(application, schedules);
}

module.exports = {
  submissionMoment,
  scheduleCoversSubmission,
  applicationIncludesDate,
  isTeacherTeachingAtSubmission,
  canReviewIzin
};
