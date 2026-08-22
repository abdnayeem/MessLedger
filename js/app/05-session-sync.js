// ---------------------------------------------------------------------------
// 05-session-sync.js  (originally app.js lines 1343-1718)
// Session expiry/activity tracking, background pause, realtime sync (onSnapshot), auto-sync, session countdown UI, notification scheduler
// ---------------------------------------------------------------------------

// COST CONTROL: intentionally cap how long a single tab keeps a live
// Firestore listener open. Every open tab with a live listener bills a read
// for every document that changes anywhere in the collection, for as long
// as the tab stays open — fine for one active tab, but adds up fast when
// several members' tabs sit open in the background all day. After
// LIVE_LISTENER_MAX_DURATION_MS, the listener is deliberately torn down and
// a small dismiss-free banner tells the person to refresh if they want
// live updates again. This is a DELIBERATE stop, separate from the
// error-triggered polling fallback below — it must never be "fixed" by the
// auto-reconnect logic, or it'd defeat the point.
const LIVE_LISTENER_MAX_DURATION_MS = 60 * 1000; // 1 minute
let _liveListenerCapTimer = null;
let _liveListenerStoppedForCostSaving = false;

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
        } else if (!_snapshotUnsub && !_liveListenerStoppedForCostSaving) {
          // BUGFIX (double full-collection read on every quick tab switch):
          // this used to unconditionally call syncFromServer() here — a
          // full storage.getAll() round trip — on EVERY visibility return,
          // even though the live onSnapshot listener (_snapshotUnsub) was
          // still attached the whole time and had already pushed any
          // change that happened while the tab sat in the background.
          // Firestore's SDK handles its own reconnect/catch-up once a
          // backgrounded tab's network resumes, so that "safety net" read
          // was almost always pure duplicate billing — and on mobile,
          // where switching apps and coming right back is constant, this
          // was one of the single biggest sources of extra reads. Now this
          // only fires as a genuine fallback, when the listener somehow
          // isn't running at all (e.g. it errored out and hasn't retried
          // yet) — the one case where `state` really could be stale.
          //
          // The `!_liveListenerStoppedForCostSaving` check matters too: if
          // the listener is down because we deliberately capped it (see
          // LIVE_LISTENER_MAX_DURATION_MS above), a tab-focus event must
          // NOT quietly fetch fresh data behind the scenes — the whole
          // point of the banner is that refreshing is a conscious choice,
          // not something that happens for free just by glancing at the tab.
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
  // NOTE: notifications are no longer part of this snapshot at all (see the
  // buildStateFromItems()/loadNotifications() comments in
  // 02-state-storage.js) — fresh.notifications is just carried forward from
  // whatever `state.notifications` already held, so there's nothing to
  // race-guard here anymore. That guard now lives in loadNotifications()
  // itself, which is the only thing that ever fetches new notification data.
  state = fresh;
  _hasFullState = true; // listener snapshots are always the full dataset — see 02-state-storage.js
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
      if (!stillTyping && !_maDirty) renderTabContent(false);
    }, 1600);
    return;
  }
  if (_deferredRenderTimer) {
    clearTimeout(_deferredRenderTimer);
    _deferredRenderTimer = null;
  }
  renderTabContent(false);
}
let _snapshotUnsub = null;

// BUGFIX (double full-collection read on every boot/login): this app used
// to (a) do a one-time storage.getAll() in loadState() during init(), and
// then (b) call startRealtimeSync() from enterApp() a moment later, whose
// onSnapshotAll() ALSO fetches every document as its "first snapshot" —
// i.e. the entire collection was read from Firestore twice, back to back,
// for the exact same data, on every single login/session-restore. That's
// double the load time and double the billed Firestore reads for no benefit.
//
// Fix: the listener is now started once, as early as possible (from
// init(), before login), via ensureRealtimeListener()/waitForFirstSnapshot()
// below. Its first snapshot IS the boot data — there's no separate
// storage.getAll() anymore. By the time enterApp() calls startRealtimeSync()
// after login, _snapshotUnsub is already set, so it's a no-op: no second
// listener, no second read.
let _firstSnapshotSeen = false;
let _bootSnapshotItems = null;
let _bootSnapshotResolvers = [];
let _bootSnapshotRejecters = [];
let _listenerRetryCount = 0; // resets to 0 once a listener actually succeeds

