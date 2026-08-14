// ---------------------------------------------------------------------------
// 00-utils-core.js  (originally app.js lines 1-210)
// Sticky header IIFE, core state vars, month/history vars, calc cache, memo(), toast/success-check UI helpers
// ---------------------------------------------------------------------------
// Keep the topbar's real height mirrored into --topbar-h so the month-bar
// (and desktop sidebar tabs) can stick exactly below it, even if the topbar
// wraps to a second line (long balance figure, role chip, etc). Runs
// immediately — this script is loaded with `defer`, so the DOM already
// exists by the time this executes.
(function syncStickyHeaderVars() {
  const topbarEl = document.querySelector('.topbar');
  const monthBarEl = document.querySelector('.month-bar');
  if (!topbarEl) return;
  const setVars = () => {
    const root = document.documentElement.style;
    root.setProperty('--topbar-h', topbarEl.offsetHeight + 'px');
    if (monthBarEl) root.setProperty('--month-bar-h', monthBarEl.offsetHeight + 'px');
  };
  setVars();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(setVars);
    ro.observe(topbarEl);
    if (monthBarEl) ro.observe(monthBarEl);
  } else {
    window.addEventListener('resize', setVars);
  }
})();

const STATE_KEY = 'meal-app-v1';
const LOCAL_CACHE_KEY = 'meal-app-v1-cache';
const SESSION_KEY = 'meal-app-session-v1';
let state = null;
let session = {
  userId: null,
  role: null
};
let pendingLoginId = null;
let activeTab = 'dashboard';
// Returns the current "YYYY-MM" using the DEVICE'S LOCAL date, not UTC.
// (new Date().toISOString() is UTC-based, so in timezones ahead of UTC — like
// Bangladesh, UTC+6 — it can report the wrong/previous month for part of the
// day/month boundary.) Also called fresh from enterApp() on every login,
// because this file's top-level `let` only runs once when the script itself
// is first parsed — if the tab/PWA was left open since an earlier month
// (e.g. backgrounded on mobile, or an old cached tab never fully reloaded),
// that stale computed value would otherwise stick around until a real page
// reload, which is exactly what was causing "stuck on July until I manually
// switch the dropdown".
function getCurrentMonthStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
let currentMonth = getCurrentMonthStr();
let monthlyActiveSelectedMonth = getCurrentMonthStr();
let historyMemberId = null;
let historyViewMode = 'month';
// Populated fresh on every renderHistory() call — index i in the rendered
// row's "View Details" button maps to the full ledger entry here, so the
// modal can show everything that didn't fit in the compact row.
let _histExpDetailsCache = [];

function showHistoryExpenseDetail(i) {
  const e = _histExpDetailsCache[i];
  if (!e) return;
  const showTime = shouldShowRecordedAt();
  const body = `
    ${detailRow('Date', e.date)}
    ${detailRow('Title', escapeHtml(e.title||''))}
    ${detailRow('Description', e.description ? escapeHtml(e.description) : '<span class="small-note" style="margin:0;">No description</span>')}
    ${e.splitType==='meal' ? detailRow('Meal', mealBadge(e.mealTypeSplit||'both')) : ''}
    ${detailRow('Method', expenseMethodLabel(e.splitType, e.mealTypeSplit, e.isEveryoneFallback))}
    ${detailRow('Your Share (Deducted)', `<span class="neg">-${fmtMoney(e.amount)}</span>`)}
    ${detailRow('Balance Before', `<span class="${e.balanceBefore<0?'neg':'pos'}">${fmtMoney(e.balanceBefore)}</span>`)}
    ${detailRow('Balance After', `<span class="${e.balanceAfter<0?'neg':'pos'}">${fmtMoney(e.balanceAfter)}</span>`)}
    ${detailRow('Added By', escapeHtml(e.addedBy||''))}
    ${showTime ? detailRow('Recorded At', formatBDDateTime(e.createdAt)) : ''}
  `;
  openDetailsModal('Shared Expense Deduction', body);
}
let dashboardExpenseDate = null; // selected date for Dashboard's "Total Expense" card; defaults to today on first render
let sessionExpiresAt = null;
let sessionCountdownInterval = null;
let lastActivityWriteAt = 0;
// True while the super admin has toggled a Monthly Active Members checkbox
// that hasn't been saved yet. Background syncs re-render the whole tab from
// fresh server data, which would otherwise silently reset any unchecked/
// checked boxes back to the last-saved state before "Save" is even clicked.
let _maDirty = false;

