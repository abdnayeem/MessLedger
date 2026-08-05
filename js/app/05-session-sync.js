// ---------------------------------------------------------------------------
// 05-session-sync.js  (originally app.js lines 1343-1718)
// Session expiry/activity tracking, background pause, realtime sync (onSnapshot), auto-sync, session countdown UI, notification scheduler
// ---------------------------------------------------------------------------
function sessionInactivityMs() {
  const days = (state && state.settings && state.settings.sessionInactivityDays) || 7;
  return days * 24 * 60 * 60 * 1000;
}

function computeSessionExpiry() {
  return Date.now() + sessionInactivityMs();
}

function persistSession(m) {
  try {
    // Every role now persists the same way, in localStorage with a normal
    // expiry — previously superadmin used sessionStorage only, which the
    // browser wipes the moment it's closed (not just refreshed), forcing a
    // fresh login every time. Members/admins never had that problem since
    // they already used localStorage; superadmin now behaves the same way.
    sessionExpiresAt = computeSessionExpiry();
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      userId: m.id,
      role: m.role,
      expiresAt: sessionExpiresAt
    }));
    sessionStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}

function loadPersistedSession() {
  // Back-compat: some browsers may still have an old superadmin session
  // sitting in sessionStorage from before this fix — honor it if present
  // (it'll naturally disappear once the tab/browser closes, same as
  // before), but the primary, going-forward path is localStorage below.
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      if (parsed && parsed.userId && parsed.role === 'superadmin') return parsed;
    }
  } catch (e) {}
  try {
    const l = localStorage.getItem(SESSION_KEY);
    if (l) {
      const parsed = JSON.parse(l);
      if (parsed && parsed.userId && parsed.expiresAt) {
        if (Date.now() < parsed.expiresAt) return parsed;
        localStorage.removeItem(SESSION_KEY);
      }
    }
  } catch (e) {}
  return null;
}

function clearPersistedSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch (e) {}
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {}
}

function refreshSessionActivity() {
  if (!session.userId) return;
  const now = Date.now();
  if (now - lastActivityWriteAt < 60000) return;
  lastActivityWriteAt = now;
  sessionExpiresAt = computeSessionExpiry();
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      userId: session.userId,
      role: session.role,
      expiresAt: sessionExpiresAt
    }));
  } catch (e) {}
}
let _activityBound = false;
// How long a tab can sit in the background before we tear down its live
// Firestore listener. Short app-switches (checking another tab for a few
// seconds, a phone screen blinking on/off) get a grace period so we're not
// constantly disconnecting/reconnecting — but a tab left minimized for a
// while (someone scrolling Facebook, watching YouTube, phone in their
// pocket) stops costing reads after this point.
const BACKGROUND_SYNC_PAUSE_MS = 2 * 60 * 1000; // 2 minutes
let _backgroundPauseTimer = null;
let _listenerPausedForBackground = false;

function bindActivityTracking() {
  if (_activityBound) return;
  _activityBound = true;
  ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(evt => {
    document.addEventListener(evt, refreshSessionActivity, {
      passive: true
    });
  });
  // Real edit activity (typing a number, adjusting a textarea, picking a
  // select option) — separate from just having a field focused. See
  // applyFreshState() for why this distinction matters for realtime sync.
  document.addEventListener('input', () => {
    _lastInputAt = Date.now();
  }, {
    passive: true
  });
  // The 1s countdown timer used to keep running even when the tab was
  // backgrounded / screen locked (common on phones), which wakes the CPU
  // once a second for no visible benefit and drains battery. Pause it while
  // hidden and just resync the displayed text + interval once the user is
  // actually looking at the page again.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopSessionCountdown();
      // Start (or restart) the grace-period timer. If the tab comes back
      // before this fires, it's cancelled below and the listener never
      // stops — this only kicks in for a genuinely backgrounded tab.
      if (session.userId) {
        if (_backgroundPauseTimer) clearTimeout(_backgroundPauseTimer);
        _backgroundPauseTimer = setTimeout(() => {
          stopRealtimeSync();
          _listenerPausedForBackground = true;
          _backgroundPauseTimer = null;
        }, BACKGROUND_SYNC_PAUSE_MS);
      }
    } else {
      if (_backgroundPauseTimer) {
        clearTimeout(_backgroundPauseTimer);
        _backgroundPauseTimer = null;
      }
      if (session.userId && sessionExpiresAt) {
        updateSessionCountdownText();
        startSessionCountdown();
      }
      // Someone (e.g. an Admin) may have changed data while this tab was in
      // the background. Pull fresh data the moment it's looked at again,
      // instead of waiting for the person to notice and manually refresh.
      if (session.userId) {
        if (_listenerPausedForBackground) {
          // The listener was torn down while backgrounded — restarting it
          // fetches a fresh snapshot on its own, so a separate
          // syncFromServer() call on top of that would just be a second,
          // redundant full read.
          _listenerPausedForBackground = false;
          startRealtimeSync();
        } else {
          // Only briefly backgrounded — the listener never stopped, but
          // pull once more as a safety net in case anything was missed.
          syncFromServer();
        }
      }
    }
  });
  // NOTE: startRealtimeSync() is intentionally NOT called here anymore.
  // This function runs on every page load, including on the login screen
  // before anyone has signed in — starting the listener here meant simply
  // opening index.html (no login required) subscribed to a live Firestore
  // listener on the ENTIRE storage collection, billing reads for every
  // write anyone made, for as long as the tab stayed open. It's now started

  // from enterApp() instead, once there's an actual signed-in session.
}