// Small, sticky, dismiss-free banner telling the person live updates have
// been intentionally paused to save Firestore reads, with a one-click way
// to get them back. Injected once and reused (not rebuilt) so repeated
// show/hide doesn't thrash the DOM or lose event listeners.
//
// Styled as a floating pill near the bottom of the screen (not a top
// strip) with its own <style> tag injected right here — kept fully
// self-contained in this JS file (no css/style.css dependency) so it
// works regardless of what's deployed there, using the app's own CSS
// custom properties (--surface/--border/--ink/--primary/--radius/--shadow)
// wherever they're already defined so it still matches the app's look.
function ensureLiveUpdatesOffBannerStyles() {
  if (document.getElementById('live-updates-off-banner-styles')) return;
  const style = document.createElement('style');
  style.id = 'live-updates-off-banner-styles';
  style.textContent = `
    #live-updates-off-banner{
      position:fixed; left:50%; bottom:18px; transform:translate(-50%,0);
      z-index:9999; display:flex; align-items:center; gap:10px;
      max-width:calc(100% - 24px); box-sizing:border-box;
      background:var(--surface,#fff);
      border:1px solid var(--border,#DFE4EA);
      border-radius:999px; padding:9px 10px 9px 14px;
      box-shadow:var(--shadow-lg,0 20px 40px -14px rgba(28,39,51,.28));
      font-size:13px; color:var(--ink,#1C2733);
      animation:lub-in .28s cubic-bezier(.2,.8,.2,1);
    }
    #live-updates-off-banner.is-hidden{ display:none; }
    #live-updates-off-banner.is-leaving{ animation:lub-out .18s ease-in forwards; }
    @keyframes lub-in{
      from{ opacity:0; transform:translate(-50%,10px) scale(.96); }
      to{ opacity:1; transform:translate(-50%,0) scale(1); }
    }
    @keyframes lub-out{
      from{ opacity:1; transform:translate(-50%,0) scale(1); }
      to{ opacity:0; transform:translate(-50%,10px) scale(.96); }
    }
    #live-updates-off-banner .lub-dot{
      width:8px; height:8px; border-radius:50%; flex-shrink:0;
      background:var(--ink-faint,#8A97A6);
    }
    #live-updates-off-banner .lub-text{
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      font-weight:600; color:var(--ink-soft,#51606F);
    }
    #live-updates-off-banner .lub-refresh{
      display:flex; align-items:center; gap:6px; flex-shrink:0;
      background:var(--primary,#33607F); color:#fff; border:none;
      border-radius:999px; padding:7px 14px; font-size:12.5px; font-weight:700;
      cursor:pointer; transition:transform .15s ease, filter .15s ease;
    }
    #live-updates-off-banner .lub-refresh:hover{ filter:brightness(1.08); }
    #live-updates-off-banner .lub-refresh:active{ transform:scale(.96); }
    @media (prefers-reduced-motion: reduce){
      #live-updates-off-banner{ animation:none; }
      #live-updates-off-banner.is-leaving{ animation:none; }
    }
    @media (max-width:420px){
      #live-updates-off-banner{ bottom:12px; padding:8px 8px 8px 12px; gap:8px; }
      #live-updates-off-banner .lub-text{ font-size:12px; }
    }
  `;
  document.head.appendChild(style);
}

function showLiveUpdatesOffBanner() {
  ensureLiveUpdatesOffBannerStyles();
  let el = document.getElementById('live-updates-off-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'live-updates-off-banner';
    el.innerHTML =
      '<span class="lub-dot"></span>' +
      '<span class="lub-text">Live updates off</span>' +
      '<button type="button" id="live-updates-refresh-btn" class="lub-refresh">' +
      '<i class="fas fa-arrow-rotate-right"></i> Refresh</button>';
    document.body.appendChild(el);
    document.getElementById('live-updates-refresh-btn').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing…';
      resumeLiveListenerFromBanner();
    });
  }
  el.classList.remove('is-hidden', 'is-leaving');
}

