const assert = require('assert');
const { submissionMoment, scheduleCoversSubmission,
        applicationIncludesDate, isTeacherTeachingAtSubmission,
        canReviewIzin } = require('../utils/izin-approval');

// submissionMoment: 2026-11-16 00:30 UTC = 2026-11-16 07:30 WIB (Senin)
const app1 = { created_at: '2026-11-16T00:30:00.000Z', start_date: '2026-11-16', end_date: '2026-11-16' };
const mom1 = submissionMoment(app1);
assert.strictEqual(mom1.date,    '2026-11-16');
assert.strictEqual(mom1.dayName, 'Senin');
assert.strictEqual(mom1.minutes, 7 * 60 + 30);

// invalid timestamp
assert.strictEqual(submissionMoment({ created_at: 'bukan-tanggal' }), null);

const sched = { hari: 'Senin', jam_mulai: '07:00:00', jam_selesai: '09:00:00' };

// 07:30 masuk rentang 07:00–09:00
assert.strictEqual(scheduleCoversSubmission(sched, mom1), true);

// tepat jam_selesai = eksklusif
const momEnd = { date: '2026-11-16', dayName: 'Senin', minutes: 9 * 60 };
assert.strictEqual(scheduleCoversSubmission(sched, momEnd), false);

// hari berbeda
const momSelasa = { date: '2026-11-17', dayName: 'Selasa', minutes: 7 * 60 + 30 };
assert.strictEqual(scheduleCoversSubmission(sched, momSelasa), false);

// applicationIncludesDate
assert.strictEqual(applicationIncludesDate(app1, '2026-11-16'), true);
assert.strictEqual(applicationIncludesDate(app1, '2026-11-17'), false);

// izin untuk hari lain: created_at Senin, tapi start_date Selasa
const appFuture = { created_at: '2026-11-16T00:30:00.000Z', start_date: '2026-11-17', end_date: '2026-11-17' };
assert.strictEqual(isTeacherTeachingAtSubmission(appFuture, [sched]), false, 'Izin hari lain: guru tidak boleh');

// izin hari ini, sedang mengajar
assert.strictEqual(isTeacherTeachingAtSubmission(app1, [sched]), true);

// wali selalu boleh
assert.strictEqual(canReviewIzin({ isWali: true,  application: appFuture, schedules: []    }), true);
assert.strictEqual(canReviewIzin({ isWali: false, application: appFuture, schedules: [sched] }), false);
assert.strictEqual(canReviewIzin({ isWali: false, application: app1,      schedules: [sched] }), true);

console.log('OK: izin-approval semua kasus lulus.');
