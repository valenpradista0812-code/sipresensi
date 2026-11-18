const { effectiveRole } = require('../middleware/role');

function createTeacherAccess(db) {
  async function resolveTeacher(user) {
    if (!user) return null;
    if (user.id) {
      const byUser = await db.findGuruByUserId(user.id);
      if (byUser) return byUser;
    }
    if (user.nip) {
      const byNip = await db.findGuruByNip(user.nip);
      if (byNip) return byNip;
    }
    return null;
  }

  async function getTaughtClasses(guruId) {
    if (!guruId) return [];
    const rows = await db.listTaughtClasses(guruId);
    return Array.isArray(rows) ? rows : [];
  }

  async function isWaliOf(guruId, className) {
    if (!guruId || !className) return false;
    return Boolean(await db.isWaliKelas(guruId, className));
  }

  async function canAccessClass(user, guruId, className, { allowWali = false } = {}) {
    const role = effectiveRole(user);
    if (role === 'petugas') return true;
    if (role !== 'guru') return false;
    const taught = await getTaughtClasses(guruId);
    if (taught.includes(className)) return true;
    if (allowWali) return isWaliOf(guruId, className);
    return false;
  }

  async function getWaliClasses(guruId) {
    if (!guruId) return [];
    const rows = await db.listWaliClasses(guruId);
    return (rows || []).map((r) => r.name);
  }

  async function getAccessibleClasses(guruId) {
    const [taught, wali] = await Promise.all([
      getTaughtClasses(guruId),
      getWaliClasses(guruId)
    ]);
    const all = [...new Set([...taught, ...wali])];
    return { taught, wali, all };
  }

  return { resolveTeacher, getTaughtClasses, isWaliOf, canAccessClass, getWaliClasses, getAccessibleClasses };
}

module.exports = { createTeacherAccess, ...createTeacherAccess(require('../data/db')) };