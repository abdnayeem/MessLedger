// ---------------------------------------------------------------------------
// 17-logs.js  (originally app.js lines 6145-6320)
// Login log and action log tabs: search/sort state, render + handlers
// ---------------------------------------------------------------------------
let loginLogSearch = '';
let loginLogSort = {
  key: 'timestamp',
  dir: 'desc'
};

function loginLogSortArrowHtml(key) {
  if (loginLogSort.key !== key) return '';
  return loginLogSort.dir === 'asc' ? ' <span class="sort-arrow">▲</span>' : ' <span class="sort-arrow">▼</span>';
}

function setLoginLogSort(key) {
  if (loginLogSort.key === key) {
    loginLogSort.dir = loginLogSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    loginLogSort.key = key;
    loginLogSort.dir = (key === 'name' || key === 'device' || key === 'action') ? 'asc' : 'desc';
  }
  renderTabContent();
}

function setLoginLogSearch(val) {
  loginLogSearch = val;
  renderTabContent();
  const el = document.getElementById('loginlog-search');
  if (el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

function loginLogActionLabel(action) {
  return action === 'logout' ? 'Logout' : 'Login';
}

function renderLoginLog() {
  const q = loginLogSearch.trim().toLowerCase();
  let list = q ? state.loginLogs.filter(l =>
    l.memberName.toLowerCase().includes(q) ||
    roleLabel(l.role).toLowerCase().includes(q) ||
    (l.device || '').toLowerCase().includes(q) ||
    (l.ip || '').toLowerCase().includes(q) ||
    loginLogActionLabel(l.action).toLowerCase().includes(q)
  ) : state.loginLogs.slice();

  const sortKey = loginLogSort.key;
  const dir = loginLogSort.dir === 'asc' ? 1 : -1;
  list = list.slice().sort((a, b) => {
    let av, bv;
    switch (sortKey) {
      case 'name':
        av = a.memberName.toLowerCase();
        bv = b.memberName.toLowerCase();
        break;
      case 'device':
        av = (a.device || '').toLowerCase();
        bv = (b.device || '').toLowerCase();
        break;
      case 'action':
        av = loginLogActionLabel(a.action);
        bv = loginLogActionLabel(b.action);
        break;
      default:
        av = a.timestamp;
        bv = b.timestamp;
        break; // 'timestamp'
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  const rows = list.map(l => `<tr>
    <td class="small-note" style="margin:0;">${formatBDDateTime(l.timestamp)}</td>
    <td>${l.memberName}</td>
    <td><span class="badge ${l.role}">${roleLabel(l.role)}</span></td>
    <td><span class="badge" style="${l.action==='logout' ? 'background:var(--danger-bg); color:var(--danger);' : 'background:var(--success-bg); color:var(--success);'}">${loginLogActionLabel(l.action)}</span></td>
    <td>${l.device||'—'}</td>
    <td class="mono">${l.ip||'—'}</td>
  </tr>`).join('');

  const header = `<tr>
    <th class="sortable-th" onclick="setLoginLogSort('timestamp')">Time (BD)${loginLogSortArrowHtml('timestamp')}</th>
    <th class="sortable-th" onclick="setLoginLogSort('name')">Name${loginLogSortArrowHtml('name')}</th>
    <th>Role</th>
    <th class="sortable-th" onclick="setLoginLogSort('action')">Action${loginLogSortArrowHtml('action')}</th>
    <th class="sortable-th" onclick="setLoginLogSort('device')">Device${loginLogSortArrowHtml('device')}</th>
    <th>IP</th>
  </tr>`;

  const emptyMsg = state.loginLogs.length === 0 ? 'No logins or logouts recorded yet.' : 'No records match your search.';

  return `
    <div class="card keep-native-tables">
      <h2>Login Log</h2>
      <div class="small-note" style="margin-bottom:12px;">Every successful sign-in and sign-out is recorded here — who, when (Bangladesh time), which action, and device/IP when they can be determined. This loads fresh each time you open this tab — leave and come back (or switch tabs) to see logins made by others while you were here. Only the most recent ${MAX_LOGIN_LOGS} records are kept.</div>
      <div class="row-between" style="margin-bottom:14px; justify-content:flex-start;">
        <input type="text" id="loginlog-search" class="search-input" style="max-width:360px; width:auto !important; flex:1 1 220px;" placeholder="Search name, role, action, device, or IP..." value="${loginLogSearch.replace(/"/g,'&quot;')}" oninput="setLoginLogSearch(this.value)">
        <button class="btn secondary" style="background:var(--danger); border-color:var(--danger); color:#fff; padding:6px 10px; font-size:12px; min-height:auto; margin-top:0; box-shadow:none; flex-shrink:0;" onclick="clearLoginLog()"><i class="fas fa-trash" style="margin-right:4px; font-size:11px;"></i>Clear Log</button>
        ${q ? `<div class="small-note" style="margin:0; flex-basis:100%;">${list.length} of ${state.loginLogs.length} records</div>` : ''}
      </div>
      ${list.length ? `<div class="table-responsive"><table><thead>${header}</thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${emptyMsg}</div>`}
    </div>`;
}

function attachLoginLogHandlers() {}

// Deletes every login log doc (from logStorage / mealAppLogs) and clears
// them from state — a hard reset for this log only, separate from the
// Database Log and from Reset All Test Data (which never touched logs
// specifically). Superadmin-only, same PIN-confirm pattern as the other
// destructive actions in Settings > Danger Zone.
async function clearLoginLog() {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can do this.', 'error');
    return;
  }
  if (!state.loginLogs.length) {
    showToast('Login log is already empty.', 'success');
    return;
  }
  const me = state.members.find(m => m.id === session.userId);
  const enteredPin = prompt(`This permanently deletes all ${state.loginLogs.length} login log record(s). This cannot be undone.\n\nEnter your super admin PIN to confirm:`);
  if (enteredPin === null) return;
  if (!me || enteredPin !== me.pin) {
    showToast('Incorrect PIN. Cancelled.', 'error');
    return;
  }
  showToast('Clearing login log…', 'success');
  try {
    await Promise.all(state.loginLogs.map(l => logStorage.delete(PFX_LOGINLOG + l.id, true)));
    state.loginLogs = [];
    showToast('Login log cleared.', 'success');
    renderTabContent();
  } catch (e) {
    console.error('clearLoginLog failed:', e);
    showToast('Failed to clear login log: ' + (e && e.message ? e.message : 'unknown error'), 'error');
  }
}

/* ---------------- DATABASE ACTION LOG (super admin only) ---------------- */
let actionLogSearch = '';
const actionLogModuleLabel = {
  meals: 'Meals',
  costs: 'Grocery Costs',
  expenses: 'Shared Expenses',
  deposits: 'Balances',
  members: 'Members',
  settings: 'Settings'
};
const actionLogActionLabel = {
  update: 'Add/Update',
  delete: 'Delete'
};

function setActionLogSearch(val) {
  actionLogSearch = val;
  renderTabContent();
  const el = document.getElementById('actionlog-search');
  if (el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

function renderActionLog() {
  const q = actionLogSearch.trim().toLowerCase();
  const list = (q ? state.actionLogs.filter(l =>
    l.memberName.toLowerCase().includes(q) ||
    roleLabel(l.role).toLowerCase().includes(q) ||
    (actionLogModuleLabel[l.module] || l.module).toLowerCase().includes(q) ||
    (actionLogActionLabel[l.action] || l.action).toLowerCase().includes(q) ||
    (l.detail || '').toLowerCase().includes(q)
  ) : state.actionLogs.slice());

  const rows = list.map(l => `<tr>
    <td class="small-note" style="margin:0;">${formatBDDateTime(l.at)}</td>
    <td>${l.memberName}</td>
    <td><span class="badge ${l.role}">${roleLabel(l.role)}</span></td>
    <td>${actionLogModuleLabel[l.module]||l.module}</td>
    <td><span class="badge" style="${l.action==='delete' ? 'background:var(--danger-bg); color:var(--danger);' : 'background:var(--success-bg); color:var(--success);'}">${actionLogActionLabel[l.action]||l.action}</span></td>
    <td class="small-note" style="margin:0;">${l.detail||'—'}</td>
  </tr>`).join('');

  const header = `<tr>
    <th>Time (BD)</th>
    <th>Name</th>
    <th>Role</th>
    <th>Module</th>
    <th>Action</th>
    <th>Detail</th>
  </tr>`;

  const emptyMsg = state.actionLogs.length === 0 ? 'No database actions recorded yet.' : 'No records match your search.';

  return `
    <div class="card keep-native-tables">
      <h2>Database Log</h2>
      <div class="small-note" style="margin-bottom:12px;">Every add/edit/delete made to Meals, Grocery Costs, Shared Expenses, Balances, Members, and Settings is recorded here — who, when (Bangladesh time), and what. This loads fresh each time you open this tab — leave and come back (or switch tabs) to see actions made by others while you were here. Only the most recent ${MAX_ACTION_LOGS} records are kept.</div>
      <div class="row-between" style="margin-bottom:14px; justify-content:flex-start;">
        <input type="text" id="actionlog-search" class="search-input" style="max-width:360px; width:auto !important; flex:1 1 220px;" placeholder="Search name, role, module, action, or detail..." value="${actionLogSearch.replace(/"/g,'&quot;')}" oninput="setActionLogSearch(this.value)">
        <button class="btn secondary" style="background:var(--danger); border-color:var(--danger); color:#fff; padding:6px 10px; font-size:12px; min-height:auto; margin-top:0; box-shadow:none; flex-shrink:0;" onclick="clearActionLog()"><i class="fas fa-trash" style="margin-right:4px; font-size:11px;"></i>Clear Log</button>
        ${q ? `<div class="small-note" style="margin:0; flex-basis:100%;">${list.length} of ${state.actionLogs.length} records</div>` : ''}
      </div>
      ${list.length ? `<div class="table-responsive"><table><thead>${header}</thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${emptyMsg}</div>`}
    </div>`;
}

function attachActionLogHandlers() {}

// Deletes every database action log doc (from logStorage / mealAppLogs)
// and clears them from state. Same pattern as clearLoginLog() above.
async function clearActionLog() {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can do this.', 'error');
    return;
  }
  if (!state.actionLogs.length) {
    showToast('Database log is already empty.', 'success');
    return;
  }
  const me = state.members.find(m => m.id === session.userId);
  const enteredPin = prompt(`This permanently deletes all ${state.actionLogs.length} database log record(s). This cannot be undone.\n\nEnter your super admin PIN to confirm:`);
  if (enteredPin === null) return;
  if (!me || enteredPin !== me.pin) {
    showToast('Incorrect PIN. Cancelled.', 'error');
    return;
  }
  showToast('Clearing database log…', 'success');
  try {
    await Promise.all(state.actionLogs.map(l => logStorage.delete(PFX_ACTIONLOG + l.id, true)));
    state.actionLogs = [];
    showToast('Database log cleared.', 'success');
    renderTabContent();
  } catch (e) {
    console.error('clearActionLog failed:', e);
    showToast('Failed to clear database log: ' + (e && e.message ? e.message : 'unknown error'), 'error');
  }
}

/* ---------------- SETTINGS (super admin only) ---------------- */