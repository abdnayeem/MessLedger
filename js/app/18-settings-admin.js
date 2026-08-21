// ---------------------------------------------------------------------------
// 18-settings-admin.js  (originally app.js lines 6321-6750)
// Admin month-access card, full Settings tab (renderSettings), notification settings, save/reset settings
// ---------------------------------------------------------------------------
function renderAdminMonthAccessCard() {
  if (!_adminMonthAccessDraft) resetAdminMonthAccessDraft();
  const draft = _adminMonthAccessDraft;
  const modules = ['meals', 'costs', 'expenses', 'deposits'];
  const today = getCurrentMonthStr(); // local date, not UTC — see getCurrentMonthStr() comment near top of file

  let html = `
    <div class="card">
      <h2>Admin Month Access Control</h2>
      <div class="small-note" style="margin-bottom:14px;">Configure which months Admins can add/edit data in each module. Super Admin always has full access. Changes are saved only when you click "Save Settings".</div>
  `;

  modules.forEach(module => {
    const cfg = draft[module] || {
      current: true,
      past: false,
      future: false,
      specificYears: {}
    };
    html += `
      <div style="border-bottom:1px solid #E5E7EB; padding:16px 0; margin:16px 0;">
        <div style="font-weight:600; margin-bottom:12px; text-transform:capitalize;">${module}</div>
        <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:12px;">
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
            <input type="checkbox" ${cfg.current?'checked':''} onchange="updateAdminMonthAccessDraft('${module}','current', this.checked)">
            Current Month (${today})
          </label>
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
            <input type="checkbox" ${cfg.past?'checked':''} onchange="updateAdminMonthAccessDraft('${module}','past', this.checked)">
            All Past Months
          </label>
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
            <input type="checkbox" ${cfg.future?'checked':''} onchange="updateAdminMonthAccessDraft('${module}','future', this.checked)">
            All Future Months
          </label>
        </div>
        <div style="background:#F9FAFB; padding:12px; border-radius:6px; margin-top:12px;">
          <div style="font-size:13px; font-weight:500; margin-bottom:8px;">Specific Months by Year</div>
          <div id="adminma-${module}-specific" style="display:flex; flex-direction:column; gap:8px;">
            ${Object.keys(cfg.specificYears || {}).map(year => {
              const months = cfg.specificYears[year] || [];
              return `
                <div style="display:flex; gap:8px; align-items:center;">
                  <input type="number" min="2020" max="2099" value="${year}" style="width:80px;" onchange="updateAdminMonthAccessYear('${module}', '${year}', this.value)">
                  <div style="flex:1;">
                    ${
                      months.length === 12 ? `
                      <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
                        <input type="checkbox" checked onchange="updateAdminMonthAccessYearAllMonths('${module}', '${year}', this.checked)">
                        All 12 months
                      </label>
                    ` : `
                      <div style="display:grid; grid-template-columns:repeat(6,1fr); gap:4px; margin-bottom:6px;">
                        ${['01','02','03','04','05','06','07','08','09','10','11','12'].map(m => `
                          <label style="display:flex; align-items:center; gap:4px; font-size:12px; cursor:pointer;">
                            <input type="checkbox" ${months.includes(m)?'checked':''} onchange="updateAdminMonthAccessYearMonth('${module}', '${year}', '${m}', this.checked)">
                            ${['J','F','M','A','M','J','J','A','S','O','N','D'][parseInt(m)-1]}
                          </label>
                        `).join('')}
                      </div>
                    `
                    }
                  </div>
                  <button class="btn secondary" style="padding:6px 10px; font-size:12px;" onclick="removeAdminMonthAccessYear('${module}', '${year}')">Remove</button>
                </div>
              `;
            }).join('')}
          </div>
          <button class="btn secondary" style="margin-top:8px; padding:6px 12px; font-size:12px;" onclick="addAdminMonthAccessYear('${module}')">+ Add Year</button>
        </div>
      </div>
    `;
  });

  html += `
      <button class="btn" onclick="saveSettings()">Save Settings</button>
    </div>`;
  return html;
}