function hideLiveUpdatesOffBanner() {
  const el = document.getElementById('live-updates-off-banner');
  if (!el || el.classList.contains('is-hidden')) return;
  // Small exit animation instead of an abrupt disappear.
  el.classList.add('is-leaving');
  setTimeout(() => {
    el.classList.add('is-hidden');
    el.classList.remove('is-leaving');
    // Reset the refresh button back to its resting state for next time.
    const btn = document.getElementById('live-updates-refresh-btn');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-arrow-rotate-right"></i> Refresh';
    }
  }, 180);
}

// Deliberately tears down the live listener after it's been open for
// LIVE_LISTENER_MAX_DURATION_MS, to cap how many reads one open tab can
// rack up. Distinct from the error-triggered fallback in the onError
// handler below — this one is scheduled (not a failure), so it must NOT
// fall back to 60s polling (that would just trade one steady cost for
// another instead of actually saving anything).
function stopLiveListenerForCostSaving() {
  if (_liveListenerCapTimer) {
    clearTimeout(_liveListenerCapTimer);
    _liveListenerCapTimer = null;
  }
  if (_snapshotUnsub) {
    _snapshotUnsub();
    _snapshotUnsub = null;
  }
  _liveListenerStoppedForCostSaving = true;
  showLiveUpdatesOffBanner();
}

// Called when the person taps "Refresh" on the banner: pulls the latest
// data once (so the screen is current right now) and re-arms the live
// listener for another LIVE_LISTENER_MAX_DURATION_MS window, same as a
// fresh login would.
function resumeLiveListenerFromBanner() {
  hideLiveUpdatesOffBanner();
  _liveListenerStoppedForCostSaving = false;
  if (session.userId) {
    const c = document.getElementById('content');
    if (c) c.innerHTML = '<div class="card empty"><i class="fas fa-spinner fa-spin"></i>&nbsp; Refreshing…</div>';
    syncFromServer(true).finally(() => {
      if (activeTab) renderTabContent(true);
    });
  }
  ensureRealtimeListener();
}

function ensureRealtimeListener() {
  if (_snapshotUnsub) return; // already listening — boot or otherwise
  // Deliberately paused for cost saving (see stopLiveListenerForCostSaving())
  // — only the banner's "Refresh" button (resumeLiveListenerFromBanner) is
  // allowed to re-arm it, not a background retry loop, or the 1-minute cap
  // would never actually save anything.
  if (_liveListenerStoppedForCostSaving) return;
  if (typeof storage.onSnapshotAll !== 'function') {
    // Deployed storage.js predates onSnapshotAll() — nothing to attach to.
    // waitForFirstSnapshot() below falls back to a normal one-time fetch,
    // and startRealtimeSync() falls back to polling, same as before.
    return;
  }
  _snapshotUnsub = storage.onSnapshotAll((items) => {
    // BUGFIX ("Member data (KEY_MEMBERS) was not found" right after a real
    // login): a freshly-attached full-collection listener can fire its
    // very first callback with an INCOMPLETE result — the SDK's local
    // cache serving whatever it already has before the server's complete
    // answer arrives, arriving more than the 100ms debounce apart from the
    // real one (see onSnapshotAll() in storage.js). Every consumer here
    // assumes a snapshot represents the WHOLE collection, so treating that
    // partial one as final threw. A genuinely complete snapshot always
    // includes the members doc, so use that as the sanity check: skip and
    // wait for the next (complete) snapshot instead of failing on this one.
    const looksComplete = items.some(it => it.key === KEY_MEMBERS);
    if (!looksComplete) {
      console.warn('Realtime listener: skipping incomplete snapshot (no members doc yet), waiting for the next one');
      return;
    }
    _listenerRetryCount = 0; // got real data — any earlier hiccup is behind us
    // BUGFIX (runaway Firestore reads): if we'd earlier fallen back to
    // polling (see the onError handler below and startAutoSync()), the
    // live listener working again right here means the polling interval
    // is now redundant — every tick was re-reading the ENTIRE collection
    // every 6-60s on top of what the listener itself already delivers for
    // free. Without this, a single transient error could leave a tab
    // polling the whole collection forever, even after the listener
    // silently recovered, which is what actually blew up read costs.
    if (_autoSyncInterval) {
      clearInterval(_autoSyncInterval);
      _autoSyncInterval = null;
    }
    // (Re)arm the cost-saving cap every time we get a real snapshot — not
    // just once — so the 1-minute window always counts from "listener is
    // actually delivering data" rather than "first attach", and a listener
    // that reconnected after an error still gets capped correctly.
    if (_liveListenerCapTimer) clearTimeout(_liveListenerCapTimer);
    _liveListenerCapTimer = setTimeout(() => {
      _liveListenerCapTimer = null;
      stopLiveListenerForCostSaving();
    }, LIVE_LISTENER_MAX_DURATION_MS);
    _bootSnapshotItems = items;
    if (!_firstSnapshotSeen) {
      _firstSnapshotSeen = true;
      _bootSnapshotResolvers.forEach(res => res(items));
      _bootSnapshotResolvers = [];
      _bootSnapshotRejecters = [];
    }
    if (!session.userId) return; // not signed in yet — nothing to repaint
    const fresh = buildStateFromItems(items);
    applyFreshState(fresh, true);
  }, true, (err) => {
    console.error('Realtime listener failed:', err);
    _snapshotUnsub = null;
    // BUGFIX: establishing the FIRST realtime listener of a session opens a
    // fresh streaming connection (unlike the plain one-off reads
    // fetchLoginScreenState() already made successfully), and can hit a
    // one-off transient hiccup on the very first attempt — this used to
    // reject immediately, surfacing "could not load your data" right after
    // a successful login even though simply retrying (e.g. clicking Sign
    // In again) always worked. Retry a couple of times with a short
    // backoff, same pattern as the anonymous sign-in retry in
    // firebase-config.js, before actually giving up and telling the caller.
    if (!_firstSnapshotSeen && _listenerRetryCount < 2) {
      _listenerRetryCount++;
      setTimeout(() => ensureRealtimeListener(), 800 * _listenerRetryCount);
      return;
    }
    _listenerRetryCount = 0;
    if (!_firstSnapshotSeen) {
      _bootSnapshotRejecters.forEach(rej => rej(err));
      _bootSnapshotResolvers = [];
      _bootSnapshotRejecters = [];
    }
    if (session.userId) startAutoSync();
  });
}

