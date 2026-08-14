// ---------------------------------------------------------------------------
// 03-persistence.js  (originally app.js lines 1020-1317)
// Pending-write tracking + all persistX/deleteXDoc functions that write individual records to Firestore
// ---------------------------------------------------------------------------
let _localEditedSinceBoot = false;

function _markEdited() {
  _localEditedSinceBoot = true;
  clearCalcCache();
  // See _hasFullState in 02-state-storage.js: only cache `state` once it's
  // confirmed to be the complete dataset, never the lightweight pre-login
  // slice (which a failed-login persistMembers() call could otherwise
  // overwrite the good cache with).
  if (_hasFullState) writeLocalCache(state);
}

// ---- Pending-write tracking (fixes: "showed success but the data wasn't
// actually there later") ----
// Meals/costs/expenses/deposits are saved "optimistically": the on-screen
// change and the success checkmark/toast appear immediately, while the
// actual write to the server (persistDay/persistCost/persistExpense/
// persistDeposit and their delete counterparts below) happens in the
// background — this is what makes typing a meal qty or adding a cost feel
// instant. The realtime listener (startRealtimeSync -> applyFreshState)
// can fire in that same window, with a server snapshot that doesn't include
// the change yet (the write hasn't landed) — if that snapshot were applied
// right away, it would silently overwrite local `state` and make the change
// vanish from the screen, even though the success message already showed,
// and permanently if the write then goes on to fail. _pendingWriteCount
// tracks how many such writes are still in flight; applyFreshState() holds
// off replacing `state` until they've all settled, then applies the latest
// snapshot it received in the meantime.
let _pendingWriteCount = 0;
let _lastPendingFresh = null;
// BUGFIX (role/PIN change reverts itself right after the "success" toast):
// this used to reapply _lastPendingFresh as soon as pending writes hit zero.
// But that held snapshot can be — and, per the reported bug, reliably was —
// a snapshot captured WHILE our write was still in flight, i.e. from BEFORE
// it committed. Applying it here overwrote `state` back to the pre-change
// value a split second after persistMembers()/persistDay()/etc. had already
// resolved successfully: the save genuinely worked, but this stale snapshot
// silently clobbered it immediately after, before the screen even redrew.
// There's no cheap way to tell here whether a given held snapshot is stale
// or current, so the safe fix is to not guess: just drop it. Firestore will
// always fire a fresh snapshot event for our own just-committed write within
// moments anyway, and THAT one is guaranteed current — so state still ends
// up correct almost immediately, without the guesswork that was reverting it.
function _pendingWriteSettled() {
  _pendingWriteCount = Math.max(0, _pendingWriteCount - 1);
  if (_pendingWriteCount === 0) _lastPendingFresh = null;
}
// BUGFIX (role/PIN/member-edit reverting itself): the realtime listener
// (see startRealtimeSync()/applyFreshState() below) re-applies the ENTIRE
// server state on every snapshot event, including events that were already
// in flight when this device made its own write. persistDay/persistDeposit/
// persistExpense/persistCost already guarded against this with
// _pendingWriteCount so a racing snapshot gets held instead of clobbering
// the change — but persistMembers/persistSettings/persistMeta did not, so a
// member edit, role change, or PIN reset could appear to instantly "revert
// itself": the write succeeded, but a stale snapshot that raced in right
// after immediately overwrote it in the UI. Now guarded the same way.
// BUGFIX (role/PIN change says "updated" but doesn't stick): this used to
// swallow its own failure completely — show its own "Failed to save" toast,
// then return nothing. Every caller (changeRole, resetMemberPin,
// removeMember, etc.) called `await persistMembers()` and then
// unconditionally showed its OWN "success" toast right after, with no way
// to know the save had actually failed. That's exactly the reported bug:
// user sees "Role updated" (and the change even displays right away, since
// it's already applied to local `state` in memory) — but the write to
// Firestore never landed, so the next realtime snapshot / reload brings
// back the old value, and it looks like the change "didn't really happen."
// Now returns true/false so callers can check before claiming success.
async function persistMembers() {
  _markEdited();
  _pendingWriteCount++;
  try {
    await storage.set(KEY_MEMBERS, JSON.stringify(state.members), true);
    logAction('members', 'update', '', 'Member list updated');
    return true;
  } catch (e) {
    console.error('persistMembers failed:', e);
    showToast('Failed to save: ' + (e && e.message ? e.message : 'unknown error'), 'error');
    return false;
  } finally {
    _pendingWriteSettled();
  }
}
async function persistSettings() {
  _markEdited();
  _pendingWriteCount++;
  try {
    await storage.set(KEY_SETTINGS, JSON.stringify(state.settings), true);
    logAction('settings', 'update', '', 'Settings updated');
    return true;
  } catch (e) {
    console.error('persistSettings failed:', e);
    showToast('Failed to save: ' + (e && e.message ? e.message : 'unknown error'), 'error');
    return false;
  } finally {
    _pendingWriteSettled();
  }
}
async function persistMeta() {
  _markEdited();
  _pendingWriteCount++;
  try {
    await storage.set(KEY_META, JSON.stringify({
      recoveryCode: state.recoveryCode,
      migrated: true
    }), true);
    return true;
  } catch (e) {
    console.error('persistMeta failed:', e);
    showToast('Failed to save: ' + (e && e.message ? e.message : 'unknown error'), 'error');
    return false;
  } finally {
    _pendingWriteSettled();
  }
}
async function persistDay(date) {
  _markEdited();
  _pendingWriteCount++;
  try {
    await storage.set(PFX_DAY + date, JSON.stringify(state.days[date]), true);
    logAction('meals', 'update', date, `Meals updated for ${date}`);
    return true;
  } catch (e) {
    console.error('persistDay failed:', e);
    showToast('Failed to save: ' + (e && e.message ? e.message : 'unknown error'), 'error');
    return false;
  } finally {
    _pendingWriteSettled();
  }
}
async function persistDeposit(id) {
  _markEdited();
  _pendingWriteCount++;
  const d = state.deposits.find(x => x.id === id);
  try {
    await storage.set(PFX_DEPOSIT + id, JSON.stringify(d), true);
    logAction('deposits', 'update', id, d ? `${d.type==='withdrawal'?'Withdrawal':'Deposit'} of ${fmtMoney(Math.abs(d.amount))} for ${d.memberId}` : '');
    return true;
  } catch (e) {
    console.error('persistDeposit failed:', e);
    showToast('Failed to save: ' + (e && e.message ? e.message : 'unknown error'), 'error');
    return false;
  } finally {
    _pendingWriteSettled();
  }
}
async function deleteDepositDoc(id) {
  _markEdited();
  _pendingWriteCount++;
  try {
    await storage.delete(PFX_DEPOSIT + id, true);
    logAction('deposits', 'delete', id, 'Deposit/withdrawal record deleted');
    return true;
  } catch (e) {
    console.error('deleteDepositDoc failed:', e);
    showToast('Failed to delete: ' + (e && e.message ? e.message : 'unknown error'), 'error');
    return false;
  } finally {
    _pendingWriteSettled();
  }
}
async function persistExpense(id) {
  _markEdited();
  _pendingWriteCount++;
  const ex = state.expenses.find(x => x.id === id);
  try {
    await storage.set(PFX_EXPENSE + id, JSON.stringify(ex), true);
    logAction('expenses', 'update', id, ex ? `Shared expense: ${ex.title} (${fmtMoney(ex.amount)})` : '');
    return true;
  } catch (e) {
    console.error('persistExpense failed:', e);
    showToast('Failed to save: ' + (e && e.message ? e.message : 'unknown error'), 'error');
    return false;
  } finally {
    _pendingWriteSettled();
  }
}
async function deleteExpenseDoc(id) {
  _markEdited();
  _pendingWriteCount++;
  try {
    await storage.delete(PFX_EXPENSE + id, true);
    logAction('expenses', 'delete', id, 'Shared expense deleted');
    return true;
  } catch (e) {
    console.error('deleteExpenseDoc failed:', e);
    showToast('Failed to delete: ' + (e && e.message ? e.message : 'unknown error'), 'error');
    return false;
  } finally {
    _pendingWriteSettled();
  }
}
async function persistCost(id) {
  _markEdited();
  _pendingWriteCount++;
  const c = state.costs.find(x => x.id === id);
  try {
    await storage.set(PFX_COST + id, JSON.stringify(c), true);
    logAction('costs', 'update', id, c ? `Grocery cost of ${fmtMoney(c.amount)} (${c.mealType})` : '');
    return true;
  } catch (e) {
    console.error('persistCost failed:', e);
    showToast('Failed to save: ' + (e && e.message ? e.message : 'unknown error'), 'error');
    return false;
  } finally {
    _pendingWriteSettled();
  }
}
async function deleteCostDoc(id) {
  _markEdited();
  _pendingWriteCount++;
  try {
    await storage.delete(PFX_COST + id, true);
    logAction('costs', 'delete', id, 'Grocery cost record deleted');
    return true;
  } catch (e) {
    console.error('deleteCostDoc failed:', e);
    showToast('Failed to delete: ' + (e && e.message ? e.message : 'unknown error'), 'error');
    return false;
  } finally {
    _pendingWriteSettled();
  }
}
// NOTE: log writes/deletes go through logStorage (LOGS_COLLECTION), not
// storage (STORAGE_COLLECTION) — see the LOGS_COLLECTION comment in
// storage.js. This is what keeps every login and every add/edit/delete
// from also generating a read for every other currently-connected member's
// live listener.
async function persistLoginLog(id) {
  const l = state.loginLogs.find(x => x.id === id);
  if (!l) return;
  try {
    await logStorage.set(PFX_LOGINLOG + id, JSON.stringify(l), true);
  } catch (e) {
    console.error('persistLoginLog failed:', e);
  }
}
async function deleteLoginLogDoc(id) {
  try {
    await logStorage.delete(PFX_LOGINLOG + id, true);
  } catch (e) {
    console.error('deleteLoginLogDoc failed:', e);
  }
}
async function persistActionLog(id) {
  const l = state.actionLogs.find(x => x.id === id);
  if (!l) return;
  try {
    await logStorage.set(PFX_ACTIONLOG + id, JSON.stringify(l), true);
  } catch (e) {
    console.error('persistActionLog failed:', e);
  }
}
async function deleteActionLogDoc(id) {
  try {
    await logStorage.delete(PFX_ACTIONLOG + id, true);
  } catch (e) {
    console.error('deleteActionLogDoc failed:', e);
  }
}
// Notifications go to logStorage (LOGS_COLLECTION), not storage
// (STORAGE_COLLECTION) — same reason login/action logs do, see the
// LOGS_COLLECTION comment in storage.js. Each is still its own small doc
// (PFX_NOTIF + id), and a member's notification list still round-trips
// through login/the bell/the periodic scheduler (see loadNotifications() in
// 02-state-storage.js) so read/unread state matches across devices — it's
// just no longer part of the collection every other signed-in member has a
// live listener open on. Not part of _pendingWriteCount either: that guard
// exists to stop the live meal/deposit/etc snapshot from overwriting an
// in-flight write of the SAME data — notifications aren't in that snapshot
// anymore, so there's nothing for a notification write to race against.
async function persistNotification(id) {
  const n = (state.notifications || []).find(x => x.id === id);
  if (!n) return;
  try {
    await logStorage.set(PFX_NOTIF + id, JSON.stringify(n), true);
  } catch (e) {
    console.error('persistNotification failed:', e);
  }
}
// IDs we've deleted locally (e.g. the member opened/read it) but the server
// delete may not have confirmed yet. loadNotifications() runs on a timer and
// on login/bell-open, independently of any particular write finishing — a
// fetch that races in during that window would otherwise still contain the
// (not-yet-deleted) doc and bring an already-read notification back to the
// bell. Filtered out there; cleared once the delete actually resolves.
const _pendingDeletedNotifIds = new Set();
async function deleteNotificationDoc(id) {
  _pendingDeletedNotifIds.add(id);
  try {
    await logStorage.delete(PFX_NOTIF + id, true);
  } catch (e) {
    console.error('deleteNotificationDoc failed:', e);
  } finally {
    _pendingDeletedNotifIds.delete(id);
  }
}
async function persistMonthlyActive(month) {
  _markEdited();
  _pendingWriteCount++;
  try {
    await storage.set(PFX_MONTHLYACTIVE + month, JSON.stringify(state.monthlyActive[month] || {}), true);
  } catch (e) {
    console.error('persistMonthlyActive failed:', e);
    showToast('Failed to save: ' + (e && e.message ? e.message : 'unknown error'), 'error');
  } finally {
    _pendingWriteSettled();
  }
}

