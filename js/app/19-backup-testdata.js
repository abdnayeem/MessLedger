// ---------------------------------------------------------------------------
// 19-backup-testdata.js  (originally app.js lines 6751-7036)
// Member/settings snapshots, manual backup, restore snapshot, reset/restore test data, state validation, cache clear, boot error UI
// ---------------------------------------------------------------------------

/* ---------------- MEMBER/SETTINGS SNAPSHOTS (backup & undo) ----------------
   Point-in-time backups of state.members + state.settings, taken
   automatically right before any operation that can damage them (member
   removed, role changed, PIN reset, settings reset to defaults) and also
   available on demand via "Create Backup Now" in Danger Zone. Restoring one
   is how a super admin undoes a bad member/role/PIN change — including a
   change made minutes or days ago, not just the very last action. */

// Takes a snapshot and pushes it onto the front of state.memberSnapshots,
// trimming to MAX_MEMBER_SNAPSHOTS (oldest dropped first). Deliberately
// swallows its own errors: a failed safety-snapshot should never block the
// real operation the caller is about to do — it just means that one
// operation won't have an undo point, which gets logged so it's visible.
async function snapshotMembersAndSettings(label) {
  _pendingWriteCount++;
  try {
    const entry = {
      id: 'snap' + Date.now() + Math.random().toString(36).slice(2, 7),
      createdAt: nowTimestamp(),
      label: label || 'Backup',
      members: JSON.parse(JSON.stringify(state.members)),
      settings: JSON.parse(JSON.stringify(state.settings))
    };
    const updated = [entry, ...(state.memberSnapshots || [])].slice(0, MAX_MEMBER_SNAPSHOTS);
    await storage.set(KEY_MEMBER_SNAPSHOTS, JSON.stringify(updated), true);
    state.memberSnapshots = updated;
    return entry;
  } catch (e) {
    console.error('snapshotMembersAndSettings failed (operation will continue without an undo point):', e);
    return null;
  } finally {
    _pendingWriteSettled();
  }
}

// Manual "Create Backup Now" button in Danger Zone — lets a super admin take
// a restore point at will, not just automatically before risky ops.
async function createManualBackup() {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can do this.', 'error');
    return;
  }
  const entry = await snapshotMembersAndSettings('Manual backup');
  if (entry) {
    showToast('Backup created.', 'success');
    renderTabContent();
  } else {
    showToast('Backup failed — check your connection and try again.', 'error');
  }
}

// Restores members + settings to an earlier snapshot. Before overwriting
// anything, it takes ONE MORE safety snapshot of whatever is currently
// live — so a restore is itself always undoable by restoring again,
// instead of being the one operation in this system with no way back.
async function restoreMemberSnapshot(id) {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can do this.', 'error');
    return;
  }
  const snap = (state.memberSnapshots || []).find(s => s.id === id);
  if (!snap) {
    showToast('That backup was not found — it may have been pruned.', 'error');
    return;
  }
  const me = state.members.find(m => m.id === session.userId);
  const when = new Date(snap.createdAt).toLocaleString();
  const enteredPin = prompt(`This restores members & settings to the backup from ${when} ("${snap.label}"), overwriting what's currently saved. The current members & settings will themselves be auto-backed-up first, so this can be undone by restoring again.\n\nEnter your super admin PIN to confirm:`);
  if (enteredPin === null) return;
  if (!me || enteredPin !== me.pin) {
    showToast('Incorrect PIN. Restore cancelled.', 'error');
    return;
  }

  try {
    await snapshotMembersAndSettings(`Auto-backup before restoring "${snap.label}" (${when})`);
    state.members = JSON.parse(JSON.stringify(snap.members));
    state.settings = JSON.parse(JSON.stringify(snap.settings));
    await persistMembers();
    await persistSettings();
    showToast(`Restored members & settings from ${when}.`, 'success');
    renderTabContent();
  } catch (e) {
    console.error('restoreMemberSnapshot failed:', e);
    showToast('Restore failed: ' + (e && e.message ? e.message : 'unknown error'), 'error');
  }
}

