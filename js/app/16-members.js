// ---------------------------------------------------------------------------
// 16-members.js  (originally app.js lines 5833-6144)
// Members tab: renderMembers, monthly-active toggle, recovery code, add/update/remove member, role change, PIN reset, enable account
// ---------------------------------------------------------------------------
function renderMembers() {
  const dayOptions = (selected) => `<option value="" ${!hasMarketDay({marketDay:selected})?'selected':''}>—</option>` +
    WEEKDAYS.map((d, i) => `<option value="${i}" ${Number(selected)===i?'selected':''}>${d}</option>`).join('');
  const shiftOptions = (selected) => `
    <option value="" ${!selected?'selected':''}>—</option>
    <option value="lunch" ${selected==='lunch'?'selected':''}>Lunch</option>
    <option value="dinner" ${selected==='dinner'?'selected':''}>Dinner</option>
    <option value="both" ${selected==='both'?'selected':''}>Both</option>`;
  const roleLabelFor = {
    member: 'Member',
    admin: 'Admin',
    superadmin: 'Super Admin'
  };
  const rows = state.members.map(m => {
    const isBlocked = isBalanceBlocked(m.id);
    const isAdminLocked = isAdminBlocked(m.id);
    let lockBadge = '<span class="pos"><i class="fas fa-circle-check"></i> Active</span>';
    if (isAdminLocked) lockBadge = `<span class="neg"><i class="fas fa-lock"></i> Blocked${m.mealLock.reason?`: ${m.mealLock.reason}`:''}</span>`;
    else if (isBlocked) lockBadge = '<span class="neg"><i class="fas fa-triangle-exclamation"></i> Negative balance (auto-blocked)</span>';
    const loginStatusCell = m.accountDisabled ?
      `<span class="neg"><i class="fas fa-ban"></i> Disabled</span><div class="small-note" style="margin:2px 0 6px;">${MAX_LOGIN_ATTEMPTS} failed attempts</div><button class="btn secondary" style="margin-top:0; padding:3px 9px; font-size:11px;" onclick="enableMemberAccount('${m.id}')">Enable</button>` :
      `<span class="pos"><i class="fas fa-circle-check"></i> OK</span>${m.failedLoginAttempts ? `<div class="small-note" style="margin:2px 0 0;">${m.failedLoginAttempts}/${MAX_LOGIN_ATTEMPTS} failed</div>` : ''}`;
    const initials = ((m.name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('') || '?').toUpperCase();
    const phoneDigits = (m.phone || '').replace(/[^\d+]/g, '');
    const marketSummary = hasMarketDay(m) ? `${WEEKDAYS[m.marketDay]}${m.marketShift ? ` · ${m.marketShift==='both'?'Both':(m.marketShift[0].toUpperCase()+m.marketShift.slice(1))}` : ''}` : 'Not set';
    return `
    <div class="member-row-grid">
      <div class="mrow-member">
        <div class="member-avatar role-${m.role}" title="${roleLabelFor[m.role]}">${initials}</div>
        <div class="mrow-member-fields">
          <input type="text" class="member-name-input" value="${m.name}" placeholder="Name" onchange="updateMemberField('${m.id}','name', this.value.trim())">
          <select class="role-select role-${m.role}" onchange="changeRole('${m.id}', this.value)">
            <option value="member" ${m.role==='member'?'selected':''}>Member</option>
            <option value="admin" ${m.role==='admin'?'selected':''}>Admin</option>
            <option value="superadmin" ${m.role==='superadmin'?'selected':''}>Super Admin</option>
          </select>
        </div>
      </div>
      <div class="mrow-cell mrow-phone">
        <span class="mrow-cell-label">Phone</span>
        <div class="mrow-phone-inner">
          ${phoneDigits ? `<a class="phone-call-btn" href="tel:${phoneDigits}" title="Call ${m.name}"><i class="fas fa-phone"></i></a>` : `<span class="phone-call-btn is-disabled" title="No phone on file"><i class="fas fa-phone"></i></span>`}
          <input type="text" value="${m.phone||''}" placeholder="Phone" inputmode="tel" onchange="updateMemberField('${m.id}','phone', this.value.trim())">
        </div>
      </div>
      <div class="mrow-cell mrow-market">
        <span class="mrow-cell-label">Market Duty</span>
        <div class="mrow-market-inner">
          <select onchange="updateMemberField('${m.id}','marketDay', this.value===''?null:Number(this.value))">
            ${dayOptions(m.marketDay)}
          </select>
          <select onchange="updateMemberField('${m.id}','marketShift', this.value)">
            ${shiftOptions(m.marketShift)}
          </select>
        </div>
        <div class="small-note mrow-market-summary">${marketSummary}</div>
      </div>
      <div class="mrow-cell mrow-status">
        <span class="mrow-cell-label">Meal Status</span>
        <div class="status-line">
          ${lockBadge}
          <button class="btn secondary" style="margin-top:6px; padding:3px 9px; font-size:11px;" onclick="toggleMealLock('${m.id}')">${isAdminLocked?'Unblock':'Block'}</button>
        </div>
        <span class="mrow-cell-label" style="margin-top:10px;">Login Status</span>
        <div class="status-line">${loginStatusCell}</div>
      </div>
      <div class="mrow-cell mrow-created">
        <span class="mrow-cell-label">Created</span>
        ${m.createdAt ? formatBDDateTime(m.createdAt) : '<span class="small-note" style="margin:0;">Unknown (before tracking)</span>'}
      </div>
      <div class="mrow-cell mrow-actions">
        <span class="mrow-cell-label">Actions</span>
        ${session.role==='superadmin' ? `<button class="del-btn" onclick="resetMemberPin('${m.id}')"><i class="fas fa-key"></i> Reset PIN</button>` : ''}
        ${state.members.length>1 ? `<button class="del-btn" onclick="removeMember('${m.id}')"><i class="fas fa-user-slash"></i> Remove</button>` : ''}
      </div>
    </div>`;
  }).join('');
  return `
    <div class="card">
      <h2>Add New Member</h2>
      <div class="form-grid">
        <div><label>Full Name</label><input type="text" id="new-member-name" placeholder="Enter name"></div>
        <div><label>Phone Number *</label><input type="text" id="new-member-phone" inputmode="tel" placeholder="017XXXXXXXX" required></div>
        <div><label>Weekly Market Day</label>
          <select id="new-member-day">
            <option value="">Not set</option>
            ${WEEKDAYS.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}
          </select>
        </div>
        <div><label>Market Shift (optional)</label>
          <select id="new-member-shift">
            <option value="">—</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
            <option value="both">Both</option>
          </select>
        </div>
      </div>
      <button class="btn" onclick="addMember()">Add</button>
    </div>
    <div class="card">
      <h2>Member List</h2>
      <div class="small-note" style="margin-bottom:10px;">Members log in with their phone number, so every member must have one on file.</div>
      <div class="member-grid-list">
        <div class="member-row-grid member-row-grid-head">
          <div>Member</div><div>Phone</div><div>Market Duty</div><div>Meal &amp; Login Status</div><div>Created</div><div>Actions</div>
        </div>
        ${rows}
      </div>
      <div class="small-note">Phone, market day, and shift save instantly when changed. If someone forgets their PIN, reset it to 0000 here.</div>
    </div>
    <div class="card">
      <h2>Monthly Active Members</h2>
      <div class="small-note" style="margin-bottom:10px;">
        Only members checked as Active below are included in that month's meal rate, grocery cost, and shared-expense "split among everyone" — inactive members are fully excluded from that month's calculations and can't log in during that month. This never changes past months' already-recorded numbers. Once someone is marked Inactive, they stay Inactive in every following month — even ones you haven't opened yet — until you come back here and check them Active again.
      </div>
      <div style="margin-bottom:12px; display:flex; align-items:center; gap:8px;">
        <label style="margin:0; white-space:nowrap;">Month</label>
        <input type="month" id="ma-month-select" value="${monthlyActiveSelectedMonth}" onchange="setMonthlyActiveMonth(this.value)" style="width:auto;">
      </div>
      <div class="active-list">
        ${state.members.map(m=>`
        <label class="active-list-row">
          <span class="active-list-info">
            <span class="active-list-name" title="${m.name}">${m.name}</span>
            <span class="badge ${m.role}">${roleLabel(m.role)}</span>
          </span>
          <input type="checkbox" class="ma-member-check" value="${m.id}" ${isMemberActiveInMonth(m.id, monthlyActiveSelectedMonth) ? 'checked' : ''}>
        </label>`).join('')}
      </div>
      <button class="btn" onclick="saveMonthlyActive()">Save for ${monthlyActiveSelectedMonth}</button>
    </div>
    <div class="card">
      <h2>Recovery Code</h2>
      <div class="small-note">Members use this code with "Forgot PIN?" to reset their own PIN. Share only with trusted people.</div>
      <div style="margin-top:12px; display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
        <span class="mono" style="font-size:20px; font-weight:700; background:#FAFAFB; border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px 14px;">${state.recoveryCode}</span>
        <button class="btn secondary" onclick="regenerateRecoveryCode()">Generate New Code</button>
      </div>
    </div>`;
}

function setMonthlyActiveMonth(val) {
  if (!val) return;
  monthlyActiveSelectedMonth = val;
  renderTabContent();
}
async function saveMonthlyActive() {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can set monthly active members.', 'error');
    renderTabContent();
    return;
  }
  const month = monthlyActiveSelectedMonth;
  const rec = {};
  document.querySelectorAll('.ma-member-check').forEach(el => {
    rec[el.value] = el.checked;
  });
  if (!state.monthlyActive) state.monthlyActive = {};
  state.monthlyActive[month] = rec;
  _maDirty = false;
  renderTabContent();
  showToast(`Active members updated for ${month}.`, 'success');
  persistMonthlyActive(month);
}
async function regenerateRecoveryCode() {
  if (!confirm('Generate a new recovery code? The old one will stop working.')) return;
  state.recoveryCode = generateRecoveryCode();
  await persistMeta();
  renderTabContent();
  showToast('New recovery code generated.', 'success');
}