/* ---------------- LIVE DATA SYNC ----------------
   storage.js now exposes onSnapshotAll(), a real Firestore collection
   listener — so this is true push-based sync, not polling. The listener
   fires immediately with the current data, then again within roughly a
   fraction of a second of ANY change to ANY document (this browser's own
   writes, another admin's, or a direct Firestore edit). If the listener
   can't be started (older storage.js, or it errors out — e.g. a permission
   or network problem), this quietly falls back to the same background
   polling this app used before, so the app still keeps working. */
// Applies a freshly-loaded/pushed state object to the app the same way
// regardless of where it came from (the realtime listener or a polling
// fallback fetch): clears the stale-cache trap, and avoids clobbering an
// in-progress edit (typing in a field, or unsaved Monthly Active checkboxes).
function applyFreshState(fresh, force) {
  const activeTag = document.activeElement && document.activeElement.tagName;
  const isFocused = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';
  // Being focused isn't the same as being edited — a field can sit focused
  // (clicked into, then left alone) for a long time with nothing typed.
  // Previously ANY focused field paused live re-renders indefinitely, which
  // is why another member's changes could show up "late" — only until you
  // clicked away. Now it only holds off while there's been an actual
  // keystroke/edit in the last 1.5s, so it releases itself the moment
  // you're not mid-edit anymore instead of waiting on an unrelated field blur.
  const isTyping = isFocused && (Date.now() - _lastInputAt) < 1500;
  // A write we made ourselves (meal qty, cost, expense, deposit/withdrawal,
  // member/role/PIN/settings edit — see persistDay/persistCost/persistExpense/
  // persistDeposit/persistMembers/persistSettings above) hasn't been
  // confirmed saved yet — applying this snapshot now would overwrite `state`
  // with server data that doesn't include it, making the just-made change
  // disappear (silently, since the success message already showed).
  // Hold this snapshot and re-apply it once the pending write(s) settle.
  //
  // BUGFIX: this used to also check `&& !force`, and the realtime listener
  // below calls applyFreshState with force=true for every snapshot after the
  // very first one — which is effectively every live update that happens
  // while the app is open. That meant this guard was bypassed almost every
  // time, letting an in-flight snapshot silently overwrite a role/PIN/
  // settings change a fraction of a second after it was made (member edits
  // looked like they "reverted themselves"). `force` is still used below to
  // control whether a snapshot forces a re-render despite active typing —
  // that's a separate concern and shouldn't also decide whether an
  // in-flight write of ours is safe to overwrite. This check must never be
  // skippable, regardless of what any caller passes for `force`.
  if (_pendingWriteCount > 0) {
    _lastPendingFresh = fresh;
    return;
  }
  // Drop any notification that we've deleted locally but whose server
  // delete hasn't confirmed yet — otherwise a snapshot that races in during
  // that window would bring an already-read notification back to life.
  if (_pendingDeletedNotifIds.size && fresh.notifications && fresh.notifications.length) {
    fresh.notifications = fresh.notifications.filter(n => !_pendingDeletedNotifIds.has(n.id));
  }
  state = fresh;
  // The memo cache is keyed by memberId/month, not by "which state object"
  // it was computed from — so after swapping in fresh data here, any
  // previously-cached figures (balance, summary totals, etc.) are stale
  // until this is cleared. Without this, live updates would refresh some
  // parts of the UI (whatever isn't memoized) while others quietly kept
  // showing numbers from before.
  clearCalcCache();
  writeLocalCache(state);
  if ((isTyping || _maDirty) && !force) {
    // Someone's mid-typing (a form field, a search box), or has unsaved
    // Monthly Active checkbox changes — update the data quietly in memory
    // but don't re-render and wipe what they're doing right now.
    // Also schedule a one-off check just past the typing window: if no
    // further edit happens (and no new sync event arrives to retrigger
    // this function), paint the already-applied fresh data anyway instead
    // of leaving it sitting unrendered until something else happens to
    // force a repaint.
    if (_deferredRenderTimer) clearTimeout(_deferredRenderTimer);
    _deferredRenderTimer = setTimeout(() => {
      _deferredRenderTimer = null;
      const stillFocused = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
      const stillTyping = stillFocused && (Date.now() - _lastInputAt) < 1500;
      if (!stillTyping && !_maDirty) renderTabContent();
    }, 1600);
    return;
  }
  if (_deferredRenderTimer) {
    clearTimeout(_deferredRenderTimer);
    _deferredRenderTimer = null;
  }
  renderTabContent();
}
let _snapshotUnsub = null;

