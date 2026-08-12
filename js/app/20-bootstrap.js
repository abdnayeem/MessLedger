// ---------------------------------------------------------------------------
// 20-bootstrap.js  (originally app.js lines 7037-7152)
// paintFromState(), init(), injected custom styles, member-stat load-more toggle, and the two calls that actually start the app
// ---------------------------------------------------------------------------

// `haveFullState` tells us whether `state` already holds the full
// days/deposits/expenses/costs/logs data (true — e.g. the offline local-
// cache fallback below) or just the lightweight login-screen slice (false
// — the normal path; see fetchLoginScreenState() in 02-state-storage.js).
// A persisted-session auto-login needs the FULL data before it can safely
// render the dashboard, so it only skips the extra fetch when we already
// have it.
function paintFromState(opts) {
  opts = opts || {};
  const haveFullState = !!opts.haveFullState;
  bindActivityTracking();
  const persisted = loadPersistedSession();
  if (persisted) {
    const m = memberById(persisted.userId);
    // Previously this also required m.role to exactly match the role
    // stored at login time. If a member's role was ever changed (e.g. an
    // admin promoted/demoted) between visits, even a perfectly valid,
    // non-expired session was silently discarded and that person was
    // forced to log in again — this hit admins far more often than
    // regular members, who rarely have their role changed. enterApp()
    // below already re-reads the CURRENT role straight from `m`, so
    // dropping this check doesn't let a stale role leak through; it just
    // stops punishing people for a role change with an unwanted logout.
    if (m) {
      const enterOpts = { persist: false, expiresAt: persisted.expiresAt };
      if (haveFullState) {
        enterApp(m, enterOpts);
      } else {
        // Update the boot loader's message (same element/branding shown
        // since page load — see index.html) so it's clear the app is now
        // pulling actual data, not just still starting up. Same
        // "still loading" follow-up as doLogin() for a genuinely slow
        // connection, since this can be the same multi-second full fetch.
        showBootLoader('Loading your dashboard…');
        const slowMsgTimer = setTimeout(() => {
          const txt = document.querySelector('#boot-loader .bl-txt');
          if (txt) txt.textContent = 'Still loading your data — this can take a few seconds on a slower connection…';
        }, 3000);
        enterAppWithFullData(m, enterOpts).catch(err => {
          console.error('Failed to load full data for persisted session:', err);
          showBootError('Could not load your data: ' + (err && err.message ? err.message : String(err)));
        }).finally(() => clearTimeout(slowMsgTimer));
      }
      return;
    }
    clearPersistedSession();
  }
  renderLogin();
}

async function init() {
  // BUGFIX (full-collection Firestore read for every visitor, even ones who
  // never log in): boot used to fetch the ENTIRE mealAppStorage collection
  // (every day's meals, every deposit/expense/cost, every log) just to
  // decide what to show on the login screen — so simply opening the site,
  // without logging in, cost a full read every time, and the realtime
  // listener that fetch fed into stayed open racking up further reads for
  // as long as the tab sat idle there. fetchLoginScreenState() (in
  // 02-state-storage.js) fetches only what the login screen and login-
  // attempt validation actually need — members, settings, recovery code,
  // monthly-active records — nothing else, and as a one-time (not live)
  // read. The full dataset is only fetched once someone actually has a
  // session, via enterAppWithFullData() (06-auth.js) — see paintFromState()
  // above and doLogin() in 06-auth.js.
  const bootTimeout = setTimeout(() => {
    showBootError('This is taking much longer than usual. Check your internet connection, or open the browser console (F12) for the actual error.');
  }, 10000);
  try {
    const loadedState = await fetchLoginScreenState();
    state = validateState(loadedState);
    _hasFullState = false; // lightweight login-screen data only — see 02-state-storage.js
    clearTimeout(bootTimeout);
    paintFromState({ haveFullState: false });
  } catch (err) {
    clearTimeout(bootTimeout);
    console.error('init() failed:', err);
    // Last resort only (e.g. genuinely offline): fall back to whatever was
    // last cached on this device, so the app isn't completely unusable —
    // but only after the real fetch has actually failed, and we say so.
    // The local cache holds a full state from a previous successful
    // session (see writeLocalCache() in enterAppWithFullData()/loadState()),
    // so this path can render straight away without another network call.
    const cached = readLocalCache();
    if (cached) {
      try {
        state = validateState(cached);
      } catch (validationErr) {
        console.error('Cached state also invalid:', validationErr);
        showBootError('Your saved data is corrupted. Try clearing browser data and logging in again.');
        return;
      }
      _hasFullState = true; // the local cache only ever holds a full snapshot — see 02-state-storage.js
      paintFromState({ haveFullState: true });
      showToast("Couldn't reach the database — showing your last saved data from this device.", 'error');
    } else {
      showBootError('An unexpected error occurred while starting the app: ' + (err && err.message ? err.message : String(err)));
    }
  }
}

function injectCustomStyles() {
  if (document.getElementById('custom-injected-styles')) return;
  const style = document.createElement('style');
  style.id = 'custom-injected-styles';
  style.textContent = `
    /* Highlighted "Download Report" buttons — layers extra polish (shadow,
       rounder corners, hover/press animation) on top of the site's own
       .btn color/theme, so this always matches the app's real palette
       instead of introducing a new color. */
    .btn-download-highlight{
      border-radius: 18px !important;
      box-shadow: 0 4px 14px rgba(0,0,0,0.18);
      display: flex; align-items: center; justify-content: center; gap: 7px;
      cursor: pointer; white-space: nowrap; overflow: hidden;
      padding-left: 12px; padding-right: 12px;
      transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
    }
    .btn-download-highlight:hover{ transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,0.26); filter: brightness(1.08); }
    .btn-download-highlight:active{ transform: translateY(0) scale(0.97); box-shadow: 0 2px 8px rgba(0,0,0,0.18); }
    .btn-download-highlight .dl-icon{ font-size: 15px; line-height: 1; flex-shrink: 0; }
    .btn-download-highlight .dl-label{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
    @media (max-width: 420px){
      .btn-download-highlight{ font-size: 12px; padding-left: 8px; padding-right: 8px; }
    }

    /* Mobile-only Monthly Summary Load More / Show Less expand-collapse.
       Lives inside .member-stat-list, which the existing stylesheet already
       shows on mobile and hides on desktop — so this never touches desktop. */
    .member-stat-extra{
      max-height: 0; overflow: hidden; opacity: 0;
      transition: max-height 0.45s ease, opacity 0.35s ease;
    }
    .member-stat-extra.expanded{ max-height: 8000px; opacity: 1; }
    .member-stat-loadmore-btn{
      width: 100%; margin-top: 10px; padding: 11px; border-radius: 12px;
      border: 1px dashed var(--border, #ddd); background: transparent;
      color: var(--primary, #4F46E5); font-weight: 700; cursor: pointer;
      transition: background 0.15s ease;
    }
    .member-stat-loadmore-btn:hover{ background: rgba(79,70,229,0.06); }
  `;
  document.head.appendChild(style);
}

function toggleMemberStatExtra() {
  const box = document.getElementById('member-stat-extra');
  const btn = document.getElementById('member-stat-loadmore-btn');
  if (!box) return;
  const expanded = box.classList.toggle('expanded');
  if (btn) btn.textContent = expanded ? '▲ Show Less' : '▼ Load More — Show All Members';
}
injectCustomStyles();
init();