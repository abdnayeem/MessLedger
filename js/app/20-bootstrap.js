// ---------------------------------------------------------------------------
// 20-bootstrap.js  (originally app.js lines 7037-7152)
// paintFromState(), init(), injected custom styles, member-stat load-more toggle, and the two calls that actually start the app
// ---------------------------------------------------------------------------

function paintFromState() {
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
      enterApp(m, {
        persist: false,
        expiresAt: persisted.expiresAt
      });
      return;
    }
    clearPersistedSession();
  }
  renderLogin();
}
async function init() {
  // Always fetch the real, current data directly from Firestore first — no
  // stale local copy is shown before it. The boot-loader spinner (already in
  // index.html) stays up until this real fetch resolves, so what appears on
  // screen is always accurate, never a flash of outdated data that then
  // jumps/changes a moment later.
  const bootTimeout = setTimeout(() => {
    showBootError('This is taking much longer than usual. Check your internet connection, or open the browser console (F12) for the actual error.');
  }, 10000);
  try {
    const loadedState = await loadState();
    state = validateState(loadedState);
    clearTimeout(bootTimeout);
    paintFromState();
  } catch (err) {
    clearTimeout(bootTimeout);
    console.error('init() failed:', err);
    // Last resort only (e.g. genuinely offline): fall back to whatever was
    // last cached on this device, so the app isn't completely unusable —
    // but only after the real fetch has actually failed, and we say so.
    const cached = readLocalCache();
    if (cached) {
      try {
        state = validateState(cached);
      } catch (validationErr) {
        console.error('Cached state also invalid:', validationErr);
        showBootError('Your saved data is corrupted. Try clearing browser data and logging in again.');
        return;
      }
      paintFromState();
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