// Wipes all transactional/test data (meals, deposits, expenses, grocery
// costs, login logs, notifications, monthlyActive) in one go, ahead of a
// real release — so testing data doesn't have to be removed doc-by-doc.
// Deliberately leaves members and settings untouched (real member list /
// PINs / app config survive the reset).
async function resetTestData() {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can do this.', 'error');
    return;
  }
  const me = state.members.find(m => m.id === session.userId);
  const enteredPin = prompt('This permanently deletes ALL meals, deposits, expenses, grocery costs, login logs and notifications for every member. Members and settings will NOT be touched. This cannot be undone.\n\nEnter your super admin PIN to confirm:');
  if (enteredPin === null) return;
  if (!me || enteredPin !== me.pin) {
    showToast('Incorrect PIN. Reset cancelled.', 'error');
    return;
  }
  const typed = prompt('PIN confirmed. Type RESET to finish confirming:');
  if (typed !== 'RESET') {
    if (typed !== null) showToast('Reset cancelled — text did not match.', 'error');
    return;
  }

  showToast('Resetting test data…', 'success');
  try {
    // Login/action logs AND notifications now all live in their own
    // collection (LOGS_COLLECTION — see storage.js), separate from
    // mealAppStorage, so they have to be fetched and wiped from there too,
    // not just from `all`. Each wiped item is tagged with which collection
    // it came from (`col`) so restoreTestData() below knows where to write
    // it back.
    const [all, allLogs] = await Promise.all([
      fetchAllStorageItems(),
      logStorage.getAll(true)
    ]);
    const wipePrefixes = [PFX_DAY, PFX_DEPOSIT, PFX_EXPENSE, PFX_COST, PFX_MONTHLYACTIVE];
    const itemsToWipe = all.items
      .filter(it => wipePrefixes.some(pfx => it.key.startsWith(pfx)))
      .map(it => ({ key: it.key, value: it.value, col: 'main' }));
    const logItemsToWipe = (allLogs.items || [])
      .filter(it => it.key.startsWith(PFX_LOGINLOG) || it.key.startsWith(PFX_ACTIONLOG) || it.key.startsWith(PFX_NOTIF))
      .map(it => ({ key: it.key, value: it.value, col: 'logs' }));
    const allItemsToWipe = itemsToWipe.concat(logItemsToWipe);

    // Snapshot everything we're about to delete so it can be restored within
    // 7 days — see restoreTestData() and the Danger Zone card in Settings.
    const backup = {
      createdAt: nowTimestamp(),
      items: allItemsToWipe
    };
    await storage.set(KEY_TEST_DATA_BACKUP, JSON.stringify(backup), true);
    state.testDataBackup = backup;

    await Promise.all([
      ...itemsToWipe.map(it => storage.delete(it.key, true)),
      ...logItemsToWipe.map(it => logStorage.delete(it.key, true))
    ]);

    state.days = {};
    state.deposits = [];
    state.expenses = [];
    state.costs = [];
    state.loginLogs = [];
    state.actionLogs = [];
    state.notifications = [];
    state.monthlyActive = {};
    _markEdited();

    showToast(`Test data reset — ${allItemsToWipe.length} record(s) deleted. You can restore this within 7 days from Danger Zone.`, 'success');
    renderTabContent();
  } catch (e) {
    console.error('resetTestData failed:', e);
    showToast('Reset failed: ' + (e && e.message ? e.message : 'unknown error'), 'error');
  }
}

