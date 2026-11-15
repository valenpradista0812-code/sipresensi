const LEGACY_ROLE_MAP = { admin: 'guru' };

function effectiveRole(user) {
  const raw = user && typeof user.role === 'string' ? user.role.trim().toLowerCase() : '';
  return LEGACY_ROLE_MAP[raw] || raw;
}

module.exports = { effectiveRole };