// ---------------------------------------------------------------------------
// 04-format-helpers.js  (originally app.js lines 1318-1342)
// Small formatting/lookup helpers: fmtMoney, memberById, roleLabel, canSeeRoleOf, roleBadgeHtml
// ---------------------------------------------------------------------------
function fmtMoney(n) {
  const v = Math.round((Number(n) || 0) * 1000) / 1000;
  return '৳' + v.toLocaleString('en-US', {
    maximumFractionDigits: 3
  });
}

function memberById(id) {
  return state.members.find(m => m.id === id);
}

function roleLabel(r) {
  return r === 'superadmin' ? 'Super Admin' : r === 'admin' ? 'Admin' : 'Member';
}
// Role badges are only shown on your own profile/row. Super admin is the
// only role that can see everyone else's role too.
function canSeeRoleOf(memberId) {
  return session.role === 'superadmin' || memberId === session.userId;
}

function roleBadgeHtml(m) {
  return canSeeRoleOf(m.id) ? `<span class="badge ${m.role}">${roleLabel(m.role)}</span>` : '';
}

/* ---------------- SESSION ---------------- */