// How many whole days are left to restore the pre-reset backup, or null if
// there's no backup / it has already expired past the 7-day window.
function testDataBackupDaysLeft() {
  const b = state.testDataBackup;
  if (!b) return null;
  const ageMs = Date.now() - b.createdAt;
  const msLeft = (7 * 24 * 60 * 60 * 1000) - ageMs;
  if (msLeft <= 0) return null;
  return Math.max(1, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
}

async function restoreTestData() {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can do this.', 'error');
    return;
  }
  const daysLeft = testDataBackupDaysLeft();
  if (daysLeft === null) {
    showToast('No restorable backup available — it may have expired (backups last 7 days).', 'error');
    return;
  }
  const me = state.members.find(m => m.id === session.userId);
  const enteredPin = prompt(`This restores the ${state.testDataBackup.items.length} record(s) deleted by the last "Reset All Test Data", overwriting anything currently saved under the same dates/records. This cannot be undone.\n\nEnter your super admin PIN to confirm:`);
  if (enteredPin === null) return;
  if (!me || enteredPin !== me.pin) {
    showToast('Incorrect PIN. Restore cancelled.', 'error');
    return;
  }

  showToast('Restoring test data…', 'success');
  try {
    const backup = state.testDataBackup;
    // Each item knows which collection it came from (`col: 'main'|'logs'`
    // — see resetTestData() above). Older backups taken before logs moved
    // to their own collection won't have `col` set — those are always
    // main-collection items (they predate LOGS_COLLECTION entirely), so
    // default to 'main' for backward compatibility.
    const mainItems = backup.items.filter(it => (it.col || 'main') === 'main');
    const logItems = backup.items.filter(it => it.col === 'logs');
    await Promise.all([
      ...mainItems.map(it => storage.set(it.key, it.value, true)),
      ...logItems.map(it => logStorage.set(it.key, it.value, true))
    ]);

    // Rebuild the affected parts of state from the restored records, same
    // parsing rules as buildStateFromItems() — mirrors how resetTestData()
    // updates state immediately rather than waiting on the realtime listener.
    // Logs and notifications are intentionally left for loadLogs()/
    // loadNotifications() to pick up on-demand (the latter right below;
    // the former next time the Login Log / Database Log tab is opened),
    // same as anywhere else in the app now — neither is part of the
    // live-synced state.
    state.days = {};
    state.deposits = [];
    state.expenses = [];
    state.costs = [];
    state.monthlyActive = {};
    mainItems.forEach(it => {
      if (it.key.startsWith(PFX_DAY)) state.days[it.key.slice(PFX_DAY.length)] = JSON.parse(it.value);
      else if (it.key.startsWith(PFX_DEPOSIT)) state.deposits.push(JSON.parse(it.value));
      else if (it.key.startsWith(PFX_EXPENSE)) state.expenses.push(JSON.parse(it.value));
      else if (it.key.startsWith(PFX_COST)) state.costs.push(JSON.parse(it.value));
      else if (it.key.startsWith(PFX_MONTHLYACTIVE)) state.monthlyActive[it.key.slice(PFX_MONTHLYACTIVE.length)] = JSON.parse(it.value);
    });
    if (logItems.length) await Promise.all([loadLogs(), loadNotifications()]);

    // Backup is now consumed — clear it so the restore option disappears
    // until the next reset creates a fresh one.
    await storage.delete(KEY_TEST_DATA_BACKUP, true);
    state.testDataBackup = null;
    _markEdited();

    showToast(`Restored ${backup.items.length} record(s).`, 'success');
    renderTabContent();
  } catch (e) {
    console.error('restoreTestData failed:', e);
    showToast('Restore failed: ' + (e && e.message ? e.message : 'unknown error'), 'error');
  }
}

/* ---------------- STATE VALIDATION & HELPERS ---------------- */
function validateState(state) {
  const required = ['members', 'settings', 'days', 'deposits', 'expenses', 'costs'];

  if (!state || typeof state !== 'object') {
    throw new Error('State is not a valid object');
  }

  for (const key of required) {
    if (!(key in state)) {
      throw new Error(`State validation failed: missing "${key}"`);
    }

    if (key === 'members' && !Array.isArray(state.members)) {
      throw new Error(`State.${key} must be an array`);
    }
    if (key === 'settings' && typeof state.settings !== 'object') {
      throw new Error(`State.${key} must be an object`);
    }
  }

  return state;
}

function clearLocalCache() {
  try {
    localStorage.removeItem(LOCAL_CACHE_KEY);
  } catch (err) {
    console.warn('Could not clear local cache:', err);
  }
}

function isMonthAccessible(month, module) {
  // Super admin always has access
  if (session.role === 'superadmin') return true;

  // Check if module access is configured
  if (!state.settings || !state.settings.adminMonthAccess) return false;

  const access = state.settings.adminMonthAccess[module];
  if (!access) return false;

  // Extract year and month from "2024-01" format
  const [year, monthNum] = month.split('-');

  // Check if this specific month is in the allowed list
  if (access.specificYears && access.specificYears[year]) {
    return access.specificYears[year].includes(monthNum);
  }

  return false;
}

/* ---------------- INIT ---------------- */
function showBootError(message) {
  const el = document.getElementById('boot-loader');
  if (!el) return;
  el.innerHTML = `
    <div style="max-width:320px; text-align:center; padding:0 16px;">
      <div style="font-size:28px; margin-bottom:8px;">⚠️</div>
      <div style="color:var(--danger); font-weight:700; font-size:14px; margin-bottom:6px;">Couldn't load MessLedger</div>
      <div style="color:var(--ink-faint); font-size:12.5px; line-height:1.5; margin-bottom:14px;">${message}</div>
      <button onclick="location.reload()" style="padding:8px 16px; border-radius:6px; border:1px solid var(--primary); background:var(--primary); color:#fff; font-weight:600; font-size:13px; cursor:pointer;">Reload</button>
    </div>`;
}