// Resolves with the raw {key,value} items from the listener's very first
// (complete) snapshot, starting the listener if it isn't already running.
// Used by init() so the app's startup load and the realtime listener share
// ONE Firestore read instead of two (see BUGFIX note above).
function waitForFirstSnapshot() {
  ensureRealtimeListener();
  if (typeof storage.onSnapshotAll !== 'function') {
    return Promise.reject(new Error('onSnapshotAll not available'));
  }
  if (_firstSnapshotSeen) return Promise.resolve(_bootSnapshotItems);
  return new Promise((resolve, reject) => {
    // Safety net: a complete snapshot should normally arrive within a
    // couple of seconds even accounting for the incomplete-snapshot skip
    // and the retry backoff above. If something genuinely never delivers
    // one, fail with a clear message instead of leaving the caller (e.g.
    // doLogin()'s "Signing in…" state) waiting forever with no feedback.
    const wrappedResolve = (items) => { clearTimeout(timeoutId); resolve(items); };
    const wrappedReject = (err) => { clearTimeout(timeoutId); reject(err); };
    const timeoutId = setTimeout(() => {
      const idx = _bootSnapshotResolvers.indexOf(wrappedResolve);
      if (idx !== -1) {
        _bootSnapshotResolvers.splice(idx, 1);
        _bootSnapshotRejecters.splice(idx, 1);
      }
      reject(new Error('Timed out waiting for data from Firestore. Check your connection and try again.'));
    }, 15000);
    _bootSnapshotResolvers.push(wrappedResolve);
    _bootSnapshotRejecters.push(wrappedReject);
  });
}