// Timestamp of the last real 'input' event anywhere on the page (typing in
// a text field, adjusting a textarea, picking a select option) — used by
// applyFreshState() below to tell "field is focused" apart from "field is
// actively being edited right now". See that function for why this matters.
let _lastInputAt = 0;
let _deferredRenderTimer = null;

// Draft state for Admin Month Access settings card (not saved until "Save Settings" clicked)
let _adminMonthAccessDraft = null;

function resetAdminMonthAccessDraft() {
  if (!state || !state.settings) return;
  _adminMonthAccessDraft = JSON.parse(JSON.stringify(state.settings.adminMonthAccess || {}));
}

/* ---------------- CALC CACHE ----------------
   Balance/meal-count math re-scans state.days / state.costs / state.deposits /
   state.expenses. Dashboard, History, Deposits etc. call these helpers once
   PER MEMBER PER MONTH (openingBalance loops every prior month too), so the
   same scan over the same data was happening dozens of times on a single
   render, and it got slower the longer the mess ran (more months = more
   repeated scans). This cache stores each result the first time it's computed
   in a render pass and reuses it. It's cleared on every persist*() write so
   it never serves stale data after an edit. */
let _calcCache = Object.create(null);
let _calcStats = {
  hits: 0,
  misses: 0
};

function clearCalcCache() {
  _calcCache = Object.create(null);
  _calcStats = {
    hits: 0,
    misses: 0
  };
}

function memo(key, fn) {
  if (key in _calcCache) {
    _calcStats.hits++;
    return _calcCache[key];
  }
  _calcStats.misses++;
  const v = fn();
  _calcCache[key] = v;
  return v;
}
// Open the browser console and run: showCacheStats()
// A high hit count (e.g. hits: 80+, misses: single digits) after clicking
// around Dashboard/History means caching is working — the same calculation
// is being reused instead of re-scanned. If hits stays at 0 no matter what
// you click, something's wrong (cache isn't being reused).
window.showCacheStats = function () {
  console.log(`Cache stats since last data change → hits: ${_calcStats.hits}, misses: ${_calcStats.misses}`);
  return _calcStats;
};

/* ---------------- TOAST ---------------- */
function showToast(message, type) {
  type = type || 'success';
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  // Respect prefers-reduced-motion
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const baseLife = type === 'error' ? 5000 : 3500;
  const life = prefersReduced ? baseLife * 1.5 : baseLife;

  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, life);
}

/* ---------------- SUCCESS CHECK (iPhone-payment-style confirmation) ----------------
   Used for the money-affecting inputs (grocery cost, deposit, withdrawal) instead of
   the plain toast — a brief full-screen checkmark confirmation, same idea as an Apple
   Pay success animation. Purely a UI confirmation; it doesn't touch any save logic —
   call it right after the existing persist/save call succeeds, same as showToast. */
function showSuccessCheck(message) {
  let overlay = document.getElementById('success-check-overlay');
  if (overlay) overlay.remove(); // in case one is still closing from a rapid previous action

  overlay = document.createElement('div');
  overlay.id = 'success-check-overlay';
  overlay.className = 'success-check-overlay';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <div class="success-check-card">
      <svg class="success-check-svg" viewBox="0 0 80 80" aria-hidden="true">
        <circle class="success-check-circle" cx="40" cy="40" r="36"/>
        <path class="success-check-mark" d="M24 41 L35 52 L57 28"/>
      </svg>
      <div class="success-check-msg">${message}</div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Sequence itself (circle draw → checkmark draw → message fade-in) takes
  // about 1s; give it another ~1s to actually be read before dismissing.
  const life = prefersReduced ? 2600 : 2000;

  setTimeout(() => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 300);
  }, life);
}

/* ---------------- NOTIFICATION CENTER (in-app only) ---------------- */
// Notifications live in state.notifications — one small Firestore doc per
// notification (PFX_NOTIF+id), stored in its own collection alongside the
// login/action logs (LOGS_COLLECTION, see storage.js) rather than the
// collection the rest of the app live-listens on, and fetched one-time/
// on-demand via loadNotifications() (02-state-storage.js) instead of being
// pushed to every signed-in member on every change. That's what still makes
// read/unread state and history the same on every device a member logs
// into, and persist across logout/login until read. Shape per item: {id,
// memberId, type, title, message, createdAt(ms), read, dedupeKey}. No
// browser/Chrome push popups —