function startRealtimeSync() {
  if (_snapshotUnsub) return; // already listening
  if (typeof storage.onSnapshotAll !== 'function') {
    // Deployed storage.js predates onSnapshotAll() — fall back to polling.
    startAutoSync();
    return;
  }
  let firstSnapshot = true;
  _snapshotUnsub = storage.onSnapshotAll((items) => {
    if (!session.userId) return; // not signed in yet — ignore for now
    const fresh = buildStateFromItems(items);
    // The very first callback fires immediately on subscribe with data we
    // may have already loaded a moment ago during login — apply it, but
    // there's no need to force a jarring re-render if nothing's changed.
    applyFreshState(fresh, !firstSnapshot ? true : false);
    firstSnapshot = false;
  }, true, (err) => {
    console.error('Realtime listener failed, falling back to polling:', err);
    _snapshotUnsub = null;
    startAutoSync();
  });
}
// Tears down whichever sync mechanism is currently active (live listener or
// polling fallback). Called on logout so a signed-out tab stops reading
// from Firestore entirely instead of quietly listening in the background.
function stopRealtimeSync() {
  if (_snapshotUnsub) {
    _snapshotUnsub();
    _snapshotUnsub = null;
  }
  if (_autoSyncInterval) {
    clearInterval(_autoSyncInterval);
    _autoSyncInterval = null;
  }
}
// Fallback only — used if the realtime listener above isn't available or
// fails. Fetches fresh state and applies it the same way the listener does.
let _syncInFlight = false;
async function syncFromServer(force) {
  if (_syncInFlight) return;
  if (!session.userId) return;
  _syncInFlight = true;
  try {
    const fresh = await loadState();
    applyFreshState(fresh, force);
  } catch (e) {
    console.error('syncFromServer failed:', e);
  } finally {
    _syncInFlight = false;
  }
}
let _autoSyncInterval = null;

function startAutoSync() {
  if (_autoSyncInterval) return;
  _autoSyncInterval = setInterval(() => {
    if (document.hidden) return; // paused while backgrounded — same battery reasoning as the countdown timer
    if (!session.userId) return;
    syncFromServer();
  }, 6000); // every 6s — only used as a fallback if the realtime listener isn't available
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days > 0) parts.push(days + 'd');
  if (days > 0 || hours > 0) parts.push(hours + 'h');
  parts.push(minutes + 'm');
  parts.push(seconds + 's');
  return parts.join(' ');
}

function updateSessionCountdownText() {
  const el = document.getElementById('session-countdown');
  if (!el) return;
  if (!sessionExpiresAt) {
    el.textContent = '';
    return;
  }
  const remaining = sessionExpiresAt - Date.now();
  el.textContent = remaining > 0 ? ('Auto-logout in ' + formatDuration(remaining)) : 'Session expired';
}

function startSessionCountdown() {
  stopSessionCountdown();
  sessionCountdownInterval = setInterval(() => {
    if (!sessionExpiresAt) return;
    const remaining = sessionExpiresAt - Date.now();
    if (remaining <= 0) {
      stopSessionCountdown();
      const days = (state && state.settings && state.settings.sessionInactivityDays) || 7;
      showToast(`You were logged out after ${days} day${days===1?'':'s'} of inactivity.`, 'error');
      logout();
      return;
    }
    updateSessionCountdownText();
  }, 1000);
}

function stopSessionCountdown() {
  if (sessionCountdownInterval) {
    clearInterval(sessionCountdownInterval);
    sessionCountdownInterval = null;
  }
}
// Market-duty and meal-edit-cutoff reminders are time-of-day triggered, not
// event-triggered — so unlike deposit/withdrawal/low-balance notifications
// (which fire the instant the triggering action happens), these need
// something checking the clock periodically while the app is open. Every
// check inside runScheduledNotificationChecks() is deduped per member per
// BD day, so calling this often is harmless.
let notifScheduleInterval = null;

function startNotificationScheduler() {
  if (notifScheduleInterval) return;
  notifScheduleInterval = setInterval(runScheduledNotificationChecks, 60 * 1000); // once a minute is plenty for HH:MM-granularity reminders
}

function stopNotificationScheduler() {
  if (notifScheduleInterval) {
    clearInterval(notifScheduleInterval);
    notifScheduleInterval = null;
  }
}