function startRealtimeSync() {
  if (_snapshotUnsub) return; // already listening (e.g. started at boot)
  if (typeof storage.onSnapshotAll !== 'function') {
    // Deployed storage.js predates onSnapshotAll() — fall back to polling.
    startAutoSync();
    return;
  }
  ensureRealtimeListener();
}
// Tears down whichever sync mechanism is currently active (live listener or
// polling fallback). Called on logout so a signed-out tab stops reading
// from Firestore entirely instead of quietly listening in the background.
function stopRealtimeSync() {
  if (_snapshotUnsub) {
    _snapshotUnsub();
    _snapshotUnsub = null;
  }
  // BUGFIX: without resetting these, a logout -> login again in the same
  // tab (no page reload) would make waitForFirstSnapshot() instantly
  // resolve with the OLD snapshot cached from before logout — served up as
  // if it were fresh — instead of waiting for the newly (re)started
  // listener's actual first callback. Clearing them forces the next
  // waitForFirstSnapshot() call to genuinely wait for new data again.
  _firstSnapshotSeen = false;
  _bootSnapshotItems = null;
  _bootSnapshotResolvers = [];
  _bootSnapshotRejecters = [];
  if (_autoSyncInterval) {
    clearInterval(_autoSyncInterval);
    _autoSyncInterval = null;
  }
  if (_liveListenerCapTimer) {
    clearTimeout(_liveListenerCapTimer);
    _liveListenerCapTimer = null;
  }
  _liveListenerStoppedForCostSaving = false;
  hideLiveUpdatesOffBanner();
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

let _autoSyncFailTicks = 0;
const AUTO_SYNC_MAX_FAIL_TICKS = 3; // 3 x 60s = give up after ~3 minutes, same cap policy as the deliberate 1-min stop

function startAutoSync() {
  if (_autoSyncInterval) return;
  // BUGFIX (runaway Firestore reads / ~500K reads on a 22-day, 10-user
  // mess): this used to poll the ENTIRE collection every 6 seconds,
  // forever, with nothing ever trying to get back onto the live listener
  // — so a single transient listener error (network blip, brief
  // permission hiccup, etc.) permanently downgraded that tab to a full
  // collection re-read 10x/minute for the rest of the session. Firestore
  // bills per document returned, so even a modest collection (tens to a
  // few hundred docs) turns into tens of thousands of reads per hour, per
  // stuck tab. Changes:
  //  1. Every tick now also retries ensureRealtimeListener() first. If it
  //     reconnects, the onSnapshotAll success callback clears this
  //     interval itself — so polling is genuinely temporary, not permanent.
  //  2. The interval itself is 60s instead of 6s — a 10x cheaper safety
  //     net for the window before the listener reconnects, instead of the
  //     primary sync mechanism.
  //  3. If it still hasn't reconnected after AUTO_SYNC_MAX_FAIL_TICKS
  //     tries (~3 min), stop polling entirely and show the same "Live
  //     updates off — Refresh" banner as the deliberate 1-min cap, instead
  //     of polling forever at a reduced-but-still-nonzero cost. A stuck
  //     permission/network problem shouldn't cost more than a few minutes
  //     of polling before it's treated the same as any other "come back
  //     and refresh" pause.
  _autoSyncFailTicks = 0;
  _autoSyncInterval = setInterval(() => {
    if (document.hidden) return; // paused while backgrounded — same battery reasoning as the countdown timer
    if (!session.userId) return;
    if (!_snapshotUnsub) ensureRealtimeListener(); // try to get back on the live listener
    if (_snapshotUnsub) return; // reconnected this tick — nothing more to do
    _autoSyncFailTicks++;
    if (_autoSyncFailTicks >= AUTO_SYNC_MAX_FAIL_TICKS) {
      clearInterval(_autoSyncInterval);
      _autoSyncInterval = null;
      _autoSyncFailTicks = 0;
      stopLiveListenerForCostSaving(); // reuses the same banner + manual-refresh flow
      return;
    }
    syncFromServer(); // still not up — fall back to one poll this tick
  }, 60000); // every 60s — fallback only; the live listener is the primary sync path
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
  notifScheduleInterval = setInterval(async () => {
    // Notifications are no longer pushed live (see loadNotifications() in
    // 02-state-storage.js) — this periodic on-demand refetch is what picks
    // up anything added since we last checked, e.g. a deposit an admin
    // posted to this member from another device/session, on top of the
    // time-of-day reminder checks this interval already ran. Once a minute
    // is plenty for both.
    try {
      await loadNotifications();
    } catch (e) {
      console.error('loadNotifications (scheduler) failed:', e);
    }
    runScheduledNotificationChecks();
    if (session && session.userId) renderTopWho();
  }, 60 * 1000);
}

function stopNotificationScheduler() {
  if (notifScheduleInterval) {
    clearInterval(notifScheduleInterval);
    notifScheduleInterval = null;
  }
}