function attachMemberHandlers() {
  document.querySelectorAll('.ma-member-check').forEach(el => {
    el.addEventListener('change', () => {
      _maDirty = true;
    });
  });
}
async function addMember() {
  const name = document.getElementById('new-member-name').value.trim();
  if (!name) {
    showToast('Full name is required.', 'error');
    return;
  }
  const phone = document.getElementById('new-member-phone').value.trim();
  if (!phone) {
    showToast('Phone number is required — it\'s used to log in.', 'error');
    return;
  }
  if (findMemberByPhone(phone)) {
    showToast('That phone number is already used by another member.', 'error');
    return;
  }
  const dayRaw = document.getElementById('new-member-day').value;
  const marketDay = dayRaw === '' ? null : Number(dayRaw);
  const marketShift = document.getElementById('new-member-shift').value;
  const newMemberId = 'm' + Date.now();
  state.members.push({
    id: newMemberId,
    name,
    role: 'member',
    pin: '0000',
    phone,
    marketDay,
    marketShift,
    marketItems: '',
    marketCompletions: {},
    mealLock: {
      blocked: false,
      reason: '',
      by: ''
    },
    failedLoginAttempts: 0,
    accountDisabled: false,
    createdAt: nowTimestamp()
  });
  await persistMembers();
  renderTabContent();
  showToast(`${name} added.`, 'success');
}
async function updateMemberField(id, field, value) {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can edit member details, including the weekly market schedule.', 'error');
    renderTabContent();
    return;
  }
  const m = memberById(id);
  m[field] = value;
  await persistMembers();
  renderTabContent();
}
async function removeMember(id) {
  if (id === session.userId) {
    showToast("You can't remove yourself.", 'error');
    return;
  }
  if (!confirm("Remove this member? Their history will be kept, but they'll be removed from the list.")) return;
  const m = memberById(id);
  const idx = state.members.findIndex(x => x.id === id);
  await snapshotMembersAndSettings(`Before removing "${m ? m.name : id}"`);
  state.members = state.members.filter(m => m.id !== id);
  const ok = await persistMembers();
  if (!ok) {
    if (m && idx >= 0) state.members.splice(idx, 0, m); // put them back locally — the delete never actually saved
    renderTabContent();
    return;
  }
  renderTabContent();
  showToast(`${m?m.name:'Member'} removed.`, 'success');
}
async function changeRole(id, role) {
  const m = memberById(id);
  if (m.role === 'superadmin' && role !== 'superadmin') {
    const superadminCount = state.members.filter(x => x.role === 'superadmin').length;
    if (superadminCount <= 1) {
      showToast("Can't change this — they're the only Super Admin. Promote someone else to Super Admin first.", 'error');
      renderTabContent();
      return;
    }
  }
  await snapshotMembersAndSettings(`Before changing ${m.name}'s role from ${m.role} to ${role}`);
  const previousRole = m.role;
  m.role = role;
  const ok = await persistMembers();
  if (!ok) {
    // Save failed — persistMembers() already showed a "Failed to save" toast.
    // Roll the in-memory role back too, so the UI doesn't sit there showing
    // a "successful" change that was never actually written to Firestore.
    m.role = previousRole;
    renderTabContent();
    return;
  }
  renderTabContent();
  showToast(`Role updated for ${m.name}.`, 'success');
}
async function resetMemberPin(id) {
  const m = memberById(id);
  if (!confirm(`Reset ${m.name}'s PIN to 0000?`)) return;
  await snapshotMembersAndSettings(`Before resetting ${m.name}'s PIN`);
  const prev = {
    pin: m.pin,
    failedLoginAttempts: m.failedLoginAttempts,
    accountDisabled: m.accountDisabled
  };
  m.pin = '0000';
  m.failedLoginAttempts = 0;
  m.accountDisabled = false;
  const ok = await persistMembers();
  if (!ok) {
    Object.assign(m, prev);
    renderTabContent();
    return;
  }
  showToast(`${m.name}'s PIN reset to 0000. Ask them to log in and set a new PIN.`, 'success');
  renderTabContent();
}
// Super admin re-enables an account that got disabled after MAX_LOGIN_ATTEMPTS
// wrong PIN attempts. Their existing PIN is kept as-is (not reset).
async function enableMemberAccount(id) {
  const m = memberById(id);
  if (!m.accountDisabled) return;
  if (!confirm(`Re-enable ${m.name}'s account? They'll be able to log in again with their existing PIN.`)) return;
  m.accountDisabled = false;
  m.failedLoginAttempts = 0;
  await persistMembers();
  showToast(`${m.name}'s account re-enabled.`, 'success');
  renderTabContent();
}

/* ---------------- LOGIN LOG (super admin only) ---------------- */