function renderSettings() {
  const s = state.settings;
  return `
    <div class="card">
      <h2>App Settings</h2>
      <div class="small-note" style="margin-bottom:14px;">These control the app's automatic behavior for everyone. Only super admins can change them.</div>
      <div class="form-grid">
        <div>
          <label>Meal edit cutoff time (BD time)</label>
          <input type="time" id="set-mealLockTime" value="${String(s.mealLockHour).padStart(2,'0')}:${String(s.mealLockMinute||0).padStart(2,'0')}">
          <div class="small-note">Members can edit tomorrow's meal from BD midnight until this time, same day (Bangladesh time) — e.g. 11:59 AM. After that it locks. Admins can still override.</div>
        </div>
        <div>
          <label>Enable meal locking</label>
          <select id="set-mealLockEnabled">
            <option value="true" ${s.mealLockEnabled!==false?'selected':''}>Enabled</option>
            <option value="false" ${s.mealLockEnabled===false?'selected':''}>Disabled</option>
          </select>
          <div class="small-note">If disabled, any date can be edited anytime (no lock).</div>
        </div>
        <div>
          <label>Max meal quantity per meal</label>
          <input type="number" id="set-maxMealQty" min="1" max="10" value="${s.maxMealQty}">
          <div class="small-note">Highest number a member (and admin, if selected below) can set for one lunch or dinner (covers guests). Super admin is always unlimited.</div>
        </div>
        <div>
          <label>Who does this cap apply to</label>
          <select id="set-maxMealQtyScope">
            <option value="member" ${s.maxMealQtyScope!=='member_admin'?'selected':''}>Members only (admin &amp; super admin unlimited)</option>
            <option value="member_admin" ${s.maxMealQtyScope==='member_admin'?'selected':''}>Members &amp; Admins (only super admin unlimited)</option>
          </select>
          <div class="small-note">Controls whether admins are also capped by the max above, or can add any amount.</div>
        </div>
        <div>
          <label>Low-balance warning threshold (৳)</label>
          <input type="number" id="set-lowBalanceWarn" min="0" step="1" value="${s.lowBalanceWarn}">
          <div class="small-note">Shows a caution badge/banner when balance drops below this (still positive).</div>
        </div>
        <div>
          <label>Negative-balance buffer (৳)</label>
          <input type="number" id="set-negativeBalanceBuffer" min="0" step="1" value="${s.negativeBalanceBuffer}">
          <div class="small-note">How far below ৳0 a member can go before meals auto-block. 0 = block as soon as balance is negative.</div>
        </div>
        <div>
          <label>Lunch shopping deadline</label>
          <select id="set-marketDeadlineLunch">
            ${Array.from({length:24}, (_,h)=>`<option value="${h}" ${s.marketDeadlineLunch===h?'selected':''}>${formatHour12(h)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Dinner shopping deadline</label>
          <select id="set-marketDeadlineDinner">
            ${Array.from({length:24}, (_,h)=>`<option value="${h}" ${s.marketDeadlineDinner===h?'selected':''}>${formatHour12(h)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Recorded At timestamp visibility</label>
          <select id="set-recordedAtVisibility">
            <option value="superadmin" ${s.recordedAtVisibility==='superadmin'?'selected':''}>Super Admin only</option>
            <option value="admin" ${s.recordedAtVisibility==='admin'?'selected':''}>Admin &amp; Super Admin</option>
            <option value="all" ${s.recordedAtVisibility==='all'?'selected':''}>All users</option>
          </select>
          <div class="small-note">Choose who can see the "Recorded At" timestamps in Grocery Costs, Shared Expenses, Deposits, and History.</div>
        </div>
        <div>
          <label>Added By visibility</label>
          <select id="set-addedByVisibility">
            <option value="superadmin" ${s.addedByVisibility==='superadmin'?'selected':''}>Super Admin only</option>
            <option value="admin" ${s.addedByVisibility==='admin'?'selected':''}>Admin &amp; Super Admin</option>
            <option value="all" ${s.addedByVisibility==='all'?'selected':''}>All users</option>
          </select>
          <div class="small-note">Choose who can see "Added By" information in Meals (Edit by Date &amp; History).</div>
        </div>
        <div>
          <label>All Meals History visibility</label>
          <select id="set-mealsHistoryVisibility">
            <option value="superadmin" ${s.mealsHistoryVisibility==='superadmin'?'selected':''}>Super Admin only</option>
            <option value="admin" ${s.mealsHistoryVisibility==='admin'?'selected':''}>Admin &amp; Super Admin</option>
            <option value="all" ${s.mealsHistoryVisibility==='all'?'selected':''}>All users</option>
          </select>
          <div class="small-note">Everyone can always see their own meal history. This controls who can additionally see OTHER members' entries in Meals → All Meals History.</div>
        </div>
      </div>
      <button class="btn" onclick="saveSettings()">Save Settings</button>
      <button class="btn secondary" onclick="resetSettings()">Reset to Defaults</button>
    </div>
    ${renderAdminMonthAccessCard()}
    ${renderNotificationSettingsCard()}
    ${session.role === 'superadmin' ? `
    <div class="card" style="border:1px solid #d33; ">
      <h2 style="color:#d33;">Danger Zone</h2>
      <div class="small-note" style="margin-bottom:14px;">For use before a real release: permanently wipes all meals, deposits, expenses, grocery costs, login logs and notifications for every member — in one go, instead of deleting each record by hand. Members and settings are kept.</div>
      <button class="btn" style="background:#d33; border-color:#d33;" onclick="resetTestData()">Reset All Test Data</button>
      ${testDataBackupDaysLeft()!==null ? `
      <div style="margin-top:16px; padding-top:16px; border-top:1px dashed var(--border);">
        <div class="small-note" style="margin-bottom:10px;">A backup from the last reset (${state.testDataBackup.items.length} record(s)) is available to restore for ${testDataBackupDaysLeft()} more day${testDataBackupDaysLeft()===1?'':'s'}.</div>
        <button class="btn secondary" onclick="restoreTestData()"><i class="fas fa-clock-rotate-left"></i> Restore Last Reset</button>
      </div>
      ` : ''}
      <div style="margin-top:16px; padding-top:16px; border-top:1px dashed var(--border);">
        <h3 style="margin:0 0 6px;">Member &amp; Settings Backups</h3>
        <div class="small-note" style="margin-bottom:10px;">A restore point is taken automatically before removing a member, changing a role, resetting a PIN, or resetting settings — so any of those can be undone here, not just the very last one. Up to ${MAX_MEMBER_SNAPSHOTS} are kept.</div>
        <button class="btn secondary" onclick="createManualBackup()"><i class="fas fa-camera"></i> Create Backup Now</button>
        ${(state.memberSnapshots||[]).length ? `
        <div style="margin-top:12px; display:flex; flex-direction:column; gap:8px;">
          ${(state.memberSnapshots||[]).map(snap => `
            <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 10px; border:1px solid var(--border); border-radius:8px;">
              <div style="min-width:0;">
                <div style="font-weight:600; font-size:13px;">${escapeHtml(snap.label)}</div>
                <div class="small-note" style="margin:0;">${new Date(snap.createdAt).toLocaleString()} · ${snap.members.length} member(s)</div>
              </div>
              <button class="btn secondary" style="flex-shrink:0;" onclick="restoreMemberSnapshot('${snap.id}')"><i class="fas fa-clock-rotate-left"></i> Restore</button>
            </div>
          `).join('')}
        </div>
        ` : `<div class="small-note" style="margin-top:10px;">No backups yet — one will be taken automatically before the next member/role/PIN/settings change, or click "Create Backup Now" above.</div>`}
      </div>
    </div>
    ` : ''}
    <div class="card">
      <h2>Session &amp; Login</h2>
      <div class="small-note" style="margin-bottom:14px;">Super Admin sessions always end when the browser/tab is closed, no matter what's set here. This only controls Admin and Member auto-logout.</div>
      <div class="form-grid">
        <div>
          <label>Admin/Member auto-logout after inactivity (days)</label>
          <input type="number" id="set-sessionInactivityDays" min="1" max="90" value="${s.sessionInactivityDays}">
          <div class="small-note">Admins and Members stay signed in across page refreshes and browser restarts, and are only logged out after this many days with no activity in the app.</div>
        </div>
      </div>
      <button class="btn" onclick="saveSettings()">Save Settings</button>
    </div>`;
}
// Notification Settings card — lets Super Admin turn each notification type
// on/off, and configure the low-balance threshold and the two daily
// reminder times (Bangladesh time). Kept as its own small card + save
// handler so it doesn't have to be entangled with the big general
// saveSettings() form above.
function renderNotificationSettingsCard() {
  const s = state.settings;
  const n = s.notifications || defaultSettings().notifications;
  const toggleOptions = (checked) => `
    <option value="true" ${checked !== false ? 'selected' : ''}>Enabled</option>
    <option value="false" ${checked === false ? 'selected' : ''}>Disabled</option>
  `;
  return `
  <div class="card">
    <h2><i class="fas fa-bell"></i> Notification Settings</h2>
    <div class="small-note" style="margin-bottom:14px;">Controls the in-app Notification Center (bell icon). Notifications never leave the app — no browser/Chrome pop-ups are used.</div>
    <div class="form-grid">
      <div>
        <label>Balance Deposit notifications</label>
        <select id="set-notif-depositEnabled">${toggleOptions(n.depositEnabled)}</select>
        <div class="small-note">Notifies a member whenever a deposit is added to their balance.</div>
      </div>
      <div>
        <label>Balance Withdrawal/Deduction notifications</label>
        <select id="set-notif-withdrawalEnabled">${toggleOptions(n.withdrawalEnabled)}</select>
        <div class="small-note">Notifies a member whenever money is withdrawn/deducted from their balance.</div>
      </div>
      <div>
        <label>Low Balance Warning notifications</label>
        <select id="set-notif-lowBalanceEnabled">${toggleOptions(n.lowBalanceEnabled)}</select>
        <div class="small-note">Notifies a member (once per day) when their balance drops below the threshold below.</div>
      </div>
      <div>
        <label>Low Balance threshold (৳)</label>
        <input type="number" id="set-notif-lowBalanceWarn" min="0" step="1" value="${s.lowBalanceWarn}">
        <div class="small-note">Same threshold used for the caution badge elsewhere in the app.</div>
      </div>
      <div>
        <label>Market/Bazar Duty Reminder notifications</label>
        <select id="set-notif-marketReminderEnabled">${toggleOptions(n.marketReminderEnabled)}</select>
        <div class="small-note">Notifies only the member assigned to market duty, on their duty day.</div>
      </div>
      <div>
        <label>Market/Bazar Reminder time (BD time)</label>
        <input type="time" id="set-notif-marketReminderTime" value="${n.marketReminderTime||'08:00'}">
        <div class="small-note">Sent once per day, at or after this time, to whoever's market day is today.</div>
      </div>
      <div>
        <label>Meal Edit Cutoff Reminder notifications</label>
        <select id="set-notif-mealEditReminderEnabled">${toggleOptions(n.mealEditReminderEnabled)}</select>
        <div class="small-note">Reminds members that tomorrow's meal edit cutoff is approaching today.</div>
      </div>
      <div>
        <label>Meal Edit Reminder time (BD time)</label>
        <input type="time" id="set-notif-mealEditReminderTime" value="${n.mealEditReminderTime||'20:00'}">
        <div class="small-note">Sent once per day, at or after this time (should be before the meal edit cutoff time above).</div>
      </div>
    </div>
    <button class="btn" onclick="saveNotificationSettings()">Save Notification Settings</button>
  </div>
  `;
}
async function saveNotificationSettings() {
  const depositEnabled = document.getElementById('set-notif-depositEnabled').value === 'true';
  const withdrawalEnabled = document.getElementById('set-notif-withdrawalEnabled').value === 'true';
  const lowBalanceEnabled = document.getElementById('set-notif-lowBalanceEnabled').value === 'true';
  const marketReminderEnabled = document.getElementById('set-notif-marketReminderEnabled').value === 'true';
  const mealEditReminderEnabled = document.getElementById('set-notif-mealEditReminderEnabled').value === 'true';
  const lowBalanceWarn = Math.max(0, parseFloat(document.getElementById('set-notif-lowBalanceWarn').value) || 0);
  const marketReminderTime = document.getElementById('set-notif-marketReminderTime').value || '08:00';
  const mealEditReminderTime = document.getElementById('set-notif-mealEditReminderTime').value || '20:00';
  state.settings.lowBalanceWarn = lowBalanceWarn;
  state.settings.notifications = {
    depositEnabled,
    withdrawalEnabled,
    lowBalanceEnabled,
    marketReminderEnabled,
    mealEditReminderEnabled,
    marketReminderTime,
    mealEditReminderTime
  };
  await persistSettings();
  showToast('Notification settings saved.', 'success');
  renderTabContent();
}
// Draft state management for Admin Month Access UI
function updateAdminMonthAccessDraft(module, field, value) {
  if (!_adminMonthAccessDraft) resetAdminMonthAccessDraft();
  if (!_adminMonthAccessDraft[module]) _adminMonthAccessDraft[module] = {
    current: false,
    past: false,
    future: false,
    specificYears: {}
  };
  _adminMonthAccessDraft[module][field] = value;
}
// Adds a new, currently-unused year entry to a module's specificYears grants
// (starts with no months checked — admin then ticks the months they want).
// This is what the "+ Add Year" button calls; previously there was no way
// to add a year at all, so the "Specific Months by Year" section had no
// working way to grant anything.
function addAdminMonthAccessYear(module) {
  if (!_adminMonthAccessDraft) resetAdminMonthAccessDraft();
  if (!_adminMonthAccessDraft[module]) _adminMonthAccessDraft[module] = {
    current: false,
    past: false,
    future: false,
    specificYears: {}
  };
  const existingYears = Object.keys(_adminMonthAccessDraft[module].specificYears || {});
  let candidate = new Date().getFullYear();
  while (existingYears.includes(String(candidate))) candidate++;
  _adminMonthAccessDraft[module].specificYears[String(candidate)] = [];
  renderTabContent(); // re-render so the new year row appears
}

function updateAdminMonthAccessYear(module, oldYear, newYear) {
  if (!_adminMonthAccessDraft) resetAdminMonthAccessDraft();
  if (!_adminMonthAccessDraft[module]) _adminMonthAccessDraft[module] = {
    current: false,
    past: false,
    future: false,
    specificYears: {}
  };
  if (oldYear !== newYear && _adminMonthAccessDraft[module].specificYears[oldYear]) {
    _adminMonthAccessDraft[module].specificYears[newYear] = _adminMonthAccessDraft[module].specificYears[oldYear];
    delete _adminMonthAccessDraft[module].specificYears[oldYear];
  }
}

function removeAdminMonthAccessYear(module, year) {
  if (!_adminMonthAccessDraft) resetAdminMonthAccessDraft();
  if (_adminMonthAccessDraft[module] && _adminMonthAccessDraft[module].specificYears) {
    delete _adminMonthAccessDraft[module].specificYears[year];
  }
  renderTabContent(); // re-render to show updated UI
}

function updateAdminMonthAccessYearMonth(module, year, month, checked) {
  if (!_adminMonthAccessDraft) resetAdminMonthAccessDraft();
  if (!_adminMonthAccessDraft[module].specificYears[year]) {
    _adminMonthAccessDraft[module].specificYears[year] = [];
  }
  if (checked) {
    if (!_adminMonthAccessDraft[module].specificYears[year].includes(month)) {
      _adminMonthAccessDraft[module].specificYears[year].push(month);
      _adminMonthAccessDraft[module].specificYears[year].sort();
    }
  } else {
    _adminMonthAccessDraft[module].specificYears[year] = _adminMonthAccessDraft[module].specificYears[year].filter(m => m !== month);
  }
}

function updateAdminMonthAccessYearAllMonths(module, year, checked) {
  if (!_adminMonthAccessDraft) resetAdminMonthAccessDraft();
  if (checked) {
    _adminMonthAccessDraft[module].specificYears[year] = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  } else {
    _adminMonthAccessDraft[module].specificYears[year] = [];
  }
  renderTabContent(); // re-render month grid
}

async function saveSettings() {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can do this.', 'error');
    return;
  }
  const mealLockTimeParts = document.getElementById('set-mealLockTime').value.split(':').map(Number);
  const mealLockHour = mealLockTimeParts[0];
  const mealLockMinute = mealLockTimeParts[1] || 0;
  const mealLockEnabled = document.getElementById('set-mealLockEnabled').value === 'true';
  const maxMealQty = Math.max(1, parseInt(document.getElementById('set-maxMealQty').value, 10) || 1);
  const maxMealQtyScope = document.getElementById('set-maxMealQtyScope').value;
  const lowBalanceWarn = Math.max(0, parseFloat(document.getElementById('set-lowBalanceWarn').value) || 0);
  const negativeBalanceBuffer = Math.max(0, parseFloat(document.getElementById('set-negativeBalanceBuffer').value) || 0);
  const marketDeadlineLunch = Number(document.getElementById('set-marketDeadlineLunch').value);
  const marketDeadlineDinner = Number(document.getElementById('set-marketDeadlineDinner').value);
  const sessionDaysInput = document.getElementById('set-sessionInactivityDays');
  const sessionInactivityDays = sessionDaysInput ? Math.max(1, parseInt(sessionDaysInput.value, 10) || 7) : state.settings.sessionInactivityDays;
  const recordedAtVisibility = document.getElementById('set-recordedAtVisibility').value;
  const addedByVisibility = document.getElementById('set-addedByVisibility').value;
  const mealsHistoryVisibility = document.getElementById('set-mealsHistoryVisibility').value;
  // Commit draft admin month access settings
  if (_adminMonthAccessDraft) {
    state.settings.adminMonthAccess = JSON.parse(JSON.stringify(_adminMonthAccessDraft));
  }

  state.settings = {
    mealLockHour,
    mealLockMinute,
    mealLockEnabled,
    maxMealQty,
    maxMealQtyScope,
    lowBalanceWarn,
    negativeBalanceBuffer,
    marketDeadlineLunch,
    marketDeadlineDinner,
    sessionInactivityDays,
    recordedAtVisibility,
    addedByVisibility,
    mealsHistoryVisibility,
    adminMonthAccess: state.settings.adminMonthAccess,
    notifications: state.settings.notifications
  };
  await persistSettings();
  lastActivityWriteAt = 0;
  refreshSessionActivity();
  showToast('Settings saved.', 'success');
  renderTabContent();
}
async function resetSettings() {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can do this.', 'error');
    return;
  }
  if (!confirm('Reset all settings to their defaults?')) return;
  await snapshotMembersAndSettings('Before resetting settings to defaults');
  state.settings = defaultSettings();
  resetAdminMonthAccessDraft(); // reset draft to match new defaults
  await persistSettings();
  lastActivityWriteAt = 0;
  refreshSessionActivity();
  showToast('Settings reset to defaults.', 'success');
  renderTabContent();
}