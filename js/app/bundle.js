// ---------------------------------------------------------------------------
// bundle.js — auto-generated concatenation of js/app/00..20 (in this exact
// numeric order) into ONE file, purely to cut ~21 separate <script> requests
// down to 1 for faster page load (round-trips matter a lot more than file
// size on mobile networks). Behavior is 100% identical to loading the 21
// files separately — same global scope, same execution order, nothing
// removed or rewritten.
//
// DO NOT hand-edit this file. To change app behavior, edit the matching
// numbered file in js/app/ (00-utils-core.js, 09-dashboard.js, etc. — see
// README.md) as before, then regenerate this bundle from those files.
// ---------------------------------------------------------------------------

/* ===== 00-utils-core.js ===== */
// ---------------------------------------------------------------------------
// 00-utils-core.js  (originally app.js lines 1-210)
// Sticky header IIFE, core state vars, month/history vars, calc cache, memo(), toast/success-check UI helpers
// ---------------------------------------------------------------------------
// Keep the topbar row's real bottom edge (measured from the viewport top)
// mirrored into --topbar-h, so the mobile notification panel — which is
// position:fixed and needs a real viewport-relative offset — can sit right
// below it. Runs immediately — this script is loaded with `defer`, so the
// DOM already exists by the time this executes.
(function syncStickyHeaderVars() {
  const headerCardEl = document.querySelector('.page-header-card');
  const topbarEl = document.querySelector('.topbar');
  if (!headerCardEl || !topbarEl) return;
  const setVars = () => {
    const root = document.documentElement.style;
    root.setProperty('--topbar-h', topbarEl.getBoundingClientRect().bottom + 'px');
  };
  setVars();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(setVars);
    ro.observe(headerCardEl);
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

/* ---------------- THEME (dark mode) ----------------
   Persisted in localStorage; the <html data-theme="dark"> attribute drives
   every color in the app since css/style.css reads colors through
   var(--...) tokens (see section 1b there). The inline THEME INIT script
   in index.html already applies the saved/OS preference before first
   paint — this function only handles the in-app toggle + save. */
const THEME_KEY = 'messledger-theme';
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  if (next === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (e) {}
  // Re-render the profile menu so its own "Dark/Light Mode" label + icon
  // flip immediately instead of only on the next unrelated re-render.
  if (typeof renderTopWho === 'function' && session && session.userId) renderTopWho();
}

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

/* ---------------- UNDO TOAST ----------------
   Same visual family as showToast(), but stays up longer, shows an "Undo"
   button, and defers the actual destructive action instead of firing it
   immediately. Used for low-stakes deletes (grocery cost / shared expense /
   deposit records) where a confirm() dialog on every delete was more
   friction than protection — the record is removed from local state (and
   thus the UI) right away for a snappy feel, and only actually deleted on
   the server once the toast times out without being undone.
   NOT used for high-stakes actions (member removal, PIN reset, bulk log
   wipes) — those keep an explicit confirm(), since those aren't easily
   reversible the same way and deserve a harder stop.
   onUndo(): called if the user clicks Undo before the timer runs out —
     restore the record to local state and re-render. The server-side
     delete never happens in this case.
   onCommit(): called once the timer elapses without an undo — this is
     where the actual Firestore delete should be fired. */
function showUndoToast(message, onUndo, onCommit) {
  const container = document.getElementById('toast-container');
  if (!container) {
    onCommit();
    return;
  }
  const UNDO_WINDOW_MS = 5000;
  let settled = false;

  const el = document.createElement('div');
  el.className = 'toast toast-success toast-undo';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');

  const msgSpan = document.createElement('span');
  msgSpan.className = 'toast-undo-msg';
  msgSpan.textContent = message;

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'toast-undo-btn';
  undoBtn.textContent = 'Undo';

  el.appendChild(msgSpan);
  el.appendChild(undoBtn);
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const life = prefersReduced ? UNDO_WINDOW_MS * 1.5 : UNDO_WINDOW_MS;

  const dismiss = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  };

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    dismiss();
    onCommit();
  }, life);

  undoBtn.addEventListener('click', () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    dismiss();
    onUndo();
  });
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

/* ===== 01-notifications.js ===== */
// ---------------------------------------------------------------------------
// 01-notifications.js  (originally app.js lines 211-481)
// In-app notification center: get/unread/type-enabled, add/mark-read, low-balance + market/meal-edit reminder checks, bell UI, recovery code gen
// ---------------------------------------------------------------------------
// notifications only ever show inside the bell/panel in this app.
const NOTIF_MAX_PER_USER = 200; // cap so a member's notification history can't grow forever
let notifPanelOpen = false;
// True once loadNotifications() has completed at least once THIS session.
// checkLowBalanceNotification/checkMarketDutyReminders/checkMealEditReminders
// all dedupe purely by scanning state.notifications in memory (see
// addNotification()) — if any of them ran while state.notifications was
// still empty/stale (the gap between enterApp() starting and its
// loadNotifications() call actually resolving from Firestore), they'd have
// no way to see a matching notification that already exists on the server
// from an earlier session/device, and would create a genuine duplicate
// (same dedupeKey, different id). Gating these three checks on this flag
// closes that gap — they simply no-op until the real list is in hand,
// then run normally on every render/tick after that. Reset to false on
// logout so the next login re-gates correctly. Doesn't apply to the
// one-off addNotification calls from cost/expense/deposit actions
// (13/14/15-*.js) — those fire on a specific admin action rather than a
// repeating check, so there's no meaningful duplicate-creation window.
let _notifBaselineLoaded = false;
// Dedupe keys the member has explicitly read/dismissed (see
// markNotificationRead/markAllNotificationsRead below) for the recurring
// checks — lowBalance/marketReminder/mealEditReminder — that re-run on
// every render/scheduler tick, not just once. Those checks' dedupeKeys
// already embed today's BD date, so this only needs to remember "already
// dismissed" for the rest of today: without it, marking one read deletes
// its Firestore doc, but the very next render (often the SAME click's own
// re-render, since markNotifAndRerender calls renderTopWho() right after)
// would find no matching doc in state.notifications and instantly recreate
// it — the notification would reappear the moment it was "cleared", making
// clearing look completely broken while the underlying condition (balance
// still low, still your market day, etc.) hadn't changed. One-off
// notifications (deposit/expense/cost — dedupeKey includes a unique
// record id) are unaffected either way since that exact dedupeKey can
// never legitimately recur. Kept in localStorage rather than Firestore —
// it only needs to suppress recreation on this device for the rest of
// today; briefly re-seeing a dismissed reminder on a different device is
// harmless and self-resolves once read there too.
const DISMISSED_DEDUPE_KEYS_LS = 'meedger_dismissedDedupeKeys';
function _readDismissedDedupeKeys() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_DEDUPE_KEYS_LS) || '[]'));
  } catch (e) {
    return new Set();
  }
}
function _rememberDismissedDedupeKey(dedupeKey) {
  if (!dedupeKey) return;
  try {
    const set = _readDismissedDedupeKeys();
    set.add(dedupeKey);
    // Cap so this can't grow forever — far more than a household mess
    // will ever generate; we only actually need "recent" entries anyway.
    localStorage.setItem(DISMISSED_DEDUPE_KEYS_LS, JSON.stringify(Array.from(set).slice(-500)));
  } catch (e) { /* localStorage unavailable — worst case is the old recreate-on-next-render behavior */ }
}

function getUserNotifications(userId) {
  return (state.notifications || []).filter(n => n.memberId === userId).sort((a, b) => b.createdAt - a.createdAt);
}

function unreadNotificationCount(userId) {
  return getUserNotifications(userId).filter(n => !n.read).length;
}
// Whether a given notification type is turned on in Super Admin > Notification Settings.
function notifTypeEnabled(type) {
  const n = state.settings && state.settings.notifications;
  if (!n) return true;
  const key = {
    deposit: 'depositEnabled',
    withdrawal: 'withdrawalEnabled',
    lowBalance: 'lowBalanceEnabled',
    marketReminder: 'marketReminderEnabled',
    mealEditReminder: 'mealEditReminderEnabled'
  } [type];
  return key ? (n[key] !== false) : true;
}
// Adds a notification for a specific member. dedupeKey defaults to
// type+title+message so the exact same alert (e.g. the same deposit) never
// gets stored twice — this is what "prevents duplicate notifications".
// Unread notifications are never auto-removed by time; they stay —
// including across logout/login — until the member actually opens/reads
// them, at which point they're deleted immediately (see
// markNotificationRead / the bell panel), not just flagged read.
// Runs synchronously against local state (so the UI can update immediately)
// and persists to Firestore in the background, same as the rest of the app.
function addNotification(userId, opts) {
  if (!userId || !opts || !state) return;
  if (!state.notifications) state.notifications = [];
  const type = opts.type || 'general';
  const title = (opts.title || '').trim() || 'Notification';
  const message = (opts.message || '').trim() || '';
  const dedupeKey = opts.dedupeKey || `${type}::${title}::${message}`;
  if (state.notifications.some(n => n.memberId === userId && n.dedupeKey === dedupeKey)) return; // duplicate — skip
  if (_readDismissedDedupeKeys().has(dedupeKey)) return; // already read/dismissed today — see the comment on DISMISSED_DEDUPE_KEYS_LS above
  const notif = {
    id: 'n' + Date.now() + Math.random().toString(36).slice(2, 8),
    memberId: userId,
    type: opts.type || 'general',
    title: opts.title || 'Notification',
    message: opts.message || '',
    createdAt: nowTimestamp(), // stored as an absolute instant; always displayed in Bangladesh date/time (see formatBDDateTime)
    read: false,
    dedupeKey
  };
  state.notifications.unshift(notif);
  persistNotification(notif.id); // fire-and-forget — a background alert shouldn't block the caller's own save

  // Trim old notifications for this member only, once they pass the cap —
  // oldest first, keeping the most recent NOTIF_MAX_PER_USER.
  const mine = state.notifications.filter(n => n.memberId === userId);
  if (mine.length > NOTIF_MAX_PER_USER) {
    const dropIds = mine.slice(NOTIF_MAX_PER_USER).map(n => n.id);
    state.notifications = state.notifications.filter(n => !dropIds.includes(n.id));
    dropIds.forEach(id => deleteNotificationDoc(id));
  }
}
// Marking a notification read REMOVES it from the panel right away (both
// locally and its Firestore doc) — there's no separate "read, but still
// listed" state anymore. Until read, it stays exactly where it is (per
// dedupeKey, never duplicated) — reading it is what makes it disappear.
function markNotificationRead(userId, id) {
  const idx = (state.notifications || []).findIndex(x => x.id === id && x.memberId === userId);
  if (idx === -1) return;
  const [n] = state.notifications.splice(idx, 1);
  if (n) _rememberDismissedDedupeKey(n.dedupeKey); // see DISMISSED_DEDUPE_KEYS_LS above — stops a recurring check from instantly recreating this on the next render
  deleteNotificationDoc(id); // fire-and-forget, same pattern as the rest of this module
}

function markAllNotificationsRead(userId) {
  const mine = (state.notifications || []).filter(n => n.memberId === userId);
  state.notifications = (state.notifications || []).filter(n => n.memberId !== userId);
  mine.forEach(n => {
    _rememberDismissedDedupeKey(n.dedupeKey); // see DISMISSED_DEDUPE_KEYS_LS above
    deleteNotificationDoc(n.id);
  });
}
// One low-balance alert per member per calendar (BD) day — dedupeKey
// includes today's BD date so it naturally resets and can re-fire the next
// day if the balance is still low, without ever double-firing the same day.
function checkLowBalanceNotification(memberId, bal) {
  if (!state || !state.settings) return;
  if (!_notifBaselineLoaded) return; // avoid dedupe races — see the flag's comment above
  if (bal >= state.settings.lowBalanceWarn) {
    // Balance has recovered (e.g. a deposit was just added) — remove any
    // still-unread low-balance warning for this member instead of leaving
    // it sitting there showing a stale/outdated balance figure.
    clearNotificationsOfType(memberId, 'lowBalance');
    return;
  }
  if (!notifTypeEnabled('lowBalance')) return;
  const today = bdTodayDateStr();
  addNotification(memberId, {
    type: 'lowBalance',
    title: bal < 0 ? 'Negative balance' : 'Low balance warning',
    message: bal < 0 ?
      `Your balance is -৳${Math.round(Math.abs(bal)).toLocaleString('en-US')}. Please add a deposit.` : `Your balance (৳${Math.round(bal).toLocaleString('en-US')}) is below the ৳${state.settings.lowBalanceWarn} warning threshold.`,
    dedupeKey: `lowBalance::${memberId}::${today}`
  });
}
// Removes all of a member's pending notifications of a given type — used
// when the underlying condition has since resolved itself (e.g. balance
// recovered) so a stale notification doesn't linger with outdated info.
function clearNotificationsOfType(memberId, type) {
  if (!state || !state.notifications) return;
  const toRemove = state.notifications.filter(n => n.memberId === memberId && n.type === type);
  if (toRemove.length === 0) return;
  state.notifications = state.notifications.filter(n => !(n.memberId === memberId && n.type === type));
  toRemove.forEach(n => deleteNotificationDoc(n.id));
}
// Returns the current Bangladesh time as "HH:MM" (24h, zero-padded), so it
// can be compared lexicographically against a configured "HH:MM" setting.
function bdNowHHMM() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date());
}
// Market/Bazar Duty Reminder — once per BD day, at/after the configured
// marketReminderTime, notify ONLY the member(s) whose weekly market day is
// today. dedupeKey is per member per date, so this is safe to call
// repeatedly (e.g. every render or on an interval) without duplicating.
function checkMarketDutyReminders() {
  if (!state || !state.settings || !state.settings.notifications) return;
  if (!_notifBaselineLoaded) return; // avoid dedupe races — see the flag's comment above
  if (!notifTypeEnabled('marketReminder')) return;
  const cfg = state.settings.notifications;
  if (bdNowHHMM() < (cfg.marketReminderTime || '08:00')) return;
  const today = bdTodayDateStr();
  const todayWeekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    weekday: 'long'
  }).format(new Date());
  const todayIdx = WEEKDAYS.indexOf(todayWeekday);
  (state.members || []).forEach(m => {
    if (!hasMarketDay(m)) return;
    if (Number(m.marketDay) !== todayIdx) return;
    addNotification(m.id, {
      type: 'marketReminder',
      title: 'Market/Bazar duty today',
      message: `You're on market duty today (${shiftLabel(m.marketShift)}) — shopping deadline is ${formatHour12(marketDeadlineHourFor(m.marketShift))} BD time.`,
      dedupeKey: `marketReminder::${m.id}::${today}`
    });
  });
}
// Meal Edit Cutoff Reminder — once per BD day, at/after the configured
// mealEditReminderTime, remind every regular member that tomorrow's meal
// edit cutoff is approaching (admins/super admin can always edit, so
// they're not included — only members are actually "affected" by the lock).
function checkMealEditReminders() {
  if (!state || !state.settings || !state.settings.notifications) return;
  if (!_notifBaselineLoaded) return; // avoid dedupe races — see the flag's comment above
  if (!notifTypeEnabled('mealEditReminder')) return;
  if (state.settings.mealLockEnabled === false) return; // locking is off entirely — no cutoff to remind about
  const cfg = state.settings.notifications;
  if (bdNowHHMM() < (cfg.mealEditReminderTime || '20:00')) return;
  const today = bdTodayDateStr();
  (state.members || []).forEach(m => {
    if (m.role !== 'member') return;
    addNotification(m.id, {
      type: 'mealEditReminder',
      title: 'Meal edit cutoff reminder',
      message: `Reminder: tomorrow's meal entry closes at ${formatTime12(state.settings.mealLockHour, state.settings.mealLockMinute)} BD time today. Update your meal count before it locks.`,
      dedupeKey: `mealEditReminder::${m.id}::${today}`
    });
  });
}
// Runs both scheduled/time-based reminder checks. Safe to call often —
// every check is internally deduped per member per BD day.
function runScheduledNotificationChecks() {
  if (!state || !session || !session.userId) return;
  checkMarketDutyReminders();
  checkMealEditReminders();
  checkMarketCompletionReminders();
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  } [c]));
}
const NOTIF_ICONS = {
  deposit: 'fa-coins',
  withdrawal: 'fa-arrow-down',
  lowBalance: 'fa-triangle-exclamation',
  marketReminder: 'fa-cart-shopping',
  mealEditReminder: 'fa-clock',
  general: 'fa-bell'
};

function toggleNotifPanel(e) {
  if (e) e.stopPropagation();
  notifPanelOpen = !notifPanelOpen;
  if (notifPanelOpen) {
    document.addEventListener('click', closeNotifPanelOnOutsideClick);
    // Notifications are only fetched on-demand now (login, this open, and
    // once a minute in the background — see loadNotifications() in
    // 02-state-storage.js), so grab anything new right as the panel opens
    // instead of waiting on the next scheduler tick.
    loadNotifications().then(() => {
      if (notifPanelOpen) renderTopWho();
    }).catch(e => console.error('loadNotifications (bell open) failed:', e));
  } else {
    document.removeEventListener('click', closeNotifPanelOnOutsideClick);
  }
  renderTopWho();
}

function closeNotifPanelOnOutsideClick(e) {
  const wrap = document.getElementById('notif-bell-wrap');
  if (wrap && !wrap.contains(e.target)) {
    notifPanelOpen = false;
    document.removeEventListener('click', closeNotifPanelOnOutsideClick);
    renderTopWho();
  }
}

function markNotifAndRerender(id, e) {
  if (e) e.stopPropagation();
  markNotificationRead(session.userId, id);
  renderTopWho();
}

function markAllNotifAndRerender(e) {
  if (e) e.stopPropagation();
  markAllNotificationsRead(session.userId);
  renderTopWho();
}

function renderNotifBell() {
  if (!session || !session.userId) return '';
  const list = getUserNotifications(session.userId);
  const unread = list.filter(n => !n.read).length;
  const panelHtml = !notifPanelOpen ? '' : `
    <div class="notif-backdrop" onclick="toggleNotifPanel(event)"></div>
    <div class="notif-panel">
      <div class="notif-panel-handle"><span></span></div>
      <div class="notif-panel-head">
        <span class="title"><i class="fas fa-bell"></i> Notifications</span>
        ${unread>0?`<button class="link-btn subtle" onclick="markAllNotifAndRerender(event)">Clear all</button>`:''}
      </div>
      <div class="notif-panel-list">
        ${list.length===0 ? '<div class="notif-panel-empty"><i class="fas fa-bell-slash"></i><div>No notifications yet</div><div class="small-note">Deposits, low-balance alerts and reminders will show up here.</div></div>' : list.map(n=>`
          <div class="notif-item ${n.read?'':'unread'}" onclick="markNotifAndRerender('${n.id}', event)">
            <div class="notif-item-icon t-${n.type||'general'}"><i class="fas ${NOTIF_ICONS[n.type]||NOTIF_ICONS.general}"></i></div>
            <div class="notif-item-body">
              <div class="notif-item-title">${escapeHtml(n.title)}</div>
              <div class="notif-item-msg">${escapeHtml(n.message)}</div>
              <div class="notif-item-time">${formatBDDateTime(n.createdAt)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  return `
    <div class="notif-bell-wrap" id="notif-bell-wrap">
      <button class="notif-bell-btn ${notifPanelOpen?'is-open':''} ${unread>0?'has-unread':''}" onclick="toggleNotifPanel(event)" aria-label="Notifications" title="Notifications">
        <i class="fas fa-bell"></i>
        ${unread>0?`<span class="notif-badge">${unread>9?'9+':unread}</span>`:''}
      </button>
      ${panelHtml}
    </div>
  `;
}

function generateRecoveryCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return 'MESS-' + code;
}
/* ===== 02-state-storage.js ===== */
// ---------------------------------------------------------------------------
// 02-state-storage.js  (originally app.js lines 482-1019)
// Default settings, local cache read/write, storage key constants, admin month-access rules, state defaults/migration, Firestore doc assembly, loadState()
// ---------------------------------------------------------------------------
// BUGFIX (partial state silently overwriting the full local cache): `state`
// can now briefly hold only the lightweight login-screen data (members/
// settings/meta/monthlyActive — see fetchLoginScreenState() below) before a
// session exists — e.g. while sitting on the login screen, or right after a
// failed login attempt. persistMembers() (03-persistence.js) can run in
// that exact window (a wrong-PIN attempt or account lockout both call it),
// and _markEdited() used to unconditionally write whatever `state` is to
// the local cache — which would replace a previously-good FULL cached
// snapshot with this near-empty one, so an offline reload afterwards would
// show an alarming "all data is gone" screen even though nothing was
// actually lost server-side. This flag is only true once `state` genuinely
// holds the complete dataset (set in loadState(), enterAppWithFullData(),
// applyFreshState(), and the offline-cache-fallback path in init()) —
// _markEdited() checks it before writing to cache.
let _hasFullState = false;

function defaultSettings() {
  return {
    mealLockHour: 11,
    mealLockMinute: 59, // NEW: minute-level cutoff precision (previously whole-hour only, so 11:59 AM wasn't selectable)
    maxMealQty: 3,
    maxMealQtyScope: 'member', // 'member' = only members capped (admin & super admin unlimited) | 'member_admin' = members & admins capped (only super admin unlimited)
    lowBalanceWarn: 100,
    marketDeadlineLunch: 10,
    marketDeadlineDinner: 17,
    negativeBalanceBuffer: 0,
    sessionInactivityDays: 7,
    recordedAtVisibility: 'superadmin',
    addedByVisibility: 'superadmin',
    mealsHistoryVisibility: 'superadmin', // who can see OTHER members' entries in All Meals History — everyone always sees their own
    mealLockEnabled: true,
    adminMonthAccess: {
      meals: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      },
      costs: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      },
      expenses: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      },
      deposits: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      }
    },
    notifications: {
      depositEnabled: true,
      withdrawalEnabled: true,
      lowBalanceEnabled: true,
      marketReminderEnabled: true,
      mealEditReminderEnabled: true,
      mealEditReminderTime: '20:00', // BD time, HH:MM — daily reminder that tomorrow's meal edit cutoff is approaching
      marketReminderTime: '08:00' // BD time, HH:MM — daily reminder sent to whoever has market/bazar duty that day
    }
  };
}
// REMOVED: defaultState() used to generate a hardcoded 14-member demo
// roster (pin '0000', first member auto-promoted to superadmin) and was
// used as a silent fallback in two places whenever real member data
// couldn't be read. This app is already live with real data — there is no
// scenario where fabricating fake members is an acceptable fallback. Both
// call sites below (buildStateFromItems and loadState) now throw an error
// instead of silently seeding/overwriting real data. See those functions
// for details.

// Local, same-device cache of the last known state. localStorage is
// synchronous — reading it costs ~0ms, unlike the Firestore round-trip in
// loadState(). This is what lets the next reload paint instantly with
// last-known data while the real (accurate) data loads in the background.
function readLocalCache() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeLocalCache(s) {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(s));
  } catch (e) {
    /* storage full/disabled — safe to ignore, Firestore stays the source of truth */
  }
}

const KEY_MEMBERS = 'meal-app-members';
const KEY_SETTINGS = 'meal-app-settings';
const KEY_META = 'meal-app-meta';
const PFX_DAY = 'meal-app-day__';
const PFX_DEPOSIT = 'meal-app-deposit__';
const PFX_EXPENSE = 'meal-app-expense__';
const PFX_COST = 'meal-app-cost__';
const PFX_LOGINLOG = 'meal-app-loginlog__';
const PFX_ACTIONLOG = 'meal-app-actionlog__';
const PFX_MONTHLYACTIVE = 'meal-app-monthlyactive__';
const PFX_NOTIF = 'meal-app-notif__';
const KEY_TEST_DATA_BACKUP = 'meal-app-testdata-backup'; // single doc: {createdAt, items:[{key,value}]} — snapshot taken right before "Reset All Test Data" wipes things, so a super admin can undo it within 7 days
// Point-in-time backups of members + settings specifically — this is the
// data that actually gets damaged by a bad edit/role change/PIN reset/bug
// (as opposed to meals/deposits/expenses, which are append-only and already
// covered by per-record delete confirmations + the test-data backup above).
// Kept as ONE doc holding an array of up to MAX_MEMBER_SNAPSHOTS entries
// (not one doc per snapshot) — members+settings are small, so this stays
// cheap to fetch on every load while still giving several restore points,
// rather than multiplying the data pulled on every app load.
const KEY_MEMBER_SNAPSHOTS = 'meal-app-member-snapshots';
const MAX_MEMBER_SNAPSHOTS = 15;
// Login lockout: after this many consecutive wrong-PIN attempts, the account
// is disabled and can only be re-enabled by the super admin (Members tab) or
// via "Forgot PIN?" with the recovery code. Super admin accounts are exempt —
// locking out the only super admin would have no way back in.
const MAX_LOGIN_ATTEMPTS = 3;
// The PIN every new/reset account starts on ('0000' — set at member creation,
// "Forgot PIN?" recovery, and super admin "Reset PIN"). Anyone still on this
// PIN is forced through the mandatory change-PIN modal on login — see
// enterApp() / showForcedPinChangeModal() below.
const DEFAULT_PIN = '0000';
// Login log: keep only the most recent N successful-login records so storage
// doesn't grow unbounded forever. Oldest entries are dropped once the cap is hit.
const MAX_LOGIN_LOGS = 300;
// Cap for the Database Action Log (below) — same reasoning as MAX_LOGIN_LOGS:
// every login/tab-refresh fetches the ENTIRE data set in one go, so an
// unbounded log would keep growing and slowly make every load a bit slower.
// 500 keeps it bounded while still holding a good few weeks of activity.
const MAX_ACTION_LOGS = 500;

/* -------- ADMIN MONTH ACCESS CONTROL -------- */
// Evaluates whether a given YYYY-MM is accessible by an Admin for a given module.
// Super Admin always has full access (returns true immediately).
// Admin access depends on: current/past/future flags + specific year→month grants.
function isMonthAllowedForAdmin(yearMonth, module) {
  if (!state || !state.settings || !state.settings.adminMonthAccess) return true;
  const cfg = state.settings.adminMonthAccess[module];
  if (!cfg) return true; // fallback: allow if config missing

  const today = getCurrentMonthStr(); // local date, not UTC — a UTC-based "today" could disagree with the real local current month and wrongly block admin edits
  const isCurrentMonth = yearMonth === today;
  const isPastMonth = yearMonth < today;
  const isFutureMonth = yearMonth > today;

  // Check current/past/future flags
  if (isCurrentMonth && cfg.current) return true;
  if (isPastMonth && cfg.past) return true;
  if (isFutureMonth && cfg.future) return true;

  // Check specific year→month grants
  if (cfg.specificYears && Object.keys(cfg.specificYears).length > 0) {
    const [year, month] = yearMonth.split('-');
    if (cfg.specificYears[year] && cfg.specificYears[year].includes(month)) {
      return true;
    }
  }

  return false;
}

// Wrapper: checks both role (super admin always allowed) and month access for admin.
function canRoleAccessMonth(yearMonth, module, role) {
  if (role === 'superadmin') return true; // super admin always unrestricted
  if (role === 'admin') return isMonthAllowedForAdmin(yearMonth, module);
  return false; // members don't have access to these operations (they only log meals)
}

// Human-readable description of allowed months for a given module config.
function describeMonthAccessCfg(cfg, module) {
  const parts = [];
  const today = getCurrentMonthStr(); // local date, not UTC

  if (cfg.current) parts.push(`Current month (${today})`);
  if (cfg.past) parts.push('All past months');
  if (cfg.future) parts.push('All future months');

  if (cfg.specificYears && Object.keys(cfg.specificYears).length > 0) {
    const specs = [];
    Object.keys(cfg.specificYears).sort().forEach(year => {
      const months = cfg.specificYears[year];
      if (months.length === 12) {
        specs.push(`All months of ${year}`);
      } else {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const names = months.map(m => monthNames[parseInt(m) - 1]).join(', ');
        specs.push(`${year}: ${names}`);
      }
    });
    parts.push(specs.join('; '));
  }

  return parts.length > 0 ? parts.join(' + ') : 'None (blocked)';
}

// Guard: throws/toasts if admin tries to access a disallowed month for a module.
function guardAdminMonthAccess(yearMonth, module) {
  if (session.role === 'superadmin') return true; // always ok
  if (session.role !== 'admin') return true; // members don't hit this guard

  if (!canRoleAccessMonth(yearMonth, module, 'admin')) {
    const cfg = state.settings.adminMonthAccess[module];
    const allowed = describeMonthAccessCfg(cfg, module);
    const msg = `Admin access restricted. This module only allows: ${allowed}`;
    showToast(msg, 'error');
    return false;
  }
  return true;
}

function fillStateDefaults(s) {
  if (!s.expenses) s.expenses = [];
  if (!s.costs) s.costs = [];
  if (!s.deposits) s.deposits = [];
  if (!s.days) s.days = {};
  if (!s.loginLogs) s.loginLogs = [];
  s.loginLogs.forEach(l => {
    if (!l.action) l.action = 'login'; // older entries were only ever recorded for logins
    if (l.ip === undefined) l.ip = '';
  });
  if (!s.actionLogs) s.actionLogs = [];
  if (!s.monthlyActive) s.monthlyActive = {};
  if (!s.notifications) s.notifications = [];
  if (s.testDataBackup === undefined) s.testDataBackup = null;
  if (!Array.isArray(s.memberSnapshots)) s.memberSnapshots = [];
  if (!s.recoveryCode) s.recoveryCode = generateRecoveryCode();
  if (!s.settings) s.settings = defaultSettings();
  else {
    const d = defaultSettings();
    const isExistingConfiguredCutoff = s.settings.mealLockHour !== undefined && s.settings.mealLockMinute === undefined;
    Object.keys(d).forEach(k => {
      if (s.settings[k] === undefined) s.settings[k] = d[k];
    });
    // BACKFILL NOTE: mealLockMinute is new — every previously-saved settings
    // doc is missing it. The generic loop above would've quietly given an
    // already-configured mess defaultSettings()'s new 11:59 (minute=59),
    // silently shifting its actual cutoff by up to 59 minutes with no one
    // having chosen that. An existing configured hour should keep meaning
    // exactly "HH:00" (its behavior before minutes existed) until a super
    // admin explicitly picks a new time in Settings.
    if (isExistingConfiguredCutoff) s.settings.mealLockMinute = 0;
  }
  s.expenses.forEach(e => {
    if (!e.title) {
      e.title = e.note || 'Shared expense';
    }
    if (e.description === undefined) {
      e.description = '';
    }
  });
  s.members.forEach(m => {
    if (!m.pin) m.pin = (s.pins && s.pins[m.role]) ? s.pins[m.role] : '0000';
    if (m.phone === undefined) m.phone = '';
    if (m.marketDay === undefined) m.marketDay = null;
    if (m.marketShift === undefined) m.marketShift = '';
    if (m.marketItems === undefined) m.marketItems = '';
    // Per-meal (lunch/dinner) shopping-confirmation state, keyed by
    // "YYYY-MM-DD::lunch" / "YYYY-MM-DD::dinner" — see the Market Completion
    // Reminders section below.
    if (!m.marketCompletions) m.marketCompletions = {};
    if (!m.mealLock) m.mealLock = {
      blocked: false,
      reason: '',
      by: ''
    };
    if (m.failedLoginAttempts === undefined) m.failedLoginAttempts = 0;
    if (m.accountDisabled === undefined) m.accountDisabled = false;
    if (m.createdAt === undefined) m.createdAt = null;
  });
  // Auto-migrate adminMonthAccess if missing (new feature)
  if (!s.settings.adminMonthAccess) {
    s.settings.adminMonthAccess = {
      meals: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      },
      costs: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      },
      expenses: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      },
      deposits: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      }
    };
  }
  // Auto-migrate notification settings if missing/partial (new feature)
  if (!s.settings.notifications) {
    s.settings.notifications = defaultSettings().notifications;
  } else {
    const dn = defaultSettings().notifications;
    Object.keys(dn).forEach(k => {
      if (s.settings.notifications[k] === undefined) s.settings.notifications[k] = dn[k];
    });
  }
  return s;
}

// One-time migration: this app used to keep EVERYTHING in one Firestore
// document (key 'meal-app-v1'). That meant every single meal tick, deposit,
// or expense rewrote the entire mess's data in one go — harmless with one
// person using it, but a real risk of one save clobbering another's once
// several members are saving around the same time. This splits that one
// document into many small ones (one per day / deposit / expense / cost),
// so everyday edits only ever touch the one small document they actually
// changed.
async function migrateFromSingleDoc(old) {
  fillStateDefaults(old);
  const writes = [];
  writes.push(storage.set(KEY_MEMBERS, JSON.stringify(old.members), true));
  writes.push(storage.set(KEY_SETTINGS, JSON.stringify(old.settings), true));
  Object.keys(old.days).forEach(date => {
    writes.push(storage.set(PFX_DAY + date, JSON.stringify(old.days[date]), true));
  });
  old.deposits.forEach(d => {
    writes.push(storage.set(PFX_DEPOSIT + d.id, JSON.stringify(d), true));
  });
  old.expenses.forEach(e => {
    writes.push(storage.set(PFX_EXPENSE + e.id, JSON.stringify(e), true));
  });
  old.costs.forEach(c => {
    writes.push(storage.set(PFX_COST + c.id, JSON.stringify(c), true));
  });
  Object.keys(old.monthlyActive || {}).forEach(month => {
    writes.push(storage.set(PFX_MONTHLYACTIVE + month, JSON.stringify(old.monthlyActive[month]), true));
  });
  // Notifications go to logStorage (LOGS_COLLECTION), not storage — same
  // reason as login/action logs below (see the LOGS_COLLECTION comment in
  // storage.js).
  (old.notifications || []).forEach(n => {
    writes.push(logStorage.set(PFX_NOTIF + n.id, JSON.stringify(n), true));
  });
  await Promise.all(writes);
  // meta (with a migrated:true marker) is written LAST, only after every
  // other piece above is confirmed written. loadState() checks THIS marker
  // — not just whether meal-app-members exists — to decide whether
  // migration is actually finished. If the browser closes or the network
  // dies partway through, this line never runs, so the next reload sees no
  // marker and safely re-runs the whole migration (storage.set overwrites,
  // so re-running it is harmless — no duplicates).
  await storage.set(KEY_META, JSON.stringify({
    recoveryCode: old.recoveryCode,
    migrated: true
  }), true);
  // Only delete the old combined doc once migration is fully confirmed done.
  try {
    await storage.delete(STATE_KEY, true);
  } catch (e) {
    /* not fatal — old key just lingers unused */
  }
}

async function writeFullState(s) {
  const writes = [
    storage.set(KEY_MEMBERS, JSON.stringify(s.members), true),
    storage.set(KEY_SETTINGS, JSON.stringify(s.settings), true),
    storage.set(KEY_META, JSON.stringify({
      recoveryCode: s.recoveryCode,
      migrated: true
    }), true)
  ];
  Object.keys(s.days).forEach(date => {
    writes.push(storage.set(PFX_DAY + date, JSON.stringify(s.days[date]), true));
  });
  s.deposits.forEach(d => {
    writes.push(storage.set(PFX_DEPOSIT + d.id, JSON.stringify(d), true));
  });
  s.expenses.forEach(e => {
    writes.push(storage.set(PFX_EXPENSE + e.id, JSON.stringify(e), true));
  });
  s.costs.forEach(c => {
    writes.push(storage.set(PFX_COST + c.id, JSON.stringify(c), true));
  });
  Object.keys(s.monthlyActive || {}).forEach(month => {
    writes.push(storage.set(PFX_MONTHLYACTIVE + month, JSON.stringify(s.monthlyActive[month]), true));
  });
  // Logs and notifications go to logStorage (LOGS_COLLECTION), not storage
  // — same reason as everywhere else they're written, see the
  // LOGS_COLLECTION comment in storage.js. This only runs once, for a mess
  // still migrating off the old single-doc format, so it's the one place
  // old-format logs/notifications get routed to their new home.
  (s.loginLogs || []).forEach(l => {
    writes.push(logStorage.set(PFX_LOGINLOG + l.id, JSON.stringify(l), true));
  });
  (s.actionLogs || []).forEach(l => {
    writes.push(logStorage.set(PFX_ACTIONLOG + l.id, JSON.stringify(l), true));
  });
  (s.notifications || []).forEach(n => {
    writes.push(logStorage.set(PFX_NOTIF + n.id, JSON.stringify(n), true));
  });
  await Promise.all(writes);
}

// Fallback only: used if a deployed storage.js is ever older than this file
// and doesn't expose getAll() yet. The real storage.js (see storage.js)
// implements getAll() as a single collection.get() round trip; this shim
// gets the same {items:[...]} shape the slow way (list, then one get() per
// key) so loadState() keeps working either way.
async function storageGetAll(shared) {
  const listRes = await storage.list(undefined, shared);
  const keys = (listRes && listRes.keys) || [];
  const items = (await Promise.all(keys.map(async key => {
    try {
      const res = await storage.get(key, shared);
      return res ? {
        key: res.key,
        value: res.value
      } : null;
    } catch (e) {
      return null;
    }
  }))).filter(Boolean);
  return {
    items
  };
}
async function fetchAllStorageItems() {
  if (typeof storage.getAll === 'function') {
    return await storage.getAll(true); // one round trip — collection.get() already returns every doc's data
  }
  return await storageGetAll(true); // older storage.js without getAll() — list + N parallel gets
}

// BUGFIX (data-loss incident): fetchAllStorageItems() can come back with
// ZERO items on a real, previously-used mess — a brief network hiccup, a
// Firestore rule/permission blip, a partial read during a listener restart,
// etc. loadState() used to treat "0 items" as "this mess has never been
// used" and would immediately WRITE defaultState() over Firestore, silently
// replacing every real member (name/role/PIN/phone) with a hardcoded demo
// roster. That is exactly what happened: the demo seed's first member is
// always promoted to superadmin with pin '0000' and blank phone, and every
// other member's role/pin/phone got reset to the same demo defaults.
//
// This app is already live with real data, so there is no longer any
// legitimate "seed brand new data" path at all: an empty read is ALWAYS
// treated as a problem to retry and, failing that, to surface as an error —
// never as a reason to fabricate data. Retrying here just avoids treating a
// harmless transient blip as a hard failure.
async function fetchAllStorageItemsWithRetry(retries, delayMs) {
  retries = retries == null ? 2 : retries;
  delayMs = delayMs == null ? 800 : delayMs;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fetchAllStorageItems();
      const gotItems = result && Array.isArray(result.items) && result.items.length > 0;
      if (gotItems || attempt === retries) return result; // trust it once retries are exhausted
      await new Promise(res => setTimeout(res, delayMs)); // empty on this attempt — could be a blip, try again
    } catch (e) {
      lastErr = e;
      if (attempt === retries) throw lastErr;
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
  throw lastErr || new Error('fetchAllStorageItems failed after retries');
}

// Turns the flat {key, value} documents from storage into the shaped state
// object the rest of the app works with. Shared by loadState() (the initial
// boot fetch) and the realtime listener (every live push update), so both
// paths parse data identically.
function buildStateFromItems(items) {
  const byKey = {};
  items.forEach(it => {
    byKey[it.key] = it.value;
  });
  // BUGFIX: this used to fall back to defaultState().members (hardcoded demo
  // roster, pin '0000', first member auto-promoted to superadmin) whenever
  // KEY_MEMBERS was missing from the fetched items — even though other items
  // existed, meaning this is a real, previously-used mess. A partial/flaky
  // read that happened to miss just the members doc would silently replace
  // every real member. There is no safe default here: if members data can't
  // be read, we must stop and surface an error, never fabricate members.
  if (!byKey[KEY_MEMBERS]) {
    throw new Error('Member data (KEY_MEMBERS) was not found in Firestore, even though other data exists. Refusing to substitute demo data — this is likely a partial/failed read. Please check your connection and reload.');
  }
  const s = {
    members: JSON.parse(byKey[KEY_MEMBERS]),
    settings: byKey[KEY_SETTINGS] ? JSON.parse(byKey[KEY_SETTINGS]) : defaultSettings(),
    recoveryCode: byKey[KEY_META] ? JSON.parse(byKey[KEY_META]).recoveryCode : generateRecoveryCode(),
    testDataBackup: byKey[KEY_TEST_DATA_BACKUP] ? JSON.parse(byKey[KEY_TEST_DATA_BACKUP]) : null,
    memberSnapshots: byKey[KEY_MEMBER_SNAPSHOTS] ? JSON.parse(byKey[KEY_MEMBER_SNAPSHOTS]) : [],
    days: {},
    costs: [],
    deposits: [],
    expenses: [],
    loginLogs: [],
    actionLogs: [],
    monthlyActive: {},
    notifications: []
  };
  items.forEach(it => {
    if (it.key.startsWith(PFX_DAY)) s.days[it.key.slice(PFX_DAY.length)] = JSON.parse(it.value);
    else if (it.key.startsWith(PFX_DEPOSIT)) s.deposits.push(JSON.parse(it.value));
    else if (it.key.startsWith(PFX_EXPENSE)) s.expenses.push(JSON.parse(it.value));
    else if (it.key.startsWith(PFX_COST)) s.costs.push(JSON.parse(it.value));
    else if (it.key.startsWith(PFX_MONTHLYACTIVE)) s.monthlyActive[it.key.slice(PFX_MONTHLYACTIVE.length)] = JSON.parse(it.value);
    // NOTE: PFX_LOGINLOG/PFX_ACTIONLOG/PFX_NOTIF are intentionally NOT
    // handled here anymore — login logs, action logs, AND notifications now
    // all live in their own Firestore collection (LOGS_COLLECTION, see
    // storage.js) instead of inside mealAppStorage, so none of them ever
    // show up in `items` (the live-listened collection) at all. Notifications
    // used to live right here (their own small doc per notification), which
    // meant every deposit/withdrawal/low-balance/reminder notification —
    // and every "mark as read" delete — got pushed to the SAME live listener
    // every other signed-in member has open, billing a phantom read to every
    // open tab for an alert that, 99% of the time, wasn't even about them.
    // They're loaded separately, one-time/on-demand, instead — see
    // loadLogs()/loadNotifications() below.
  });
  // BUGFIX: buildStateFromItems() is called on every single realtime
  // snapshot (every login/logout/meal/cost/expense/deposit/settings
  // change from ANYONE), and its result wholesale-replaces `state` (see
  // applyFreshState() in 05-session-sync.js: `state = fresh`). Since
  // items never contains log or notification docs anymore,
  // `s.loginLogs`/`s.actionLogs`/`s.notifications` above are always
  // freshly-initialized empty arrays — without this, whatever loadLogs()/
  // loadNotifications() had fetched would get silently wiped back to []
  // the instant ANY unrelated change happened anywhere in the app,
  // clearing the bell (or an open log tab) out from under whoever was
  // looking at it. Logs and notifications are only ever loaded/refreshed
  // by loadLogs()/loadNotifications() now, so every other path that
  // rebuilds state must carry forward whatever was already loaded instead
  // of resetting it.
  if (typeof state !== 'undefined' && state) {
    s.loginLogs = state.loginLogs || [];
    s.actionLogs = state.actionLogs || [];
    s.notifications = state.notifications || [];
  }
  fillStateDefaults(s);
  return s;
}

// One-time (non-live) load of login/action logs from their own collection.
// These deliberately aren't part of state.days/deposits/etc's live sync —
// see the LOGS_COLLECTION comment in storage.js for why. Call this right
// before rendering the Login Log / Database Log tabs (see setTab() in
// 07-ui-shell.js) rather than keeping them subscribed all the time; nobody
// is looking at those tabs most of the time, so there's no reason to pay
// for a live listener (or a bigger live-collection snapshot) on their
// behalf for every signed-in member, every session.
async function loadLogs() {
  const [loginRes, actionRes] = await Promise.all([
    logStorage.getByPrefix(PFX_LOGINLOG, true),
    logStorage.getByPrefix(PFX_ACTIONLOG, true)
  ]);
  state.loginLogs = (loginRes.items || [])
    .map(it => JSON.parse(it.value))
    .sort((a, b) => b.timestamp - a.timestamp);
  state.actionLogs = (actionRes.items || [])
    .map(it => JSON.parse(it.value))
    .sort((a, b) => b.at - a.at);
  // BUGFIX (log cap silently stopped working): trimLoginLogs()/
  // trimActionLogs() (06-auth.js) only ever prune state.loginLogs/
  // actionLogs down to MAX_LOGIN_LOGS/MAX_ACTION_LOGS when THIS array
  // holds the complete history — but a normal session no longer loads
  // full log history (see the LOGS_COLLECTION comment in storage.js), so
  // that array is usually just the handful of entries made during the
  // current session, and the length check almost never trips. This is
  // the one place the true full list is actually in memory, so this is
  // the right (and only reliably correct) place to enforce the cap —
  // right after fetching it, before anyone views/searches it.
  if (typeof trimLoginLogs === 'function') trimLoginLogs();
  if (typeof trimActionLogs === 'function') trimActionLogs();
}

// One-time (non-live) load of notifications from their own collection —
// same reasoning and same collection as loadLogs() above (see the
// LOGS_COLLECTION comment in storage.js): notifications used to be small
// per-item docs inside mealAppStorage, which meant every deposit/
// withdrawal/low-balance/reminder notification — and every "mark as read"
// delete — got pushed live to EVERY signed-in member's listener, almost
// always for someone else's alert. Moving them here means they're fetched
// on-demand instead: right after login (enterApp(), 06-auth.js), every
// time the bell panel is opened (toggleNotifPanel(), 01-notifications.js),
// and once a minute via the same scheduler that already runs the market/
// meal-edit reminder checks (startNotificationScheduler(), 05-session-
// sync.js) — close enough to real-time for an in-app bell, without paying
// for a live listener that fires on every signed-in member's every action.
async function loadNotifications() {
  const res = await logStorage.getByPrefix(PFX_NOTIF, true);
  let fresh = (res.items || []).map(it => JSON.parse(it.value));
  // Same race guard the old live-listener path used (see
  // deleteNotificationDoc() in 03-persistence.js): don't let a fetch that
  // started before a local "mark as read" delete has confirmed bring an
  // already-read notification back to life.
  if (typeof _pendingDeletedNotifIds !== 'undefined' && _pendingDeletedNotifIds.size) {
    fresh = fresh.filter(n => !_pendingDeletedNotifIds.has(n.id));
  }
  state.notifications = fresh.sort((a, b) => b.createdAt - a.createdAt);
  _notifBaselineLoaded = true; // safe for checkLowBalance/MarketDuty/MealEditReminders to dedupe against this now
}
// BUGFIX (full-collection read for every visitor, even ones who never log
// in): loadState()/the realtime listener both read the ENTIRE
// mealAppStorage collection — every day's meals, every deposit/expense/
// cost, every log — which is only actually needed once someone is signed
// in. But init() used to fetch all of that just to decide what to show on
// the *login screen*, so simply opening the site and not logging in still
// cost a full collection read (and, before this fix, kept a live listener
// open racking up further reads for as long as the tab sat idle there).
//
// The login screen and login-attempt validation (doLogin() in 06-auth.js)
// only ever touch: the member list+PINs (KEY_MEMBERS), the recovery code
// (KEY_META), and monthly-active records (PFX_MONTHLYACTIVE, for the
// "you're marked inactive this month" check) — never the day/deposit/
// expense/cost/log data. This fetches only those, as a one-time (not
// live) read, so an idle or never-logging-in visitor costs a handful of
// small document reads instead of the whole dataset. The full listener
// (ensureRealtimeListener()/waitForFirstSnapshot() in 05-session-sync.js)
// only gets opened once someone actually has a session — see enterAppFull()
// below and doLogin()'s success path.
async function fetchLoginScreenState() {
  let membersRes;
  try {
    membersRes = await storage.get(KEY_MEMBERS, true);
  } catch (e) {
    // BUGFIX: a mess that hasn't finished migrating from the old
    // single-document format yet has no KEY_MEMBERS per-item doc at all —
    // storage.get() above throws "Key not found", which used to just
    // break the login screen outright. loadState() already knows how to
    // detect and run that one-time migration (see migrateFromSingleDoc()
    // above), so fall back to it here; this only ever costs the full read
    // on a mess that genuinely still needs migrating, which should be
    // rare/one-time, not the normal case.
    return await loadState();
  }
  const [metaRes, settingsRes, monthlyRes] = await Promise.all([
    storage.get(KEY_META, true).catch(() => null),
    storage.get(KEY_SETTINGS, true).catch(() => null),
    (typeof storage.getByPrefix === 'function'
      ? storage.getByPrefix(PFX_MONTHLYACTIVE, true)
      : Promise.resolve({ items: [] })
    ).catch(() => ({ items: [] }))
  ]);
  const s = {
    members: JSON.parse(membersRes.value),
    settings: settingsRes ? JSON.parse(settingsRes.value) : defaultSettings(),
    recoveryCode: metaRes ? JSON.parse(metaRes.value).recoveryCode : generateRecoveryCode(),
    testDataBackup: null,
    memberSnapshots: [],
    days: {},
    costs: [],
    deposits: [],
    expenses: [],
    loginLogs: [],
    actionLogs: [],
    monthlyActive: {},
    notifications: []
  };
  (monthlyRes.items || []).forEach(it => {
    s.monthlyActive[it.key.slice(PFX_MONTHLYACTIVE.length)] = JSON.parse(it.value);
  });
  fillStateDefaults(s);
  return s;
}

async function loadState() {
  // NOTE ON A PAST DATA-LOSS INCIDENT: this function used to (a) treat any
  // empty read from Firestore as "brand new mess" and immediately overwrite
  // real data with defaultState()'s hardcoded demo roster, and (b) fall back
  // to that same defaultState() on ANY error at all (network drop, permission
  // error, etc.), silently handing the app fake in-memory data that a
  // superadmin's next edit (e.g. Settings save) could then persist over real
  // Firestore docs. This app is already live with real data, so there is no
  // "brand new mess" case to support anymore: defaultState() has been
  // removed entirely, and an empty read is ALWAYS treated as a failure to
  // surface (via try/catch), never as a reason to fabricate/seed data.
  // init()'s existing fallback (last-known local cache, then a visible boot
  // error) takes over from there instead of pretending everything loaded fine.
  const all = await fetchAllStorageItemsWithRetry();
  const byKey = {};
  all.items.forEach(it => {
    byKey[it.key] = it.value;
  });

  const metaParsed = byKey[KEY_META] ? JSON.parse(byKey[KEY_META]) : null;
  const migrationComplete = !!(metaParsed && metaParsed.migrated);
  if (!migrationComplete && byKey[STATE_KEY]) {
    await migrateFromSingleDoc(JSON.parse(byKey[STATE_KEY]));
    return await loadState(); // re-read, now from the migrated per-item docs
  }

  if (all.items.length === 0) {
    // No legitimate reason for this to ever be empty on a live deployment —
    // treat it strictly as a failed/blip read (network, permissions, quota)
    // and let the caller's try/catch handle it. Never seed, ever.
    throw new Error('Firestore returned no data. Refusing to seed/fabricate data — this is likely a temporary connectivity or permissions issue; please check your connection and reload.');
  }

  const s = buildStateFromItems(all.items);
  _hasFullState = true;
  writeLocalCache(s);
  return s;
}


/* ===== 03-persistence.js ===== */
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
  // A real edit (deposit, expense, meal tick, cost, etc.) is much stronger
  // evidence of "actively using this tab" than a stray click or scroll —
  // and it's about to write to Firestore, so the person is clearly not
  // just idly glancing at stale data. If the live listener had been
  // deliberately paused for cost saving (see LIVE_LISTENER_MAX_DURATION_MS
  // in 05-session-sync.js), bring it back right here, quietly — no banner,
  // no "Refreshing…" screen takeover — so the write and whatever comes
  // back from it are reflected live, instead of the person having to
  // separately notice the banner and tap Refresh first. If the listener
  // is already live, this just counts as activity and extends its cap.
  if (typeof _liveListenerStoppedForCostSaving !== 'undefined') {
    if (_liveListenerStoppedForCostSaving) {
      _liveListenerStoppedForCostSaving = false;
      hideLiveUpdatesOffBanner();
      ensureRealtimeListener();
    } else {
      resetLiveListenerCapOnActivity();
    }
  }
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


/* ===== 04-format-helpers.js ===== */
// ---------------------------------------------------------------------------
// 04-format-helpers.js  (originally app.js lines 1318-1342)
// Small formatting/lookup helpers: fmtMoney, memberById, roleLabel, canSeeRoleOf, roleBadgeHtml
// ---------------------------------------------------------------------------
function fmtMoney(n) {
  const v = Math.round((Number(n) || 0) * 1000) / 1000;
  return '৳' + v.toLocaleString('en-US', {
    maximumFractionDigits: 3
  });
}

function memberById(id) {
  return state.members.find(m => m.id === id);
}

function roleLabel(r) {
  return r === 'superadmin' ? 'Super Admin' : r === 'admin' ? 'Admin' : 'Member';
}
// Role badges are only shown on your own profile/row. Super admin is the
// only role that can see everyone else's role too.
function canSeeRoleOf(memberId) {
  return session.role === 'superadmin' || memberId === session.userId;
}

function roleBadgeHtml(m) {
  return canSeeRoleOf(m.id) ? `<span class="badge ${m.role}">${roleLabel(m.role)}</span>` : '';
}

/* ---------------- SESSION ---------------- */

/* ===== 05-session-sync.js ===== */
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

// Starts (or restarts) the 1-minute countdown to the deliberate cost-saving
// stop. Called once when the live listener first connects/reconnects.
function armLiveListenerCap() {
  if (_liveListenerCapTimer) clearTimeout(_liveListenerCapTimer);
  _liveListenerCapTimer = setTimeout(() => {
    _liveListenerCapTimer = null;
    stopLiveListenerForCostSaving();
  }, LIVE_LISTENER_MAX_DURATION_MS);
}

// Resets the cap countdown on THIS tab's own activity (click/keydown/
// mousemove/scroll/touchstart/input — see bindActivityTracking() below).
// Deliberately does NOT get called just because data arrives from the
// live listener — another member's deposit/meal-tick keeps THEIR tab's
// cap alive, but shouldn't keep an actually-idle tab's cap alive too.
// "1 minute" here means "1 minute since you last touched this tab",
// not "1 minute since the mess last had any activity at all".
let _lastCapResetAt = 0;
function resetLiveListenerCapOnActivity() {
  if (!_snapshotUnsub || _liveListenerStoppedForCostSaving) return; // nothing live to extend
  const now = Date.now();
  if (now - _lastCapResetAt < 2000) return; // throttle — avoid re-creating the timer on every mousemove
  _lastCapResetAt = now;
  armLiveListenerCap();
}

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
    // Same events also keep the live-listener cap alive — see
    // resetLiveListenerCapOnActivity() above. This is deliberately based
    // on THIS tab's own activity, not on data arriving from other members
    // (which does NOT reset the cap) — so a genuinely idle tab still goes
    // quiet after a minute even while other people keep using the mess.
    document.addEventListener(evt, resetLiveListenerCapOnActivity, {
      passive: true
    });
  });
  // Real edit activity (typing a number, adjusting a textarea, picking a
  // select option) — separate from just having a field focused. See
  // applyFreshState() for why this distinction matters for realtime sync.
  document.addEventListener('input', () => {
    _lastInputAt = Date.now();
    resetLiveListenerCapOnActivity();
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
          // BUGFIX (inconsistent behavior): this used to silently call
          // startRealtimeSync() here — reconnecting (and paying for a
          // fresh full-collection read) the instant the tab became visible
          // again, with no banner at all. That meant a tab backgrounded
          // for 2+ minutes (e.g. switching to another app on a phone for a
          // few minutes) behaved completely differently from the
          // deliberate 1-minute foreground-idle cap above: one path showed
          // "Live updates off — Refresh" and waited for a conscious tap,
          // the other silently reconnected on its own. Now both paths are
          // the same: coming back to a backgrounded-and-paused tab shows
          // the banner too, and only the person tapping Refresh (or making
          // an actual edit — see _markEdited() in 03-persistence.js)
          // reconnects it. This does mean frequent app-switching now shows
          // the banner more often — that's the deliberate trade-off for
          // consistent behavior instead of silently paying for a
          // reconnect read every time the tab regains focus.
          _listenerPausedForBackground = false;
          _liveListenerStoppedForCostSaving = true;
          showLiveUpdatesOffBanner();
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
  // Superadmin-only kill switch — see the maintenanceMode/maintenanceMessage
  // comment in defaultSettings() (02-state-storage.js) for the full design.
  // Checked first, before the typing/pending-write guards below: if a
  // super admin just turned this on, everyone else currently inside the
  // app needs to be bounced out to the maintenance message right away,
  // not held back by "someone's mid-edit" logic that's meant for normal
  // data updates, not an admin lockdown. Reusing logout() here is
  // deliberate — it already does everything needed (tear down the
  // listener/polling so no further reads happen, clear the persisted
  // session, hide the app, show the login screen), and renderLogin()
  // itself shows the maintenance message once it sees maintenanceMode on.
  if (fresh && fresh.settings && fresh.settings.maintenanceMode &&
      session && session.userId && session.role !== 'superadmin') {
    state = fresh; // so renderLogin()'s maintenance check below sees the current message text
    logout();
    return;
  }
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
    // Arm the cost-saving cap only when it's not already running — a fresh
    // connect/reconnect starts the 1-minute countdown, but data pushed in
    // by OTHER members through this same snapshot must not extend it.
    // Keeping it alive from here on is resetLiveListenerCapOnActivity()'s
    // job (see top of file), driven by THIS tab's own activity — that's
    // what makes "1 minute" mean "1 minute since you last touched this
    // tab" rather than "1 minute since the mess last had any activity".
    if (!_liveListenerCapTimer) armLiveListenerCap();
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
const AUTO_SYNC_MAX_FAIL_TICKS = 3; // 3 x 60s = give up after ~3 minutes, same cap policy as the deliberate 15-sec stop

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
  //     updates off — Refresh" banner as the deliberate 15-sec cap, instead
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
/* ===== 06-auth.js ===== */
// ---------------------------------------------------------------------------
// 06-auth.js  (originally app.js lines 1719-2175)
// App entry (enterApp/hideBootLoader), login screen + doLogin/forgotPin, device detection, login/action logs, logout, PIN change + forced-PIN modal
// ---------------------------------------------------------------------------
function enterApp(m, opts) {
  hideBootLoader();
  opts = opts || {};
  session = {
    userId: m.id,
    role: m.role
  };
  sessionExpiresAt = opts.expiresAt || computeSessionExpiry();
  if (opts.persist !== false) persistSession(m);
  // Notifications aren't part of the full-state fetch above anymore (see
  // loadNotifications() in 02-state-storage.js) — fetch this member's own
  // on login so the bell isn't empty until the next scheduler tick/bell-open.
  // runScheduledNotificationChecks() is deliberately chained AFTER the fetch
  // resolves, not fired in parallel with it — those checks dedupe by
  // scanning state.notifications in memory, so running them before the
  // fetch lands (against a still-empty array) could create a genuine
  // duplicate of a reminder that already exists on the server. (They're
  // also individually gated behind the same "have we loaded yet" flag as a
  // second line of defense — see _notifBaselineLoaded in 01-notifications.js.)
  loadNotifications().then(() => {
    runScheduledNotificationChecks();
    if (session && session.userId) renderTopWho();
  }).catch(e => console.error('loadNotifications (login) failed:', e));
  startNotificationScheduler();
  startRealtimeSync(); // moved here from bindActivityTracking() — only open the live listener once someone is actually signed in
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-screen').style.display = 'block';
  activeTab = 'dashboard';
  // Recompute on every login — see getCurrentMonthStr() comment above for why
  // relying only on the value set when the script first loaded isn't enough.
  currentMonth = getCurrentMonthStr();
  const monthSelectEl = document.getElementById('month-select');
  monthSelectEl.value = currentMonth;
  if (!monthSelectEl._changeBound) {
    monthSelectEl.addEventListener('change', (e) => {
      currentMonth = e.target.value;
      renderTabContent();
    });
    monthSelectEl._changeBound = true; // prevents duplicate listeners if enterApp() runs again (logout -> login again) without a full page reload
  }
  renderTopWho();
  renderTabs();
  renderTabContent(true);
  startSessionCountdown();
  // Mandatory security gate: anyone still on the default PIN must change it
  // before doing anything else. The app underneath has already rendered
  // normally (existing behavior untouched) — this just locks it behind a
  // non-dismissible overlay until the PIN is changed.
  if (m.pin === DEFAULT_PIN) showForcedPinChangeModal(m.id);
}

// `state` at this point may only be the lightweight login-screen data
// (members/settings/meta/monthlyActive — see fetchLoginScreenState() in
// 02-state-storage.js), not the full days/deposits/expenses/costs/logs a
// signed-in session actually needs. This fetches the full data (via the
// same realtime listener the app keeps running afterwards — see
// waitForFirstSnapshot()/ensureRealtimeListener() in 05-session-sync.js,
// so it's still only ONE full read, not an extra one on top of the live
// listener) and only THEN calls enterApp(), so the dashboard never briefly
// flashes empty/zeroed data. Throws on failure — callers decide how to
// surface that (see doLogin() and paintFromState() below).
async function enterAppWithFullData(m, opts) {
  const items = await waitForFirstSnapshot();
  state = validateState(buildStateFromItems(items));
  _hasFullState = true; // see 02-state-storage.js — now safe for _markEdited() to cache `state`
  writeLocalCache(state);
  enterApp(m, opts);
}

/* ---------------- LOGIN ---------------- */
function hideBootLoader() {
  const el = document.getElementById('boot-loader');
  if (_bootSkeletonTimer) { clearTimeout(_bootSkeletonTimer); _bootSkeletonTimer = null; }
  if (el) el.remove();
}

// Fades in the shimmering skeleton preview inside #boot-loader (see the
// .bl-skeleton/.skel-block CSS and markup in index.html) after a short
// delay, instead of immediately — so a fast connection that clears the
// loader in well under a second never even flashes the skeleton, and only
// a load that's genuinely taking a moment shows shaped placeholders under
// the spinner instead of a blank gap. Called once for the initial static
// loader (below) and again each time showBootLoader() (re)builds it.
let _bootSkeletonTimer = null;
function armBootSkeleton(el) {
  if (!el) return;
  if (_bootSkeletonTimer) clearTimeout(_bootSkeletonTimer);
  el.classList.remove('bl-show-skeleton');
  _bootSkeletonTimer = setTimeout(() => {
    const stillEl = document.getElementById('boot-loader');
    if (stillEl) stillEl.classList.add('bl-show-skeleton');
    _bootSkeletonTimer = null;
  }, 350);
}
// Arms it for the initial boot-loader markup already sitting in index.html
// (present before this script even runs, since <script defer> executes
// after the DOM is parsed).
armBootSkeleton(document.getElementById('boot-loader'));

// Shows (or updates, if already showing) the same branded full-screen
// loader used for the very first page load — see index.html's initial
// #boot-loader markup, which uses these exact class names (.bl-logo/
// .bl-ring/.bl-txt) so this never looks like a "different" loading state
// mid-flow. Used for: (1) a slow persisted-session auto-login (see
// paintFromState() in 20-bootstrap.js), and (2) doLogin() below, so
// waiting on a slow connection always shows this instead of a frozen-
// looking screen with just a button label change.
function showBootLoader(message) {
  let el = document.getElementById('boot-loader');
  if (el && el.querySelector('.bl-content')) {
    // Boot loader is already up on screen (e.g. going straight from the
    // initial "Loading MessLedger…" text into this one) — just update the
    // message in place instead of rebuilding. Previously this always
    // replaced the whole innerHTML, which destroyed and recreated the
    // logo/ring/dots too, restarting their animations and causing a
    // visible flash/jolt right when the text changed. A plain text swap
    // (with a quick crossfade) leaves everything else untouched.
    el.style.display = 'flex';
    const txt = el.querySelector('.bl-txt');
    if (txt && txt.textContent !== message) {
      txt.style.opacity = '0';
      setTimeout(() => {
        txt.textContent = message;
        txt.style.opacity = '1';
      }, 150);
    }
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-loader';
    document.body.insertBefore(el, document.body.firstChild);
  }
  el.innerHTML = `
    <div class="bl-dots"></div>
    <div class="bl-glow"></div>
    <div class="bl-content">
      <div class="bl-ring-wrap"><div class="bl-ring-track"></div><div class="bl-ring"></div><div class="bl-logo"><img src="favicon.png" alt="" width="100" height="100"></div></div>
      <div class="bl-brand">MessLedger</div>
      <div class="bl-txt">${message}</div>
      <div class="bl-skeleton">
        <div class="skel-block bl-skel-card"></div>
        <div class="skel-block bl-skel-row"></div>
        <div class="skel-block bl-skel-row short"></div>
        <div class="skel-block bl-skel-row"></div>
      </div>
    </div>`;
  el.style.display = 'flex';
  armBootSkeleton(el);
}

function normalizePhone(p) {
  return (p || '').replace(/\D/g, '');
}
// Finds a member by phone number. Tries an exact normalized match first
// (digits only, ignoring spaces/dashes), then falls back to comparing just
// the last 10 digits so a stored "+8801712345678" still matches someone
// typing "01712345678" (or vice versa).
function findMemberByPhone(entered) {
  const norm = normalizePhone(entered);
  if (!norm) return null;
  let m = state.members.find(mm => mm.phone && normalizePhone(mm.phone) === norm);
  if (!m && norm.length >= 10) {
    const last10 = norm.slice(-10);
    m = state.members.find(mm => mm.phone && normalizePhone(mm.phone).slice(-10) === last10);
  }
  return m || null;
}

// Tracks whether the (deliberately tucked-away) sign-in form has been
// revealed on the maintenance screen — see renderLogin() below. Resets to
// false on every fresh renderLogin() call from outside (e.g. logout()),
// but toggleMaintenanceLoginForm() flips it and re-renders in place.
let _maintenanceLoginFormOpen = false;

function toggleMaintenanceLoginForm() {
  _maintenanceLoginFormOpen = !_maintenanceLoginFormOpen;
  renderLogin();
}

function renderLogin() {
  hideBootLoader();
  const s = document.getElementById('login-screen');
  const maintenanceOn = !!(state && state.settings && state.settings.maintenanceMode);
  if (maintenanceOn && !_maintenanceLoginFormOpen) {
    // Default maintenance view: just the message, no visible sign-in
    // form — see the maintenanceMode comment in defaultSettings()
    // (02-state-storage.js) for the full design. The small link below is
    // the only way back to the normal form, deliberately unobtrusive so
    // it reads as "for admins", not an invitation for everyone to keep
    // trying to log in during a lockdown.
    const msg = (state.settings.maintenanceMessage || '').trim() ||
      "We're doing scheduled maintenance right now. Please check back shortly.";
    s.innerHTML = `
      <div class="login-card">
        <div class="login-brand">
          <div class="logo-dot"><img src="favicon.png" alt="" width="20" height="20" style="width:100%; height:100%; display:block; border-radius:inherit;"></div>
          <div>
            <h1>MessLedger</h1>
            <div class="login-sub">Meal &amp; expense tracker</div>
          </div>
        </div>
        <div class="card" style="border:1px solid var(--warning); background:var(--warning-bg); margin:14px 0;">
          <div style="display:flex; align-items:flex-start; gap:10px;">
            <i class="fas fa-triangle-exclamation" style="color:var(--warning); margin-top:2px;"></i>
            <div>
              <div style="font-weight:700; margin-bottom:4px;">Under maintenance</div>
              <div class="small-note" style="margin:0; white-space:pre-wrap;">${escapeHtml(msg)}</div>
            </div>
          </div>
        </div>
        <div class="login-links">
          <button class="link-btn subtle" onclick="toggleMaintenanceLoginForm()">Super Admin sign in</button>
        </div>
      </div>`;
    return;
  }
  s.innerHTML = `
    <div class="login-card">
      <div class="login-brand">
        <div class="logo-dot"><img src="favicon.png" alt="" width="20" height="20" style="width:100%; height:100%; display:block; border-radius:inherit;"></div>
        <div>
          <h1>MessLedger</h1>
          <div class="login-sub">Meal &amp; expense tracker</div>
        </div>
      </div>
      <div class="login-tagline">${maintenanceOn ? 'Super Admin sign-in only — the app is under maintenance for everyone else.' : 'Enter your phone number and PIN to continue.'}</div>
      <label>Your phone number</label>
      <input type="tel" id="login-phone" inputmode="tel" placeholder="Enter your number" autocomplete="tel">
      <label>Your PIN</label>
      <input type="password" id="login-pin" inputmode="numeric" placeholder="4-digit PIN">
      <div class="error-text" id="login-error"></div>
      <button class="btn" id="login-btn" style="width:100%; text-align:center;">Sign In</button>
      <div class="login-links">
        ${maintenanceOn ? '<button class="link-btn subtle" onclick="toggleMaintenanceLoginForm()">Back</button>' : '<button class="link-btn subtle" onclick="forgotPin()">Forgot PIN?</button>'}
      </div>
    </div>`;
  document.getElementById('login-btn').addEventListener('click', doLogin);
}
// Resolves which member is trying to log in, by phone number. Shared by
// doLogin() and forgotPin().
function resolveLoginMember(errBox) {
  const phoneVal = document.getElementById('login-phone').value;
  const m = findMemberByPhone(phoneVal);
  if (!m && errBox) errBox.textContent = "No member found with that phone number.";
  return m;
}
async function forgotPin() {
  const m = resolveLoginMember(null);
  if (!m) {
    showToast('Enter your phone number first.', 'error');
    return;
  }
  const code = prompt(`Enter the recovery code to reset ${m.name}'s PIN:`);
  if (code === null) return;
  if (code.trim().toUpperCase() !== state.recoveryCode) {
    showToast('Invalid recovery code. Ask your super admin for it.', 'error');
    return;
  }
  m.pin = '0000';
  m.failedLoginAttempts = 0;
  m.accountDisabled = false;
  await persistMembers();
  showToast('PIN reset. Log in with 0000 and set a new PIN.', 'success');
}
async function doLogin() {
  const errBox = document.getElementById('login-error');
  errBox.textContent = '';
  const loginBtn = document.getElementById('login-btn');
  // Respond the instant the button is clicked — not just after all the
  // validation checks below — so there's never a moment where clicking
  // feels like it did nothing. Every early-return path below restores the
  // button, so it's never stuck showing "Checking…" if login fails fast.
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Checking…';
  }
  const resetBtn = () => {
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign In';
    }
  };
  const m = resolveLoginMember(errBox);
  if (!m) { resetBtn(); return; }
  if (m.accountDisabled) {
    errBox.textContent = `This account is disabled after ${MAX_LOGIN_ATTEMPTS} failed attempts. Ask your super admin to re-enable it, or use "Forgot PIN?" with the recovery code.`;
    resetBtn();
    return;
  }
  if (m.role !== 'superadmin' && !isMemberActiveInMonth(m.id, realCurrentMonth())) {
    errBox.textContent = `You're marked inactive for ${realCurrentMonth()} by the super admin, so you can't log in this month. Ask them to reactivate you for a future month.`;
    resetBtn();
    return;
  }
  const entered = document.getElementById('login-pin').value;
  if (entered !== m.pin) {
    // Super admin accounts are exempt from lockout — there'd be no one left
    // who could re-enable them if the only super admin got locked out.
    if (m.role !== 'superadmin') {
      m.failedLoginAttempts = (m.failedLoginAttempts || 0) + 1;
      if (m.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
        m.accountDisabled = true;
        await persistMembers();
        errBox.textContent = `Incorrect PIN. Account disabled after ${MAX_LOGIN_ATTEMPTS} failed attempts — ask your super admin to re-enable it.`;
        resetBtn();
        return;
      }
      await persistMembers();
      const left = MAX_LOGIN_ATTEMPTS - m.failedLoginAttempts;
      errBox.textContent = `Incorrect PIN. ${left} attempt${left===1?'':'s'} left before this account is disabled.`;
      resetBtn();
      return;
    }
    errBox.textContent = 'Incorrect PIN.';
    resetBtn();
    return;
  }
  // Superadmin-only kill switch — see the maintenanceMode/maintenanceMessage
  // comment in defaultSettings() (02-state-storage.js). Checked here, after
  // the PIN is confirmed correct, so a wrong PIN still shows "Incorrect
  // PIN" instead of leaking whether maintenance is on to someone who
  // hasn't even authenticated. Deliberately does NOT touch
  // failedLoginAttempts — being correct-but-blocked isn't a failed
  // attempt, and shouldn't risk locking that member's account out too.
  if (state.settings.maintenanceMode && m.role !== 'superadmin') {
    errBox.textContent = (state.settings.maintenanceMessage || '').trim() ||
      "We're doing scheduled maintenance right now. Please check back shortly.";
    resetBtn();
    return;
  }
  if (m.failedLoginAttempts) {
    m.failedLoginAttempts = 0;
    await persistMembers();
  }
  recordLoginLog(m);
  // BUGFIX (login felt frozen on a slow connection): this used to only
  // change the button's own label to "Signing in…" while
  // enterAppWithFullData() awaited a full data fetch that can take several
  // seconds — everything else on screen (the login card, phone/PIN fields)
  // just sat there unchanged, which read as broken rather than loading.
  // showBootLoader() brings up the same branded full-screen loader used
  // for the initial page boot, so a slow login now always shows clear,
  // consistent progress instead of a static form with one changed word.
  showBootLoader('Signing you in…');
  // A couple of seconds in, swap to a message that sets the right
  // expectation instead of leaving the same static line up the whole
  // time — makes a genuinely slow connection feel handled, not stuck.
  const slowMsgTimer = setTimeout(() => {
    const txt = document.querySelector('#boot-loader .bl-txt');
    if (txt) txt.textContent = 'Still loading your data — this can take a few seconds on a slower connection…';
  }, 3000);
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';
  }
  try {
    await enterAppWithFullData(m);
  } catch (err) {
    console.error('Failed to load full data after login:', err);
    hideBootLoader();
    errBox.textContent = 'Signed in, but could not load your data. Check your connection and try again.';
    resetBtn();
  } finally {
    clearTimeout(slowMsgTimer);
  }
}
// Best-effort browser/OS guess from the user agent string. Not exact (user
// agents can be spoofed or blocked), but good enough for "which device".
function detectDevice() {
  const ua = navigator.userAgent || '';
  let os = 'Unknown device';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  let browser = 'Unknown browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  return `${browser} on ${os}`;
}
// Keeps only the newest MAX_LOGIN_LOGS entries so this collection doesn't
// grow forever; older docs are deleted from storage too, not just dropped
// from memory.
function trimLoginLogs() {
  if (state.loginLogs.length > MAX_LOGIN_LOGS) {
    const excess = state.loginLogs.slice(MAX_LOGIN_LOGS);
    state.loginLogs = state.loginLogs.slice(0, MAX_LOGIN_LOGS);
    excess.forEach(l => deleteLoginLogDoc(l.id));
  }
}
/* ---------------- DATABASE ACTION LOG (super admin only) ----------------
   Records every add/update/delete write this app makes to meals, grocery
   costs, shared expenses, deposits/withdrawals, members, and settings — who
   did it, which module, and when. Hooked directly into the low-level
   persist() / delete() functions above (persistDay, persistCost,
   deleteCostDoc, persistExpense, deleteExpenseDoc, persistDeposit,
   deleteDepositDoc, persistMembers, persistSettings) so every current AND
   future write that goes through them is caught automatically — no need to
   remember to log at each individual "add meal" / "add cost" call site.
   Fire-and-forget, same as the data write itself: logging never blocks or
   slows down the action the person is doing. Capped at MAX_ACTION_LOGS. */
function trimActionLogs() {
  if (state.actionLogs.length > MAX_ACTION_LOGS) {
    const excess = state.actionLogs.slice(MAX_ACTION_LOGS);
    state.actionLogs = state.actionLogs.slice(0, MAX_ACTION_LOGS);
    excess.forEach(l => deleteActionLogDoc(l.id));
  }
}

function logAction(module, action, recordId, detail) {
  if (!session.userId) return; // nothing to attribute a system-level write to (e.g. first-run seeding) — skip
  const me = memberById(session.userId);
  const entry = {
    id: 'al' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    memberId: session.userId,
    memberName: me ? me.name : 'Unknown',
    role: session.role,
    module,
    action,
    recordId: recordId !== undefined ? String(recordId) : '',
    detail: detail || '',
    at: nowTimestamp()
  };
  state.actionLogs.unshift(entry);
  trimActionLogs();
  persistActionLog(entry.id); // fire-and-forget — see comment above
  if (activeTab === 'actionlog') renderTabContent();
}
// Best-effort public IP lookup. This is genuinely best-effort: it depends on
// an external service and the user's network/browser allowing it, so it can
// fail (offline, blocked, slow) without that ever holding up sign-in/out —
// callers don't await this before proceeding, and the log entry is saved
// immediately with whatever it has, then quietly updated if an IP arrives.
async function fetchClientIp() {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('https://api.ipify.org?format=json', {
      signal: ctrl.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return '';
    const data = await res.json();
    return (data && data.ip) ? data.ip : '';
  } catch (e) {
    return '';
  }
}
// Logs who signed in/out, when (Bangladesh time), from which device, action
// (login/logout), and IP if it can be determined. Every entry is saved
// right away so it shows up in the Login Log immediately; the IP (when it
// resolves) is patched onto the same entry and re-saved a moment later.
async function recordLoginLog(member, action) {
  action = action || 'login';
  const id = 'lg' + Date.now() + '_' + member.id + '_' + action;
  const entry = {
    id,
    memberId: member.id,
    memberName: member.name,
    role: member.role,
    timestamp: nowTimestamp(),
    device: detectDevice(),
    action,
    ip: ''
  };
  state.loginLogs.unshift(entry);
  trimLoginLogs();
  await persistLoginLog(id);
  if (activeTab === 'loginlog') renderTabContent();
  fetchClientIp().then(ip => {
    if (!ip) return;
    const e = state.loginLogs.find(x => x.id === id);
    if (!e) return; // already trimmed off (extremely unlikely this soon)
    e.ip = ip;
    persistLoginLog(id);
    if (activeTab === 'loginlog') renderTabContent();
  });
}

function logout() {
  const m = memberById(session.userId);
  if (m) recordLoginLog(m, 'logout');
  stopSessionCountdown();
  stopRealtimeSync();
  stopNotificationScheduler();
  // Reset so the next login re-gates checkLowBalanceNotification/
  // checkMarketDutyReminders/checkMealEditReminders behind a fresh
  // loadNotifications() (see the flag's comment in 01-notifications.js) —
  // otherwise a same-tab re-login (logout -> log back in without a full
  // page reload) would incorrectly treat stale notification data as
  // "already loaded" and risk creating duplicates.
  _notifBaselineLoaded = false;
  if (_backgroundPauseTimer) {
    clearTimeout(_backgroundPauseTimer);
    _backgroundPauseTimer = null;
  }
  _listenerPausedForBackground = false;
  clearPersistedSession();
  _maintenanceLoginFormOpen = false;
  if (notifPanelOpen) {
    notifPanelOpen = false;
    document.removeEventListener('click', closeNotifPanelOnOutsideClick);
  }
  session = {
    userId: null,
    role: null
  };
  sessionExpiresAt = null;
  document.getElementById('main-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'block';
  renderLogin();
}
async function changeMyPin() {
  const me = memberById(session.userId);
  const oldPin = prompt('Enter your current PIN:');
  if (oldPin === null) return;
  if (oldPin !== me.pin) {
    showToast('Current PIN is incorrect.', 'error');
    return;
  }
  const newPin = prompt('Enter new PIN (at least 4 digits):');
  if (newPin === null) return;
  if (!newPin || newPin.length < 4) {
    showToast('PIN must be at least 4 digits.', 'error');
    return;
  }
  const confirmPin = prompt('Re-enter new PIN to confirm:');
  if (confirmPin !== newPin) {
    showToast("PINs don't match. Try again.", 'error');
    return;
  }
  me.pin = newPin;
  await persistMembers();
  showToast('PIN updated.', 'success');
}

/* ---------------- MANDATORY DEFAULT-PIN CHANGE (security gate) ----------------
   Anyone who logs in still on the default PIN (0000 — see DEFAULT_PIN above)
   gets a full-screen, non-dismissible modal on top of the app the instant
   they land in enterApp(). There is deliberately no close/cancel/skip button,
   no backdrop-click handler, and no Escape handler — the only way out is a
   successful PIN change, which then forces a fresh login with the new PIN.
   Everything else in the app (menus, tabs, dashboard) keeps rendering
   normally underneath; this overlay is what actually blocks interaction
   with it while it's open. */
let _forcedPinStylesInjected = false;

function injectForcedPinStyles() {
  if (_forcedPinStylesInjected) return;
  _forcedPinStylesInjected = true;
  const style = document.createElement('style');
  style.id = 'forced-pin-styles';
  style.textContent = `
    #forced-pin-overlay{position:fixed; inset:0; z-index:99999; display:none; align-items:center; justify-content:center; padding:16px;}
    #forced-pin-overlay .forced-pin-backdrop{position:absolute; inset:0; background:rgba(15,23,42,0.72); backdrop-filter:blur(2px);}
    #forced-pin-overlay .forced-pin-modal{position:relative; width:100%; max-width:400px; background:var(--surface); color:var(--ink); border-radius:16px; padding:28px 24px; box-shadow:0 20px 60px rgba(0,0,0,0.35); animation:forcedPinPop .25s ease-out;}
    @keyframes forcedPinPop{ from{opacity:0; transform:translateY(12px) scale(.97);} to{opacity:1; transform:translateY(0) scale(1);} }
    #forced-pin-overlay .forced-pin-icon{font-size:32px; text-align:center; margin-bottom:6px;}
    #forced-pin-overlay h2{font-size:19px; text-align:center; margin:0 0 8px;}
    #forced-pin-overlay .forced-pin-msg{font-size:13.5px; text-align:center; opacity:0.8; margin:0 0 20px; line-height:1.45;}
    #forced-pin-overlay .forced-pin-field{margin-bottom:14px;}
    #forced-pin-overlay .forced-pin-field label{display:block; font-size:12.5px; font-weight:600; margin-bottom:5px; opacity:0.85;}
    #forced-pin-overlay .forced-pin-field input{width:100%; box-sizing:border-box; padding:11px 12px; border-radius:9px; border:1px solid var(--border); font-size:15px; background:var(--surface-alt); color:inherit; transition:border-color .15s, box-shadow .15s;}
    #forced-pin-overlay .forced-pin-field input:focus{outline:none; border-color:var(--primary); box-shadow:0 0 0 3px var(--primary-bg);}
    #forced-pin-overlay #fpin-error{min-height:18px; margin-bottom:10px;}
    #forced-pin-overlay #fpin-submit{width:100%; text-align:center;}
    body.forced-pin-lock #main-screen{filter:blur(2px); pointer-events:none; user-select:none;}
  `;
  document.head.appendChild(style);
}

function showForcedPinChangeModal(memberId) {
  injectForcedPinStyles();
  let overlay = document.getElementById('forced-pin-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'forced-pin-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="forced-pin-backdrop"></div>
    <div class="forced-pin-modal" role="dialog" aria-modal="true" aria-labelledby="forced-pin-title">
      <div class="forced-pin-icon">🔒</div>
      <h2 id="forced-pin-title">Change Your Default PIN</h2>
      <p class="forced-pin-msg">For your account security, you must change your default PIN before continuing.</p>
      <div class="forced-pin-field">
        <label>Current PIN</label>
        <input type="password" id="fpin-current" inputmode="numeric" autocomplete="off" placeholder="Enter current PIN">
      </div>
      <div class="forced-pin-field">
        <label>New PIN</label>
        <input type="password" id="fpin-new" inputmode="numeric" autocomplete="off" placeholder="At least 4 digits">
      </div>
      <div class="forced-pin-field">
        <label>Confirm New PIN</label>
        <input type="password" id="fpin-confirm" inputmode="numeric" autocomplete="off" placeholder="Re-enter new PIN">
      </div>
      <div class="error-text" id="fpin-error"></div>
      <button class="btn" id="fpin-submit">Change PIN</button>
    </div>
  `;
  // No backdrop click-to-close and no Escape handler — intentionally absent
  // so the modal cannot be dismissed any way other than a successful change.
  overlay.style.display = 'flex';
  document.body.classList.add('forced-pin-lock');
  document.getElementById('fpin-submit').addEventListener('click', () => submitForcedPinChange(memberId));
  overlay.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitForcedPinChange(memberId);
      }
    });
  });
  document.getElementById('fpin-current').focus();
}

function closeForcedPinModal() {
  const overlay = document.getElementById('forced-pin-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  }
  document.body.classList.remove('forced-pin-lock');
}
async function submitForcedPinChange(memberId) {
  const errBox = document.getElementById('fpin-error');
  const m = memberById(memberId);
  if (!m) {
    closeForcedPinModal();
    return;
  } // shouldn't happen, but don't leave someone stuck behind a dead overlay
  errBox.textContent = '';
  const cur = document.getElementById('fpin-current').value;
  const next = document.getElementById('fpin-new').value;
  const conf = document.getElementById('fpin-confirm').value;
  if (!cur) {
    errBox.textContent = 'Enter your current PIN.';
    return;
  }
  if (cur !== m.pin) {
    errBox.textContent = 'Current PIN is incorrect.';
    return;
  }
  if (!next || next.length < 4) {
    errBox.textContent = 'New PIN must be at least 4 digits.';
    return;
  }
  if (next === DEFAULT_PIN) {
    errBox.textContent = 'New PIN cannot be the default PIN (0000).';
    return;
  }
  if (conf !== next) {
    errBox.textContent = "PINs don't match. Try again.";
    return;
  }
  const submitBtn = document.getElementById('fpin-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Changing...';
  try {
    m.pin = next; // account is now off the default PIN, so this modal won't trigger again
    m.failedLoginAttempts = 0;
    await persistMembers();
  } catch (e) {
    errBox.textContent = 'Something went wrong saving your new PIN. Please try again.';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Change PIN';
    return;
  }
  closeForcedPinModal();
  showToast('Your PIN has been changed successfully. Please log in again using your new PIN.', 'success');
  logout(); // clears session and returns to the login screen, per the mandatory-relogin requirement
}

/* ---------------- SHELL ---------------- */
/* ===== 07-ui-shell.js ===== */
// ---------------------------------------------------------------------------
// 07-ui-shell.js  (originally app.js lines 2176-2378)
// Top bar 'who' box, tab config + role filtering, tab bar rendering, tab switching/content routing
// ---------------------------------------------------------------------------
function renderTopWho() {
  const m = memberById(session.userId);
  const bal = myTotalBalance();
  let balColor = 'var(--success)',
    balBg = 'var(--success-bg)',
    balBorder = 'var(--border-success-tint)';
  if (bal < 0) {
    balColor = 'var(--danger)';
    balBg = 'var(--danger-bg)';
    balBorder = 'var(--border-danger-tint)';
  } else if (bal < state.settings.lowBalanceWarn) {
    balColor = 'var(--warning)';
    balBg = 'var(--warning-bg)';
    balBorder = 'var(--border-warning-tint)';
  }
  const balText = bal >= 0 ? `৳${Math.round(bal).toLocaleString('en-US')}` : `-৳${Math.round(Math.abs(bal)).toLocaleString('en-US')}`;
  checkLowBalanceNotification(session.userId, bal);
  const initial = m ? m.name.trim().charAt(0).toUpperCase() : '?';
  const isDark = currentTheme() === 'dark';
  const topMenuHtml = !topProfileMenuOpen ? '' : `
    <div class="header-profile-menu">
      <button type="button" onclick="changeMyPin()"><i class="fas fa-key"></i> Change PIN</button>
      <button type="button" onclick="toggleTheme()"><i class="fas fa-${isDark?'sun':'moon'}"></i> ${isDark?'Light Mode':'Dark Mode'}</button>
      <button type="button" onclick="logout()"><i class="fas fa-sign-out-alt"></i> Log Out</button>
    </div>`;
  document.getElementById('who-box').innerHTML = `
    ${renderNotifBell()}
    <span class="mono balance-pill" style="background:${balBg}; color:${balColor}; border-color:${balBorder};">${balText}${bal<state.settings.lowBalanceWarn?' ⚠':''}</span>
    <div class="header-profile-wrap" id="header-profile-wrap">
      <button type="button" class="header-profile-btn ${topProfileMenuOpen?'is-open':''}" onclick="toggleTopProfileMenu(event)" aria-label="Account menu" title="Account">
        <span class="header-profile-avatar">${initial}</span>
        <span class="header-profile-info">
          <span class="header-profile-name">${m?escapeHtml(m.name):''}</span>
          <span class="header-profile-role">${roleLabel(session.role)}</span>
        </span>
        <i class="fas fa-chevron-${topProfileMenuOpen?'up':'down'}"></i>
      </button>
      ${topMenuHtml}
    </div>
  `;
  renderHeaderGreeting(m);
}

// Fills the empty space on the left of the header row (desktop only — see
// .header-greeting's display:none base rule) with a time-of-day greeting
// and a one-line "essential info" summary, instead of leaving it blank
// next to the notification bell. Read-only reuse of dayMealTotals(), the
// same helper the dashboard/schedule tabs already use — nothing about the
// dashboard body itself is touched.
function renderHeaderGreeting(m) {
  const el = document.getElementById('header-greeting');
  if (!el) return;
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 21 ? 'Good evening' : 'Good night';
  const firstName = m ? m.name.trim().split(/\s+/)[0] : '';
  let infoLine = '';
  try {
    const t = dayMealTotals(todayStr());
    infoLine = t.total > 0 ? `<i class="fas fa-utensils"></i> ${t.total} meal${t.total===1?'':'s'} logged today · ${t.lunch}L / ${t.dinner}D` : `<i class="fas fa-utensils"></i> No meals logged today yet`;
  } catch (e) {
    infoLine = '';
  }
  el.innerHTML = `
    <div class="header-greeting-title">${greeting}${firstName ? ', ' + escapeHtml(firstName) : ''}</div>
    ${infoLine ? `<div class="header-greeting-sub">${infoLine}</div>` : ''}
  `;
}

let topProfileMenuOpen = false;
// Whether the mobile "More" sheet (extra tabs beyond the 4 quick-access
// slots in the phone bottom bar) is currently open. See renderMobileTabbar()
// / openMoreSheet() / closeMoreSheet() below.
let moreSheetOpen = false;

function toggleTopProfileMenu(e) {
  if (e) e.stopPropagation();
  topProfileMenuOpen = !topProfileMenuOpen;
  if (topProfileMenuOpen) {
    document.addEventListener('click', closeTopProfileMenuOnOutsideClick);
  } else {
    document.removeEventListener('click', closeTopProfileMenuOnOutsideClick);
  }
  renderTopWho();
}

function closeTopProfileMenuOnOutsideClick(e) {
  const wrap = document.getElementById('header-profile-wrap');
  if (wrap && !wrap.contains(e.target)) {
    topProfileMenuOpen = false;
    document.removeEventListener('click', closeTopProfileMenuOnOutsideClick);
    renderTopWho();
  }
}

// Tab configuration with icons
const tabConfig = {
  dashboard: {
    label: 'Dashboard',
    icon: 'fa-gauge-high'
  },
  meals: {
    label: 'Meals',
    icon: 'fa-utensils'
  },
  schedule: {
    label: 'Market Schedule',
    icon: 'fa-calendar-day'
  },
  history: {
    label: 'History',
    icon: 'fa-clock-rotate-left'
  },
  costs: {
    label: 'Grocery Costs',
    icon: 'fa-bag-shopping'
  },
  expenses: {
    label: 'Shared Expenses',
    icon: 'fa-money-bill-wave'
  },
  deposits: {
    label: 'Balances',
    icon: 'fa-scale-balanced'
  },
  members: {
    label: 'Members',
    icon: 'fa-users'
  },
  loginlog: {
    label: 'Login Log',
    icon: 'fa-right-to-bracket'
  },
  actionlog: {
    label: 'Database Log',
    icon: 'fa-database'
  },
  settings: {
    label: 'Settings',
    icon: 'fa-gear'
  }
};

// Category grouping for the sidebar menu — purely a display grouping on
// top of tabsForRole()'s existing role filtering below; it doesn't change
// which tabs a role can see, just how they're labeled/sectioned.
const tabGroups = {
  dashboard: 'Main',
  meals: 'Main',
  schedule: 'Main',
  history: 'Main',
  costs: 'Finance',
  expenses: 'Finance',
  deposits: 'Finance',
  members: 'Admin',
  loginlog: 'Admin',
  actionlog: 'Admin',
  settings: 'Admin'
};

function tabsForRole() {
  const base = [{
      id: 'dashboard'
    },
    {
      id: 'meals'
    },
    {
      id: 'schedule'
    },
    {
      id: 'history'
    }
  ];
  if (session.role === 'admin' || session.role === 'superadmin') {
    base.push({
      id: 'costs'
    });
    base.push({
      id: 'expenses'
    });
    base.push({
      id: 'deposits'
    });
  }
  if (session.role === 'superadmin') {
    base.push({
      id: 'members'
    });
    base.push({
      id: 'loginlog'
    });
    base.push({
      id: 'actionlog'
    });
    base.push({
      id: 'settings'
    });
  }
  return base;
}

// BUGFIX (tab switch looked like an abrupt "jhaki"/jump instead of a smooth
// color change): renderTabs() rebuilds #tabs'/the mobile tabbar's entire
// innerHTML from scratch on every single tab click. css/style.css already
// has transitions on .tab-btn i / .tab-icon-box / .mtab-btn for exactly
// this (color .15s ease, background .15s ease) — but a CSS transition only
// animates a property changing on the SAME DOM node over time. Destroying
// the old button and creating a brand new one already in its final
// "active" state (which is what innerHTML replacement does) gives the
// transition nothing to animate from, so the highlight just snaps into
// place instead of fading/sliding in. This walks the already-rendered
// buttons (tagged with data-tab-id — see renderTabs()/renderMobileTabbar()/
// renderMoreSheetBody() above) and only toggles the `active` class on the
// SAME nodes, so the existing CSS transitions actually get to run.
function updateActiveTabHighlight() {
  document.querySelectorAll('#tabs .tab-btn[data-tab-id]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tabId === activeTab);
  });
  const primaryTabIds = [];
  document.querySelectorAll('#mobile-tabbar .mtab-btn[data-tab-id]').forEach(btn => {
    const isActive = btn.dataset.tabId === activeTab;
    btn.classList.toggle('active', isActive);
    primaryTabIds.push(btn.dataset.tabId);
  });
  const moreBtn = document.querySelector('#mobile-tabbar .mtab-more');
  if (moreBtn) {
    // "More" itself is active when the selected tab isn't one of the fixed
    // primary slots — i.e. it's one of the tabs tucked in the sheet.
    moreBtn.classList.toggle('active', !primaryTabIds.includes(activeTab));
  }
  document.querySelectorAll('#more-sheet-body .more-sheet-item[data-tab-id]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tabId === activeTab);
  });
}

function renderTabs() {
  const tabs = tabsForRole();
  let lastGroup = null;
  const itemsHtml = tabs.map(t => {
    const cfg = tabConfig[t.id] || {
      label: t.id,
      icon: 'fa-circle'
    };
    const group = tabGroups[t.id] || 'Main';
    const groupLabelHtml = group !== lastGroup ? `<div class="tab-group-label">${group}</div>` : '';
    lastGroup = group;
    const pinClass = t.id === 'settings' ? ' tab-btn-pinned' : '';
    return `${groupLabelHtml}<button class="tab-btn ${activeTab===t.id?'active':''}${pinClass}" data-tab-id="${t.id}" onclick="setTab('${t.id}')">
      <span class="tab-icon-box"><i class="fas ${cfg.icon}"></i></span>
      <span class="tab-label">${cfg.label}</span>
      <span class="tab-chevron"><i class="fas fa-chevron-right"></i></span>
    </button>`;
  }).join('');
  document.getElementById('tabs').innerHTML = itemsHtml;

  renderMobileTabbar(tabs);
}

// ---------------------------------------------------------------------------
// Mobile bottom tab bar (phones only — desktop keeps using the .tabs sidebar
// list built above). Replaces the old design, which crammed every tab
// (up to 11 for a superadmin) into one horizontally-scrolling row with no
// way to tell there was more off-screen.
//
// New layout: the 4 tabs every role shares (Dashboard/Meals/Schedule/
// History) always get a fixed, evenly-spaced slot — no scrolling, nothing
// hidden. Anything role-specific beyond that (Finance tabs for admins,
// Admin tabs for superadmins) collapses into a single "More" slot that
// opens a bottom sheet, grouped exactly like the desktop sidebar so it's
// still easy to scan.
// ---------------------------------------------------------------------------
function renderMobileTabbar(tabs) {
  const bar = document.getElementById('mobile-tabbar');
  if (!bar) return;

  const primary = tabs.slice(0, 4);
  const rest = tabs.slice(4);

  const mtabBtn = t => {
    const cfg = tabConfig[t.id] || { label: t.id, icon: 'fa-circle' };
    return `<button type="button" class="mtab-btn ${activeTab === t.id ? 'active' : ''}" data-tab-id="${t.id}" onclick="setTab('${t.id}')">
      <span class="mtab-icon"><i class="fas ${cfg.icon}"></i></span>
      <span class="mtab-label">${cfg.label}</span>
    </button>`;
  };

  let html = primary.map(mtabBtn).join('');

  if (rest.length) {
    const restActive = rest.some(t => t.id === activeTab);
    html += `<button type="button" class="mtab-btn mtab-more ${restActive ? 'active' : ''}" onclick="toggleMoreSheet()" aria-haspopup="true" aria-expanded="${moreSheetOpen ? 'true' : 'false'}">
      <span class="mtab-icon"><i class="fas fa-ellipsis"></i></span>
      <span class="mtab-label">More</span>
    </button>`;
  }

  bar.innerHTML = html;
  renderMoreSheetBody(rest);
}

function renderMoreSheetBody(rest) {
  const body = document.getElementById('more-sheet-body');
  if (!body) return;
  if (!rest.length) {
    body.innerHTML = '';
    return;
  }
  let lastGroup = null;
  body.innerHTML = rest.map(t => {
    const cfg = tabConfig[t.id] || { label: t.id, icon: 'fa-circle' };
    const group = tabGroups[t.id] || 'More';
    const groupLabelHtml = group !== lastGroup ? `<div class="more-sheet-group-label">${group}</div>` : '';
    lastGroup = group;
    return `${groupLabelHtml}<button type="button" class="more-sheet-item ${activeTab === t.id ? 'active' : ''}" data-tab-id="${t.id}" onclick="selectFromMoreSheet('${t.id}')">
      <span class="more-sheet-item-icon"><i class="fas ${cfg.icon}"></i></span>
      <span class="more-sheet-item-label">${cfg.label}</span>
      <i class="fas fa-chevron-right more-sheet-item-chevron"></i>
    </button>`;
  }).join('');
}

function openMoreSheet() {
  moreSheetOpen = true;
  document.getElementById('more-sheet')?.classList.add('open');
  document.getElementById('more-sheet-backdrop')?.classList.add('open');
  document.body.classList.add('more-sheet-locked');
  const moreBtn = document.querySelector('.mtab-more');
  if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
}
function closeMoreSheet() {
  moreSheetOpen = false;
  document.getElementById('more-sheet')?.classList.remove('open');
  document.getElementById('more-sheet-backdrop')?.classList.remove('open');
  document.body.classList.remove('more-sheet-locked');
  const moreBtn = document.querySelector('.mtab-more');
  if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
}
function toggleMoreSheet() {
  if (moreSheetOpen) closeMoreSheet();
  else openMoreSheet();
}
function selectFromMoreSheet(id) {
  closeMoreSheet();
  setTab(id);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && moreSheetOpen) closeMoreSheet();
});

function scrollContentToTop() {
  // On desktop .content-wrap is the independently-scrolling panel; on
  // mobile the window itself scrolls. Reset whichever is active so every
  // tab opens from the top instead of wherever the previous tab left off.
  const cw = document.querySelector('.content-wrap');
  if (cw) cw.scrollTop = 0;
  window.scrollTo(0, 0);
}
async function setTab(id) {
  // Quick crossfade-out of whatever's currently in #content before we
  // swap tabs. Scoped to setTab (not renderTabContent itself) on purpose:
  // renderTabContent() is also called from dozens of places elsewhere
  // (every meal/expense/deposit edit re-renders the current tab to reflect
  // the change) and those in-place updates should stay instant — only an
  // actual tab switch should pay the small fade delay below. Without this,
  // the old tab's content was replaced by the new tab's content in the
  // same synchronous tick, so the "fade in" of the new content had nothing
  // to fade in *from* — it just snapped, which is what read as a jhaki.
  const outgoing = id !== activeTab ? document.getElementById('content') : null;
  if (outgoing && outgoing.childNodes.length) {
    outgoing.classList.add('tab-content-leaving');
    await new Promise(res => setTimeout(res, 150));
  }
  activeTab = id;
  if (moreSheetOpen) closeMoreSheet();
  if (id !== 'members') _maDirty = false;
  if (id !== 'settings') _adminMonthAccessDraft = null; // force a fresh draft next time Settings is opened
  // Build the sidebar/tabbar DOM once (login, or role/tab-set genuinely
  // changed); every subsequent tab click just toggles which button has the
  // `active` class on the SAME nodes (see updateActiveTabHighlight() above)
  // so the CSS color/background transitions can actually animate instead
  // of a rebuilt node snapping straight into its final state.
  if (document.querySelectorAll('#tabs .tab-btn[data-tab-id]').length) {
    updateActiveTabHighlight();
  } else {
    renderTabs();
  }
  scrollContentToTop();
  // BUGFIX (full-collection Firestore read on every single tab click): this
  // used to call loadState() here — a full re-fetch of the entire
  // mealAppStorage collection — every time a tab was opened, even though
  // the realtime listener (startRealtimeSync -> applyFreshState, see
  // 05-session-sync.js) already keeps `state` continuously up to date in
  // the background the whole time the app is open. That made every tab
  // click cost as much as a full app reload, for data that was already
  // current. `state` reflects the live listener's last snapshot (or the
  // polling fallback's), so we can just render it directly.
  //
  // The one case that still needs an explicit fetch: the realtime sync
  // isn't actually running (e.g. it failed to start and polling hasn't
  // kicked in yet either) — then `state` could genuinely be stale, so fall
  // back to a real fetch only in that situation.
  const syncIsLive = (typeof _snapshotUnsub !== 'undefined' && _snapshotUnsub) ||
    (typeof _autoSyncInterval !== 'undefined' && _autoSyncInterval);
  if (!syncIsLive) {
    const c = document.getElementById('content');
    if (c) {
      c.innerHTML = '<div class="card empty"><i class="fas fa-spinner fa-spin"></i>&nbsp; Loading latest data…</div>';
    }
    try {
      state = await loadState();
    } catch (e) {
      console.error('Tab refresh failed:', e);
      showToast('Could not refresh latest data — showing last known data.', 'error');
    }
  }
  // Login Log / Database Log aren't part of the live-synced state anymore
  // (see loadLogs() in 02-state-storage.js and the LOGS_COLLECTION comment
  // in storage.js) — they're fetched fresh, once, only when someone
  // actually opens one of these two tabs, instead of being pushed to every
  // signed-in member's listener for the entire session.
  if (id === 'loginlog' || id === 'actionlog') {
    const c = document.getElementById('content');
    if (c) {
      c.innerHTML = '<div class="card empty"><i class="fas fa-spinner fa-spin"></i>&nbsp; Loading logs…</div>';
    }
    try {
      await loadLogs();
    } catch (e) {
      console.error('loadLogs failed:', e);
      showToast('Could not load logs — check your connection and try again.', 'error');
    }
  }
  clearCalcCache();
  renderTabContent(true);
}

function renderTabContent(animate) {
  if (animate === undefined) animate = false;
  console.time('renderTabContent');
  renderTopWho();
  const c = document.getElementById('content');
  if (activeTab === 'dashboard') {
    c.innerHTML = renderDashboard();
    attachDashboardHandlers();
  } else if (activeTab === 'meals') {
    c.innerHTML = renderMeals();
    attachMealHandlers();
  } else if (activeTab === 'schedule') {
    c.innerHTML = renderSchedule();
  } else if (activeTab === 'history') {
    c.innerHTML = renderHistory();
    attachHistoryHandlers();
  } else if (activeTab === 'costs') {
    c.innerHTML = renderCosts();
    attachCostHandlers();
  } else if (activeTab === 'expenses') {
    c.innerHTML = renderExpenses();
    attachExpenseHandlers();
  } else if (activeTab === 'deposits') {
    c.innerHTML = renderDeposits();
    attachDepositHandlers();
  } else if (activeTab === 'members') {
    c.innerHTML = renderMembers();
    attachMemberHandlers();
  } else if (activeTab === 'loginlog') {
    c.innerHTML = renderLoginLog();
    attachLoginLogHandlers();
  } else if (activeTab === 'actionlog') {
    c.innerHTML = renderActionLog();
    attachActionLogHandlers();
  } else if (activeTab === 'settings') {
    // Only (re)initialize the draft from saved state if it doesn't exist yet.
    // Resetting unconditionally here used to wipe out in-progress edits
    // (Add Year / Remove Year / "all months" toggle) every time those
    // actions called renderTabContent() to redraw themselves.
    if (!_adminMonthAccessDraft) resetAdminMonthAccessDraft();
    c.innerHTML = renderSettings();
  }
  // Replay the tab-switch fade/slide-in animation ONLY when explicitly
  // requested (animate=true) — i.e. a genuine tab switch (setTab()) or the
  // initial paint right after login (enterApp()). Every other caller — the
  // dozens of in-place repaints after adding/removing a meal, grocery cost,
  // shared expense, or deposit/balance change on the SAME tab, plus the
  // live Firestore listener repainting someone else's change — leaves
  // animate unset and now defaults to false, so #content swaps in silently
  // instead of replaying the fade+shift+scale entrance animation. That
  // animation used to fire unconditionally on every render regardless of
  // caller, which is why simply adding/removing a meal, cost, expense, or
  // deposit made the whole page visibly "jolt" every single time — even
  // though nothing about it was actually navigation. Tab switches and the
  // post-login entrance still get the normal animated transition.
  if (animate) {
    // The class is already present on #content from the previous render, so
    // just adding it again wouldn't restart the CSS animation — removing
    // it, forcing a reflow (reading offsetWidth), then re-adding it is what
    // makes the browser treat it as a fresh animation start each time.
    c.classList.remove('tab-content-anim', 'tab-content-leaving');
    void c.offsetWidth;
    c.classList.add('tab-content-anim');
  }
  console.timeEnd('renderTabContent');
}

/* ---------------- CALC HELPERS ---------------- */
/* ===== 08-calculations.js ===== */
// ---------------------------------------------------------------------------
// 08-calculations.js  (originally app.js lines 2379-2758)
// Pure meal/cost/deposit/expense/balance calculations, month navigation helpers, all-time totals, meal-lock business rules
// ---------------------------------------------------------------------------
function monthDayKeys() {
  return Object.keys(state.days).filter(k => k.startsWith(currentMonth));
}

function dayMealTotals(dateStr) {
  const dayRec = state.days[dateStr];
  let lunch = 0,
    dinner = 0;
  if (dayRec && dayRec.meals) {
    Object.values(dayRec.meals).forEach(rec => {
      lunch += rec.lunch || 0;
      dinner += rec.dinner || 0;
    });
  }
  return {
    lunch,
    dinner,
    total: lunch + dinner
  };
}
// Combines grocery costs (state.costs) + shared expenses (state.expenses)
// recorded on one specific calendar date. Used for the "Today's Total Cost"
// card on the Dashboard. Note: this is separate from meal cost — it's raw
// money spent/logged that day, not what got charged to members.
function dayTotalCost(dateStr) {
  const costItems = state.costs.filter(c => c.date === dateStr).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  const expenseItems = state.expenses.filter(e => e.date === dateStr).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  const grocery = costItems.reduce((s, c) => s + Number(c.amount || 0), 0);
  const shared = expenseItems.reduce((s, e) => s + Number(e.amount || 0), 0);
  return {
    grocery,
    shared,
    total: grocery + shared,
    costItems,
    expenseItems
  };
}
// Month-wise active/inactive. A month with no explicit record for a member
// carries forward that member's most recent EARLIER explicit setting —
// so once someone is marked Inactive, they stay Inactive in every later
// month until a super admin explicitly re-activates them. Members are
// never auto-reactivated just because a new month started.
// Only if a member has NEVER been explicitly set in any month (including
// months recorded before this feature existed) do they default to ACTIVE.
function isMemberActiveInMonth(memberId, month) {
  const rec = state.monthlyActive && state.monthlyActive[month];
  if (rec && rec[memberId] !== undefined) return !!rec[memberId];
  const priorMonths = Object.keys(state.monthlyActive || {}).filter(mo => mo < month).sort();
  for (let i = priorMonths.length - 1; i >= 0; i--) {
    const priorRec = state.monthlyActive[priorMonths[i]];
    if (priorRec && priorRec[memberId] !== undefined) return !!priorRec[memberId];
  }
  return true;
}

function activeMemberIdsForMonth(month) {
  return state.members.filter(m => isMemberActiveInMonth(m.id, month)).map(m => m.id);
}

function memberMealCount(memberId) {
  return monthMealCountsAll(currentMonth)[memberId] || 0;
}

function totalMealsAll() {
  return monthTotalMeals(currentMonth);
}

function totalCostMonth() {
  return memo('totalCostMonth_' + currentMonth, () => state.costs.filter(c => c.date.startsWith(currentMonth)).reduce((s, c) => s + Number(c.amount || 0), 0));
}

function memberDepositMonth(memberId) {
  return monthDeposit(memberId, currentMonth);
}

function mealRate() {
  const t = totalMealsAll();
  return t > 0 ? totalCostMonth() / t : 0;
}

function monthMealRate(month) {
  return memo('monthMealRate_' + month, () => {
    const t = monthTotalMeals(month);
    return t > 0 ? monthTotalCost(month) / t : 0;
  });
}

function monthMemberMealCost(memberId, month) {
  return memo('monthMemberMealCost_' + memberId + '_' + month, () => monthMealCount(memberId, month) * monthMealRate(month));
}

function estimatedRemainingMeals(rate) {
  if (!rate || rate <= 0) return null;
  return myTotalBalance() / rate;
}

function allKnownMonths() {
  return memo('allKnownMonths', () => {
    const set = new Set();
    Object.keys(state.days).forEach(k => set.add(k.slice(0, 7)));
    state.costs.forEach(c => set.add(c.date.slice(0, 7)));
    state.deposits.forEach(d => set.add(d.date.slice(0, 7)));
    state.expenses.forEach(e => set.add(e.date.slice(0, 7)));
    return Array.from(set).sort();
  });
}

// Grouped versions: scan the underlying array ONCE per month and split the
// totals across every member in that single pass, instead of re-scanning the
// whole month's data separately for each of the 14 members.
function monthMealCountsAll(month) {
  return memo('monthMealCountsAll_' + month, () => {
    const counts = {};
    const activeIds = new Set(activeMemberIdsForMonth(month));
    Object.keys(state.days).forEach(k => {
      if (!k.startsWith(month)) return;
      const meals = state.days[k].meals;
      if (!meals) return;
      Object.keys(meals).forEach(mid => {
        // A member marked inactive for this month is completely excluded
        // from the month's meal totals/rate — as if they had no entries
        // at all, regardless of what's actually stored (e.g. meals entered
        // before they were deactivated mid-month).
        if (!activeIds.has(mid)) return;
        const rec = meals[mid];
        counts[mid] = (counts[mid] || 0) + (rec.lunch || 0) + (rec.dinner || 0);
      });
    });
    return counts;
  });
}

function monthMealCount(memberId, month) {
  return monthMealCountsAll(month)[memberId] || 0;
}

function monthTotalMeals(month) {
  return memo('monthTotalMeals_' + month, () => {
    const c = monthMealCountsAll(month);
    return Object.values(c).reduce((s, v) => s + v, 0);
  });
}

function monthTotalCost(month) {
  return memo('monthTotalCost_' + month, () => state.costs.filter(c => c.date.startsWith(month)).reduce((s, c) => s + Number(c.amount || 0), 0));
}

function monthDepositsAll(month) {
  return memo('monthDepositsAll_' + month, () => {
    const totals = {};
    state.deposits.forEach(d => {
      if (!d.date.startsWith(month)) return;
      totals[d.memberId] = (totals[d.memberId] || 0) + Number(d.amount || 0);
    });
    return totals;
  });
}

function monthDeposit(memberId, month) {
  return monthDepositsAll(month)[memberId] || 0;
}
// Deposits/withdrawals/net-change totals for a single month, scanning ONLY
// entries whose date falls inside that month (never all-time data).
function monthTotalDeposits(month) {
  return memo('monthTotalDeposits_' + month, () => state.deposits
    .filter(d => d.date.startsWith(month) && Number(d.amount || 0) > 0)
    .reduce((s, d) => s + Number(d.amount || 0), 0));
}

function monthTotalWithdrawals(month) {
  return memo('monthTotalWithdrawals_' + month, () => state.deposits
    .filter(d => d.date.startsWith(month) && Number(d.amount || 0) < 0)
    .reduce((s, d) => s + Math.abs(Number(d.amount || 0)), 0));
}

function monthNetBalanceChange(month) {
  return memo('monthNetBalanceChange_' + month, () => monthTotalDeposits(month) - monthTotalWithdrawals(month));
}

function monthExpenseSharesAll(month) {
  return memo('monthExpenseSharesAll_' + month, () => {
    const totals = {};
    state.expenses.forEach(e => {
      if (!e.date.startsWith(month)) return;
      e.memberIds.forEach(mid => {
        totals[mid] = (totals[mid] || 0) + expenseShareFor(e, mid);
      });
    });
    return totals;
  });
}

function monthExpenseShare(memberId, month) {
  return monthExpenseSharesAll(month)[memberId] || 0;
}

function expenseShareFor(expense, memberId) {
  if (expense.shares && expense.shares[memberId] !== undefined) return Number(expense.shares[memberId]);
  return Number(expense.amount) / expense.memberIds.length;
}

function monthTotalExpense(month) {
  return memo('monthTotalExpense_' + month, () => state.expenses.filter(e => e.date.startsWith(month)).reduce((s, e) => s + Number(e.amount || 0), 0));
}

function monthBalance(memberId, month) {
  return memo('monthBalance_' + memberId + '_' + month, () => {
    const cost = monthMemberMealCost(memberId, month);
    const expShare = monthExpenseShare(memberId, month);
    return monthDeposit(memberId, month) - cost - expShare;
  });
}

function openingBalance(memberId, month) {
  return memo('openingBalance_' + memberId + '_' + month, () =>
    allKnownMonths().filter(m => m < month).reduce((s, m) => s + monthBalance(memberId, m), 0)
  );
}

function memberTotalBalance(memberId) {
  return openingBalance(memberId, currentMonth) + monthBalance(memberId, currentMonth);
}

function myTotalBalance() {
  if (!session.userId) return 0;
  return memberTotalBalance(session.userId);
}

function realCurrentMonth() {
  return getCurrentMonthStr();
} // local date, not UTC — see getCurrentMonthStr() comment near top of file
// Shift a 'YYYY-MM' string by `delta` months (delta can be negative). Handles
// year rollover correctly (e.g. 2026-01 - 1 month => 2025-12).
function shiftMonthStr(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12;
  return `${ny}-${String(nm+1).padStart(2,'0')}`;
}
// Shift a 'YYYY-MM-DD' string by `delta` days (delta can be negative).
// Uses local midnight (not UTC) so day rollover matches what the user sees.
function shiftDateStr(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, '0'),
    day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
// Move the globally-selected month backward/forward by one month. Used by
// the ‹ › arrows next to the month toggle on every month-based page (Costs,
// Expenses, Balances, History, Meal History). Keeps the header's own month
// picker in sync, and switches the calling page into "month" view mode so
// the newly-selected month's data is immediately visible.
function navigateMonth(delta, setViewModeFn) {
  currentMonth = shiftMonthStr(currentMonth, delta);
  const sel = document.getElementById('month-select');
  if (sel) sel.value = currentMonth;
  if (setViewModeFn) setViewModeFn('month');
  else renderTabContent();
}

function memberBalanceNow(memberId) {
  const rc = realCurrentMonth();
  return openingBalance(memberId, rc) + monthBalance(memberId, rc);
}
// Move the Dashboard "Total Expense" card's selected date backward/forward by one day.
function navigateDashboardExpenseDate(delta) {
  dashboardExpenseDate = shiftDateStr(dashboardExpenseDate || todayStr(), delta);
  renderTabContent();
}

function setDashboardExpenseDate(dateStr) {
  if (!dateStr) return;
  dashboardExpenseDate = dateStr;
  renderTabContent();
}

function attachDashboardHandlers() {
  const dateInput = document.getElementById('dashboard-expense-date');
  if (dateInput) {
    dateInput.addEventListener('change', e => setDashboardExpenseDate(e.target.value));
  }
}

function allTimeTotalDeposits() {
  return memo('allTimeTotalDeposits', () => state.deposits.reduce((s, d) => s + Number(d.amount || 0), 0));
}
// allTimeTotalDeposits() above is actually NET (deposits minus withdrawals,
// since withdrawals are stored as negative amounts in the same array) — that
// stays correct for the cash-in-hand math below, but it's the wrong number
// to label "Total Deposited": these split it into the two gross figures.
function allTimeTotalDepositsGross() {
  return memo('allTimeTotalDepositsGross', () => state.deposits.filter(d => Number(d.amount || 0) > 0).reduce((s, d) => s + Number(d.amount || 0), 0));
}

function allTimeTotalWithdrawals() {
  return memo('allTimeTotalWithdrawals', () => state.deposits.filter(d => Number(d.amount || 0) < 0).reduce((s, d) => s + Math.abs(Number(d.amount || 0)), 0));
}

function allTimeTotalMeals() {
  return memo('allTimeTotalMeals', () => Object.values(state.days).reduce((s, d) => s + Object.values(d.meals || {}).reduce((s2, r) => s2 + (r.lunch || 0) + (r.dinner || 0), 0), 0));
}

function allTimeTotalGroceryCost() {
  return memo('allTimeTotalGroceryCost', () => state.costs.reduce((s, c) => s + Number(c.amount || 0), 0));
}

function allTimeTotalSharedExpense() {
  return memo('allTimeTotalSharedExpense', () => state.expenses.reduce((s, e) => s + Number(e.amount || 0), 0));
}

function allTimeTotalExpenses() {
  return allTimeTotalGroceryCost() + allTimeTotalSharedExpense();
}

function allTimeCashInHand() {
  return allTimeTotalDeposits() - allTimeTotalExpenses();
}

function isBalanceBlocked(memberId) {
  const buffer = Number(state.settings.negativeBalanceBuffer) || 0;
  return memberBalanceNow(memberId) < -buffer;
}

function isAdminBlocked(memberId) {
  const m = memberById(memberId);
  return !!(m && m.mealLock && m.mealLock.blocked);
}

function isMealIncreaseBlocked(memberId) {
  return isBalanceBlocked(memberId) || isAdminBlocked(memberId);
}

function canIncreaseMealNow(memberId) {
  if (isAdminBlocked(memberId)) return false;
  if (isBalanceBlocked(memberId)) {
    return session.role === 'admin' || session.role === 'superadmin';
  }
  return true;
}

function mealBlockReasons(memberId) {
  const reasons = [];
  if (isBalanceBlocked(memberId)) reasons.push('negative balance');
  if (isAdminBlocked(memberId)) {
    const m = memberById(memberId);
    reasons.push('blocked by admin' + (m.mealLock.reason ? `: ${m.mealLock.reason}` : ''));
  }
  return reasons;
}
async function toggleMealLock(memberId) {
  const m = memberById(memberId);
  if (!m.mealLock) m.mealLock = {
    blocked: false,
    reason: '',
    by: ''
  };
  if (m.mealLock.blocked) {
    if (!confirm(`Unblock meals for ${m.name}?`)) return;
    m.mealLock = {
      blocked: false,
      reason: '',
      by: ''
    };
  } else {
    const reason = prompt(`Reason for blocking ${m.name}'s meals (optional):`);
    if (reason === null) return;
    m.mealLock = {
      blocked: true,
      reason: reason.trim(),
      by: memberById(session.userId).name
    };
  }
  await persistMembers();
  renderTabContent();
}

/* ---------------- MARKET SCHEDULE HELPERS ---------------- */

/* ===== 09-dashboard.js ===== */
// ---------------------------------------------------------------------------
// 09-dashboard.js  (originally app.js lines 2759-3416)
// Date/shift/time formatting helpers, market-duty schedule + completion reminders/modal, renderDashboard, renderSchedule
// ---------------------------------------------------------------------------
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function hasMarketDay(m) {
  return m.marketDay !== null && m.marketDay !== undefined && m.marketDay !== '';
}

function shiftLabel(shift) {
  return shift === 'lunch' ? 'Lunch' : shift === 'dinner' ? 'Dinner' : shift === 'both' ? 'Both' : '—';
}

function fmtShortDate(d) {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

function marketDeadlineHourFor(shift) {
  return shift === 'dinner' ? state.settings.marketDeadlineDinner : state.settings.marketDeadlineLunch;
}

function formatHour12(h) {
  return formatTime12(h, 0);
}

function formatTime12(h, m) {
  const period = h >= 12 ? 'PM' : 'AM';
  let hh = h % 12;
  if (hh === 0) hh = 12;
  return `${hh}:${String(m||0).padStart(2,'0')} ${period}`;
}
// "1d 6h left" / "6h 24m left" / "24m left" — drops leading zero units so it
// doesn't always show all three, but always shows minutes for precision.
function formatCountdown(days, hours, minutes) {
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function nextMarketInfo(member) {
  if (!hasMarketDay(member)) return null;
  const targetDay = Number(member.marketDay);
  const now = new Date();
  const todayIdx = now.getDay();
  const diff = (targetDay - todayIdx + 7) % 7;
  const nextDate = new Date(now);
  nextDate.setDate(now.getDate() + diff);
  nextDate.setHours(0, 0, 0, 0);
  const isToday = diff === 0;
  const deadlineHour = marketDeadlineHourFor(member.marketShift);

  // Precise countdown against the real deadline moment (target date at that
  // shift's deadline hour) — not just whole calendar days — so "1 day left"
  // can instead read "1d 6h 24m left", using the same lunch/dinner deadline
  // times already configured in Settings.
  const deadline = new Date(nextDate);
  deadline.setHours(deadlineHour, 0, 0, 0);
  const diffMs = deadline - now;
  const overdue = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const remDays = Math.floor(absMs / 86400000);
  const remHours = Math.floor((absMs % 86400000) / 3600000);
  const remMinutes = Math.floor((absMs % 3600000) / 60000);
  const hoursLeft = isToday ? Math.round(absMs / 3600000) : null; // kept for anything still relying on the old rounded-hours value

  return {
    date: nextDate,
    daysLeft: diff,
    hoursLeft,
    isToday,
    overdue,
    deadlineHour,
    remDays,
    remHours,
    remMinutes,
    deadline
  };
}

function membersWithSchedule() {
  return state.members.map(m => ({
    member: m,
    info: nextMarketInfo(m)
  }));
}

/* ---------------- MEAL-SPECIFIC MARKET COMPLETION REMINDERS ----------------
   Separate from checkMarketDutyReminders() above (which just posts a one-time
   "you're on duty today" note to the Notification Center). This is a
   blocking popup, shown to the assigned shopper themselves, that appears
   only after THAT MEAL's own Shopping Deadline has passed and only if THAT
   MEAL hasn't been confirmed yet. Lunch and Dinner are tracked completely
   independently — a member on "both" shifts gets up to two separate
   confirmations for the same day, and confirming one never touches the
   other.

   Confirmation state lives on the member record itself
   (m.marketCompletions), keyed by "YYYY-MM-DD::lunch" / "YYYY-MM-DD::dinner",
   and rides along with the member's existing persistMembers() save — no new
   Firestore collection or sync path needed. */
function marketCompletionKey(dateStr, mealType) {
  return `${dateStr}::${mealType}`;
}

function getMarketCompletion(member, dateStr, mealType) {
  return (member.marketCompletions || {})[marketCompletionKey(dateStr, mealType)] || null;
}
// Which meal(s) a member is on shopping duty for, based on their shift.
// 'both' yields two independent meal types, each checked/confirmed on its own.
function mealTypesForShift(shift) {
  if (shift === 'both') return ['lunch', 'dinner'];
  if (shift === 'lunch' || shift === 'dinner') return [shift];
  return [];
}
// "3 Aug 2026" from a "YYYY-MM-DD" string.
function formatMarketCompletionDate(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[mo-1]} ${y}`;
}
// "Remind Me Later" suppresses the popup for the rest of THIS session only —
// it comes back on the next login (per spec), which happens naturally since
// this Set is recreated empty on every fresh page load/session.
let _marketReminderDismissedThisSession = new Set();
let _marketReminderModalOpenKey = null; // guards against stacking a second popup while one's already open
function checkMarketCompletionReminders() {
  if (!state || !session || !session.userId) return;
  if (_marketReminderModalOpenKey) return; // one popup at a time
  const me = memberById(session.userId);
  if (!me || !hasMarketDay(me)) return;
  const todayWeekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    weekday: 'long'
  }).format(new Date());
  const todayIdx = WEEKDAYS.indexOf(todayWeekday);
  if (Number(me.marketDay) !== todayIdx) return; // not this member's market day today
  const today = bdTodayDateStr();
  const nowHHMM = bdNowHHMM();
  for (const mealType of mealTypesForShift(me.marketShift)) {
    const deadlineHour = marketDeadlineHourFor(mealType);
    const deadlineHHMM = String(deadlineHour).padStart(2, '0') + ':00';
    if (nowHHMM < deadlineHHMM) continue; // this meal's deadline hasn't passed yet — no popup
    const key = marketCompletionKey(today, mealType);
    const existing = getMarketCompletion(me, today, mealType);
    if (existing && existing.status === 'completed') continue; // already confirmed — never show again for this meal
    if (_marketReminderDismissedThisSession.has(key)) continue; // deferred this session — reappears next login
    showMarketCompletionModal(me.id, mealType, today, deadlineHour);
    break; // surface one popup at a time even if both lunch and dinner are pending
  }
}
let _marketCompletionStylesInjected = false;

function injectMarketCompletionStyles() {
  if (_marketCompletionStylesInjected) return;
  _marketCompletionStylesInjected = true;
  const style = document.createElement('style');
  style.id = 'market-completion-styles';
  style.textContent = `
    #market-completion-overlay{position:fixed; inset:0; z-index:9998; display:none; align-items:center; justify-content:center; padding:16px;}
    #market-completion-overlay .mc-backdrop{position:absolute; inset:0; background:rgba(15,23,42,0.65); backdrop-filter:blur(2px);}
    #market-completion-overlay .mc-modal{position:relative; width:100%; max-width:400px; background:var(--surface); color:var(--ink); border-radius:16px; padding:26px 24px; box-shadow:0 20px 60px rgba(0,0,0,0.35); animation:mcModalPop .25s ease-out;}
    @keyframes mcModalPop{ from{opacity:0; transform:translateY(12px) scale(.97);} to{opacity:1; transform:translateY(0) scale(1);} }
    #market-completion-overlay .mc-icon{font-size:30px; text-align:center; margin-bottom:6px;}
    #market-completion-overlay h2{font-size:18px; text-align:center; margin:0 0 14px;}
    #market-completion-overlay .mc-row{display:flex; justify-content:space-between; gap:10px; font-size:13.5px; padding:8px 0; border-bottom:1px solid var(--border);}
    #market-completion-overlay .mc-row:last-of-type{border-bottom:none;}
    #market-completion-overlay .mc-row .mc-label{opacity:0.65; font-weight:600;}
    #market-completion-overlay .mc-row .mc-value{text-align:right; font-weight:600;}
    #market-completion-overlay .mc-items-box{margin-top:6px; margin-bottom:18px; font-size:13px; background:var(--surface-alt); border-radius:9px; padding:10px 12px; line-height:1.5;}
    #market-completion-overlay .mc-btns{display:flex; flex-direction:column; gap:9px; margin-top:18px;}
    #market-completion-overlay .mc-btn-primary{width:100%; text-align:center;}
    #market-completion-overlay .mc-btn-later{width:100%; text-align:center; background:transparent; border:1px solid var(--border); color:inherit; border-radius:9px; padding:10px; font-size:14px; cursor:pointer; font-family:inherit;}
    #market-completion-overlay .mc-btn-later:hover{background:var(--surface-alt);}
  `;
  document.head.appendChild(style);
}

function showMarketCompletionModal(memberId, mealType, dateStr, deadlineHour) {
  injectMarketCompletionStyles();
  const key = marketCompletionKey(dateStr, mealType);
  _marketReminderModalOpenKey = key;
  let overlay = document.getElementById('market-completion-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'market-completion-overlay';
    document.body.appendChild(overlay);
  }
  const me = memberById(memberId);
  const mealLabel = mealType === 'dinner' ? 'Dinner' : 'Lunch';
  const itemsHtml = (me && me.marketItems) ? escapeHtml(me.marketItems) : 'No shopping list added yet.';
  overlay.innerHTML = `
    <div class="mc-backdrop"></div>
    <div class="mc-modal" role="dialog" aria-modal="true" aria-labelledby="mc-title">
      <div class="mc-icon">🛒</div>
      <h2 id="mc-title">Market Completion Reminder</h2>
      <div class="mc-row"><span class="mc-label">Meal</span><span class="mc-value">${mealLabel}</span></div>
      <div class="mc-row"><span class="mc-label">Date</span><span class="mc-value">${formatMarketCompletionDate(dateStr)}</span></div>
      <div class="mc-row"><span class="mc-label">Shopping Deadline</span><span class="mc-value">${formatHour12(deadlineHour)}</span></div>
      <div class="mc-items-box"><b>Shopping Items:</b> ${itemsHtml}</div>
      <div class="mc-btns">
        <button class="btn mc-btn-primary" id="mc-confirm-btn">✅ Yes, Market Completed</button>
        <button class="mc-btn-later" id="mc-later-btn">⏰ Remind Me Later</button>
      </div>
    </div>
  `;
  overlay.style.display = 'flex';
  document.getElementById('mc-confirm-btn').addEventListener('click', () => confirmMarketCompletion(memberId, mealType, dateStr));
  document.getElementById('mc-later-btn').addEventListener('click', () => deferMarketCompletion(dateStr, mealType));
}

function closeMarketCompletionModal() {
  const overlay = document.getElementById('market-completion-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  }
  _marketReminderModalOpenKey = null;
}
// "Remind Me Later" — that meal stays Pending; the popup will surface again
// on the next login (or, if this same session stays open past midnight,
// naturally stops applying once bdTodayDateStr() rolls to a new date).
function deferMarketCompletion(dateStr, mealType) {
  _marketReminderDismissedThisSession.add(marketCompletionKey(dateStr, mealType));
  closeMarketCompletionModal();
}
// "Yes, Market Completed" — marks ONLY this specific meal (date+shift) as
// Completed, with a confirmation timestamp. Lunch and Dinner confirmations
// never touch each other since each lives under its own key.
async function confirmMarketCompletion(memberId, mealType, dateStr) {
  const me = memberById(memberId);
  if (!me) {
    closeMarketCompletionModal();
    return;
  }
  if (!me.marketCompletions) me.marketCompletions = {};
  me.marketCompletions[marketCompletionKey(dateStr, mealType)] = {
    status: 'completed',
    confirmedAt: nowTimestamp()
  };
  _marketReminderDismissedThisSession.delete(marketCompletionKey(dateStr, mealType));
  await persistMembers();
  closeMarketCompletionModal();
  const mealLabel = mealType === 'dinner' ? 'Dinner' : 'Lunch';
  showToast(`${mealLabel} market marked as completed.`, 'success');
}

/* ---------------- TREND CHARTS (Meals & Grocery Cost, last up to 6 months) ----------------
   Plain inline SVG bars computed from data already in state (monthTotalMeals/
   monthTotalCost, which are already memoized — see 08-calculations.js) — no
   charting library added, so this doesn't add a single byte to the app's
   script payload beyond this file (keeps the fast-load work from earlier
   intact). Meal-count trend is shown to every role (same numbers a member
   can already see for themselves elsewhere); Grocery Cost trend is
   admin/superadmin-only, matching the same role gate as the Grocery Costs
   tab itself (see tabsForRole() in 07-ui-shell.js) — regular members have
   no other view of mess-wide grocery spending, so this shouldn't be the
   first place they see it either. */
function trendMonths() {
  return allKnownMonths().slice(-6); // ascending, oldest..newest, max 6
}
function monthShortLabel(monthStr) {
  const idx = Number(monthStr.slice(5, 7)) - 1;
  return `${MONTHS_SHORT[idx]} '${monthStr.slice(2, 4)}`;
}
// Renders one row of bars for `values` (same length/order as `months`).
// valueFormatter controls the number shown above each bar (plain count vs money).
function trendBarChartSvg(months, values, barColorVar, valueFormatter) {
  const W = 640,
    H = 148,
    padTop = 20,
    padBottom = 24,
    padSide = 6;
  const n = months.length;
  const chartW = W - padSide * 2;
  const chartH = H - padTop - padBottom;
  const maxVal = Math.max(1, ...values); // avoid divide-by-zero when every month is 0
  const barGap = n > 1 ? 10 : 0;
  const barW = Math.max(14, (chartW - barGap * (n - 1)) / n);
  const bars = months.map((m, i) => {
    const v = values[i];
    const barH = Math.round((v / maxVal) * chartH);
    const x = padSide + i * (barW + barGap);
    const y = padTop + (chartH - barH);
    const labelY = y - 6 < 11 ? 11 : y - 6;
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${Math.max(barH, 1)}" rx="4" fill="${barColorVar}"><title>${monthShortLabel(m)}: ${valueFormatter(v)}</title></rect>
      <text x="${x + barW / 2}" y="${labelY}" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink)">${valueFormatter(v)}</text>
      <text x="${x + barW / 2}" y="${H - 7}" text-anchor="middle" font-size="10.5" fill="var(--ink-faint)">${monthShortLabel(m)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block; overflow:visible;">${bars}</svg>`;
}
function renderTrendsCard() {
  const months = trendMonths();
  if (!months.length) return ''; // brand-new mess, no data to trend yet
  const mealValues = months.map(m => monthTotalMeals(m));
  const canSeeCosts = session.role === 'admin' || session.role === 'superadmin';
  const costChartHtml = canSeeCosts ? `
      <div style="margin-top:18px; padding-top:14px; border-top:1px dashed var(--border);">
        <div class="small-note" style="margin:0 0 8px; font-weight:700; text-transform:uppercase; letter-spacing:.3px;">Grocery Cost / Month</div>
        ${trendBarChartSvg(months, months.map(m => monthTotalCost(m)), 'var(--danger)', v => fmtMoney(v))}
      </div>` : '';
  return `
    <div class="card">
      <h2>📈 Trends <span class="small-note" style="margin:0; font-weight:400;">(last ${months.length} month${months.length > 1 ? 's' : ''})</span></h2>
      <div>
        <div class="small-note" style="margin:0 0 8px; font-weight:700; text-transform:uppercase; letter-spacing:.3px;">Total Meals / Month</div>
        ${trendBarChartSvg(months, mealValues, 'var(--primary)', v => String(v))}
      </div>
      ${costChartHtml}
    </div>`;
}

/* ---------------- DASHBOARD ---------------- */
/* ---------------- TOMORROW-MEAL-OFF REMINDER BANNER ----------------
   Shows a small dismissible card at the top of Dashboard when the
   logged-in member has BOTH lunch and dinner off (0) for tomorrow and
   there's still time to change it (mirrors the same isMealLocked() gate
   Meals tab itself uses, so this never offers an action that would then
   fail as "locked"). Dismissing hides it for the rest of that specific
   tomorrow-date only (localStorage) — it reappears once the date rolls
   over to a new "tomorrow" that's also still off. */
function tomorrowMealReminderDismissKey() {
  return `messledger-meal-reminder-dismissed:${session.userId}:${tomorrowStr()}`;
}
function shouldShowTomorrowMealBanner() {
  if (!session || !session.userId) return false;
  const m = memberById(session.userId);
  if (!m) return false;
  const d = tomorrowStr();
  if (isMealLocked(d)) return false; // no point offering an action that's already too late
  let dismissed = false;
  try { dismissed = localStorage.getItem(tomorrowMealReminderDismissKey()) === '1'; } catch (e) {}
  if (dismissed) return false;
  const rec = state.days[d] && state.days[d].meals && state.days[d].meals[session.userId];
  const lunch = (rec && rec.lunch) || 0;
  const dinner = (rec && rec.dinner) || 0;
  return lunch === 0 && dinner === 0;
}
function tomorrowMealItemsSubtitle(d) {
  const lunchDuty = dutyMemberForDateMeal(d, 'lunch');
  const dinnerDuty = dutyMemberForDateMeal(d, 'dinner');
  const lunchItems = (lunchDuty && lunchDuty.marketItems) ? lunchDuty.marketItems.trim() : '';
  const dinnerItems = (dinnerDuty && dinnerDuty.marketItems) ? dinnerDuty.marketItems.trim() : '';
  const parts = [];
  if (lunchItems) parts.push(`<b>Lunch:</b> ${escapeHtml(lunchItems)}`);
  if (dinnerItems) parts.push(`<b>Dinner:</b> ${escapeHtml(dinnerItems)}`);
  if (!parts.length) return '';
  return `<div class="small-note" style="margin-top:3px;">🍳 ${parts.join(' &nbsp;·&nbsp; ')}</div>`;
}
function tomorrowMealBannerHtml() {
  if (!shouldShowTomorrowMealBanner()) return '';
  const d = tomorrowStr();
  const dLabel = fmtShortDate(new Date(d + 'T00:00:00'));
  return `<div class="alert-card warning meal-reminder-banner" style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;">
    <div style="flex:1 1 220px; min-width:0;">
      <b style="color:var(--warning);">🍽️ No meals on for tomorrow (${dLabel})</b>
      <div style="margin-top:4px;" class="small-note">You haven't turned on Lunch or Dinner for tomorrow yet.</div>
      ${tomorrowMealItemsSubtitle(d)}
    </div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; flex:0 0 auto;">
      <button type="button" class="btn" style="margin-top:0; min-height:0; padding:8px 14px; font-size:12.5px;" onclick="turnOnTomorrowMeals()">✓ Turn Both On</button>
      <button type="button" class="btn secondary" style="margin-top:0; min-height:0; padding:8px 14px; font-size:12.5px;" onclick="goToMealsForTomorrow()">Customize</button>
      <button type="button" class="btn secondary" style="margin-top:0; min-height:0; padding:8px 10px; font-size:12.5px;" onclick="dismissTomorrowMealBanner()">Not now</button>
    </div>
  </div>`;
}
async function turnOnTomorrowMeals() {
  const d = tomorrowStr();
  const memberId = session.userId;
  if (!canEditMealForDate(memberId, d)) {
    showToast('Meals for tomorrow are locked and can no longer be changed.', 'error');
    renderTabContent();
    return;
  }
  if (isAdminBlocked(memberId) || !canIncreaseMealNow(memberId)) {
    showToast(`Can't turn on meals — reason: ${mealBlockReasons(memberId).join(', ')}.`, 'error');
    renderTabContent();
    return;
  }
  if (!state.days[d]) state.days[d] = { meals: {} };
  if (!state.days[d].meals) state.days[d].meals = {};
  if (!state.days[d].meals[memberId]) state.days[d].meals[memberId] = { lunch: 0, dinner: 0 };
  const who = `${memberById(session.userId).name} (${roleLabel(session.role)})`;
  const now = nowTimestamp();
  state.days[d].meals[memberId].lunch = 1;
  state.days[d].meals[memberId].dinner = 1;
  state.days[d].meals[memberId].lunchBy = who;
  state.days[d].meals[memberId].dinnerBy = who;
  state.days[d].meals[memberId].lunchAt = now;
  state.days[d].meals[memberId].dinnerAt = now;
  renderTabContent();
  const ok = await persistDay(d);
  if (ok) showToast('Tomorrow\'s Lunch and Dinner turned on.', 'success');
}
function goToMealsForTomorrow() {
  mealSelectedDate = tomorrowStr();
  setTab('meals');
}
function dismissTomorrowMealBanner() {
  try { localStorage.setItem(tomorrowMealReminderDismissKey(), '1'); } catch (e) {}
  renderTabContent();
}

function renderDashboard() {
  const memberStatCards = [];
  const rows = state.members.map(m => {
    const meals = memberMealCount(m.id);
    const cost = monthMemberMealCost(m.id, currentMonth);
    const dep = memberDepositMonth(m.id);
    const expShare = monthExpenseShare(m.id, currentMonth);
    const totalExpense = cost + expShare;
    const thisMonthBal = dep - cost - expShare;
    const opening = openingBalance(m.id, currentMonth);
    const grandTotal = opening + thisMonthBal;
    const personalRate = meals > 0 ? (cost + expShare) / meals : null;
    const fmt = (v) => v >= 0 ? `<span class="pos">${fmtMoney(v)}</span>` : `<span class="neg">-${fmtMoney(Math.abs(v))}</span>`;
    const inactiveTag = !isMemberActiveInMonth(m.id, currentMonth) ? ' <span class="badge" style="background:var(--danger-bg); color:var(--danger);">Inactive this month</span>' : '';

    memberStatCards.push({
      id: m.id,
      html: `
      <div class="member-stat-card">
        <div class="member-stat-name">${m.name} ${roleBadgeHtml(m)}${inactiveTag}</div>
        <div class="stat-grid-2col" style="grid-template-columns:repeat(3,1fr); gap:6px;">
          <div class="stat-tile" style="padding:8px 6px;"><i class="fas fa-utensils"></i><div class="stat-tile-title">Meals</div><div class="stat-tile-value" style="font-size:12.5px;">${meals}</div></div>
          <div class="stat-tile" style="padding:8px 6px;"><i class="fas fa-bowl-food"></i><div class="stat-tile-title">Grocery Cost</div><div class="stat-tile-value" style="font-size:12.5px;">${fmtMoney(cost)}</div></div>
          <div class="stat-tile" style="padding:8px 6px;"><i class="fas fa-receipt"></i><div class="stat-tile-title">Shared Expense</div><div class="stat-tile-value" style="font-size:12.5px;">${fmtMoney(expShare)}</div></div>
          <div class="stat-tile" style="padding:8px 6px;"><i class="fas fa-wallet"></i><div class="stat-tile-title">Total Expense</div><div class="stat-tile-value" style="font-size:12.5px;">${fmtMoney(totalExpense)}</div></div>
          <div class="stat-tile" style="padding:8px 6px;"><i class="fas fa-piggy-bank"></i><div class="stat-tile-title">Deposits</div><div class="stat-tile-value" style="font-size:12.5px;">${fmtMoney(dep)}</div></div>
          <div class="stat-tile" style="padding:8px 6px;"><i class="fas fa-clock-rotate-left"></i><div class="stat-tile-title">Prior Balance</div><div class="stat-tile-value ${opening>=0?'pos':'neg'}" style="font-size:12.5px;">${opening>=0?'':'-'}${fmtMoney(Math.abs(opening))}</div></div>
          <div class="stat-tile" style="padding:8px 6px;"><i class="fas fa-layer-group"></i><div class="stat-tile-title">Dep+Prior</div><div class="stat-tile-value ${(dep+opening)>=0?'pos':'neg'}" style="font-size:12.5px;">${(dep+opening)>=0?'':'-'}${fmtMoney(Math.abs(dep+opening))}</div></div>
          <div class="stat-tile" style="padding:8px 6px;"><i class="fas fa-calculator"></i><div class="stat-tile-title">Personal Rate</div><div class="stat-tile-value" style="font-size:12.5px;">${personalRate!==null ? fmtMoney(personalRate) : '—'}</div></div>
          <div class="stat-tile" style="padding:8px 6px;"><i class="fas fa-scale-balanced"></i><div class="stat-tile-title">Total Balance</div><div class="stat-tile-value ${grandTotal>=0?'pos':'neg'}" style="font-weight:800; font-size:12.5px;">${grandTotal>=0?'':'-'}${fmtMoney(Math.abs(grandTotal))}</div></div>
        </div>
      </div>`
    });

    return `<tr>
      <td>${m.name} ${roleBadgeHtml(m)}${inactiveTag}</td>
      <td class="num">${meals}</td>
      <td class="num">${fmtMoney(cost)}</td>
      <td class="num">${fmtMoney(expShare)}</td>
      <td class="num">${fmtMoney(totalExpense)}</td>
      <td class="num">${fmtMoney(dep)}</td>
      <td class="num">${fmt(opening)}</td>
      <td class="num">${fmt(dep + opening)}</td>
      <td class="num" style="font-weight:700;">${fmt(grandTotal)}</td>
      <td class="num">${personalRate!==null ? fmtMoney(personalRate) : '—'}</td>
    </tr>`;
  }).join('');
  // Mobile Monthly Summary: show only the logged-in member's card by default,
  // with everyone else tucked behind a "Load More" expand/collapse. Desktop
  // is untouched — it keeps using the full dashboard-table above, which
  // still lists every member exactly as before.
  const myCardEntry = memberStatCards.find(c => c.id === session.userId);
  const otherCardEntries = memberStatCards.filter(c => c.id !== session.userId);
  const memberStatCardsHtml = `
    ${myCardEntry ? myCardEntry.html : ''}
    ${otherCardEntries.length ? `
    <div id="member-stat-extra" class="member-stat-extra">${otherCardEntries.map(c=>c.html).join('')}</div>
    <button type="button" id="member-stat-loadmore-btn" class="member-stat-loadmore-btn" onclick="toggleMemberStatExtra()">▼ Load More — Show All Members</button>` : ''}
  `;

  const myBal = myTotalBalance();
  const myMeals = memberMealCount(session.userId);
  const myCost = monthMemberMealCost(session.userId, currentMonth);
  const myExpShare = monthExpenseShare(session.userId, currentMonth);
  const myPersonalRate = myMeals > 0 ? (myCost + myExpShare) / myMeals : null;
  const remaining = estimatedRemainingMeals(myPersonalRate);
  let remainingLine = '';
  if (remaining !== null) {
    remainingLine = remaining >= 0 ?
      `<div class="small-note" style="margin-top:6px;">🍽️ At your personal meal rate (${fmtMoney(myPersonalRate)}/meal), your balance covers about <b>${Math.floor(remaining)}</b> more meals.</div>` :
      `<div class="small-note" style="margin-top:6px;">🍽️ Your balance is already short by the equivalent of <b>${Math.abs(Math.round(remaining))}</b> meals — please deposit before adding new meals.</div>`;
  }
  let banner = '';
  if (myBal < 0) {
    banner = `<div class="alert-card danger">
      <b style="color:var(--danger);">⚠ Your balance is negative</b>
      <div style="margin-top:4px;">Your account is short by <span class="mono neg">${fmtMoney(Math.abs(myBal))}</span>. Please deposit as soon as possible.</div>
      ${remainingLine}
    </div>`;
  } else if (myBal < state.settings.lowBalanceWarn) {
    banner = `<div class="alert-card warning">
      <b style="color:var(--warning);">⚠ Balance running low</b>
      <div style="margin-top:4px;">Your account has only <span class="mono">${fmtMoney(myBal)}</span> left. Consider topping up.</div>
      ${remainingLine}
    </div>`;
  } else {
    banner = `<div class="alert-card success">
      <b style="color:var(--success);">Your balance looks good</b>
      ${remainingLine}
    </div>`;
  }
  const myMonthlyExpense = myCost + myExpShare;
  const myBalFmt = myBal >= 0 ? `<span class="pos">${fmtMoney(myBal)}</span>` : `<span class="neg">-${fmtMoney(Math.abs(myBal))}</span>`;
  const myRateBreakdown = `This month's meal cost ${fmtMoney(myCost)} + your expense share ${fmtMoney(myExpShare)} = ${fmtMoney(myCost+myExpShare)} ÷ ${myMeals} meals`;
  const myStatsCard = `
    <div class="card">
      <h2>Your Summary</h2>
      <div class="summary-grid">
        <div class="summary-box"><div class="label">Current Balance</div><div class="value">${myBalFmt}</div></div>
        <div class="summary-box"><div class="label">Total Meals (${currentMonth})</div><div class="value">${myMeals}</div></div>
        <div class="summary-box"><div class="label">This Month's Expense</div><div class="value">${fmtMoney(myMonthlyExpense)}</div></div>
      </div>
      <div style="margin-top:14px; padding-top:12px; border-top:1px dashed var(--border);">
        <div class="small-note" style="margin:0; font-weight:700; text-transform:uppercase; letter-spacing:.3px;">Personal Meal Rate</div>
        <div class="mono" style="font-size:22px; font-weight:700; margin-top:4px; cursor:help;" title="${myPersonalRate!==null ? myRateBreakdown : 'No meals recorded this month yet'}">${myPersonalRate!==null ? fmtMoney(myPersonalRate) : '—'} <span class="small-note" style="font-weight:400; font-size:13px;">/ meal</span></div>
      </div>
    </div>`;
  if (!dashboardExpenseDate) dashboardExpenseDate = todayStr();
  const dayCost = dayTotalCost(dashboardExpenseDate);
  const groceryRows = dayCost.costItems.length ? dayCost.costItems.map(c => `
        <div style="display:flex; justify-content:space-between; align-items:baseline; padding:5px 0; gap:10px;">
          <span><span class="badge" style="margin-right:6px;">${MEAL_TIME_LABEL[c.mealType||'other']}</span><span class="small-note" style="margin:0;">${c.note||'—'}</span></span>
          <span class="mono">${fmtMoney(c.amount)}</span>
        </div>`).join('') : `<div class="small-note" style="padding:5px 0;">Nothing bought for groceries on this day yet.</div>`;
  const sharedRows = dayCost.expenseItems.length ? dayCost.expenseItems.map(e => `
        <div style="display:flex; justify-content:space-between; align-items:baseline; padding:5px 0; gap:10px;">
          <span>${e.splitType==='meal' ? `<span style="margin-right:6px; display:inline-block;">${mealBadge(e.mealTypeSplit||'both')}</span>` : ''}<b>${e.title}</b>${e.description ? `<span class="small-note" style="margin:0;"> — ${e.description}</span>` : ''}</span>
          <span class="mono">${fmtMoney(e.amount)}</span>
        </div>`).join('') : `<div class="small-note" style="padding:5px 0;">No shared expenses added on this day yet.</div>`;
  const totalExpenseCard = `
    <div class="card">
      <div class="row-between">
        <h2>Total Expenses</h2>
        <div>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateDashboardExpenseDate(-1)" title="Previous day">‹</button>
          <button class="btn secondary active-toggle" style="margin-top:0; cursor:default;">${dashboardExpenseDate}</button>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateDashboardExpenseDate(1)" title="Next day">›</button>
        </div>
      </div>
      <div style="margin:10px 0 4px;">
        <label style="font-size:12.5px;">Jump to date</label>
        <input type="date" id="dashboard-expense-date" value="${dashboardExpenseDate}">
      </div>
      <div style="margin-top:12px;">
        <div class="small-note" style="margin:0 0 2px; font-weight:700; text-transform:uppercase; letter-spacing:.3px;">Grocery Cost</div>
        ${groceryRows}
        <div style="display:flex; justify-content:space-between; padding:6px 0; border-top:1px solid var(--border); font-weight:600;">
          <span>Total Grocery Cost</span>
          <span class="mono">${fmtMoney(dayCost.grocery)}</span>
        </div>
      </div>
      <div style="margin-top:12px;">
        <div class="small-note" style="margin:0 0 2px; font-weight:700; text-transform:uppercase; letter-spacing:.3px;">Shared Expense</div>
        ${sharedRows}
        <div style="display:flex; justify-content:space-between; padding:6px 0; border-top:1px solid var(--border); font-weight:600;">
          <span>Total Shared Expense</span>
          <span class="mono">${fmtMoney(dayCost.shared)}</span>
        </div>
      </div>
        <div style="display:flex; justify-content:space-between; padding:8px 0 0; border-top:2px solid var(--border); margin-top:2px; font-weight:700;">
          <span>Total</span>
          <span class="mono">${fmtMoney(dayCost.total)}</span>
        </div>
      </div>
    </div>`;
  const schedList = membersWithSchedule();
  const todayDuty = schedList.filter(x => x.info && x.info.isToday);
  const upcomingDuty = schedList.filter(x => x.info && !x.info.isToday).sort((a, b) => a.info.daysLeft - b.info.daysLeft);
  let marketBox = '';
  if (todayDuty.length) {
    const t = dayMealTotals(todayStr());
    marketBox = `<div class="card" style="background:var(--success-bg); border-color:var(--border-success-tint);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div><b style="color:var(--success);">🛒 Market duty today:</b> ${todayDuty.map(x=>`${x.member.name} (${shiftLabel(x.member.marketShift)})`).join(', ')}</div>
        <button class="btn secondary" style="margin-top:0;" onclick="setTab('schedule')">View full schedule</button>
      </div>
      ${todayDuty.filter(x=>x.member.marketItems).map(x=>`<div class="small-note" style="margin-top:4px;">🧺 <b>${x.member.name}</b>'s items: ${x.member.marketItems}</div>`).join('')}
      <div class="small-note" style="margin-top:8px; background:var(--warning-bg); border:1px dashed var(--warning); border-radius:var(--radius-sm); padding:7px 10px; color:var(--warning); font-weight:600;">🛒 Shop for today's meals — <b style="font-size:17px;">${t.lunch}</b> Lunch, <b style="font-size:17px;">${t.dinner}</b> Dinner (<b style="font-size:17px;">${t.total}</b> total).</div>
    </div>`;
  } else if (upcomingDuty.length) {
    // Show everyone whose duty falls on that same nearest date (e.g. one
    // person on Lunch and another on Dinner the same day) — not just
    // whichever one happened to sort first.
    const nearestDays = upcomingDuty[0].info.daysLeft;
    const nextGroup = upcomingDuty.filter(x => x.info.daysLeft === nearestDays);
    const names = nextGroup.map(x => `<b>${x.member.name}</b> (${shiftLabel(x.member.marketShift)})`).join(', ');
    const g = nextGroup[0].info;
    marketBox = `<div class="card" style="background:var(--warning-bg); border-color:var(--border-warning-tint); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
      <div>🛒 Next market duty: ${names} — ${WEEKDAYS[nextGroup[0].member.marketDay]} (${formatCountdown(g.remDays, g.remHours, g.remMinutes)} left)</div>
      <button class="btn secondary" style="margin-top:0;" onclick="setTab('schedule')">View full schedule</button>
    </div>`;
  }
  const groupExpenses = allTimeTotalExpenses();
  const groupCash = allTimeCashInHand();
  const monthGrocery = totalCostMonth();
  const monthShared = monthTotalExpense(currentMonth);
  const monthCombinedCost = monthGrocery + monthShared;
  const monthDep = monthTotalDeposits(currentMonth);
  const monthWithdraw = monthTotalWithdrawals(currentMonth);
  const messPriorBalance = state.members.reduce((s, m) => s + openingBalance(m.id, currentMonth), 0);
  const messCashInHand = messPriorBalance + monthDep - monthWithdraw - monthCombinedCost;
  const personalReportCard = `
    <div class="card">
      <h2>📄 Person Based Daily Meal Rate</h2>
      <div style="margin-bottom:10px;">
        <label style="font-size:12.5px;">Select day</label>
        <input type="date" id="personal-report-date" value="${todayStr()}">
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn btn-download-highlight" style="flex:1; min-width:0;" onclick="downloadDailyMealRateReport()"><span class="dl-icon">⬇️</span> <span class="dl-label">Day Report (Everyone)</span></button>
        <button class="btn btn-download-highlight" style="flex:1; min-width:0;" onclick="downloadPersonalMonthReport()"><span class="dl-icon">⬇️</span> <span class="dl-label">${currentMonth} (Mine)</span></button>
        <button class="btn btn-download-highlight" style="flex:1; min-width:0;" onclick="downloadFullMonthAllMembersReport()"><span class="dl-icon">⬇️</span> <span class="dl-label">${currentMonth} (Everyone)</span></button>
      </div>
    </div>`;

  return `
    ${tomorrowMealBannerHtml()}
    ${banner}
    ${marketBox}
    ${myStatsCard}
    ${totalExpenseCard}
    <div class="card">
      <h2>${currentMonth} Summary</h2>
      <div class="summary-grid">
        <div class="summary-box"><div class="label">Total Meals</div><div class="value">${totalMealsAll()}</div></div>
        <div class="summary-box"><div class="label">Total Grocery Cost</div><div class="value">${fmtMoney(monthGrocery)}</div></div>
        <div class="summary-box"><div class="label">Total Shared Expenses</div><div class="value">${fmtMoney(monthShared)}</div></div>
        <div class="summary-box"><div class="label">Total Cost (Grocery + Shared)</div><div class="value neg">${fmtMoney(monthCombinedCost)}</div></div>
        <div class="summary-box"><div class="label">Total Deposit</div><div class="value pos">${fmtMoney(monthDep)}</div></div>
        <div class="summary-box"><div class="label">Total Withdrawal</div><div class="value ${monthWithdraw>0?'neg':''}">${fmtMoney(monthWithdraw)}</div></div>
        <div class="summary-box"><div class="label">Prior Balance</div><div class="value ${messPriorBalance>=0?'pos':'neg'}">${messPriorBalance>=0?'':'-'}${fmtMoney(Math.abs(messPriorBalance))}</div></div>
        <div class="summary-box"><div class="label">Cash in Hand</div><div class="value ${messCashInHand>=0?'pos':'neg'}">${messCashInHand>=0?'':'-'}${fmtMoney(Math.abs(messCashInHand))}</div></div>
      </div>
      <div class="table-responsive dashboard-desktop-table">
        <table class="dashboard-table">
          <thead>
            <tr>
              <th>Name</th>
              <th class="num">Meals</th>
              <th class="num">Grocery Cost</th>
              <th class="num">Shared Expense</th>
              <th class="num">Total Expense</th>
              <th class="num">Deposits</th>
              <th class="num">Prior Balance</th>
              <th class="num">Dep+Prior</th>
              <th class="num">Remaing Balance</th>
              <th class="num">Personal Rate</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="member-stat-list">${memberStatCardsHtml}</div>
    </div>
    <div class="card">
      <h2>Mess Account Summary <span class="small-note" style="margin:0; display:inline-block; font-weight:700; text-transform:uppercase; letter-spacing:.3px; color:var(--warning);">⚠️ All-Time</span></h2>
      <div class="summary-grid">
        <div class="summary-box"><div class="label">Total Grocery Cost (All-Time)</div><div class="value">${fmtMoney(allTimeTotalGroceryCost())}</div></div>
        <div class="summary-box"><div class="label">Total Shared Expenses (All-Time)</div><div class="value">${fmtMoney(allTimeTotalSharedExpense())}</div></div>
        <div class="summary-box"><div class="label">Total Cost, Grocery + Shared (All-Time)</div><div class="value neg">${fmtMoney(groupExpenses)}</div></div>
        <div class="summary-box"><div class="label">Total Deposit (All-Time)</div><div class="value pos">${fmtMoney(allTimeTotalDepositsGross())}</div></div>
        <div class="summary-box"><div class="label">Total Withdrawal (All-Time)</div><div class="value ${allTimeTotalWithdrawals()>0?'neg':''}">${fmtMoney(allTimeTotalWithdrawals())}</div></div>
        <div class="summary-box"><div class="label">Cash in Hand (All-Time)</div><div class="value ${groupCash>=0?'pos':'neg'}">${fmtMoney(groupCash)}</div></div>
      </div>
    </div>
    ${renderTrendsCard()}
    ${personalReportCard}`;
}

/* ---------------- MARKET SCHEDULE ---------------- */
// Which weekly-schedule row (if any) is currently expanded into its inline
// edit form. Reset to null on every re-render triggered by an actual save,
// so the form closes itself once the change is persisted.
let _msched_editingId = null;

function mschedInitials(name) {
  return ((name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('') || '?').toUpperCase();
}

function renderSchedule() {
  const list = membersWithSchedule();
  const isSuperadmin = session.role === 'superadmin';
  const shiftOrder = { lunch: 0, dinner: 1, both: 0 };
  const todayDuty = list.filter(x => x.info && x.info.isToday)
    .sort((a, b) => (shiftOrder[a.member.marketShift] ?? 2) - (shiftOrder[b.member.marketShift] ?? 2));
  const upcoming = list.filter(x => x.info && !x.info.isToday).sort((a, b) => a.info.daysLeft - b.info.daysLeft);

  /* ---- Header ---- */
  const header = `
    <div class="msched-header">
      <div>
        <div class="msched-title">Market Schedule</div>
        <div class="msched-subtitle">Plan and manage market duties &amp; shopping items</div>
      </div>
      <div class="msched-header-actions">
        ${isSuperadmin ? `<button class="btn msched-assign-btn" onclick="openAssignDutyModal()"><i class="fas fa-plus"></i> Assign Market Duty</button>` : ''}
        <button type="button" class="msched-filter-toggle-btn" title="Toggle filters" onclick="toggleScheduleToolbar()"><i class="fas fa-filter"></i></button>
      </div>
    </div>`;

  /* ---- On market duty today ---- */
  const todayCard = todayDuty.length ? `
    <div class="msched-banner is-today">
      <div class="msched-banner-head"><span class="msched-banner-icon today"><i class="fas fa-cart-shopping"></i></span> On market duty today</div>
      <div class="msched-duty-list">
        ${todayDuty.map(x => {
          const statusHtml = x.info.overdue ? `
            <div class="msched-overdue-box">
              <div class="l1"><i class="fas fa-triangle-exclamation"></i> Overdue by ${formatCountdown(x.info.remDays, x.info.remHours, x.info.remMinutes)}</div>
              <div class="l2">(deadline was ${formatHour12(x.info.deadlineHour)})</div>
            </div>` : `
            <div class="msched-status-wrap">
              <span class="msched-status-pill today"><i class="fas fa-check"></i> Today</span>
              <span class="msched-status-box">${formatCountdown(x.info.remDays, x.info.remHours, x.info.remMinutes)} left (by ${formatHour12(x.info.deadlineHour)})</span>
            </div>`;
          const itemChips = (x.member.marketItems || '').split(',').map(s => s.trim()).filter(Boolean);
          return `<div class="msched-duty-item">
            <div class="msched-duty-item-top">
              <div class="msched-duty-person">
                <div class="member-avatar ${memberAvatarClass(x.member.id)}">${mschedInitials(x.member.name)}</div>
                <div class="msched-duty-textcol">
                  <div class="msched-duty-name">${x.member.name}</div>
                  <div class="msched-duty-meta">${shiftLabel(x.member.marketShift)}${x.member.phone ? ` · <span class="msched-nowrap">${x.member.phone}</span>` : ''}</div>
                </div>
              </div>
              ${statusHtml}
            </div>
            ${itemChips.length ? `<div class="msched-items-row"><span class="msched-items-label"><i class="fas fa-crown"></i> Items:</span>${itemChips.map(it => `<span class="msched-item-chip">${escapeHtml(it)}</span>`).join('')}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
      ${(function() {
        const t = dayMealTotals(todayStr());
        return `<div class="msched-shop-strip">
          <div class="msched-shop-strip-text"><i class="fas fa-basket-shopping"></i> Shop for today's meals — <b>${t.lunch}</b> Lunch, <b>${t.dinner}</b> Dinner (<b>${t.total}</b> total).</div>
          <button class="btn secondary msched-cal-btn" onclick="setTab('meals')">View Details <i class="fas fa-arrow-right"></i></button>
        </div>`;
      })()}
    </div>` : `
    <div class="msched-banner is-empty">
      <div class="msched-banner-head" style="color:var(--ink-soft);"><i class="fas fa-circle-info"></i> No one is scheduled for market duty today</div>
    </div>`;

  /* ---- Next market duty (everyone tied for the nearest upcoming date) ---- */
  const nearestDaysLeft = upcoming.length ? upcoming[0].info.daysLeft : null;
  const nextGroup = upcoming.filter(x => x.info.daysLeft === nearestDaysLeft)
    .sort((a, b) => (shiftOrder[a.member.marketShift] ?? 2) - (shiftOrder[b.member.marketShift] ?? 2));
  const nextCard = nextGroup.length ? `
    <div class="msched-banner is-next">
      <div class="msched-banner-head"><span class="msched-banner-icon next"><i class="fas fa-calendar-day"></i></span> Next Market Duty</div>
      <div class="msched-duty-list">
        ${nextGroup.map(x => `<div class="msched-duty-item">
          <div class="msched-duty-item-top">
            <div class="msched-duty-person">
              <div class="member-avatar ${memberAvatarClass(x.member.id)}">${mschedInitials(x.member.name)}</div>
              <div class="msched-duty-textcol">
                <div class="msched-duty-name">${x.member.name}</div>
                <div class="msched-duty-meta">${WEEKDAYS[x.member.marketDay]} · ${shiftLabel(x.member.marketShift)} · <span class="msched-nowrap">${fmtShortDate(x.info.date)}</span></div>
              </div>
            </div>
          </div>
          ${(() => {
            const nextItemChips = (x.member.marketItems || '').split(',').map(s => s.trim()).filter(Boolean);
            return nextItemChips.length ? `<div class="msched-items-row"><span class="msched-items-label"><i class="fas fa-crown"></i> Items:</span>${nextItemChips.map(it => `<span class="msched-item-chip">${escapeHtml(it)}</span>`).join('')}</div>` : '';
          })()}
          <div class="msched-next-actions">
            <span class="msched-status-box next"><i class="fas fa-hourglass-half"></i> ${formatCountdown(x.info.remDays, x.info.remHours, x.info.remMinutes)} left</span>
            <button type="button" class="btn secondary msched-cal-btn" onclick="addScheduleDutyToCalendar('${x.member.id}')"><i class="fas fa-calendar-plus"></i> Add to calendar</button>
          </div>
        </div>`).join('')}
      </div>
    </div>` : '';

  /* ---- Quick overview (aside) ---- */
  const dayTotals = dayMealTotals(todayStr());
  const overviewCard = `
    <div class="card">
      <div class="msched-card-title">Quick Overview</div>
      <div class="msched-overview-list">
        <div class="msched-overview-row"><div class="msched-overview-left"><span class="msched-overview-icon lunch"><i class="fas fa-utensils"></i></span> Lunch Meals</div><div class="msched-overview-value">${dayTotals.lunch}</div></div>
        <div class="msched-overview-row"><div class="msched-overview-left"><span class="msched-overview-icon dinner"><i class="fas fa-bag-shopping"></i></span> Dinner Meals</div><div class="msched-overview-value">${dayTotals.dinner}</div></div>
        <div class="msched-overview-row"><div class="msched-overview-left"><span class="msched-overview-icon total"><i class="fas fa-bowl-food"></i></span> Total Meals</div><div class="msched-overview-value">${dayTotals.total}</div></div>
        <div class="msched-overview-row"><div class="msched-overview-left"><span class="msched-overview-icon members"><i class="fas fa-users"></i></span> Members on Duty</div><div class="msched-overview-value">${todayDuty.length}</div></div>
      </div>
    </div>`;

  /* ---- Tips (aside, static guidance) ---- */
  const tipsCard = `
    <div class="card msched-tips-card">
      <div class="msched-card-title"><i class="fas fa-lightbulb"></i> Market Duty Tips</div>
      <ul class="msched-tips-list">
        <li><i class="fas fa-circle-check"></i> Check meal count before heading out</li>
        <li><i class="fas fa-circle-check"></i> Shop on time to avoid overdue duty</li>
        <li><i class="fas fa-circle-check"></i> Keep receipts for grocery costs</li>
      </ul>
    </div>`;

  /* ---- Weekly schedule toolbar (search / shift filter / export) ---- */
  const toolbar = `
    <div class="msched-toolbar" id="msched-toolbar-row">
      <input type="text" class="search-input" id="msched-search-input" placeholder="Search member…" oninput="applyScheduleFilters()">
      <select id="msched-shift-filter" onchange="applyScheduleFilters()">
        <option value="all">All Shifts</option>
        <option value="lunch">Lunch</option>
        <option value="dinner">Dinner</option>
        <option value="both">Both</option>
      </select>
      <button type="button" class="btn secondary msched-icon-btn" title="Download schedule as CSV" onclick="downloadScheduleCSV()"><i class="fas fa-download"></i></button>
    </div>`;

  /* ---- Weekly schedule rows: desktop table + mobile cards, same data ---- */
  const rows = list.map(x => scheduleRowHtml(x, isSuperadmin)).join('');
  const mobileCards = list.map(x => scheduleCardHtml(x, isSuperadmin)).join('');

  /* ---- Bottom duty-statistics strip ---- */
  const weekStats = computeScheduleWeekStats(list);
  const statStrip = `
    <div class="msched-stat-strip">
      <div class="msched-stat-strip-item"><div class="msched-stat-strip-icon"><i class="fas fa-bowl-food"></i></div><div><div class="msched-stat-strip-value">${dayTotals.total}</div><div class="msched-stat-strip-label">Today's Meals · ${dayTotals.lunch}L / ${dayTotals.dinner}D</div></div></div>
      <div class="msched-stat-strip-item"><div class="msched-stat-strip-icon"><i class="fas fa-calendar-week"></i></div><div><div class="msched-stat-strip-value">${weekStats.thisWeekDuties}</div><div class="msched-stat-strip-label">This Week Duties</div></div></div>
      <div class="msched-stat-strip-item"><div class="msched-stat-strip-icon warn"><i class="fas fa-hourglass-half"></i></div><div><div class="msched-stat-strip-value">${weekStats.upcoming24h}</div><div class="msched-stat-strip-label">Upcoming in 24h</div></div></div>
      <div class="msched-stat-strip-item"><div class="msched-stat-strip-icon success"><i class="fas fa-circle-check"></i></div><div><div class="msched-stat-strip-value">${weekStats.completedThisWeek}</div><div class="msched-stat-strip-label">Completed This Week</div></div></div>
    </div>`;

  return `
    ${header}
    <div class="msched-grid">
      <div class="msched-slot-today">${todayCard}</div>
      <div class="msched-slot-overview">${overviewCard}</div>
      <div class="msched-slot-next">${nextCard}</div>
      <div class="msched-slot-tips">${tipsCard}</div>
      <div class="msched-full card">
        <h2>Weekly Market Schedule</h2>
        ${toolbar}
        <div class="table-responsive msched-table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Market Day</th><th>Shift</th><th>Next Turn</th><th>Items to Buy</th>${isSuperadmin?'<th>Action</th>':''}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="msched-list">${mobileCards}</div>
        ${statStrip}
      </div>
    </div>
    <div class="msched-footnote"><i class="fas fa-circle-info"></i> Items help the market person know what to buy — keep the list updated so nothing is missed.${isSuperadmin ? ' Tap the pencil icon on any row to update their day, shift, or shopping list.' : ''}</div>`;
}

/* Shared day/shift/status/items markup for one member — desktop <tr>. */
function scheduleRowHtml(x, isSuperadmin) {
  const m = x.member,
    info = x.info;
  const searchKey = escapeHtml(`${m.name} ${m.phone || ''}`.toLowerCase());
  const colspan = isSuperadmin ? 7 : 6;
  if (_msched_editingId === m.id) {
    return `<tr class="msched-filterable" data-search="${searchKey}" data-shift="${m.marketShift || ''}">
      <td colspan="${colspan}">${scheduleEditFormHtml(m)}</td>
    </tr>`;
  }
  let statusBadge;
  if (!info) {
    statusBadge = `<span class="small-note" style="margin:0;">Not set</span>`;
  } else if (info.isToday) {
    statusBadge = info.overdue ?
      `<span class="msched-status-badge overdue"><i class="fas fa-triangle-exclamation"></i> ${formatCountdown(info.remDays, info.remHours, info.remMinutes)} overdue</span>` :
      `<span class="msched-status-badge ok"><i class="fas fa-check"></i> ${formatCountdown(info.remDays, info.remHours, info.remMinutes)} left</span>`;
  } else {
    statusBadge = `<span class="msched-status-badge upcoming"><i class="fas fa-hourglass-half"></i> ${formatCountdown(info.remDays, info.remHours, info.remMinutes)} left</span> <span class="small-note" style="margin:0;">— ${fmtShortDate(info.date)}</span>`;
  }
  return `<tr class="msched-filterable" data-search="${searchKey}" data-shift="${m.marketShift || ''}">
    <td><div class="msched-table-name"><div class="member-avatar ${memberAvatarClass(m.id)}">${mschedInitials(m.name)}</div><span class="name-txt">${m.name}</span></div></td>
    <td>${m.phone || '—'}</td>
    <td>${hasMarketDay(m) ? WEEKDAYS[m.marketDay] : '—'}</td>
    <td>${m.marketShift ? `<span class="badge" style="background:var(--primary-bg); color:var(--primary);">${shiftLabel(m.marketShift)}</span>` : '—'}</td>
    <td>${statusBadge}${hasMarketDay(m) && m.marketShift ? ` <button type="button" class="msched-action-btn" title="Add this month's duty to calendar (2h reminder)" onclick="addMemberMonthlyDutyToCalendar('${m.id}')"><i class="fas fa-calendar-plus"></i></button>` : ''}</td>
    <td>${m.marketItems ? `<span class="msched-duty-items" style="display:inline-flex;"><i class="fas fa-basket-shopping"></i> ${escapeHtml(m.marketItems)}</span>` : '<span class="small-note" style="margin:0;">—</span>'}</td>
    ${isSuperadmin ? `<td><div class="msched-card-actions">
        <button type="button" class="msched-action-btn" title="Edit" onclick="toggleScheduleEdit('${m.id}')"><i class="fas fa-pen"></i></button>
        <button type="button" class="msched-action-btn danger" title="Remove from schedule" onclick="clearScheduleDuty('${m.id}')"><i class="fas fa-trash"></i></button>
      </div></td>` : ''}
  </tr>`;
}

/* Same member, mobile card markup (<900px). */
function scheduleCardHtml(x, isSuperadmin) {
  const m = x.member,
    info = x.info;
  const searchKey = escapeHtml(`${m.name} ${m.phone || ''}`.toLowerCase());
  if (_msched_editingId === m.id) {
    return `<div class="msched-card msched-filterable" data-search="${searchKey}" data-shift="${m.marketShift || ''}">${scheduleEditFormHtml(m)}</div>`;
  }
  let nextTurnHtml;
  if (!info) {
    nextTurnHtml = `<span>Not set</span>`;
  } else if (info.isToday) {
    nextTurnHtml = info.overdue ?
      `<span style="color:var(--danger); font-weight:700;"><i class="fas fa-triangle-exclamation"></i> Overdue by ${formatCountdown(info.remDays, info.remHours, info.remMinutes)}</span>` :
      `<span style="color:var(--success); font-weight:700;"><i class="fas fa-check"></i> Today · ${formatCountdown(info.remDays, info.remHours, info.remMinutes)} left</span>`;
  } else {
    nextTurnHtml = `<span>${fmtShortDate(info.date)} · ${formatCountdown(info.remDays, info.remHours, info.remMinutes)} left</span>`;
  }
  return `<div class="msched-card msched-filterable" data-search="${searchKey}" data-shift="${m.marketShift || ''}">
    <div class="msched-card-top">
      <div class="msched-card-person">
        <div class="member-avatar ${memberAvatarClass(m.id)}">${mschedInitials(m.name)}</div>
        <div style="min-width:0;">
          <div class="msched-card-name">${m.name}</div>
          <div class="msched-card-phone">${m.phone || '—'}</div>
        </div>
      </div>
      ${isSuperadmin ? `<div class="msched-card-actions">
          <button type="button" class="msched-action-btn" title="Edit" onclick="toggleScheduleEdit('${m.id}')"><i class="fas fa-pen"></i></button>
          <button type="button" class="msched-action-btn danger" title="Remove" onclick="clearScheduleDuty('${m.id}')"><i class="fas fa-trash"></i></button>
        </div>` : ''}
    </div>
    <div class="msched-card-meta">
      <span><i class="fas fa-calendar-day"></i> ${hasMarketDay(m) ? WEEKDAYS[m.marketDay] : '—'}</span>
      <span><i class="fas fa-clock"></i> ${shiftLabel(m.marketShift)}</span>
    </div>
    <div class="msched-card-next">${nextTurnHtml}</div>
    ${hasMarketDay(m) && m.marketShift ? `<button type="button" class="btn secondary msched-cal-btn" style="margin-top:8px;" onclick="addMemberMonthlyDutyToCalendar('${m.id}')"><i class="fas fa-calendar-plus"></i> Add this month to calendar</button>` : ''}
    ${m.marketItems ? `<div class="msched-card-items"><b>Items to buy</b>${escapeHtml(m.marketItems)}</div>` : ''}
  </div>`;
}

/* Inline day/shift/items edit form shared by the desktop row and mobile card. */
function scheduleEditFormHtml(m) {
  return `<div class="msched-inline-edit">
    <div class="msched-inline-edit-row">
      <select id="se-day-${m.id}">
        <option value="">— Day —</option>
        ${WEEKDAYS.map((d, i) => `<option value="${i}" ${Number(m.marketDay)===i?'selected':''}>${d}</option>`).join('')}
      </select>
      <select id="se-shift-${m.id}">
        <option value="" ${!m.marketShift?'selected':''}>— Shift —</option>
        <option value="lunch" ${m.marketShift==='lunch'?'selected':''}>Lunch</option>
        <option value="dinner" ${m.marketShift==='dinner'?'selected':''}>Dinner</option>
        <option value="both" ${m.marketShift==='both'?'selected':''}>Both</option>
      </select>
    </div>
    <textarea id="se-items-${m.id}" class="msched-items-textarea" style="width:100%;" rows="2" placeholder="Items to buy — e.g. fish, potato, onion">${m.marketItems || ''}</textarea>
    <div style="display:flex; gap:6px;">
      <button type="button" class="btn msched-items-save" style="flex:1;" onclick="saveScheduleEdit('${m.id}')"><i class="fas fa-check"></i> Save</button>
      <button type="button" class="btn secondary msched-items-save" style="flex:1;" onclick="toggleScheduleEdit('${m.id}')">Cancel</button>
    </div>
  </div>`;
}

function toggleScheduleToolbar() {
  const row = document.getElementById('msched-toolbar-row');
  const btn = document.querySelector('.msched-filter-toggle-btn');
  if (!row) return;
  const nowHidden = row.classList.toggle('is-collapsed');
  if (btn) btn.classList.toggle('is-active', !nowHidden);
}

// Client-side search + shift filter — toggles visibility only, so the
// search box never loses focus on keystroke the way a full re-render would.
function applyScheduleFilters() {
  const searchEl = document.getElementById('msched-search-input');
  const filterEl = document.getElementById('msched-shift-filter');
  const q = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const shift = filterEl ? filterEl.value : 'all';
  document.querySelectorAll('.msched-filterable').forEach(el => {
    const matchesSearch = !q || (el.dataset.search || '').includes(q);
    const matchesShift = shift === 'all' || el.dataset.shift === shift;
    el.style.display = (matchesSearch && matchesShift) ? '' : 'none';
  });
}

function toggleScheduleEdit(id) {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can edit the market schedule.', 'error');
    return;
  }
  _msched_editingId = (_msched_editingId === id) ? null : id;
  renderTabContent();
}

async function saveScheduleEdit(id) {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can edit the market schedule.', 'error');
    renderTabContent();
    return;
  }
  const m = memberById(id);
  if (!m) return;
  const dayEl = document.getElementById('se-day-' + id);
  const shiftEl = document.getElementById('se-shift-' + id);
  const itemsEl = document.getElementById('se-items-' + id);
  const dayRaw = dayEl.value;
  m.marketDay = dayRaw === '' ? null : Number(dayRaw);
  m.marketShift = shiftEl.value;
  m.marketItems = itemsEl.value.trim();
  await persistMembers();
  _msched_editingId = null;
  renderTabContent();
  showToast(`Market schedule updated for ${m.name}.`, 'success');
}

async function clearScheduleDuty(id) {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can edit the market schedule.', 'error');
    return;
  }
  const m = memberById(id);
  if (!m) return;
  if (!confirm(`Remove ${m.name} from the market duty schedule? This won't remove them as a member.`)) return;
  m.marketDay = null;
  m.marketShift = '';
  m.marketItems = '';
  await persistMembers();
  if (_msched_editingId === id) _msched_editingId = null;
  renderTabContent();
  showToast(`${m.name} removed from the market duty schedule.`, 'success');
}

/* ---- Assign Market Duty modal (superadmin only) — sets marketDay/
   marketShift/marketItems on the existing member record in one save,
   same fields the Members tab already edits, just from a quicker dialog. */
function openAssignDutyModal() {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can assign market duty.', 'error');
    return;
  }
  let overlay = document.getElementById('msched-assign-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'msched-assign-overlay';
    overlay.className = 'msched-modal-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="msched-modal" role="dialog" aria-modal="true" aria-labelledby="ad-title">
      <h2 id="ad-title"><i class="fas fa-cart-shopping"></i> Assign Market Duty</h2>
      <label for="ad-member">Member</label>
      <select id="ad-member" onchange="prefillAssignDutyForm()">
        ${state.members.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
      </select>
      <label for="ad-day">Market Day</label>
      <select id="ad-day">
        <option value="">— Select day —</option>
        ${WEEKDAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('')}
      </select>
      <label for="ad-shift">Shift</label>
      <select id="ad-shift">
        <option value="">— Select shift —</option>
        <option value="lunch">Lunch</option>
        <option value="dinner">Dinner</option>
        <option value="both">Both</option>
      </select>
      <label for="ad-items">Shopping Items (optional)</label>
      <textarea id="ad-items" rows="2" placeholder="e.g. fish, potato, onion"></textarea>
      <div class="msched-modal-actions">
        <button type="button" class="btn secondary" onclick="closeAssignDutyModal()">Cancel</button>
        <button type="button" class="btn" onclick="submitAssignDuty()"><i class="fas fa-check"></i> Save</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
  prefillAssignDutyForm();
}

function prefillAssignDutyForm() {
  const id = document.getElementById('ad-member').value;
  const m = memberById(id);
  if (!m) return;
  document.getElementById('ad-day').value = hasMarketDay(m) ? String(m.marketDay) : '';
  document.getElementById('ad-shift').value = m.marketShift || '';
  document.getElementById('ad-items').value = m.marketItems || '';
}

function closeAssignDutyModal() {
  const overlay = document.getElementById('msched-assign-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  }
}

async function submitAssignDuty() {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can assign market duty.', 'error');
    return;
  }
  const id = document.getElementById('ad-member').value;
  const dayRaw = document.getElementById('ad-day').value;
  const shift = document.getElementById('ad-shift').value;
  const items = document.getElementById('ad-items').value.trim();
  const m = memberById(id);
  if (!m) return;
  if (dayRaw === '' || !shift) {
    showToast('Pick a market day and shift.', 'error');
    return;
  }
  m.marketDay = Number(dayRaw);
  m.marketShift = shift;
  m.marketItems = items;
  await persistMembers();
  closeAssignDutyModal();
  renderTabContent();
  showToast(`Market duty assigned to ${m.name}.`, 'success');
}

/* ---- Duty statistics for the bottom strip ----
   thisWeekDuties: total lunch/dinner duty-slots across the week (a "both"
   shift counts as 2, matching how mealTypesForShift already treats it).
   upcoming24h: assigned duties (today or the next occurrence) whose
   shopping deadline falls within the next 24 hours and isn't overdue yet.
   completedThisWeek: how many of this week's duty-slots already have a
   confirmed marketCompletions entry for their date. */
function computeScheduleWeekStats(list) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(now.getDate() - now.getDay());
  let thisWeekDuties = 0,
    completedThisWeek = 0,
    upcoming24h = 0;
  list.forEach(x => {
    const m = x.member;
    if (!hasMarketDay(m)) return;
    const mealTypes = mealTypesForShift(m.marketShift);
    thisWeekDuties += mealTypes.length;
    const occDate = new Date(weekStart);
    occDate.setDate(weekStart.getDate() + Number(m.marketDay));
    const dateStr = `${occDate.getFullYear()}-${String(occDate.getMonth()+1).padStart(2,'0')}-${String(occDate.getDate()).padStart(2,'0')}`;
    mealTypes.forEach(mt => {
      const c = getMarketCompletion(m, dateStr, mt);
      if (c && c.status === 'completed') completedThisWeek++;
    });
    if (x.info && !x.info.overdue) {
      const msLeft = x.info.deadline - now;
      if (msLeft >= 0 && msLeft <= 24 * 3600 * 1000) upcoming24h++;
    }
  });
  return {
    thisWeekDuties,
    completedThisWeek,
    upcoming24h
  };
}

// Opens a prefilled Google Calendar "quick add" link for a member's next
// upcoming market duty — reuses the same nextMarketInfo()/shiftLabel() data
// already computed for the Next Market Duty card, no new state or writes.
function addScheduleDutyToCalendar(memberId) {
  const m = memberById(memberId);
  if (!m) return;
  const info = nextMarketInfo(m);
  if (!info) {
    showToast('No market day set for this member yet.', 'error');
    return;
  }
  const start = new Date(info.date);
  start.setHours(info.deadlineHour, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60000);
  const fmt = (dt) => `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}T${String(dt.getHours()).padStart(2,'0')}${String(dt.getMinutes()).padStart(2,'0')}00`;
  const title = encodeURIComponent(`Market Duty — ${m.name} (${shiftLabel(m.marketShift)})`);
  const details = encodeURIComponent(`Market shopping duty for ${shiftLabel(m.marketShift)}, deadline ${formatHour12(info.deadlineHour)}.${m.marketItems ? ' Items: ' + m.marketItems : ''}`);
  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${fmt(start)}/${fmt(end)}&details=${details}`;
  window.open(url, '_blank', 'noopener');
}

// Escapes text for safe use inside .ics SUMMARY/DESCRIPTION fields per the
// iCalendar spec — commas, semicolons, backslashes, and newlines all need
// a backslash prefix (newlines become the literal two-char sequence \n).
function icsEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Downloads a .ics file covering EVERY occurrence of a member's market duty
// in the CURRENT calendar month (from today onward, so already-passed dates
// this month are skipped) — one weekly-recurring VEVENT with an UNTIL at
// month-end, plus a VALARM that fires 2 hours before each occurrence.
// Works with any calendar app (Google/Apple/Outlook) via import, since
// Google's own "quick add" URL scheme has no way to attach a reminder.
function addMemberMonthlyDutyToCalendar(memberId) {
  const m = memberById(memberId);
  if (!m) return;
  if (!hasMarketDay(m) || !m.marketShift) {
    showToast('No market day set for this member yet.', 'error');
    return;
  }
  const now = new Date();
  const targetDay = Number(m.marketDay);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  monthEnd.setHours(23, 59, 59, 0);

  // First occurrence on/after today (so past duty days this month aren't included).
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = (targetDay - first.getDay() + 7) % 7;
  first.setDate(first.getDate() + diff);

  if (first > monthEnd) {
    showToast(`${m.name} has no more market duty this month.`, 'error');
    return;
  }

  const deadlineHour = marketDeadlineHourFor(m.marketShift);
  const dtStart = new Date(first);
  dtStart.setHours(deadlineHour, 0, 0, 0);
  const dtEnd = new Date(dtStart.getTime() + 30 * 60000);

  const fmtICS = (d) => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
  const untilStr = `${monthEnd.getFullYear()}${String(monthEnd.getMonth()+1).padStart(2,'0')}${String(monthEnd.getDate()).padStart(2,'0')}T235959`;
  const stampNow = new Date();

  const title = icsEscape(`Market Duty — ${m.name} (${shiftLabel(m.marketShift)})`);
  const desc = icsEscape(`Market shopping duty for ${shiftLabel(m.marketShift)}, deadline ${formatHour12(deadlineHour)}.${m.marketItems ? ' Items: ' + m.marketItems.replace(/\r?\n/g, ', ') : ''}`);

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Market Schedule//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:market-duty-${m.id}-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}@marketschedule`,
    `DTSTAMP:${fmtICS(stampNow)}Z`,
    `DTSTART:${fmtICS(dtStart)}`,
    `DTEND:${fmtICS(dtEnd)}`,
    `RRULE:FREQ=WEEKLY;UNTIL=${untilStr}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${desc}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Market duty reminder',
    'TRIGGER:-PT2H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `market-duty-${m.name.replace(/\s+/g, '-').toLowerCase()}-${MONTHS_SHORT[now.getMonth()].toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`This month's market duty for ${m.name} downloaded — open the file to add it to your calendar with a 2h reminder.`, 'success');
}

function downloadScheduleCSV() {
  const list = membersWithSchedule();
  const header = ['Name', 'Phone', 'Market Day', 'Shift', 'Next Turn', 'Items to Buy'];
  const rows = list.map(x => {
    const m = x.member,
      info = x.info;
    const day = hasMarketDay(m) ? WEEKDAYS[m.marketDay] : '';
    let next = '';
    if (info) {
      next = info.isToday ?
        (info.overdue ? `Overdue (deadline was ${formatHour12(info.deadlineHour)})` : `Today, by ${formatHour12(info.deadlineHour)}`) :
        `${fmtShortDate(info.date)}`;
    }
    return [m.name, m.phone || '', day, shiftLabel(m.marketShift), next, (m.marketItems || '').replace(/\r?\n/g, ' ')];
  });
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], {
    type: 'text/csv;charset=utf-8;'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `market-schedule-${todayStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------- TIMESTAMPS & VISIBILITY ---------------- */
/* ===== 10-meals.js ===== */
// ---------------------------------------------------------------------------
// 10-meals.js  (originally app.js lines 3417-4226)
// Meal date helpers, meal lock/editability, renderMeals + edit/history sub-views, meal qty change/reset handlers
// ---------------------------------------------------------------------------
function nowTimestamp() {
  return Date.now();
}

function formatBDDateTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('en-US', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }) + ' (BD time)';
  } catch (e) {
    return '';
  }
}
// Date-only version (no time) — used in compact table rows where the full
// recorded timestamp would just be secondary clutter; the full one is still
// available in the record's View Details modal.
function formatBDDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('en-US', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (e) {
    return '';
  }
}

function shouldShowRecordedAt() {
  const setting = (state.settings && state.settings.recordedAtVisibility) || 'superadmin';
  const role = session.role;
  if (setting === 'superadmin') return role === 'superadmin';
  if (setting === 'admin') return role === 'admin' || role === 'superadmin';
  if (setting === 'all') return true;
  return false;
}

function shouldShowAddedBy() {
  const setting = (state.settings && state.settings.addedByVisibility) || 'superadmin';
  const role = session.role;
  if (setting === 'superadmin') return role === 'superadmin';
  if (setting === 'admin') return role === 'admin' || role === 'superadmin';
  if (setting === 'all') return true;
  return false;
}

function canViewAllMealsHistory() {
  const setting = (state.settings && state.settings.mealsHistoryVisibility) || 'superadmin';
  const role = session.role;
  if (setting === 'superadmin') return role === 'superadmin';
  if (setting === 'admin') return role === 'admin' || role === 'superadmin';
  if (setting === 'all') return true;
  return false;
}

// NEW: Date range restriction for meal editing
function getEditableDateRange() {
  const role = session.role;
  if (role === 'superadmin' || role === 'admin') {
    return {
      min: '',
      max: ''
    }; // no restriction
  }
  // Member: only tomorrow (Bangladesh calendar date, not the device's own timezone)
  const tStr = bdTomorrowStr();
  return {
    min: tStr,
    max: tStr
  };
}

/* ---------------- BANGLADESH TIME HELPERS (timezone-safe, ignores device clock's own zone) ---------------- */
// BD is UTC+6 year-round (no daylight saving), so these are computed directly rather than
// trusting the browser/device's local timezone setting, which may not actually be BD time.
function getBDNowParts() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => Number(parts.find(p => p.type === t).value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second')
  };
}

function bdTodayDateStr() {
  const p = getBDNowParts();
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}

function bdTomorrowStr() {
  const p = getBDNowParts();
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
// Formats an absolute instant as a YYYY-MM-DD calendar date IN Bangladesh time (safe near midnight,
// unlike toISOString() which would show the UTC calendar date instead).
function bdDateStrFromInstant(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

// Super admin is always unlimited. Admin is unlimited unless maxMealQtyScope is 'member_admin'.
// Members are always capped at state.settings.maxMealQty.
function effectiveMaxMealQty(role) {
  if (role === 'superadmin') return Infinity;
  if (role === 'admin') return (state.settings.maxMealQtyScope === 'member_admin') ? state.settings.maxMealQty : Infinity;
  return state.settings.maxMealQty;
}

/* ---------------- MEAL ACTION BUTTON FEEDBACK (visual only — no logic changes) ----------------
   The four meal action controls (+ Add, +1 Both, Reset, quantity Update) still perform
   their Firestore writes exactly as before; this layer only decorates them with a
   temporary success/error visual state once the write settles. Because changeMeal/
   changeBothMeals/setMealQty/resetMealsForMember call renderTabContent() optimistically
   *before* the write finishes, the clicked element is already gone from the DOM by the
   time the write resolves — so elements are looked up again by data-maa attribute
   (there can be a mobile + desktop copy of the same control; both are updated, since
   only one is ever visible at a time via CSS) rather than holding a stale node
   reference. */
function mealActionSelector(action, memberId, type) {
  return `[data-maa="${action}"][data-maa-member="${memberId}"]${type ? `[data-maa-type="${type}"]` : ''}`;
}

// Small, non-blocking, icon-only feedback for meal add/remove/update taps
// — replaces the old full-screen dimmed/blurred backdrop popup (~2.2s per
// tap), which visually "blocked" the screen for every single +/- tap. Meal
// actions happen dozens of times a day per member; a screen-dimming modal
// for each one felt slow and intrusive, especially when tapping several
// times in a row. This is just a small colored circle with a checkmark/
// warning icon, no text, no backdrop — confirms the tap landed without
// getting in the way of the next one. Styled here (JS-only) rather than in
// css/style.css.
const MEAL_ACTION_FEEDBACK_HOLD_MS = 550;
let _mealActionBadgeHideTimer = null;

function ensureMealActionFeedbackStyles() {
  if (document.getElementById('meal-action-feedback-styles')) return;
  const style = document.createElement('style');
  style.id = 'meal-action-feedback-styles';
  style.textContent = `
    #meal-action-badge{
      position:fixed; left:50%; top:70px; z-index:9999;
      width:44px; height:44px; border-radius:50%;
      display:flex; align-items:center; justify-content:center;
      color:#fff; font-size:18px; pointer-events:none;
      opacity:0; transform:translate(-50%, -8px) scale(.85);
      box-shadow:0 10px 24px -8px rgba(0,0,0,.35);
      transition:opacity .16s ease, transform .16s ease;
    }
    #meal-action-badge.show{ opacity:1; transform:translate(-50%, 0) scale(1); }
    #meal-action-badge.success{ background:var(--success,#2E8B57); }
    #meal-action-badge.error{ background:var(--danger,#C0392B); }
    @media (prefers-reduced-motion: reduce){
      #meal-action-badge{ transition:opacity .1s linear; transform:translate(-50%, 0) scale(1); }
    }
  `;
  document.head.appendChild(style);
}

function showMealActionPopup(ok) {
  ensureMealActionFeedbackStyles();
  let el = document.getElementById('meal-action-badge');
  if (!el) {
    el = document.createElement('div');
    el.id = 'meal-action-badge';
    document.body.appendChild(el);
  }
  clearTimeout(_mealActionBadgeHideTimer);
  el.classList.remove('show', 'success', 'error');
  void el.offsetWidth; // restart the animation cleanly on rapid repeat taps
  el.classList.add(ok ? 'success' : 'error');
  el.innerHTML = ok ? '<i class="fas fa-check"></i>' : '<i class="fas fa-exclamation"></i>';
  requestAnimationFrame(() => el.classList.add('show'));
  _mealActionBadgeHideTimer = setTimeout(() => {
    el.classList.remove('show');
  }, MEAL_ACTION_FEEDBACK_HOLD_MS);
}

function flashMealAction(selector, ok, successText) {
  showMealActionPopup(ok);
  // Extra: a brief glow on the qty input itself for the Update action.
  const el = document.querySelector(selector);
  if (el && el.classList.contains('qty-input')) {
    el.classList.remove('maa-glow-success', 'maa-glow-error');
    el.classList.add(ok ? 'maa-glow-success' : 'maa-glow-error');
    setTimeout(() => el.classList.remove('maa-glow-success', 'maa-glow-error'), MEAL_ACTION_FEEDBACK_HOLD_MS);
  }
}

// Wraps an existing persistDay(...) call with success/error visual feedback for the
// button that triggered it, without changing what persistDay itself does or its
// existing toast-on-failure behavior. If persistDay doesn't return a Promise, this
// quietly no-ops and nothing about the write path changes.
function withMealActionFeedback(persistResult, selector, successText) {
  if (persistResult && typeof persistResult.then === 'function') {
    persistResult.then(
      () => flashMealAction(selector, true, successText),
      () => flashMealAction(selector, false, successText)
    );
  }
  return persistResult;
}

/* ---------------- MEALS ---------------- */
function todayStr() {
  return bdTodayDateStr();
} // Bangladesh calendar date, not UTC — see BANGLADESH TIME HELPERS above
function tomorrowStr() {
  return bdTomorrowStr();
}
let mealSelectedDate = bdTomorrowStr();
let mealsViewMode = 'edit';
let mealsHistorySearch = '';
let mealsHistorySort = {
  key: 'date',
  dir: 'desc'
};
let mealsHistoryViewMode = 'month';
// Persists the mobile "Load More — Show All Members" expand/collapse state for the
// Meals tab's member list across re-renders (e.g. after Add Meal/Both/Rest/Edit/Update),
// so a meal action doesn't silently re-collapse a list the admin already expanded.
// Only reset back to false when the user explicitly collapses it (or leaves the tab —
// see setActiveTab below), never as a side effect of a meal edit.
let mealsRowsExpanded = false;

function renderMeals() {
  const toggle = `
    <div class="meals-header-row card-header-row">
      <div class="meals-header-title">
        <div class="meals-header-icon"><i class="fas fa-utensils"></i></div>
        <div>
          <h2>Meals</h2>
          <div class="small-note">Set or update meals for a specific date</div>
        </div>
      </div>
      <div class="meals-header-actions">
        <button class="btn ${mealsViewMode==='edit'?'':'secondary'}" onclick="setMealsView('edit')"><i class="fas fa-calendar-day"></i> Edit by Date</button>
        <button class="btn ${mealsViewMode==='history'?'':'secondary'}" onclick="setMealsView('history')"><i class="fas fa-clock-rotate-left"></i> All Meals History</button>
      </div>
    </div>`;
  if (mealsViewMode === 'history') return renderMealsHistory(toggle);
  return renderMealsEdit(toggle);
}

// Deterministic per-member avatar tint (same member always gets the same
// color across re-renders and across every tab that shows an avatar).
// NOTE: this used to hash the member's *name* and take %5, but for real
// rosters that hash collides often (several names landing on the same
// bucket), so most avatars ended up the same color instead of visually
// distinct like intended. Using the member's stable position in
// state.members instead guarantees neighboring members always get
// different colors (only wrapping back to the same shade every 5th
// member), and still stays deterministic since member order doesn't
// change on its own.
function memberAvatarClass(memberId) {
  const idx = state.members.findIndex(x => x.id === memberId);
  return 'av-' + ((idx >= 0 ? idx : 0) % 5);
}

function mealLockTime(dateStr) {
  // dateStr is the meal's date (a Bangladesh calendar date). The cutoff is at
  // state.settings.mealLockHour:mealLockMinute, Bangladesh time, on the day before dateStr.
  const [y, m, d] = dateStr.split('-').map(Number);
  const lockInstant = new Date(Date.UTC(y, m - 1, d));
  lockInstant.setUTCDate(lockInstant.getUTCDate() - 1);
  // BD is always UTC+6 (no daylight saving), so BD "mealLockHour:mealLockMinute" = UTC "(mealLockHour-6):mealLockMinute"
  lockInstant.setUTCHours(state.settings.mealLockHour - 6, state.settings.mealLockMinute || 0, 0, 0);
  return lockInstant;
}

function isMealLocked(dateStr) {
  if (state.settings.mealLockEnabled === false) return false;
  return new Date() > mealLockTime(dateStr);
}

function canEditMealForDate(memberId, dateStr) {
  const canAll = session.role === 'admin' || session.role === 'superadmin';
  if (canAll) return true;
  if (memberId !== session.userId) return false;
  return !isMealLocked(dateStr);
}

function formatRemaining(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  const parts = [];
  if (days) parts.push(days + 'd');
  if (hours) parts.push(hours + 'h');
  if (mins || parts.length === 0) parts.push(mins + 'm');
  return parts.join(' ');
}
// Mobile-vs-desktop check for the Meals "your row first, Load More for
// everyone else" layout — same 768px breakpoint convention as the rest of
// this app's mobile-only controls (e.g. the .mrg-mobile-only meal buttons).
// Desktop (>768px) always renders every member's row exactly as before.
function isMobileMealsView() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function toggleMealRowExtra() {
  const box = document.getElementById('meal-row-extra');
  const btn = document.getElementById('meal-row-loadmore-btn');
  if (!box) return;
  const expanded = box.classList.toggle('expanded');
  mealsRowsExpanded = expanded; // remember explicit user choice across re-renders
  if (btn) btn.textContent = expanded ? '▲ Show Less' : '▼ Load More — Show All Members';
}
// If the viewport crosses the mobile/desktop boundary (e.g. device rotation,
// resizing a browser window) while the Meals tab is open, re-render so the
// row layout switches immediately instead of waiting for the next tab click.
let _mealsViewWasMobile = null;
let _mealsResizeDebounce = null;
window.addEventListener('resize', () => {
  if (activeTab !== 'meals') return;
  clearTimeout(_mealsResizeDebounce);
  _mealsResizeDebounce = setTimeout(() => {
    const nowMobile = isMobileMealsView();
    if (_mealsViewWasMobile === null) {
      _mealsViewWasMobile = nowMobile;
      return;
    }
    if (nowMobile !== _mealsViewWasMobile) {
      _mealsViewWasMobile = nowMobile;
      renderTabContent();
    }
  }, 200);
});

// Finds whoever's on market duty for a given date + meal (lunch/dinner),
// using the exact same matching rule as defaultPurchaserIdForDate() in
// 13-costs.js — weekday from member.marketDay, and marketShift 'both' or
// the specific meal — just returning the member object here instead of an
// id, and with no "any duty that day" fallback (that fallback exists there
// only for the shiftless "Other/Grocery" cost type, which doesn't apply to
// a Lunch/Dinner menu card).
// Memoized via the same _calcCache used by 08-calculations.js (see memo()
// there) — a single Dashboard render calls this twice (banner subtitle,
// lunch+dinner) and a single Meals-tab render calls it FOUR times (menu
// card + grid-header subtitle, each for lunch and dinner), all with the
// exact same (dateStr, mealType) pairs re-scanning the same member list.
// memo() caches the result the first time and reuses it for the rest of
// that render pass; it's already cleared on every persist*() write
// (_markEdited), so a duty change (e.g. market day edited) is never
// served stale.
function dutyMemberForDateMeal(dateStr, mealType) {
  if (!dateStr) return null;
  return memo('dutyMemberForDateMeal_' + dateStr + '_' + mealType, () => {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return null;
    const weekday = d.getDay(); // 0=Sunday, matching WEEKDAYS/member.marketDay
    return (state.members || []).find(m => hasMarketDay(m) && Number(m.marketDay) === weekday && (m.marketShift === 'both' || m.marketShift === mealType)) || null;
  });
}

// Renders the Lunch/Dinner Menu card for the selected date, sourced entirely
// from the existing Market Schedule data (whoever's on duty that day/shift,
// and their marketItems shopping-list string) — no new data is stored here,
// this is purely a read-only view into 09-dashboard.js's schedule feature.
// Editing still happens on the Market Schedule tab (superadmin only, same
// as today) — "+ Add Item" just jumps there.
// Small "what's cooking" subtitle under the Lunch/Dinner column headers
// in the per-member counting grid — reuses the exact same duty/items data
// as renderMealMenuCard() above it (no separate data source), just shown
// again down here so it stays visible while scrolling the member list
// instead of having to scroll back up to the menu cards to check it.
function mealGridColItemsHtml(dateStr, mealType) {
  const duty = dutyMemberForDateMeal(dateStr, mealType);
  const itemsStr = (duty && duty.marketItems) ? duty.marketItems.trim() : '';
  if (!itemsStr) return '';
  const items = itemsStr.split(',').map(s => s.trim()).filter(Boolean);
  return `<div class="meal-grid-col-items" title="${escapeHtml(itemsStr)}">${escapeHtml(items.join(', '))}</div>`;
}

function renderMealMenuCard(mealType, dateStr) {
  const label = mealType === 'lunch' ? 'Lunch Menu' : 'Dinner Menu';
  const icon = mealType === 'lunch' ? 'fa-sun' : 'fa-moon';
  const iconClass = mealType === 'lunch' ? 'icon-lunch' : 'icon-dinner';
  const duty = dutyMemberForDateMeal(dateStr, mealType);
  const itemsStr = (duty && duty.marketItems) ? duty.marketItems.trim() : '';
  const items = itemsStr ? itemsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
  const canEdit = session.role === 'superadmin';
  const chips = items.map((it, i) => `<div class="menu-item-chip"><span class="menu-item-dot dot-${i%5}"></span>${it}</div>`).join('');
  const emptyMsg = !duty ?
    `No one is on ${mealType} duty for this date.` :
    'No items listed yet.';
  const dutyLineHtml = duty ?
    `<div class="menu-card-duty"><i class="fas fa-cart-shopping"></i> ${escapeHtml(duty.name)} is on ${mealType} duty</div>` :
    '';
  return `<div class="card menu-card">
    <div class="menu-card-head">
      <div class="menu-card-title">
        <div class="menu-card-icon ${iconClass}"><i class="fas ${icon}"></i></div>
        <div>
          <div style="font-weight:700;">${label} <span class="small-note" style="margin:0;">(${dateStr})</span></div>
          ${dutyLineHtml}
        </div>
      </div>
      <span class="badge" style="background:var(--success-bg); color:var(--success);">${items.length} Item${items.length===1?'':'s'}</span>
    </div>
    <div class="menu-items-row">
      ${chips || `<span class="small-note" style="margin:0;">${emptyMsg}</span>`}
      ${canEdit ? `<button class="btn secondary menu-add-item-btn" onclick="setTab('schedule')"><i class="fas fa-plus"></i> Add Item</button>` : ''}
    </div>
  </div>`;
}

// Compact, self-contained styling for the admin/superadmin bulk lunch/
// dinner reset row (see renderMealsEdit()/bulkResetMeal() below), the
// mobile fix for the Select Date field's width, and the mobile-shortened
// lock-status pill message (.pill-full/.pill-short — see the media
// queries below). Injected here (not css/style.css) so it's a JS-only
// change.
function ensureMealBulkActionsStyles() {
  if (document.getElementById('meal-bulk-actions-styles')) return;
  const style = document.createElement('style');
  style.id = 'meal-bulk-actions-styles';
  style.textContent = `
    .meal-bulk-row{
      display:flex; align-items:center; justify-content:space-between;
      gap:10px; flex-wrap:wrap; margin-bottom:12px; padding:8px 10px;
      background:var(--primary-bg,#E4EEF4); border-radius:var(--radius,12px);
    }
    .meal-bulk-row .meal-bulk-label{
      display:flex; align-items:center; gap:6px; margin:0;
      font-size:12px; font-weight:600; color:var(--ink-soft,#51606F);
      white-space:nowrap;
    }
    .meal-bulk-btns{ display:flex; gap:8px; }
    .meal-bulk-btn{
      display:flex; align-items:center; gap:6px; white-space:nowrap;
      border:1px solid var(--border,#DFE4EA); border-radius:999px;
      padding:6px 12px; font-size:12.5px; font-weight:700; cursor:pointer;
      background:var(--surface,#fff); color:var(--ink,#1C2733);
      transition:transform .12s ease, filter .12s ease, background .12s ease;
    }
    .meal-bulk-btn i{ font-size:11px; }
    .meal-bulk-btn:hover{ filter:brightness(.97); }
    .meal-bulk-btn:active{ transform:scale(.96); }
    @media (max-width:480px){
      .meal-bulk-row{ flex-direction:column; align-items:stretch; }
      .meal-bulk-row .meal-bulk-label{ justify-content:center; }
      .meal-bulk-btns{ width:100%; }
      .meal-bulk-btn{ flex:1; justify-content:center; padding:8px 10px; }
    }
    /* REDESIGN: every previous attempt to squeeze the lock-status pill
       into the SAME row as the date field kept breaking in a new way on
       mobile — text overflowing off-screen, the native date input
       rendering as literally "0" when shrunk too far, then Safari
       painting its content wider than the box regardless and overlapping
       the pill anyway. The root problem was always the same: a native
       <input type=date> renders at an unpredictable width depending on
       the device/browser/locale, so nothing sharing its row can be sized
       reliably. Instead of continuing to fight that, the pill now gets
       its OWN full-width row below the date field on mobile — no
       competition for space, no overlap possible, and room for a proper
       card treatment (padding, colored background, icon on the left,
       message + time badge on the right) instead of the cramped
       icon-and-text-only version from the last few iterations. */
    @media (max-width:480px){
      .meals-datebar{ flex-wrap:wrap; gap:10px; }
      .meals-datebar-field{ flex:1 1 auto; max-width:100%; }
      .meals-datebar .meal-lock-pill{
        flex-basis:100%; width:100%; box-sizing:border-box;
        justify-content:space-between; gap:10px;
        padding:11px 14px; font-size:13px;
      }
      .meals-datebar .meal-lock-pill i{ font-size:14px; }
      .meals-datebar .meal-lock-pill .pill-badge{ font-weight:800; font-size:12.5px; }
    }
    /* Lock-status pill: long messages like "Time left to edit this date:
       25m (locks at 11:59 PM BD time on 2026-08-23)." are fine on desktop
       but don't fit the now-full-width mobile row — .pill-short is the
       compact version of the same message (see renderMealsEdit() above),
       shown only on mobile while .pill-full stays hidden there. */
    .meal-lock-pill .pill-short{ display:none; }
    @media (max-width:480px){
      .meal-lock-pill .pill-full{ display:none; }
      .meal-lock-pill .pill-short{ display:inline-flex; align-items:center; gap:6px; }
    }
  `;
  document.head.appendChild(style);
}

function renderMealsEdit(headerHtml) {
  const canEditAll = session.role === 'admin' || session.role === 'superadmin';
  const locked = isMealLocked(mealSelectedDate);
  const lockEnabled = state.settings.mealLockEnabled !== false;
  const dayRec = state.days[mealSelectedDate] || {
    meals: {}
  };
  const showAdded = shouldShowAddedBy();
  const myMaxQty = effectiveMaxMealQty(session.role);
  const myMaxQtyAttr = isFinite(myMaxQty) ? `max="${myMaxQty}"` : '';

  // NEW: Restrict date picker for members
  const dateRange = getEditableDateRange();
  const minDate = dateRange.min;
  const maxDate = dateRange.max;

  // If member and current selected date is outside allowed range, reset to tomorrow
  if (!canEditAll && minDate && maxDate) {
    if (mealSelectedDate < minDate || mealSelectedDate > maxDate) {
      mealSelectedDate = minDate;
    }
  }

  const rowEntries = state.members.map(m => {
    const rec = (dayRec.meals && dayRec.meals[m.id]) || {
      lunch: 0,
      dinner: 0
    };
    const isOwn = m.id === session.userId;
    const editable = canEditMealForDate(m.id, mealSelectedDate);
    const blocked = isMealIncreaseBlocked(m.id);
    const canIncrease = editable && canIncreaseMealNow(m.id);
    // +1 Both is a personal shortcut for regular members (only their own row).
    // Admins/super admins can use it on anyone's row, same as the individual +/- buttons.
    const canBoth = (isOwn || canEditAll) && canIncrease;
    // An explicit admin Block freezes the row entirely (no + and no −).
    // An auto-block from a negative balance only stops adding more meals —
    // lowering the count back down is still allowed (it only helps them).
    const canDecrease = editable && !isAdminBlocked(m.id);
    const canReset = session.role === 'superadmin'; // Reset is destructive (wipes a member's meal for the day) — super admin only

    let addedByInfo = '';
    if (showAdded) {
      const parts = [];
      if (rec.lunchBy) parts.push(`Lunch: ${rec.lunchBy}`);
      if (rec.dinnerBy) parts.push(`Dinner: ${rec.dinnerBy}`);
      if (parts.length) addedByInfo = `<div class="small-note" style="text-align:center; margin-top:2px;">${parts.join(' | ')}</div>`;
    }

    const memberRole = m.role || 'member';
    const rowTotal = (rec.lunch || 0) + (rec.dinner || 0);

    return {
      id: m.id,
      html: `<div class="meal-row-grid ${isOwn?'own':''}">
      <div class="mrg-name">
        <div class="mrg-name-row">
          <div class="member-avatar ${memberAvatarClass(m.id)}">${(m.name||'?').charAt(0).toUpperCase()}</div>
          <div class="mrg-name-info">
            <div class="mrg-name-line">${m.name}${isOwn?' <span class="small-note" style="margin:0;">(You)</span>':''}</div>
            <span class="badge ${memberRole}">${roleLabel(memberRole)}</span>
            ${blocked?`<div class="small-note" style="margin-top:2px; color:var(--danger);">🔒 ${mealBlockReasons(m.id).join(', ')}</div>`:''}
          </div>
        </div>
      </div>
      <div class="mrg-cell">
        <div class="mrg-cell-main">
          <span class="meal-control-label mrg-col-label">Lunch</span>
          <div class="stepper">
            <button class="maa-remove" data-maa="remove" data-maa-member="${m.id}" data-maa-type="lunch" data-maa-label="−" ${canDecrease?'':'disabled'} onclick="changeMeal('${m.id}','lunch',-1)">−</button>
            <input type="number" class="qty-input" min="0" ${myMaxQtyAttr} value="${rec.lunch||0}" ${canDecrease?'':'disabled'} data-maa="update" data-maa-member="${m.id}" data-maa-type="lunch" onchange="setMealQty('${m.id}','lunch',this.value)">
            <button class="maa-add" data-maa="add" data-maa-member="${m.id}" data-maa-type="lunch" data-maa-label="+" ${canIncrease?'':'disabled'} onclick="changeMeal('${m.id}','lunch',1)">+</button>
          </div>
          ${rec.lunchBy && showAdded ? `<div class="small-note">Added by: ${rec.lunchBy}</div>` : ''}
        </div>
        <button class="btn secondary mrg-inline-btn mrg-mobile-only maa-both" data-maa="both" data-maa-member="${m.id}" data-maa-label="+1 Both" ${canBoth?'':'disabled'} onclick="changeBothMeals('${m.id}',1)" title="Add 1 lunch + 1 dinner">+1 Both</button>
      </div>
      <div class="mrg-cell">
        <div class="mrg-cell-main">
          <span class="meal-control-label mrg-col-label">Dinner</span>
          <div class="stepper">
            <button class="maa-remove" data-maa="remove" data-maa-member="${m.id}" data-maa-type="dinner" data-maa-label="−" ${canDecrease?'':'disabled'} onclick="changeMeal('${m.id}','dinner',-1)">−</button>
            <input type="number" class="qty-input" min="0" ${myMaxQtyAttr} value="${rec.dinner||0}" ${canDecrease?'':'disabled'} data-maa="update" data-maa-member="${m.id}" data-maa-type="dinner" onchange="setMealQty('${m.id}','dinner',this.value)">
            <button class="maa-add" data-maa="add" data-maa-member="${m.id}" data-maa-type="dinner" data-maa-label="+" ${canIncrease?'':'disabled'} onclick="changeMeal('${m.id}','dinner',1)">+</button>
          </div>
          ${rec.dinnerBy && showAdded ? `<div class="small-note">Added by: ${rec.dinnerBy}</div>` : ''}
        </div>
        ${canReset ? `<button class="btn secondary mrg-inline-btn mrg-mobile-only maa-reset" data-maa="reset" data-maa-member="${m.id}" data-maa-label="↻ Reset" onclick="resetMealsForMember('${m.id}')">↻ Reset</button>` : ''}
      </div>
      <div class="mrg-total">
        <span class="meal-control-label mrg-col-label">Total</span>
        <span class="mrg-total-value">${rowTotal}</span>
      </div>
      <div class="mrg-quick">
        <div class="mrg-quick-buttons">
          <button class="btn secondary mrg-inline-btn maa-both" data-maa="both" data-maa-member="${m.id}" data-maa-label="+1 Both" ${canBoth?'':'disabled'} onclick="changeBothMeals('${m.id}',1)" title="Add 1 lunch + 1 dinner">+1 Both</button>
          ${canReset ? `<button class="btn secondary mrg-inline-btn maa-reset" data-maa="reset" data-maa-member="${m.id}" data-maa-label="↻ Reset" onclick="resetMealsForMember('${m.id}')">↻ Reset</button>` : ''}
        </div>
        <button type="button" class="mrg-kebab" aria-hidden="true" tabindex="-1"><i class="fas fa-ellipsis-vertical"></i></button>
      </div>
    </div>`
    };
  });
  // Mobile: same "your own row first, everyone else behind Load More" pattern
  // already used on the Dashboard's Monthly Summary cards. Desktop is
  // completely untouched — rowEntries.map(...).join('') below is byte-for-byte
  // what `rows` used to be before this change, so nothing about the desktop
  // Meals table changes at all.
  let rows;
  if (isMobileMealsView() && rowEntries.length > 1) {
    const myRowEntry = rowEntries.find(r => r.id === session.userId);
    const otherRowEntries = rowEntries.filter(r => r.id !== session.userId);
    rows = `
      ${myRowEntry ? myRowEntry.html : ''}
      ${otherRowEntries.length ? `
      <div id="meal-row-extra" class="member-stat-extra${mealsRowsExpanded?' expanded':''}">${otherRowEntries.map(r=>r.html).join('')}</div>
      <button type="button" id="meal-row-loadmore-btn" class="member-stat-loadmore-btn" onclick="toggleMealRowExtra()">${mealsRowsExpanded?'▲ Show Less':'▼ Load More — Show All Members'}</button>` : ''}
    `;
  } else {
    rows = rowEntries.map(r => r.html).join('');
  }

  // Same underlying lock/permission logic as before — only the markup
  // (icon + variant class + "pill-badge" for the bold time span) changed.
  // Each message now carries BOTH a .pill-full (desktop) and .pill-short
  // (mobile) version — see ensureMealBulkActionsStyles() below for the CSS
  // that shows only one of the two per breakpoint. Long messages like
  // "Time left to edit this date: 25m (locks at 11:59 PM BD time on
  // 2026-08-23)." don't fit next to the now-full-width date field on a
  // phone; the short version keeps just what actually matters there.
  let lockMessage = '';
  if (lockEnabled) {
    if (canEditAll) {
      if (locked) {
        lockMessage = `<div class="meal-lock-pill warning"><i class="fas fa-triangle-exclamation"></i> <span class="pill-full">Meals for ${mealSelectedDate} are locked (cutoff was ${formatTime12(state.settings.mealLockHour, state.settings.mealLockMinute)} BD time on ${bdDateStrFromInstant(mealLockTime(mealSelectedDate))}), but you as admin can still edit.</span><span class="pill-short">Locked (edit OK)</span></div>`;
      } else {
        const remainingTime = mealLockTime(mealSelectedDate) - new Date();
        if (remainingTime > 0) {
          lockMessage = `<div class="meal-lock-pill success"><i class="far fa-clock"></i> <span class="pill-full">Time left to edit this date: <span class="pill-badge">${formatRemaining(remainingTime)}</span> <span class="pill-note">(locks at ${formatTime12(state.settings.mealLockHour, state.settings.mealLockMinute)} BD time on ${bdDateStrFromInstant(mealLockTime(mealSelectedDate))}).</span></span><span class="pill-short">Left to edit: <span class="pill-badge">${formatRemaining(remainingTime)}</span></span></div>`;
        } else {
          lockMessage = `<div class="meal-lock-pill warning"><i class="fas fa-triangle-exclamation"></i> <span class="pill-full">This date is past the lock time, but you as admin can still edit.</span><span class="pill-short">Past lock (edit OK)</span></div>`;
        }
      }
    } else {
      if (locked) {
        lockMessage = `<div class="meal-lock-pill danger"><i class="fas fa-lock"></i> <span class="pill-full">Meals for ${mealSelectedDate} are locked — the cutoff was ${formatTime12(state.settings.mealLockHour, state.settings.mealLockMinute)} BD time on ${bdDateStrFromInstant(mealLockTime(mealSelectedDate))}. Contact an admin for changes.</span><span class="pill-short">Locked</span></div>`;
      } else {
        const remainingTime = mealLockTime(mealSelectedDate) - new Date();
        if (remainingTime > 0) {
          lockMessage = `<div class="meal-lock-pill success"><i class="far fa-clock"></i> <span class="pill-full">Time left to edit this date: <span class="pill-badge">${formatRemaining(remainingTime)}</span> <span class="pill-note">(locks at ${formatTime12(state.settings.mealLockHour, state.settings.mealLockMinute)} BD time on ${bdDateStrFromInstant(mealLockTime(mealSelectedDate))}).</span></span><span class="pill-short">Left to edit: <span class="pill-badge">${formatRemaining(remainingTime)}</span></span></div>`;
        } else {
          lockMessage = `<div class="meal-lock-pill warning"><i class="fas fa-triangle-exclamation"></i> <span class="pill-full">This date is past the lock time, contact an admin for changes.</span><span class="pill-short">Past lock</span></div>`;
        }
      }
    }
  } else {
    lockMessage = `<div class="meal-lock-pill success"><i class="fas fa-lock-open"></i> <span class="pill-full">Meal locking is disabled. You can edit any date anytime.</span><span class="pill-short">Locking off</span></div>`;
  }

  // Add date range restriction note for members
  let dateRangeNote = '';
  if (!canEditAll && minDate && maxDate) {
    dateRangeNote = `<div class="small-note" style="color:var(--ink-soft); margin-bottom:10px;"><i class="fas fa-calendar-day"></i> You can only edit meals for <b>${minDate}</b> (tomorrow).</div>`;
  }

  // Injects both the admin-only bulk-action styles and the mobile date-field
  // width fix below — the latter applies to every role, so this can't be
  // gated behind canEditAll.
  ensureMealBulkActionsStyles();
  // Deliberately NOT a toggle (see bulkResetMeal() below for why): with a
  // mixed state — some members' lunch on, some off — a toggle button can't
  // directly express "turn everyone off regardless of current state"
  // without first turning everyone ON (a wasted, confusing extra click).
  // These buttons always mean the same thing regardless of current state:
  // reset that meal to off for everyone.
  const bulkMealActionsHtml = canEditAll ? `
    <div class="meal-bulk-row">
      <div class="meal-bulk-label"><i class="fas fa-bolt"></i> Bulk actions for ${mealSelectedDate}</div>
      <div class="meal-bulk-btns">
        <button class="meal-bulk-btn" onclick="bulkResetMeal('lunch')">
          <i class="fas fa-sun"></i> Reset All Lunch
        </button>
        <button class="meal-bulk-btn" onclick="bulkResetMeal('dinner')">
          <i class="fas fa-moon"></i> Reset All Dinner
        </button>
      </div>
    </div>` : '';

  return `
    <div class="card">
      ${headerHtml || ''}
      <div class="meals-datebar">
        <div class="meals-datebar-field">
          <label for="meal-date">Select Date</label>
          <input type="date" id="meal-date" value="${mealSelectedDate}" ${minDate ? `min="${minDate}"` : ''} ${maxDate ? `max="${maxDate}"` : ''}>
        </div>
        ${lockMessage}
      </div>
      ${dateRangeNote}
      ${bulkMealActionsHtml}
      <div class="meal-menu-grid">
        ${renderMealMenuCard('lunch', mealSelectedDate)}
        ${renderMealMenuCard('dinner', mealSelectedDate)}
      </div>
      <div class="row-between meal-menu-note-row">
        <div class="small-note" style="margin:0;"><i class="fas fa-circle-info"></i> Only the super admin can edit shopping-list items (set per member's market duty) — everyone else can view them here.</div>
        <button class="btn secondary" onclick="setTab('schedule')"><i class="fas fa-list"></i> Manage in Market Schedule</button>
      </div>
      <div class="meal-grid-list">
        <div class="meal-row-grid meal-row-grid-head">
          <div>Member</div><div>Lunch${mealGridColItemsHtml(mealSelectedDate, 'lunch')}</div><div>Dinner${mealGridColItemsHtml(mealSelectedDate, 'dinner')}</div><div>Total</div><div>Quick Actions</div>
        </div>
        ${rows}
      </div>
      <div class="meal-summary-grid">
        <div class="meal-summary-card"><div class="meal-summary-icon icon-lunch"><i class="fas fa-sun"></i></div><div><div class="label">Total Lunch (${mealSelectedDate})</div><div class="value">${dayMealTotals(mealSelectedDate).lunch}</div></div></div>
        <div class="meal-summary-card"><div class="meal-summary-icon icon-dinner"><i class="fas fa-moon"></i></div><div><div class="label">Total Dinner (${mealSelectedDate})</div><div class="value">${dayMealTotals(mealSelectedDate).dinner}</div></div></div>
        <div class="meal-summary-card"><div class="meal-summary-icon icon-total"><i class="fas fa-utensils"></i></div><div><div class="label">Total Meals (${mealSelectedDate})</div><div class="value">${dayMealTotals(mealSelectedDate).total}</div></div></div>
        <div class="meal-summary-card"><div class="meal-summary-icon icon-month"><i class="fas fa-arrow-trend-up"></i></div><div><div class="label">Total Meals (${currentMonth})</div><div class="value">${totalMealsAll()}</div></div></div>
      </div>
      <div class="meal-info-box"><i class="fas fa-circle-info"></i><div class="small-note">${lockEnabled ? `Members can edit tomorrow's meal only, from BD midnight until ${formatTime12(state.settings.mealLockHour, state.settings.mealLockMinute)} BD time the same day. ${canEditAll? 'Admins can override after lock and edit any date. ':''}Use +/− or type a number directly${isFinite(myMaxQty) ? ` (max ${myMaxQty} per meal)` : ' (no maximum for your role)'}.` : 'Meal locking is disabled – all dates are editable anytime.'} These totals update live and help whoever is doing market duty know how many meals to shop for.</div></div>
    </div>`;
}

function renderMealsHistory(headerHtml) {
  const entries = [];
  const showTimeCol = shouldShowRecordedAt();
  const showAddedBy = shouldShowAddedBy();

  Object.keys(state.days)
    .filter(k => mealsHistoryViewMode === 'month' ? k.startsWith(currentMonth) : true)
    .sort((a, b) => b.localeCompare(a))
    .forEach(date => {
      const meals = state.days[date].meals || {};
      const rate = monthMealRate(date.slice(0, 7));
      state.members.forEach(m => {
        const rec = meals[m.id];
        if (rec && ((rec.lunch || 0) > 0 || (rec.dinner || 0) > 0)) {
          const lunchQty = rec.lunch || 0;
          const dinnerQty = rec.dinner || 0;
          const totalQty = lunchQty + dinnerQty;
          const cost = totalQty * rate;
          const lunchAt = rec.lunchAt || null;
          const dinnerAt = rec.dinnerAt || null;
          entries.push({
            date,
            member: m,
            lunch: lunchQty,
            dinner: dinnerQty,
            total: totalQty,
            cost,
            lunchBy: rec.lunchBy || '',
            dinnerBy: rec.dinnerBy || '',
            lunchAt,
            dinnerAt
          });
        }
      });
    });

  const canViewAll = canViewAllMealsHistory();
  let scopedEntries = canViewAll ? entries : entries.filter(e => e.member.id === session.userId);

  let filtered = scopedEntries;
  const q = mealsHistorySearch.trim().toLowerCase();
  if (q) filtered = scopedEntries.filter(e => e.member.name.toLowerCase().includes(q) || e.date.includes(q));

  const sortKey = mealsHistorySort.key;
  const dir = mealsHistorySort.dir === 'asc' ? 1 : -1;
  filtered = filtered.slice().sort((a, b) => {
    let av, bv;
    switch (sortKey) {
      case 'name':
        av = a.member.name.toLowerCase();
        bv = b.member.name.toLowerCase();
        break;
      case 'lunch':
        av = a.lunch;
        bv = b.lunch;
        break;
      case 'dinner':
        av = a.dinner;
        bv = b.dinner;
        break;
      case 'total':
        av = a.total;
        bv = b.total;
        break;
      default:
        av = a.date;
        bv = b.date;
        break; // 'date'
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });

  const rows = filtered.map(e => {
    let timeStr = '';
    if (showTimeCol) {
      const parts = [];
      if (e.lunchAt && e.lunch > 0) parts.push(`Lunch: ${formatBDDateTime(e.lunchAt)}`);
      if (e.dinnerAt && e.dinner > 0) parts.push(`Dinner: ${formatBDDateTime(e.dinnerAt)}`);
      timeStr = parts.length ? parts.join('<br>') : '—';
    }

    let addedByStr = '';
    if (showAddedBy) {
      const parts = [];
      if (e.lunchBy) parts.push(`Lunch: ${e.lunchBy}`);
      if (e.dinnerBy) parts.push(`Dinner: ${e.dinnerBy}`);
      addedByStr = parts.length ? parts.join('<br>') : '—';
    }

    return `<tr class="${e.member.id===session.userId?'meal-row own':''}">
      <td class="mono">${e.date}</td>
      <td>${e.member.name}${e.member.id===session.userId?' <span class="small-note">(You)</span>':''}</td>
      <td class="num">${e.lunch}</td>
      <td class="num">${e.dinner}</td>
      <td class="num">${e.total}</td>
      <td class="num">${fmtMoney(e.cost)}</td>
      ${showAddedBy ? `<td style="font-size:12px;">${addedByStr}</td>` : ''}
      ${showTimeCol ? `<td style="font-size:12px;">${timeStr}</td>` : ''}
    </tr>`;
  }).join('');

  let header = `<tr>
    <th class="sortable-th" onclick="setMealsHistorySort('date')">Date${sortArrowHtml('date')}</th>
    <th class="sortable-th" onclick="setMealsHistorySort('name')">Name${sortArrowHtml('name')}</th>
    <th class="num sortable-th" onclick="setMealsHistorySort('lunch')">Lunch${sortArrowHtml('lunch')}</th>
    <th class="num sortable-th" onclick="setMealsHistorySort('dinner')">Dinner${sortArrowHtml('dinner')}</th>
    <th class="num sortable-th" onclick="setMealsHistorySort('total')">Total${sortArrowHtml('total')}</th>
    <th class="num">Cost</th>`;
  if (showAddedBy) header += `<th>Added By</th>`;
  if (showTimeCol) header += `<th>Recorded At</th>`;
  header += `</tr>`;

  const emptyMsg = scopedEntries.length === 0 ?
    (canViewAll ? `No meals recorded yet${mealsHistoryViewMode==='month' ? ' this month' : ''}.` : `You don't have any meals recorded yet${mealsHistoryViewMode==='month' ? ' this month' : ''}.`) :
    'No records match your search.';
  const scopeLabel = mealsHistoryViewMode === 'month' ? currentMonth : 'all time';
  const totalCount = mealsHistoryViewMode === 'month' ?
    (canViewAll ? totalMealsAll() : scopedEntries.reduce((s, e) => s + e.total, 0)) :
    (canViewAll ? allTimeTotalMeals() : scopedEntries.reduce((s, e) => s + e.total, 0));

  return `
    <div class="card keep-native-tables">
      ${headerHtml || ''}
      <div class="row-between">
        <div class="small-note" style="margin:0;">${canViewAll ? `All meal records for ${scopeLabel}` : `Your meal records for ${scopeLabel} <span style="color:var(--ink-faint);">(only you can see others' — ask a superadmin to change this in Settings)</span>`}</div>
        <div>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(-1, setMealsHistoryView)" title="Previous month">‹</button>
          <button class="btn secondary ${mealsHistoryViewMode==='month'?'active-toggle':''}" style="margin-top:0;" onclick="setMealsHistoryView('month')">${currentMonth}</button>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(1, setMealsHistoryView)" title="Next month">›</button>
          <button class="btn secondary ${mealsHistoryViewMode==='all'?'active-toggle':''}" style="margin-top:0;" onclick="setMealsHistoryView('all')">All Time</button>
        </div>
      </div>
      <div class="row-between" style="margin:8px 0 14px;">
        <input type="text" id="meals-history-search" class="search-input" placeholder="Search name or date..." value="${mealsHistorySearch.replace(/"/g,'&quot;')}" oninput="setMealsHistorySearch(this.value)">
        <div class="mono" style="font-weight:700; white-space:nowrap;">${q ? `${filtered.length} of ${scopedEntries.length} records` : `Total meals: ${totalCount}`}</div>
      </div>
      ${filtered.length ? `<div class="table-responsive"><table><thead>${header}</thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${emptyMsg}</div>`}
    </div>`;
}

function sortArrowHtml(key) {
  if (mealsHistorySort.key !== key) return '';
  return mealsHistorySort.dir === 'asc' ? ' <span class="sort-arrow">▲</span>' : ' <span class="sort-arrow">▼</span>';
}

function setMealsHistorySort(key) {
  if (mealsHistorySort.key === key) {
    mealsHistorySort.dir = mealsHistorySort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    mealsHistorySort.key = key;
    mealsHistorySort.dir = key === 'name' ? 'asc' : 'desc';
  }
  renderTabContent();
}

function setMealsHistorySearch(val) {
  mealsHistorySearch = val;
  renderTabContent();
  const el = document.getElementById('meals-history-search');
  if (el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

function setMealsHistoryView(mode) {
  mealsHistoryViewMode = mode;
  renderTabContent();
}

function setMealsView(mode) {
  mealsViewMode = mode;
  renderTabContent();
}

function attachMealHandlers() {
  const dateInput = document.getElementById('meal-date');
  if (dateInput) {
    dateInput.addEventListener('change', e => {
      const newDate = e.target.value;
      const range = getEditableDateRange();
      // If member and date out of range, reject and reset
      if (range.min && range.max) {
        if (newDate < range.min || newDate > range.max) {
          showToast('You can only edit meals for tomorrow.', 'error');
          // Reset to previous value
          e.target.value = mealSelectedDate;
          return;
        }
      }
      mealSelectedDate = newDate;
      renderTabContent();
    });
  }
}
async function changeMeal(memberId, type, delta) {
  // Date range validation for members
  const range = getEditableDateRange();
  if (range.min && range.max) {
    if (mealSelectedDate < range.min || mealSelectedDate > range.max) {
      showToast('You can only edit meals for tomorrow.', 'error');
      renderTabContent();
      return;
    }
  }

  if (!canEditMealForDate(memberId, mealSelectedDate)) {
    showToast('Meals for this date are locked and can no longer be changed.', 'error');
    renderTabContent();
    return;
  }
  if (!guardAdminMonthAccess(mealSelectedDate.slice(0, 7), 'meals')) {
    renderTabContent();
    return;
  }
  if (delta > 0 && !canIncreaseMealNow(memberId)) {
    showToast(`Can't turn on this meal — reason: ${mealBlockReasons(memberId).join(', ')}.`, 'error');
    renderTabContent();
    return;
  }
  // An explicit admin Block freezes the row entirely — no − either, not just no +.
  if (delta < 0 && isAdminBlocked(memberId)) {
    showToast(`Can't change this meal — reason: ${mealBlockReasons(memberId).join(', ')}.`, 'error');
    renderTabContent();
    return;
  }
  if (!state.days[mealSelectedDate]) state.days[mealSelectedDate] = {
    meals: {}
  };
  if (!state.days[mealSelectedDate].meals) state.days[mealSelectedDate].meals = {};
  if (!state.days[mealSelectedDate].meals[memberId]) state.days[mealSelectedDate].meals[memberId] = {
    lunch: 0,
    dinner: 0
  };
  const rec = state.days[mealSelectedDate].meals[memberId];
  let val = (rec[type] || 0) + delta;
  val = Math.max(0, Math.min(effectiveMaxMealQty(session.role), val));
  rec[type] = val;
  rec[type + 'By'] = `${memberById(session.userId).name} (${roleLabel(session.role)})`;
  rec[type + 'At'] = nowTimestamp();
  // Optimistic UI — the +/- stepper should react instantly; the Firestore
  // write happens in the background (persistDay already toasts on failure).
  renderTabContent();
  const mealActionName = delta > 0 ? 'add' : 'remove';
  const mealActionText = delta > 0 ? '✓ Added' : '✓ Removed';
  withMealActionFeedback(persistDay(mealSelectedDate), mealActionSelector(mealActionName, memberId, type), mealActionText);
}
// Bumps lunch AND dinner together by delta in one go (one persist, one
// rerender) — for the common case of "this person is eating both today"
// instead of clicking the lunch + and dinner + steppers separately.
async function changeBothMeals(memberId, delta) {
  // +1 Both is a personal shortcut for regular members — only usable on their own row.
  // Admins/super admins can use it on anyone's row.
  const canEditAll = session.role === 'admin' || session.role === 'superadmin';
  if (delta > 0 && memberId !== session.userId && !canEditAll) {
    showToast("+1 Both only works on your own row.", 'error');
    renderTabContent();
    return;
  }
  const range = getEditableDateRange();
  if (range.min && range.max) {
    if (mealSelectedDate < range.min || mealSelectedDate > range.max) {
      showToast('You can only edit meals for tomorrow.', 'error');
      renderTabContent();
      return;
    }
  }
  if (!canEditMealForDate(memberId, mealSelectedDate)) {
    showToast('Meals for this date are locked and can no longer be changed.', 'error');
    renderTabContent();
    return;
  }
  if (!guardAdminMonthAccess(mealSelectedDate.slice(0, 7), 'meals')) {
    renderTabContent();
    return;
  }
  if (delta > 0 && !canIncreaseMealNow(memberId)) {
    showToast(`Can't turn on this meal — reason: ${mealBlockReasons(memberId).join(', ')}.`, 'error');
    renderTabContent();
    return;
  }
  // An explicit admin Block freezes the row entirely — no − either, not just no +.
  if (delta < 0 && isAdminBlocked(memberId)) {
    showToast(`Can't change this meal — reason: ${mealBlockReasons(memberId).join(', ')}.`, 'error');
    renderTabContent();
    return;
  }
  if (!state.days[mealSelectedDate]) state.days[mealSelectedDate] = {
    meals: {}
  };
  if (!state.days[mealSelectedDate].meals) state.days[mealSelectedDate].meals = {};
  if (!state.days[mealSelectedDate].meals[memberId]) state.days[mealSelectedDate].meals[memberId] = {
    lunch: 0,
    dinner: 0
  };
  const rec = state.days[mealSelectedDate].meals[memberId];
  const who = `${memberById(session.userId).name} (${roleLabel(session.role)})`;
  const ts = nowTimestamp();
  ['lunch', 'dinner'].forEach(type => {
    let val = (rec[type] || 0) + delta;
    val = Math.max(0, Math.min(effectiveMaxMealQty(session.role), val));
    rec[type] = val;
    rec[type + 'By'] = who;
    rec[type + 'At'] = ts;
  });
  renderTabContent();
  if (delta > 0) {
    withMealActionFeedback(persistDay(mealSelectedDate), mealActionSelector('both', memberId), '✓ Both Added');
  } else {
    persistDay(mealSelectedDate);
  }
}
async function setMealQty(memberId, type, rawValue) {
  // Date range validation for members
  const range = getEditableDateRange();
  if (range.min && range.max) {
    if (mealSelectedDate < range.min || mealSelectedDate > range.max) {
      showToast('You can only edit meals for tomorrow.', 'error');
      renderTabContent();
      return;
    }
  }

  if (!canEditMealForDate(memberId, mealSelectedDate)) {
    showToast('Meals for this date are locked and can no longer be changed.', 'error');
    renderTabContent();
    return;
  }
  if (!guardAdminMonthAccess(mealSelectedDate.slice(0, 7), 'meals')) {
    renderTabContent();
    return;
  }
  let val = parseInt(rawValue, 10);
  if (isNaN(val)) val = 0;
  val = Math.max(0, Math.min(effectiveMaxMealQty(session.role), val));
  const currentVal = (state.days[mealSelectedDate] && state.days[mealSelectedDate].meals && state.days[mealSelectedDate].meals[memberId] && state.days[mealSelectedDate].meals[memberId][type]) || 0;
  // An explicit admin Block freezes the row entirely — typing a lower
  // number isn't exempt just because it's not technically an "increase".
  if (val !== currentVal && isAdminBlocked(memberId)) {
    showToast(`Can't change this meal — reason: ${mealBlockReasons(memberId).join(', ')}.`, 'error');
    renderTabContent();
    return;
  }
  if (val > currentVal && !canIncreaseMealNow(memberId)) {
    showToast(`Can't turn on this meal — reason: ${mealBlockReasons(memberId).join(', ')}.`, 'error');
    renderTabContent();
    return;
  }
  if (!state.days[mealSelectedDate]) state.days[mealSelectedDate] = {
    meals: {}
  };
  if (!state.days[mealSelectedDate].meals) state.days[mealSelectedDate].meals = {};
  if (!state.days[mealSelectedDate].meals[memberId]) state.days[mealSelectedDate].meals[memberId] = {
    lunch: 0,
    dinner: 0
  };
  state.days[mealSelectedDate].meals[memberId][type] = val;
  state.days[mealSelectedDate].meals[memberId][type + 'By'] = `${memberById(session.userId).name} (${roleLabel(session.role)})`;
  state.days[mealSelectedDate].meals[memberId][type + 'At'] = nowTimestamp();
  renderTabContent();
  withMealActionFeedback(persistDay(mealSelectedDate), mealActionSelector('update', memberId, type), '✓ Updated');
}

// NEW: Reset both lunch and dinner for a member on the current selected date
async function resetMealsForMember(memberId) {
  const dateStr = mealSelectedDate;
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can reset meals.', 'error');
    return;
  }
  // Check edit permission
  if (!canEditMealForDate(memberId, dateStr)) {
    showToast('You do not have permission to reset meals for this date.', 'error');
    return;
  }
  // If member, ensure date is tomorrow (already enforced by date picker, but double-check)
  const range = getEditableDateRange();
  if (range.min && range.max) {
    if (dateStr < range.min || dateStr > range.max) {
      showToast('You can only reset meals for tomorrow.', 'error');
      return;
    }
  }

  if (!confirm(`Reset all meals for ${memberById(memberId).name} on ${dateStr}? This will set lunch and dinner to 0 and clear who added them.`)) {
    return;
  }

  // Initialize if needed
  if (!state.days[dateStr]) state.days[dateStr] = {
    meals: {}
  };
  if (!state.days[dateStr].meals) state.days[dateStr].meals = {};
  if (!state.days[dateStr].meals[memberId]) state.days[dateStr].meals[memberId] = {
    lunch: 0,
    dinner: 0
  };

  const rec = state.days[dateStr].meals[memberId];
  rec.lunch = 0;
  rec.dinner = 0;
  rec.lunchBy = '';
  rec.dinnerBy = '';
  rec.lunchAt = null;
  rec.dinnerAt = null;

  renderTabContent();
  withMealActionFeedback(persistDay(dateStr), mealActionSelector('reset', memberId), `✓ Reset for ${memberById(memberId).name}`);
}

// Admin/super admin bulk shortcut: reset a meal type to OFF (qty 0) for
// every member at once, regardless of the current per-member state.
// Deliberately NOT a toggle — with a mixed state (some members' lunch on,
// some off), a toggle can't directly express "turn everyone off" without
// first forcing everyone ON (a confusing, wasted extra click just to reach
// the state you actually wanted). This always means the same thing:
// nobody has this meal for this date anymore.
// Mutates state.days[...] for every member in memory first and calls
// persistDay() ONCE at the end — same pattern as changeMeal()/
// changeBothMeals()/resetMealsForMember() above — rather than looping a
// per-member persist call, which would turn one button click into N
// separate Firestore writes.
async function bulkResetMeal(type) {
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    showToast('Only admins can do this.', 'error');
    return;
  }
  const dateStr = mealSelectedDate;
  if (!guardAdminMonthAccess(dateStr.slice(0, 7), 'meals')) {
    renderTabContent();
    return;
  }
  const label = type === 'lunch' ? 'Lunch' : 'Dinner';
  if (!confirm(`Reset ${label} to OFF for all members on ${dateStr}?`)) return;

  if (!state.days[dateStr]) state.days[dateStr] = { meals: {} };
  if (!state.days[dateStr].meals) state.days[dateStr].meals = {};
  const who = `${memberById(session.userId).name} (${roleLabel(session.role)})`;
  const ts = nowTimestamp();
  let changedCount = 0;
  let skippedCount = 0;
  state.members.forEach(m => {
    // An explicit admin Block freezes the row entirely — a bulk action
    // must not silently override that, same rule as every per-row control.
    if (isAdminBlocked(m.id)) { skippedCount++; return; }
    if (!state.days[dateStr].meals[m.id]) state.days[dateStr].meals[m.id] = { lunch: 0, dinner: 0 };
    const rec = state.days[dateStr].meals[m.id];
    if ((rec[type] || 0) === 0) return; // already off — don't touch the audit fields
    rec[type] = 0;
    rec[type + 'By'] = who;
    rec[type + 'At'] = ts;
    changedCount++;
  });
  renderTabContent();
  if (changedCount === 0) {
    // Nothing to save — either everyone eligible was already off, or
    // every remaining member got skipped (blocked/frozen). Avoid a
    // pointless Firestore write for a no-op change.
    showToast(`No changes made${skippedCount ? ` — ${skippedCount} member${skippedCount === 1 ? '' : 's'} skipped (blocked)` : ''}.`);
    return;
  }
  const ok = await persistDay(dateStr);
  if (ok) {
    const skippedNote = skippedCount ? `, ${skippedCount} skipped (blocked)` : '';
    showToast(`${label} reset to OFF for ${changedCount} member${changedCount === 1 ? '' : 's'}${skippedNote}.`, 'success');
  }
}

/* ---------------- HISTORY ---------------- */
/* ===== 11-reports.js ===== */
// ---------------------------------------------------------------------------
// 11-reports.js  (originally app.js lines 4227-4710)
// Printable report building blocks (header/avatar/stat/shell) and the day/personal-month report HTML generators + downloads
// ---------------------------------------------------------------------------
const MEAL_TYPE_LABEL = {
  lunch: 'Lunch',
  dinner: 'Dinner'
};

function buildMemberLedger(memberId) {
  const entries = [];
  Object.keys(state.days).sort().forEach(date => {
    const meals = state.days[date].meals || {};
    const rec = meals[memberId];
    if (!rec) return;
    const month = date.slice(0, 7);
    const rate = monthMealRate(month);
    ['lunch', 'dinner'].forEach(type => {
      const qty = rec[type] || 0;
      if (qty > 0) {
        entries.push({
          kind: 'meal',
          date,
          mealType: type,
          qty,
          rate,
          amount: qty * rate,
          addedBy: rec[type + 'By'] || '',
          createdAt: rec[type + 'At'] || null
        });
      }
    });
  });
  state.expenses.filter(e => e.memberIds.includes(memberId)).forEach(e => {
    entries.push({
      kind: 'expense',
      date: e.date,
      title: e.title || 'Shared expense',
      description: e.description || '',
      amount: expenseShareFor(e, memberId),
      addedBy: e.addedBy || '',
      createdAt: e.createdAt || null,
      splitType: e.splitType,
      mealTypeSplit: e.mealTypeSplit,
      isEveryoneFallback: e.memberIds.length === state.members.length
    });
  });
  state.deposits.filter(d => d.memberId === memberId).forEach(d => {
    entries.push({
      kind: 'deposit',
      date: d.date,
      note: d.note || '',
      amount: Number(d.amount),
      type: d.type || 'deposit',
      addedBy: d.addedBy || '',
      createdAt: d.createdAt || null
    });
  });
  entries.sort((a, b) => {
    if (a.date < b.date) return -1;
    if (a.date > b.date) return 1;
    // Same date: fall back to actual recorded time so deposits made earlier
    // in the day are applied before same-day deductions (and vice versa),
    // instead of always ordering by kind (meal -> expense -> deposit).
    // Entries without a createdAt (older data, before this field existed)
    // sort before ones that have it, keeping old behavior for them.
    const at = a.createdAt || 0;
    const bt = b.createdAt || 0;
    return at - bt;
  });
  let running = 0;
  entries.forEach(e => {
    e.balanceBefore = running;
    running += (e.kind === 'deposit') ? e.amount : -e.amount;
    e.balanceAfter = running;
  });
  return entries;
}

/* ---------------- PERSONAL DOWNLOADABLE REPORTS (Dashboard) ----------------
   Client-side only: builds a printable HTML page in a new tab which the
   member can Print → Save as PDF. Uses the exact same buildMemberLedger()
   entries (and therefore the exact same rates/amounts) already used
   throughout the app, so figures always match History/Dashboard.
   Visual style matches the "Person Based Daily Meal Rate" mockup: dark
   slate-blue headers, avatar bubble, rate×qty breakdown under costs, a
   Daily-Summary grid, a dark Grand Total bar, and a green rate-comparison
   callout. */
const REPORT_HEADER_BG = '#2F4A5E';
const REPORT_AVATAR_PALETTE = ['#6366F1', '#F59E0B', '#16A34A', '#DB2777', '#0EA5E9', '#8B5CF6', '#DC2626', '#0D9488'];

function formatLongDateStr(dateStr) {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (e) {
    return dateStr;
  }
}

function reportAvatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % REPORT_AVATAR_PALETTE.length;
  return REPORT_AVATAR_PALETTE[Math.abs(h)];
}

function messLedgerReportHeader(subtitle) {
  return `
    <div style="display:flex; align-items:center; gap:14px; padding-bottom:14px; margin-bottom:16px; border-bottom:1px solid #E5E7EB;">
      <div style="width:44px; height:44px; min-width:44px; border-radius:10px; background:${REPORT_HEADER_BG}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:20px;">M</div>
      <div>
        <div style="font-size:22px; font-weight:800; color:#111827;">MessLedger</div>
        <div style="font-size:13px; color:#6B7280;">${subtitle}</div>
      </div>
    </div>`;
}

function reportPersonBar(me, dateLabel) {
  const initial = (me && me.name ? me.name[0] : '?').toUpperCase();
  const color = reportAvatarColor(me ? me.name : '?');
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px;">
      <div style="display:flex; align-items:center; gap:10px;">
        <div style="width:34px; height:34px; min-width:34px; border-radius:8px; background:${color}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:14px;">${initial}</div>
        <div>
          <div style="font-size:16px; font-weight:800; color:#111827;">${me?me.name:''}</div>
          <div style="font-size:12.5px; color:#6B7280;">${dateLabel}</div>
        </div>
      </div>
      <div style="font-size:11.5px; color:#6B7280;">Generated ${formatBDDateTime(nowTimestamp())}</div>
    </div>`;
}

function reportStatBox(label, value, bg, border) {
  return `<div style="flex:1; min-width:140px; background:${bg}; border:0.75px solid ${border}; border-radius:8px; padding:10px 13px;">
    <div style="font-size:8.5px; letter-spacing:.3px; text-transform:uppercase; color:#6B7280;">${label}</div>
    <div style="font-size:16px; font-weight:800; color:#111827; margin-top:3px;">${value}</div>
  </div>`;
}

function reportShell(bodyHtml, docTitle) {
  // Rendered as an in-page overlay (see openPrintableReport) rather than a
  // full HTML document opened via window.open(). On iOS home-screen web
  // apps, window.open('_blank') kicks the user out of the standalone PWA
  // and into Safari with no way back short of force-closing and reopening
  // the app. Keeping the report inside the same document avoids that.
  return `
    <div id="msledger-report-overlay" role="dialog" aria-label="${docTitle || 'MessLedger Report'}">
      <div class="msledger-report-topbar no-print">
        <div class="msledger-report-title">${docTitle || 'MessLedger Report'}</div>
        <div class="msledger-report-actions">
          <button type="button" onclick="window.print()">🖨️ Print / Save as PDF</button>
          <button type="button" onclick="closePrintableReport()">✕ Close</button>
        </div>
      </div>
      <div class="msledger-report-body">
        ${bodyHtml}
      </div>
    </div>`;
}

function ensureReportOverlayStyles() {
  if (document.getElementById('msledger-report-overlay-styles')) return;
  const style = document.createElement('style');
  style.id = 'msledger-report-overlay-styles';
  style.textContent = `
    #msledger-report-overlay{ position:fixed; inset:0; background:#fff; color-scheme:light; z-index:99999; overflow:auto;
      font-family: Arial, Helvetica, sans-serif; color:#111827; -webkit-overflow-scrolling:touch; }
    #msledger-report-overlay table{ width:100%; border-collapse:collapse; }
    #msledger-report-overlay th, #msledger-report-overlay td{ border-bottom: 1px solid #E5E7EB; }
    #msledger-report-overlay .msledger-report-topbar{ position:sticky; top:0; display:flex; gap:8px;
      justify-content:space-between; align-items:center; padding:10px 16px; background:#fff;
      border-bottom:1px solid #E5E7EB; z-index:2; }
    #msledger-report-overlay .msledger-report-title{ font-weight:700; font-size:13.5px; color:#111827; }
    #msledger-report-overlay .msledger-report-actions{ display:flex; gap:8px; flex-shrink:0; }
    #msledger-report-overlay .msledger-report-actions button{ border:none; padding:8px 14px; border-radius:6px;
      font-size:13px; cursor:pointer; white-space:nowrap; }
    #msledger-report-overlay .msledger-report-actions button:first-child{ background:${REPORT_HEADER_BG}; color:#fff; }
    #msledger-report-overlay .msledger-report-actions button:last-child{ background:#F3F4F6; color:#111827; }
    #msledger-report-overlay .msledger-report-body{ padding:24px; }
    body.msledger-report-open{ overflow:hidden; }
    @media print {
      body.msledger-report-open > *:not(#msledger-report-overlay){ display:none !important; }
      #msledger-report-overlay{ position:static !important; overflow:visible !important; }
      #msledger-report-overlay .no-print{ display:none !important; }
      #msledger-report-overlay .msledger-report-body{ padding:0; }
      @page{ margin: 14mm; }
    }`;
  document.head.appendChild(style);
}

let _reportOverlayHistoryPushed = false;

function _handleReportOverlayPopstate() {
  closePrintableReport(false);
}

function openPrintableReport(html) {
  ensureReportOverlayStyles();
  closePrintableReport(false); // remove any existing overlay first, without touching history
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  const overlay = wrapper.firstElementChild;
  document.body.appendChild(overlay);
  document.body.classList.add('msledger-report-open');
  window.addEventListener('popstate', _handleReportOverlayPopstate);
  // Push a history entry so the device/browser back button closes the
  // report overlay instead of leaving the app with nothing to "go back" to.
  try {
    history.pushState({ msledgerReport: true }, '');
    _reportOverlayHistoryPushed = true;
  } catch (e) {
    _reportOverlayHistoryPushed = false;
  }
}

function closePrintableReport(goBack) {
  const overlay = document.getElementById('msledger-report-overlay');
  window.removeEventListener('popstate', _handleReportOverlayPopstate);
  if (!overlay) return;
  overlay.remove();
  document.body.classList.remove('msledger-report-open');
  if (goBack !== false && _reportOverlayHistoryPushed) {
    _reportOverlayHistoryPushed = false;
    history.back();
  } else {
    _reportOverlayHistoryPushed = false;
  }
}

function reportSectionTitle(text) {
  return `<div style="font-size:12.5px; font-weight:700; margin:18px 0 6px; color:#111827;">${text}</div>`;
}

function reportGrandTotalBar(label, value) {
  return `<div style="margin-top:16px; background:${REPORT_HEADER_BG}; color:#fff; border-radius:8px; padding:13px 16px; display:flex; justify-content:space-between; align-items:center;">
    <div style="font-weight:700; font-size:13.5px;">${label}</div><div style="font-size:19px; font-weight:800;">${value}</div>
  </div>`;
}

function reportRateCallout(title, formula, rateStr, aboveMonthAvg) {
  const good = aboveMonthAvg === false;
  const bg = aboveMonthAvg === null ? '#F3F4F6' : (good ? '#E7F6EC' : '#FFEDD5');
  const border = aboveMonthAvg === null ? '#E5E7EB' : (good ? '#BBE5C8' : '#FCD9A8');
  const textColor = aboveMonthAvg === null ? '#374151' : (good ? '#166534' : '#9A3412');
  const tag = aboveMonthAvg === null ? '' : (good ? '<div style="font-size:11px; margin-top:2px;">▼ Below your month average</div>' : '<div style="font-size:11px; margin-top:2px;">▲ Above your month average</div>');
  return `<div style="margin-top:10px; background:${bg}; border:1px solid ${border}; border-radius:8px; padding:12px 16px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
    <div><div style="font-weight:700; color:${textColor};">${title}</div>
      <div style="font-size:11.5px; color:${textColor};">${formula}</div>${tag}</div>
    <div style="font-size:19px; font-weight:800; color:${textColor};">${rateStr}</div>
  </div>`;
}

function reportSummaryGrid(pairs) {
  const rowsHtml = pairs.map(([l1, v1, l2, v2]) => `
    <tr>
      <td style="padding:9px 10px; font-weight:700; color:#3E5A70; font-size:9px; border-right:0.5px solid #E5E7EB;">${l1}</td>
      <td style="padding:9px 10px; text-align:right; font-size:9.5px; border-right:0.5px solid #E5E7EB;">${v1}</td>
      <td style="padding:9px 10px; font-weight:700; color:#3E5A70; font-size:9px;">${l2}</td>
      <td style="padding:9px 10px; text-align:right; font-size:9.5px;">${v2}</td>
    </tr>`).join('');
  return `<table style="border:0.6px solid #E5E7EB; border-collapse:collapse;"><tbody>${rowsHtml}</tbody></table>`;
}

function reportProgressBar(pct) {
  const clamped = Math.max(0, Math.min(100, pct));
  return `<div style="width:60px; height:6px; border-radius:3px; background:#E5E7EB; overflow:hidden; margin:0 auto 3px;">
    <div style="width:${clamped}%; height:100%; background:#6366F1;"></div>
  </div><div style="font-size:9.5px; text-align:center; color:#374151;">${pct.toFixed(1)}%</div>`;
}

function reportAvatarNameCell(name) {
  const initial = (name || '?')[0].toUpperCase();
  const color = reportAvatarColor(name || '?');
  return `<div style="display:flex; align-items:center; gap:8px;">
    <div style="width:22px; height:22px; min-width:22px; border-radius:6px; background:${color}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:10px;">${initial}</div>
    <span style="font-weight:700;">${name}</span>
  </div>`;
}

function buildAllMembersDayReportHtml(dateStr) {
  const month = dateStr.slice(0, 7);
  const groceryRate = monthMealRate(month);
  const dayCost = dayTotalCost(dateStr);

  // "Today's Costs" — every raw grocery/shared-expense entry logged for this
  // date, exactly as shown on the Dashboard's Total Expenses card.
  const costRows = [
    ...dayCost.costItems.map(c => ({
      type: MEAL_TIME_LABEL[c.mealType || 'other'],
      detail: c.note || '—',
      by: c.addedBy || '—',
      amount: Number(c.amount || 0)
    })),
    ...dayCost.expenseItems.map(e => ({
      type: 'Shared Expense',
      detail: e.title + (e.description ? ` — ${e.description}` : ''),
      by: e.addedBy || '—',
      amount: Number(e.amount || 0)
    })),
  ];
  const costRowsHtml = costRows.length ? costRows.map((r, i) => `
    <tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:8px;">${r.type}</td><td style="padding:8px;">${r.detail}</td>
      <td style="padding:8px;">${r.by}</td><td style="text-align:right; padding:8px;">${fmtMoney(r.amount)}</td>
    </tr>`).join('') : `<tr><td colspan="4" style="padding:10px 8px; color:#6B7280;">Nothing logged for this day yet.</td></tr>`;

  // Per-member breakdown — grocery cost uses the same monthly meal rate used
  // everywhere else in the app; shared-expense share uses the same
  // expenseShareFor() split already used for balances.
  const activeIds = new Set(activeMemberIdsForMonth(month));
  const dayMeals = (state.days[dateStr] && state.days[dateStr].meals) || {};
  const todaysExpenses = state.expenses.filter(e => e.date === dateStr);
  const memberRows = state.members.filter(m => activeIds.has(m.id)).map(m => {
    const rec = dayMeals[m.id] || {};
    const lunch = rec.lunch || 0,
      dinner = rec.dinner || 0;
    const totalMealsForMember = lunch + dinner;
    const groceryCost = totalMealsForMember * groceryRate;
    const myExpenses = todaysExpenses.filter(e => e.memberIds.includes(m.id));
    const sharedCost = myExpenses.reduce((s, e) => s + expenseShareFor(e, m.id), 0);
    const sharedDetail = myExpenses.map(e => {
      const share = expenseShareFor(e, m.id);
      const isMealSplit = e.shares && e.shares[m.id] !== undefined;
      return isMealSplit ?
        `${e.title}: ${fmtMoney(share)} (by meal count)` :
        `${e.title}: ${fmtMoney(e.amount)} \u00f7 ${e.memberIds.length} = ${fmtMoney(share)}`;
    });
    const totalCost = groceryCost + sharedCost;
    const personalRate = totalMealsForMember > 0 ? totalCost / totalMealsForMember : null;
    return {
      member: m,
      lunch,
      dinner,
      totalMealsForMember,
      groceryCost,
      sharedCost,
      sharedDetail,
      totalCost,
      personalRate
    };
  });

  const dayTotalMeals = memberRows.reduce((s, r) => s + r.totalMealsForMember, 0);
  const dayGrandTotal = memberRows.reduce((s, r) => s + r.totalCost, 0);
  const dayAvgRate = dayTotalMeals > 0 ? dayGrandTotal / dayTotalMeals : null;
  const maxCost = memberRows.length ? Math.max(...memberRows.map(r => r.totalCost)) : 0;
  const maxMeals = memberRows.length ? Math.max(...memberRows.map(r => r.totalMealsForMember)) : 0;

  const memberRowsHtml = memberRows.length ? memberRows.map((r, i) => {
    const groc = r.totalMealsForMember > 0 ? `<div>${fmtMoney(r.groceryCost)}</div><div style="font-size:9px; color:#6B7280;">${fmtMoney(groceryRate)} &times; ${r.totalMealsForMember}</div>` : '&mdash;';
    const shr = r.sharedCost > 0 ?
      `<div>${fmtMoney(r.sharedCost)}</div><div style="font-size:9px; color:#6B7280;">${r.sharedDetail.join('<br>')}</div>` :
      '&mdash;';
    let rateHtml = '&mdash;';
    if (r.personalRate !== null) {
      const above = dayAvgRate !== null && r.personalRate > dayAvgRate + 0.005;
      const below = dayAvgRate !== null && r.personalRate < dayAvgRate - 0.005;
      const color = above ? '#D97706' : (below ? '#16A34A' : '#111827');
      const tag = above ? '▲ Above avg' : (below ? '▼ Below avg' : '≈ On avg');
      rateHtml = `<div style="color:${color}; font-weight:700;">${fmtMoney(r.personalRate)}</div><div style="font-size:9px; color:${color};">${tag}</div>`;
    }
    const pct = dayGrandTotal > 0 ? (r.totalCost / dayGrandTotal * 100) : 0;
    let badge = '';
    if (r.totalCost > 0 && r.totalCost === maxCost) badge = '💸 Top Spender';
    else if (r.totalMealsForMember > 0 && r.totalMealsForMember === maxMeals) badge = '🍽️ Most Meals';
    else if (r.personalRate !== null && dayAvgRate !== null && r.personalRate < dayAvgRate) badge = '🌱 Budget Friendly';
    else if (r.totalMealsForMember > 0) badge = '✅ Regular';
    return `<tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${reportAvatarNameCell(r.member.name)}</td>
      <td style="text-align:center; padding:7px 8px;">${r.lunch}</td>
      <td style="text-align:center; padding:7px 8px;">${r.dinner}</td>
      <td style="text-align:center; padding:7px 8px;">${r.totalMealsForMember}</td>
      <td style="text-align:right; padding:7px 8px;">${groc}</td>
      <td style="text-align:right; padding:7px 8px;">${shr}</td>
      <td style="text-align:right; padding:7px 8px; font-weight:700;">${fmtMoney(r.totalCost)}</td>
      <td style="text-align:right; padding:7px 8px;">${rateHtml}</td>
      <td style="text-align:center; padding:7px 8px;">${reportProgressBar(pct)}</td>
      <td style="padding:7px 8px; font-size:9.5px;">${badge}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="10" style="padding:10px 8px; color:#6B7280;">No active members found.</td></tr>`;

  const totalLunch = memberRows.reduce((s, r) => s + r.lunch, 0);
  const totalDinner = memberRows.reduce((s, r) => s + r.dinner, 0);
  const totalGrocery = memberRows.reduce((s, r) => s + r.groceryCost, 0);
  const totalShared = memberRows.reduce((s, r) => s + r.sharedCost, 0);

  const statStrip = `<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:6px;">
      ${reportStatBox('🛒 MONTHLY GROCERY RATE', `${fmtMoney(groceryRate)}/meal`, '#EEF2FF', '#C7D2FE')}
      ${reportStatBox('💵 TODAY\'S SHARED EXPENSE', fmtMoney(dayCost.shared), '#FEF3C7', '#F59E0B')}
      ${reportStatBox('📊 DAILY AVG RATE', dayAvgRate!==null?`${fmtMoney(dayAvgRate)}/meal`:'—', '#E7F6EC', '#BBE5C8')}
    </div>`;

  const body = `
    ${messLedgerReportHeader('Meal &amp; expense tracker — Daily Report')}
    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:14px; flex-wrap:wrap; gap:6px;">
      <div style="font-size:18px; font-weight:700;">${formatLongDateStr(dateStr)}</div>
      <div style="font-size:11.5px; color:#6B7280;">Generated ${formatBDDateTime(nowTimestamp())}</div>
    </div>
    ${reportSectionTitle('💵 Today\'s Costs')}
    <table style="font-size:12px; margin-bottom:12px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:8px;">Type</th><th style="text-align:left; padding:8px;">Detail</th>
        <th style="text-align:left; padding:8px;">Added By</th><th style="text-align:right; padding:8px;">Amount</th></tr></thead>
      <tbody>${costRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;"><td colspan="3" style="padding:8px;">Total</td>
        <td style="text-align:right; padding:8px;">${fmtMoney(dayCost.total)}</td></tr></tbody>
    </table>
    ${statStrip}
    ${reportSectionTitle('🍽️ Person Based Daily Meal Cost')}
    <table style="font-size:10.5px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:7px 8px;">Member</th><th style="padding:7px 8px;">Lunch</th><th style="padding:7px 8px;">Dinner</th>
        <th style="padding:7px 8px;">Total<br>Meals</th><th style="text-align:right; padding:7px 8px;">Grocery Cost</th>
        <th style="text-align:right; padding:7px 8px;">Shared Exp Cost</th><th style="text-align:right; padding:7px 8px;">Total<br>Cost</th>
        <th style="text-align:right; padding:7px 8px;">Meal<br>Rate</th><th style="padding:7px 8px;">% of Day's<br>Total Cost</th>
        <th style="text-align:left; padding:7px 8px;">Highlight</th></tr></thead>
      <tbody>${memberRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;">
        <td style="padding:7px 8px;">Total</td>
        <td style="text-align:center; padding:7px 8px;">${totalLunch}</td>
        <td style="text-align:center; padding:7px 8px;">${totalDinner}</td>
        <td style="text-align:center; padding:7px 8px;">${dayTotalMeals}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(totalGrocery)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(totalShared)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(dayGrandTotal)}</td>
        <td style="text-align:right; padding:7px 8px;">${dayAvgRate!==null?fmtMoney(dayAvgRate):'—'}</td>
        <td colspan="2" style="text-align:center; padding:7px 8px;">100%</td>
      </tr></tbody>
    </table>
    ${reportSectionTitle('📋 Daily Summary')}
    ${reportSummaryGrid([
      ['Total Lunch Meals', totalLunch, 'Total Dinner Meals', totalDinner],
      ['Total Grocery Cost', fmtMoney(totalGrocery), 'Total Shared Expense', fmtMoney(totalShared)],
    ])}
    ${reportGrandTotalBar('Grand Total Daily Cost', fmtMoney(dayGrandTotal))}
    ${dayAvgRate!==null ? reportRateCallout('Daily Average Meal Rate', `Grand Total Daily Cost ÷ Total Meals = ${fmtMoney(dayGrandTotal)} ÷ ${dayTotalMeals}`, `${fmtMoney(dayAvgRate)} / meal`, null) : ''}
    <div style="margin-top:14px; font-size:11px; color:#6B7280;">Meal Rate is color-coded against the day's average. Highlight badges are just for fun. Figures may change if meals or costs are edited after this export.</div>`;
  return reportShell(body, `MessLedger — ${dateStr}`);
}

function buildPersonalMonthReportHtml(month) {
  const me = memberById(session.userId);
  const ledger = buildMemberLedger(session.userId);
  const monthEntries = ledger.filter(e => e.date.startsWith(month) && (e.kind === 'meal' || e.kind === 'expense'));
  const byDate = {};
  monthEntries.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = {
      lunch: 0,
      dinner: 0,
      mealCost: 0,
      expenseCost: 0
    };
    if (e.kind === 'meal') {
      byDate[e.date][e.mealType] += e.qty;
      byDate[e.date].mealCost += e.amount;
    } else {
      byDate[e.date].expenseCost += e.amount;
    }
  });
  const dates = Object.keys(byDate).sort();
  let totalLunch = 0,
    totalDinner = 0,
    totalMealCost = 0,
    totalExpenseCost = 0;
  const dayTotals = dates.map(d => {
    const r = byDate[d];
    totalLunch += r.lunch;
    totalDinner += r.dinner;
    totalMealCost += r.mealCost;
    totalExpenseCost += r.expenseCost;
    return {
      date: d,
      ...r,
      total: r.mealCost + r.expenseCost
    };
  });
  const nonZero = dayTotals.filter(d => d.total > 0);
  const maxDay = nonZero.length ? nonZero.reduce((a, b) => b.total > a.total ? b : a) : null;
  const minDay = nonZero.length ? nonZero.reduce((a, b) => b.total < a.total ? b : a) : null;
  const rows = dayTotals.length ? dayTotals.map((d, i) => {
    let tag = '';
    if (maxDay && d.date === maxDay.date && nonZero.length > 1) tag = '<div style="font-size:9px; color:#D97706; margin-top:2px;">🔥 Priciest day</div>';
    else if (minDay && d.date === minDay.date && nonZero.length > 1) tag = '<div style="font-size:9px; color:#16A34A; margin-top:2px;">🌱 Lightest day</div>';
    return `<tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${d.date}${tag}</td>
      <td style="text-align:center; padding:7px 8px;">${d.lunch}</td>
      <td style="text-align:center; padding:7px 8px;">${d.dinner}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(d.mealCost)}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(d.expenseCost)}</td>
      <td style="text-align:right; padding:7px 8px; font-weight:600;">${fmtMoney(d.total)}</td></tr>`;
  }).join('') : `<tr><td colspan="6" style="padding:12px 8px; color:#6B7280;">No meals or expenses recorded this month yet.</td></tr>`;
  const totalMeals = totalLunch + totalDinner;
  const totalCost = totalMealCost + totalExpenseCost;
  const avgRate = totalMeals > 0 ? totalCost / totalMeals : null;

  const statStrip = `<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:6px;">
      ${reportStatBox('🍽️ TOTAL MEALS', totalMeals, '#EEF2FF', '#C7D2FE')}
      ${reportStatBox('💵 TOTAL COST', fmtMoney(totalCost), '#FEF3C7', '#F59E0B')}
      ${reportStatBox('📊 AVERAGE RATE', avgRate!==null?`${fmtMoney(avgRate)}/meal`:'—', '#E7F6EC', '#BBE5C8')}
    </div>`;

  const body = `
    ${messLedgerReportHeader('Meal &amp; expense tracker — Monthly Report')}
    ${reportPersonBar(me, month)}
    ${statStrip}
    ${reportSectionTitle('📅 Day-by-Day Breakdown')}
    <table style="font-size:12px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:8px;">Date</th><th style="padding:8px;">Lunch</th><th style="padding:8px;">Dinner</th>
        <th style="text-align:right; padding:8px;">Meal Cost</th><th style="text-align:right; padding:8px;">Shared Exp.</th>
        <th style="text-align:right; padding:8px;">Total</th></tr></thead>
      <tbody>${rows}
      <tr style="background:#EDF1F4; font-weight:700;"><td style="padding:8px;">Total</td>
        <td style="text-align:center; padding:8px;">${totalLunch}</td><td style="text-align:center; padding:8px;">${totalDinner}</td>
        <td style="text-align:right; padding:8px;">${fmtMoney(totalMealCost)}</td>
        <td style="text-align:right; padding:8px;">${fmtMoney(totalExpenseCost)}</td>
        <td style="text-align:right; padding:8px;">${fmtMoney(totalCost)}</td></tr></tbody>
    </table>
    ${reportSectionTitle('📋 Monthly Summary')}
    ${reportSummaryGrid([
      ['Total Lunch Meals', totalLunch, 'Total Dinner Meals', totalDinner],
      ['Total Meal Cost', fmtMoney(totalMealCost), 'Total Shared Expense', fmtMoney(totalExpenseCost)],
    ])}
    ${reportGrandTotalBar('Grand Total This Month', fmtMoney(totalCost))}
    ${avgRate!==null ? reportRateCallout('Your Average Meal Rate', `Total Cost ÷ Total Meals = ${fmtMoney(totalCost)} ÷ ${totalMeals}`, `${fmtMoney(avgRate)} / meal`, null) : ''}
    <div style="margin-top:14px; font-size:11px; color:#6B7280;">This report is personal — it only reflects your own meals and expense share, not other members'. Figures may change if entries are edited later.</div>`;
  return reportShell(body, `MessLedger — ${month}`);
}

/* ---------------- FULL MONTH REPORT — EVERYONE (Dashboard) ----------------
   Companion to the day report and the "mine only" month report: this one
   dumps the *entire* month for the *whole mess* in one printable page —
   per-member summary (meals/grocery/shared/deposits/balance/rate, same
   numbers as the Dashboard's monthly table) plus the raw grocery-cost,
   shared-expense, and deposit/withdrawal logs for the month, so it can be
   downloaded and archived or shared with the group. */
function buildFullMonthAllMembersReportHtml(month) {
  const groceryRate = monthMealRate(month);
  const monthGrocery = state.costs.filter(c => c.date.startsWith(month)).reduce((s, c) => s + Number(c.amount || 0), 0);
  const monthShared = monthTotalExpense(month);
  const monthDep = monthTotalDeposits(month);
  const monthWithdraw = monthTotalWithdrawals(month);
  const priorBalance = state.members.reduce((s, m) => s + openingBalance(m.id, month), 0);
  const combinedCost = monthGrocery + monthShared;
  const cashInHand = priorBalance + monthDep - monthWithdraw - combinedCost;
  const moneyTag = (v) => v >= 0 ? `<span style="color:#16A34A;">${fmtMoney(v)}</span>` : `<span style="color:#DC2626;">-${fmtMoney(Math.abs(v))}</span>`;

  // ---- Lunch/Dinner split per member for the month (from raw day records) ----
  const monthDateKeys = Object.keys(state.days).filter(k => k.startsWith(month)).sort();
  const memberLunchDinner = {};
  monthDateKeys.forEach(d => {
    const meals = (state.days[d] && state.days[d].meals) || {};
    Object.keys(meals).forEach(mid => {
      if (!memberLunchDinner[mid]) memberLunchDinner[mid] = { lunch: 0, dinner: 0 };
      memberLunchDinner[mid].lunch += meals[mid].lunch || 0;
      memberLunchDinner[mid].dinner += meals[mid].dinner || 0;
    });
  });

  // ---- Per-member monthly summary (mirrors Dashboard's month table, plus lunch/dinner split & highlight badges) ----
  const memberRows = state.members.map(m => {
    const ld = memberLunchDinner[m.id] || { lunch: 0, dinner: 0 };
    const meals = ld.lunch + ld.dinner;
    const cost = monthMemberMealCost(m.id, month);
    const dep = monthDeposit(m.id, month);
    const expShare = monthExpenseShare(m.id, month);
    const totalExpense = cost + expShare;
    const opening = openingBalance(m.id, month);
    const balance = opening + dep - totalExpense;
    const personalRate = meals > 0 ? totalExpense / meals : null;
    const inactive = !isMemberActiveInMonth(m.id, month);
    return { member: m, lunch: ld.lunch, dinner: ld.dinner, meals, cost, dep, expShare, totalExpense, opening, balance, personalRate, inactive };
  });
  const totalMeals = memberRows.reduce((s, r) => s + r.meals, 0);
  const totalLunchAll = memberRows.reduce((s, r) => s + r.lunch, 0);
  const totalDinnerAll = memberRows.reduce((s, r) => s + r.dinner, 0);
  const monthAvgRate = totalMeals > 0 ? combinedCost / totalMeals : null;
  const spendMax = memberRows.length ? Math.max(...memberRows.map(r => r.totalExpense)) : 0;
  const mealsMax = memberRows.length ? Math.max(...memberRows.map(r => r.meals)) : 0;
  const memberRowsHtml = memberRows.length ? memberRows.map((r, i) => {
    let badge = '';
    if (r.totalExpense > 0 && r.totalExpense === spendMax) badge = '💸 Top Spender';
    else if (r.meals > 0 && r.meals === mealsMax) badge = '🍽️ Most Meals';
    else if (r.personalRate !== null && monthAvgRate !== null && r.personalRate < monthAvgRate) badge = '🌱 Budget Friendly';
    return `
    <tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${reportAvatarNameCell(r.member.name)}${r.inactive ? ' <span style="font-size:9px; color:#9CA3AF;">(inactive)</span>' : ''}</td>
      <td style="text-align:center; padding:7px 8px;">${r.lunch}</td>
      <td style="text-align:center; padding:7px 8px;">${r.dinner}</td>
      <td style="text-align:center; padding:7px 8px;">${r.meals}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(r.cost)}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(r.expShare)}</td>
      <td style="text-align:right; padding:7px 8px; font-weight:700;">${fmtMoney(r.totalExpense)}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(r.dep)}</td>
      <td style="text-align:right; padding:7px 8px;">${moneyTag(r.opening)}</td>
      <td style="text-align:right; padding:7px 8px; font-weight:700;">${moneyTag(r.balance)}</td>
      <td style="text-align:right; padding:7px 8px;">${r.personalRate!==null?fmtMoney(r.personalRate):'—'}</td>
      <td style="padding:7px 8px; font-size:9.5px;">${badge}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="12" style="padding:10px 8px; color:#6B7280;">No members found.</td></tr>`;

  // ---- Mess-wide day-by-day breakdown for the month ----
  const dailyDateSet = new Set([
    ...monthDateKeys,
    ...state.costs.filter(c => c.date.startsWith(month)).map(c => c.date),
    ...state.expenses.filter(e => e.date.startsWith(month)).map(e => e.date)
  ]);
  const dailyDates = Array.from(dailyDateSet).sort();
  const dailyRows = dailyDates.map(d => {
    const mt = dayMealTotals(d);
    const dc = dayTotalCost(d);
    return { date: d, lunch: mt.lunch, dinner: mt.dinner, meals: mt.total, grocery: dc.grocery, shared: dc.shared, total: dc.total };
  });
  const nonZeroDaily = dailyRows.filter(d => d.total > 0);
  const priciestDay = nonZeroDaily.length ? nonZeroDaily.reduce((a, b) => b.total > a.total ? b : a) : null;
  const lightestDay = nonZeroDaily.length ? nonZeroDaily.reduce((a, b) => b.total < a.total ? b : a) : null;
  const dailyRowsHtml = dailyRows.length ? dailyRows.map((d, i) => {
    let tag = '';
    if (priciestDay && d.date === priciestDay.date && nonZeroDaily.length > 1) tag = '<div style="font-size:9px; color:#D97706; margin-top:2px;">🔥 Priciest day</div>';
    else if (lightestDay && d.date === lightestDay.date && nonZeroDaily.length > 1) tag = '<div style="font-size:9px; color:#16A34A; margin-top:2px;">🌱 Lightest day</div>';
    return `<tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${d.date}${tag}</td>
      <td style="text-align:center; padding:7px 8px;">${d.lunch}</td>
      <td style="text-align:center; padding:7px 8px;">${d.dinner}</td>
      <td style="text-align:center; padding:7px 8px;">${d.meals}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(d.grocery)}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(d.shared)}</td>
      <td style="text-align:right; padding:7px 8px; font-weight:600;">${fmtMoney(d.total)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="7" style="padding:10px 8px; color:#6B7280;">No activity recorded this month.</td></tr>`;

  // ---- Raw grocery-cost log for the month ----
  const costEntries = state.costs.filter(c => c.date.startsWith(month)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const costRowsHtml = costEntries.length ? costEntries.map((c, i) => `
    <tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${c.date}</td>
      <td style="padding:7px 8px;">${MEAL_TIME_LABEL[c.mealType || 'other'] || c.mealType || '—'}</td>
      <td style="padding:7px 8px;">${c.note || '—'}</td>
      <td style="padding:7px 8px;">${(memberById(c.purchasedBy)||{}).name || c.addedBy || '—'}</td>
      <td style="padding:7px 8px; font-size:9px; color:#6B7280;">${c.addedBy || '—'}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(Number(c.amount||0))}</td>
    </tr>`).join('') : `<tr><td colspan="6" style="padding:10px 8px; color:#6B7280;">No grocery costs logged this month.</td></tr>`;

  // ---- Raw shared-expense log for the month, with full per-member split detail ----
  const expenseEntries = state.expenses.filter(e => e.date.startsWith(month)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const expenseRowsHtml = expenseEntries.length ? expenseEntries.map((e, i) => {
    const splitLabel = e.memberIds.length === state.members.length ? 'Everyone' : `${e.memberIds.length} member(s)`;
    const isMealSplit = !!e.shares;
    const splitDetail = e.memberIds.map(mid => {
      const mm = memberById(mid);
      const share = expenseShareFor(e, mid);
      return `${mm?mm.name:'?'}: ${fmtMoney(share)}`;
    }).join(', ');
    return `<tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${e.date}</td>
      <td style="padding:7px 8px;">${e.title}${e.description ? `<div style="font-size:9px; color:#6B7280;">${e.description}</div>` : ''}</td>
      <td style="padding:7px 8px;">${splitLabel}${isMealSplit ? ' <span style="font-size:9px; color:#6B7280;">(by meal count)</span>' : ''}<div style="font-size:9px; color:#6B7280; margin-top:2px;">${splitDetail}</div></td>
      <td style="padding:7px 8px;">${e.addedBy || '—'}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(Number(e.amount||0))}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" style="padding:10px 8px; color:#6B7280;">No shared expenses logged this month.</td></tr>`;

  // ---- Raw deposit / withdrawal log for the month ----
  const depositEntries = state.deposits.filter(d => d.date.startsWith(month)).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const depositRowsHtml = depositEntries.length ? depositEntries.map((d, i) => `
    <tr style="${i%2? 'background:#F8F9FA;':''}">
      <td style="padding:7px 8px;">${d.date}</td>
      <td style="padding:7px 8px;">${(memberById(d.memberId)||{}).name || '—'}</td>
      <td style="padding:7px 8px;">${d.type === 'withdrawal' ? '🔻 Withdrawal' : '💰 Deposit'}</td>
      <td style="padding:7px 8px;">${d.note || '—'}</td>
      <td style="padding:7px 8px; font-size:9px; color:#6B7280;">${d.addedBy || '—'}</td>
      <td style="text-align:right; padding:7px 8px;">${fmtMoney(Number(d.amount||0))}</td>
    </tr>`).join('') : `<tr><td colspan="6" style="padding:10px 8px; color:#6B7280;">No deposits or withdrawals logged this month.</td></tr>`;

  const statStrip = `<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:6px;">
      ${reportStatBox('🛒 MONTHLY GROCERY RATE', `${fmtMoney(groceryRate)}/meal`, '#EEF2FF', '#C7D2FE')}
      ${reportStatBox('🍽️ TOTAL MEALS', `${totalMeals} (${totalLunchAll}L / ${totalDinnerAll}D)`, '#E7F6EC', '#BBE5C8')}
      ${reportStatBox('💵 TOTAL COST', fmtMoney(combinedCost), '#FEF3C7', '#F59E0B')}
      ${reportStatBox('👥 ACTIVE MEMBERS', activeMemberIdsForMonth(month).length, '#F3E8FF', '#DDD6FE')}
    </div>`;

  const body = `
    ${messLedgerReportHeader('Meal &amp; expense tracker — Full Month Report (Everyone)')}
    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:14px; flex-wrap:wrap; gap:6px;">
      <div style="font-size:18px; font-weight:700;">${month}</div>
      <div style="font-size:11.5px; color:#6B7280;">Generated ${formatBDDateTime(nowTimestamp())}</div>
    </div>
    ${statStrip}
    ${reportSectionTitle('📋 Month Summary')}
    ${reportSummaryGrid([
      ['Total Grocery Cost', fmtMoney(monthGrocery), 'Total Shared Expenses', fmtMoney(monthShared)],
      ['Total Cost (Grocery + Shared)', fmtMoney(combinedCost), 'Total Deposit', fmtMoney(monthDep)],
      ['Total Withdrawal', fmtMoney(monthWithdraw), 'Prior Balance (carried in)', (priorBalance>=0?'':'-')+fmtMoney(Math.abs(priorBalance))],
      ['Cash in Hand (end of month)', (cashInHand>=0?'':'-')+fmtMoney(Math.abs(cashInHand)), 'Grocery Cost Entries', String(costEntries.length)],
      ['Shared Expense Entries', String(expenseEntries.length), 'Deposit/Withdrawal Entries', String(depositEntries.length)],
    ])}
    ${monthAvgRate!==null ? reportRateCallout('Month Average Meal Rate', `Total Cost ÷ Total Meals = ${fmtMoney(combinedCost)} ÷ ${totalMeals}`, `${fmtMoney(monthAvgRate)} / meal`, null) : ''}
    ${reportSectionTitle('👥 Per-Member Summary')}
    <table style="font-size:10px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:7px 8px;">Member</th><th style="padding:7px 8px;">Lunch</th><th style="padding:7px 8px;">Dinner</th>
        <th style="padding:7px 8px;">Meals</th>
        <th style="text-align:right; padding:7px 8px;">Grocery Cost</th><th style="text-align:right; padding:7px 8px;">Shared Exp.</th>
        <th style="text-align:right; padding:7px 8px;">Total Exp.</th><th style="text-align:right; padding:7px 8px;">Deposits</th>
        <th style="text-align:right; padding:7px 8px;">Prior Bal.</th><th style="text-align:right; padding:7px 8px;">Balance</th>
        <th style="text-align:right; padding:7px 8px;">Rate</th><th style="text-align:left; padding:7px 8px;">Highlight</th></tr></thead>
      <tbody>${memberRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;">
        <td style="padding:7px 8px;">Total</td>
        <td style="text-align:center; padding:7px 8px;">${totalLunchAll}</td>
        <td style="text-align:center; padding:7px 8px;">${totalDinnerAll}</td>
        <td style="text-align:center; padding:7px 8px;">${totalMeals}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthGrocery)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthShared)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(combinedCost)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthDep)}</td>
        <td colspan="4" style="text-align:right; padding:7px 8px;">—</td>
      </tr></tbody>
    </table>
    ${reportSectionTitle('📅 Day-by-Day Breakdown (Whole Mess)')}
    <table style="font-size:10.5px; margin-bottom:12px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:7px 8px;">Date</th><th style="padding:7px 8px;">Lunch</th><th style="padding:7px 8px;">Dinner</th>
        <th style="padding:7px 8px;">Meals</th><th style="text-align:right; padding:7px 8px;">Grocery</th>
        <th style="text-align:right; padding:7px 8px;">Shared</th><th style="text-align:right; padding:7px 8px;">Total</th></tr></thead>
      <tbody>${dailyRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;">
        <td style="padding:7px 8px;">Total</td>
        <td style="text-align:center; padding:7px 8px;">${totalLunchAll}</td>
        <td style="text-align:center; padding:7px 8px;">${totalDinnerAll}</td>
        <td style="text-align:center; padding:7px 8px;">${totalMeals}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthGrocery)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthShared)}</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(combinedCost)}</td>
      </tr></tbody>
    </table>
    ${reportSectionTitle('🛒 Grocery Cost Log')}
    <table style="font-size:10.5px; margin-bottom:12px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:7px 8px;">Date</th><th style="text-align:left; padding:7px 8px;">Meal</th>
        <th style="text-align:left; padding:7px 8px;">Note</th><th style="text-align:left; padding:7px 8px;">Purchased By</th>
        <th style="text-align:left; padding:7px 8px;">Logged By</th>
        <th style="text-align:right; padding:7px 8px;">Amount</th></tr></thead>
      <tbody>${costRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;"><td colspan="5" style="padding:7px 8px;">Total</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthGrocery)}</td></tr></tbody>
    </table>
    ${reportSectionTitle('🧾 Shared Expense Log (with split detail)')}
    <table style="font-size:10.5px; margin-bottom:12px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:7px 8px;">Date</th><th style="text-align:left; padding:7px 8px;">Title</th>
        <th style="text-align:left; padding:7px 8px;">Split (who owes what)</th><th style="text-align:left; padding:7px 8px;">Added By</th>
        <th style="text-align:right; padding:7px 8px;">Amount</th></tr></thead>
      <tbody>${expenseRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;"><td colspan="4" style="padding:7px 8px;">Total</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthShared)}</td></tr></tbody>
    </table>
    ${reportSectionTitle('💰 Deposit / Withdrawal Log')}
    <table style="font-size:10.5px;">
      <thead><tr style="background:${REPORT_HEADER_BG}; color:#fff;">
        <th style="text-align:left; padding:7px 8px;">Date</th><th style="text-align:left; padding:7px 8px;">Member</th>
        <th style="text-align:left; padding:7px 8px;">Type</th><th style="text-align:left; padding:7px 8px;">Note</th>
        <th style="text-align:left; padding:7px 8px;">Added By</th>
        <th style="text-align:right; padding:7px 8px;">Amount</th></tr></thead>
      <tbody>${depositRowsHtml}
      <tr style="background:#EDF1F4; font-weight:700;"><td colspan="5" style="padding:7px 8px;">Net (Deposits − Withdrawals)</td>
        <td style="text-align:right; padding:7px 8px;">${fmtMoney(monthDep - monthWithdraw)}</td></tr></tbody>
    </table>
    ${reportGrandTotalBar('Grand Total Month Cost (Grocery + Shared)', fmtMoney(combinedCost))}
    <div style="margin-top:14px; font-size:11px; color:#6B7280;">This report covers every member for ${month} — meals (lunch/dinner split), grocery costs, shared expenses (with full split breakdown), and deposits/withdrawals, plus a day-by-day and per-member summary. Figures may change if entries are edited after this export.</div>`;
  return reportShell(body, `MessLedger — ${month} — Everyone`);
}

function downloadFullMonthAllMembersReport() {
  openPrintableReport(buildFullMonthAllMembersReportHtml(currentMonth));
}

function downloadDailyMealRateReport() {
  const input = document.getElementById('personal-report-date');
  const dateStr = (input && input.value) || todayStr();
  openPrintableReport(buildAllMembersDayReportHtml(dateStr));
}

function downloadPersonalMonthReport() {
  openPrintableReport(buildPersonalMonthReportHtml(currentMonth));
}

/* ---------------- COMPACT TABLES: "VIEW DETAILS" MODAL ----------------
   Shared by the History (Shared Expense Deductions), Grocery Costs, and
   Shared Expenses tables below. Those tables now show only the compact,
   glanceable columns a row needs (kept to a fixed ~64px row height); every
   long or secondary field (full description, complete split list, full
   recorded timestamp, calculation breakdown, etc.) moved in here instead of
   being dropped — nothing that used to be visible is gone, it's one click
   away via "View Details". */
/* ===== 12-history.js ===== */
// ---------------------------------------------------------------------------
// 12-history.js  (originally app.js lines 4711-4932)
// Details modal, combined activity history table (renderHistory) and its handlers
// ---------------------------------------------------------------------------
let _detailsModalStylesInjected = false;

function injectDetailsModalStyles() {
  if (_detailsModalStylesInjected) return;
  _detailsModalStylesInjected = true;
  const style = document.createElement('style');
  style.id = 'details-modal-styles';
  style.textContent = `
    #details-modal-overlay{position:fixed; inset:0; z-index:9998; display:none; align-items:center; justify-content:center; padding:16px;}
    #details-modal-overlay .details-modal-backdrop{position:absolute; inset:0; background:rgba(15,23,42,0.55); backdrop-filter:blur(1.5px);}
    #details-modal-overlay .details-modal-box{position:relative; width:100%; max-width:460px; max-height:82vh; overflow-y:auto; background:var(--surface); color:var(--ink); border-radius:14px; padding:22px 22px 18px; box-shadow:0 20px 60px rgba(0,0,0,0.35); animation:detailsModalPop .16s ease-out;}
    @keyframes detailsModalPop{ from{opacity:0; transform:translateY(10px) scale(.98);} to{opacity:1; transform:translateY(0) scale(1);} }
    #details-modal-overlay .details-modal-close{position:absolute; top:12px; right:12px; background:none; border:none; font-size:20px; line-height:1; cursor:pointer; color:var(--ink); opacity:0.5; padding:6px;}
    #details-modal-overlay .details-modal-close:hover{opacity:1;}
    #details-modal-overlay h3{margin:0 26px 14px 0; font-size:17px;}
    #details-modal-overlay .detail-row{display:flex; justify-content:space-between; gap:16px; padding:9px 0; border-bottom:1px dashed var(--border); font-size:13.5px; line-height:1.4;}
    #details-modal-overlay .detail-row:last-child{border-bottom:none;}
    #details-modal-overlay .detail-label{color:var(--ink-faint); flex-shrink:0; padding-top:1px;}
    #details-modal-overlay .detail-value{text-align:right; font-weight:600; word-break:break-word;}
  `;
  document.head.appendChild(style);
}

function openDetailsModal(title, bodyHtml) {
  injectDetailsModalStyles();
  let overlay = document.getElementById('details-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'details-modal-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="details-modal-backdrop" onclick="closeDetailsModal()"></div>
    <div class="details-modal-box" role="dialog" aria-modal="true">
      <button class="details-modal-close" onclick="closeDetailsModal()" aria-label="Close">✕</button>
      <h3>${title}</h3>
      ${bodyHtml}
    </div>`;
  overlay.style.display = 'flex';
  document.addEventListener('keydown', _detailsModalEscHandler);
}

function _detailsModalEscHandler(e) {
  if (e.key === 'Escape') closeDetailsModal();
}

function closeDetailsModal() {
  const overlay = document.getElementById('details-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  document.removeEventListener('keydown', _detailsModalEscHandler);
}
// Renders one label/value line in the modal; skips rendering entirely for
// empty/undefined values instead of showing a blank row.
function detailRow(label, valueHtml) {
  if (valueHtml === undefined || valueHtml === null || valueHtml === '') return '';
  return `<div class="detail-row"><div class="detail-label">${label}</div><div class="detail-value">${valueHtml}</div></div>`;
}
// Compact method badge — 🟢 Split Equally / 🟠 Meal Count / 🔵 Specific
// Members — replaces the old longer-text badge in the tables below (the
// full explanatory sentence, e.g. "Charge based on meal count (Lunch)",
// still shows in that record's View Details modal via expenseMethodLabel()).
function expenseMethodBadge(splitType, mealTypeSplit, isEveryoneFallback) {
  const isSelected = splitType === 'selected' || (!splitType && !isEveryoneFallback);
  if (splitType === 'meal') return `<span class="method-badge method-badge-amber">🟠 Meal Count</span>`;
  if (isSelected) return `<span class="method-badge method-badge-blue">🔵 Specific Members</span>`;
  return `<span class="method-badge method-badge-green">🟢 Split Equally</span>`;
}
// Compact meal badge — Lunch / Dinner / Both / Other — used for grocery
// cost's meal, and for a shared expense's meal when it's a meal-count split.
const MEAL_BADGE_STYLE = {
  lunch:  { cls: 'meal-badge-amber',  label: 'Lunch' },
  dinner: { cls: 'meal-badge-indigo', label: 'Dinner' },
  both:   { cls: 'meal-badge-purple', label: 'Both' },
  other:  { cls: 'meal-badge-slate',  label: 'Other/Grocery' }
};

function mealBadge(mealType) {
  const c = MEAL_BADGE_STYLE[mealType] || MEAL_BADGE_STYLE.other;
  return `<span class="meal-badge ${c.cls}">${c.label}</span>`;
}
// Truncates for a single-line, fixed-height table cell; full text always
// available via the title="" tooltip and in View Details.
function truncateCell(text, maxChars) {
  const t = text || '';
  const shown = t.length > maxChars ? t.slice(0, maxChars) + '…' : t;
  return `<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(t)}">${escapeHtml(shown) || '<span class="small-note" style="margin:0;">—</span>'}</div>`;
}
// Fixed row height (spec: 60–72px) applied consistently across all three
// redesigned tables below, regardless of how much text is in any cell.
const COMPACT_ROW_STYLE = 'height:64px;';
const COMPACT_CELL_STYLE = 'height:64px; vertical-align:middle;';

/* ---------------- Grocery / Shared-expense search boxes ----------------
   Same search-then-refocus pattern already used by costsSearch/expensesSearch/
   depositsSearch elsewhere in the app — filters the table below it only,
   the four stat cards up top stay scoped to the whole month/all-time regardless. */
let historyGrocerySearch = '';
let historyExpenseSearch = '';
// Populated fresh on every renderHistory() call so the CSV export buttons can
// read exactly what's currently on screen (post-search-filter) without
// re-deriving it. Expense side reuses _histExpDetailsCache (00-utils-core.js),
// which already holds this for the "View Details" buttons.
let _histMealRowsCache = [];

function setHistoryGrocerySearch(val) {
  historyGrocerySearch = val;
  renderTabContent();
  const el = document.getElementById('history-grocery-search');
  if (el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

function setHistoryExpenseSearch(val) {
  historyExpenseSearch = val;
  renderTabContent();
  const el = document.getElementById('history-expense-search');
  if (el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

// Small colored icon-card used for the four top stat tiles (Grocery Deductions /
// Expense Deductions / Deposits / Withdrawn). `tone` picks which existing
// design-token pair paints the icon (no new colors introduced). `trendHtml`
// is only passed in month view — All Time has no "previous period" to compare against.
const HISTORY_STAT_TONE = {
  meal: {
    bg: 'var(--meals-purple-bg)',
    fg: 'var(--meals-purple)',
    icon: 'fa-utensils'
  },
  expense: {
    bg: 'var(--danger-bg)',
    fg: 'var(--danger)',
    icon: 'fa-file-invoice-dollar'
  },
  deposit: {
    bg: 'var(--success-bg)',
    fg: 'var(--success)',
    icon: 'fa-circle-down'
  },
  withdraw: {
    bg: 'var(--meals-amber-bg)',
    fg: 'var(--meals-amber)',
    icon: 'fa-circle-up'
  }
};

function historyStatCard(tone, label, valueHtml, trendHtml) {
  const t = HISTORY_STAT_TONE[tone];
  return `
    <div class="hist-stat-card">
      <div class="hist-stat-icon" style="background:${t.bg}; color:${t.fg};"><i class="fas ${t.icon}"></i></div>
      <div class="label">${label}</div>
      <div class="value">${valueHtml}</div>
      ${trendHtml ? `<div class="hist-stat-sub">${trendHtml}</div>` : ''}
    </div>`;
}

// curr/prev are both already-positive magnitudes (deductions, deposits,
// withdrawals are all summed as positive numbers before reaching here).
function historyTrendHtml(curr, prev) {
  if (curr === prev) return `<span class="hist-trend">0% <span class="small-note" style="margin:0;">vs last month</span></span>`;
  if (prev === 0) return `<span class="hist-trend trend-up"><i class="fas fa-arrow-up"></i> New</span> <span class="small-note" style="margin:0;">vs last month</span>`;
  const pct = ((curr - prev) / prev) * 100;
  const up = pct > 0;
  return `<span class="hist-trend ${up ? 'trend-up' : 'trend-down'}"><i class="fas fa-arrow-${up ? 'up' : 'down'}"></i> ${Math.abs(pct).toFixed(1)}%</span> <span class="small-note" style="margin:0;">vs last month</span>`;
}

function _historyCsvExport(filename, header, rows) {
  const csv = [header, ...rows].map(r => r.map(v => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], {
    type: 'text/csv;charset=utf-8;'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadHistoryGroceryCSV() {
  if (!_histMealRowsCache.length) {
    showToast('No grocery deductions to export.', 'success');
    return;
  }
  const header = ['Date', 'Meal Type', 'Qty', 'Rate', 'Deducted', 'Balance Before', 'Balance After', 'Recorded At'];
  const rows = _histMealRowsCache.map(e => [e.date, MEAL_TYPE_LABEL[e.mealType], e.qty, e.rate, e.amount, e.balanceBefore, e.balanceAfter, formatBDDateTime(e.createdAt)]);
  const selMember = memberById(historyMemberId);
  _historyCsvExport(`grocery-deductions-${selMember ? selMember.name.replace(/\s+/g, '-').toLowerCase() : historyMemberId}-${historyViewMode === 'month' ? currentMonth : 'all-time'}.csv`, header, rows);
}

function downloadHistoryExpenseCSV() {
  if (!_histExpDetailsCache.length) {
    showToast('No shared-expense deductions to export.', 'success');
    return;
  }
  const header = ['Date', 'Title', 'Amount', 'Method', 'Balance Before', 'Balance After'];
  const rows = _histExpDetailsCache.map(e => [e.date, e.title, e.amount, expenseMethodLabel(e.splitType, e.mealTypeSplit, e.isEveryoneFallback), e.balanceBefore, e.balanceAfter]);
  const selMember = memberById(historyMemberId);
  _historyCsvExport(`shared-expense-deductions-${selMember ? selMember.name.replace(/\s+/g, '-').toLowerCase() : historyMemberId}-${historyViewMode === 'month' ? currentMonth : 'all-time'}.csv`, header, rows);
}

// Jumps to the Deposits tab and focuses/pre-fills the matching form (Add
// Deposit or Withdraw Funds) for whoever's history is currently open —
// the actual add-deposit/add-withdrawal forms live on that tab, not here.
async function goHistoryAddDeposit(type) {
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    showToast('You are not authorized to do this.', 'error');
    return;
  }
  await setTab('deposits');
  setTimeout(() => {
    const memberSel = document.getElementById(type === 'withdrawal' ? 'wd-member' : 'dep-member');
    if (memberSel && historyMemberId) {
      memberSel.value = historyMemberId;
      memberSel.dispatchEvent(new Event('change'));
    }
    const amountInput = document.getElementById(type === 'withdrawal' ? 'wd-amount' : 'dep-amount');
    if (amountInput) amountInput.focus();
  }, 60);
}

function renderHistory() {
  const canViewOthers = session.role === 'admin' || session.role === 'superadmin';
  const showTimeCol = shouldShowRecordedAt();
  if (!historyMemberId) historyMemberId = session.userId;
  const selectBox = canViewOthers ? `
    <div style="margin-bottom:14px;">
      <label style="margin:0 0 5px;">View history for</label>
      <select id="history-member-select">
        ${state.members.map(m=>`<option value="${m.id}" ${m.id===historyMemberId?'selected':''}>${m.name}${m.id===session.userId?' (You)':''}</option>`).join('')}
      </select>
    </div>` : '';
  const ledger = buildMemberLedger(historyMemberId);
  const scopedLedger = historyViewMode === 'month' ? ledger.filter(e => e.date.startsWith(currentMonth)) : ledger;
  const mealRows = scopedLedger.filter(e => e.kind === 'meal').slice().reverse();
  const expenseRows = scopedLedger.filter(e => e.kind === 'expense').slice().reverse();
  const depositRows = scopedLedger.filter(e => e.kind === 'deposit').slice().reverse();

  // Search only narrows what's shown in that table — totals/trend cards
  // above stay scoped to the whole month/all-time regardless of a search.
  const gq = historyGrocerySearch.trim().toLowerCase();
  const mealRowsShown = gq ? mealRows.filter(e => e.date.includes(gq) || (MEAL_TYPE_LABEL[e.mealType] || '').toLowerCase().includes(gq)) : mealRows;
  const eq = historyExpenseSearch.trim().toLowerCase();
  const expenseRowsShown = eq ? expenseRows.filter(e => e.date.includes(eq) || (e.title || '').toLowerCase().includes(eq) || expenseMethodLabel(e.splitType, e.mealTypeSplit, e.isEveryoneFallback).toLowerCase().includes(eq)) : expenseRows;

  _histMealRowsCache = mealRowsShown;
  const mealTable = mealRowsShown.length ? `
    <table class="hist-native-table"><thead><tr><th>Date</th><th>Meal Type</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Deducted</th><th class="num">Balance Before</th><th class="num">Balance After</th>${showTimeCol?'<th>Recorded At</th>':''}</tr></thead>
    <tbody>${mealRowsShown.map(e=>`<tr style="${COMPACT_ROW_STYLE}">
      <td class="mono" style="${COMPACT_CELL_STYLE}">${e.date}</td>
      <td style="${COMPACT_CELL_STYLE}">${mealBadge(e.mealType)}</td>
      <td class="num" style="${COMPACT_CELL_STYLE}">${e.qty}</td>
      <td class="num" style="${COMPACT_CELL_STYLE}">${fmtMoney(e.rate)}</td>
      <td class="num neg" style="${COMPACT_CELL_STYLE}">-${fmtMoney(e.amount)}</td>
      <td class="num ${e.balanceBefore<0?'neg':'pos'}" style="${COMPACT_CELL_STYLE}">${fmtMoney(e.balanceBefore)}</td>
      <td class="num ${e.balanceAfter<0?'neg':'pos'}" style="${COMPACT_CELL_STYLE}">${fmtMoney(e.balanceAfter)}</td>
      ${showTimeCol?`<td class="small-note" style="${COMPACT_CELL_STYLE} margin:0;">${formatBDDateTime(e.createdAt)}</td>`:''}
    </tr>`).join('')}</tbody></table>` : `<div class="hist-empty-box"><div class="hist-empty-icon"><i class="fas fa-basket-shopping"></i></div><div class="hist-empty-title">${gq ? 'No matching records.' : `No meal deductions ${historyViewMode==='month'?'this month':'yet'}.`}</div></div>`;

  _histExpDetailsCache = [];
  const expenseTable = expenseRowsShown.length ? `
    <table class="hist-native-table"><thead><tr><th>Date</th><th>Title</th><th class="num">Amount</th><th>Method</th><th class="num">Balance</th>${showTimeCol?'<th>Recorded</th>':''}<th></th></tr></thead>
    <tbody>${expenseRowsShown.map((e,i)=>{
      _histExpDetailsCache[i] = e;
      return `<tr style="${COMPACT_ROW_STYLE}">
      <td class="mono" style="${COMPACT_CELL_STYLE}">${e.date}</td>
      <td style="${COMPACT_CELL_STYLE} max-width:170px;">${truncateCell(e.title, 22)}</td>
      <td class="num neg" style="${COMPACT_CELL_STYLE}">-${fmtMoney(e.amount)}</td>
      <td style="${COMPACT_CELL_STYLE}">${expenseMethodBadge(e.splitType, e.mealTypeSplit, e.isEveryoneFallback)}</td>
      <td class="num" style="${COMPACT_CELL_STYLE} white-space:nowrap;"><span class="${e.balanceBefore<0?'neg':'pos'}">${fmtMoney(e.balanceBefore)}</span> → <span class="${e.balanceAfter<0?'neg':'pos'}">${fmtMoney(e.balanceAfter)}</span></td>
      ${showTimeCol?`<td class="small-note" style="${COMPACT_CELL_STYLE} margin:0;">${formatBDDate(e.createdAt)}</td>`:''}
      <td style="${COMPACT_CELL_STYLE}"><button class="btn secondary" style="margin:0; padding:5px 10px; font-size:12px;" onclick="showHistoryExpenseDetail(${i})">View Details</button></td>
    </tr>`;
    }).join('')}</tbody></table>` : `<div class="hist-empty-box"><div class="hist-empty-icon" style="background:var(--primary-bg); color:var(--primary);"><i class="fas fa-receipt"></i></div><div class="hist-empty-title">${eq ? 'No matching records.' : `No shared-expense deductions ${historyViewMode==='month'?'this month yet':'yet'}.`}</div></div>`;

  const depositTable = depositRows.length ? `
    <table><thead><tr><th>Date</th><th>Type</th><th>Note</th><th class="num">Amount</th><th class="num">Balance Before</th><th class="num">Balance After</th>${showTimeCol?'<th>Recorded At</th>':''}</tr></thead>
    <tbody>${depositRows.map(d=>`<tr>
      <td class="mono">${d.date}</td>
      <td>${d.type==='withdrawal'?'Withdrawal':'Deposit'}</td>
      <td>${d.note||'-'}</td>
      <td class="num ${d.amount<0?'neg':'pos'}">${d.amount<0?'-':'+'}${fmtMoney(Math.abs(d.amount))}</td>
      <td class="num ${d.balanceBefore<0?'neg':'pos'}">${fmtMoney(d.balanceBefore)}</td>
      <td class="num ${d.balanceAfter<0?'neg':'pos'}">${fmtMoney(d.balanceAfter)}</td>
      ${showTimeCol?`<td class="small-note" style="margin:0;">${formatBDDateTime(d.createdAt)}</td>`:''}
    </tr>`).join('')}</tbody></table>` : `
    <div class="hist-empty-box">
      <div class="hist-empty-icon" style="background:var(--success-bg); color:var(--success);"><i class="fas fa-wallet"></i></div>
      <div class="hist-empty-title">No deposits or withdrawals ${historyViewMode==='month'?'this month':'yet'}.</div>
      <div class="hist-empty-sub">All your deposit and withdrawal transactions will appear here.</div>
    </div>`;

  const selMember = memberById(historyMemberId);
  const scopeLabel = historyViewMode === 'month' ? currentMonth : 'all time';
  const mealTotal = mealRows.reduce((s, e) => s + e.amount, 0);
  const expenseTotal = expenseRows.reduce((s, e) => s + e.amount, 0);
  const depositTotal = depositRows.filter(d => d.amount > 0).reduce((s, d) => s + d.amount, 0);
  const withdrawalTotal = depositRows.filter(d => d.amount < 0).reduce((s, d) => s + Math.abs(d.amount), 0);

  // Trend vs. previous month — only meaningful in month view (All Time has
  // no single "previous period" to compare against, so the cards drop the
  // sub-line entirely in that mode).
  let trendMeal = '', trendExpense = '', trendDeposit = '', trendWithdraw = '';
  if (historyViewMode === 'month') {
    const prevMonth = shiftMonthStr(currentMonth, -1);
    const prevLedger = ledger.filter(e => e.date.startsWith(prevMonth));
    const prevMealTotal = prevLedger.filter(e => e.kind === 'meal').reduce((s, e) => s + e.amount, 0);
    const prevExpenseTotal = prevLedger.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
    const prevDepositTotal = prevLedger.filter(e => e.kind === 'deposit' && e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const prevWithdrawalTotal = prevLedger.filter(e => e.kind === 'deposit' && e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0);
    trendMeal = historyTrendHtml(mealTotal, prevMealTotal);
    trendExpense = historyTrendHtml(expenseTotal, prevExpenseTotal);
    trendDeposit = historyTrendHtml(depositTotal, prevDepositTotal);
    trendWithdraw = historyTrendHtml(withdrawalTotal, prevWithdrawalTotal);
  }

  const mealRecordNote = gq ? `${mealRowsShown.length} of ${mealRows.length} records` : `Total Records: ${mealRows.length}`;
  const expenseRecordNote = eq ? `${expenseRowsShown.length} of ${expenseRows.length} records` : `Total Records: ${expenseRows.length}`;

  return `
    <div class="card">
      <div class="hist-header-row">
        <div>
          <h2>History — <span class="hist-name">${selMember?escapeHtml(selMember.name):''}</span></h2>
          <div class="small-note" style="margin-bottom:0;">Every meal and shared-expense deduction for ${scopeLabel}, most recent first.${showTimeCol ? ' Exact recording time (Bangladesh time) is shown below.' : ''}</div>
        </div>
        <div class="hist-month-controls">
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(-1, setHistoryView)" title="Previous month">‹</button>
          <button class="btn secondary ${historyViewMode==='month'?'active-toggle':''}" style="margin-top:0;" onclick="setHistoryView('month')"><i class="fas fa-calendar" style="margin-right:6px;"></i>${currentMonth}</button>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(1, setHistoryView)" title="Next month">›</button>
          <button class="btn secondary ${historyViewMode==='all'?'active-toggle':''}" style="margin-top:0;" onclick="setHistoryView('all')"><i class="fas fa-clock-rotate-left" style="margin-right:6px;"></i>All Time</button>
        </div>
      </div>
      ${selectBox}
      <div class="hist-stat-grid">
        ${historyStatCard('meal', 'Grocery Deductions', `<span class="neg">${fmtMoney(mealTotal)}</span>`, trendMeal)}
        ${historyStatCard('expense', 'Expense Deductions', `<span class="neg">${fmtMoney(expenseTotal)}</span>`, trendExpense)}
        ${historyStatCard('deposit', 'Deposits', `<span class="pos">${fmtMoney(depositTotal)}</span>`, trendDeposit)}
        ${historyStatCard('withdraw', 'Withdrawn', `<span class="${withdrawalTotal>0?'neg':''}">${fmtMoney(withdrawalTotal)}</span>`, trendWithdraw)}
      </div>
    </div>
    <div class="card keep-native-tables">
      <div class="hist-section-head">
        <div class="hist-section-title">
          <div class="hist-section-icon icon-grocery"><i class="fas fa-basket-shopping"></i></div>
          <h2>Grocery Deductions</h2>
        </div>
        <div class="hist-section-tools">
          <div class="hist-search-wrap"><i class="fas fa-search"></i><input type="text" id="history-grocery-search" class="search-input" style="width:auto;" placeholder="Search by meal type..." value="${historyGrocerySearch.replace(/"/g,'&quot;')}" oninput="setHistoryGrocerySearch(this.value)"></div>
          <button type="button" class="btn secondary hist-icon-btn" title="Search filters the list below" onclick="document.getElementById('history-grocery-search').focus()"><i class="fas fa-filter"></i></button>
          <button type="button" class="btn secondary hist-icon-btn" title="Download as CSV" onclick="downloadHistoryGroceryCSV()"><i class="fas fa-download"></i></button>
        </div>
      </div>
      <div class="table-responsive">${mealTable}</div>
      <div class="hist-total-note"><i class="fas fa-file-lines"></i>${mealRecordNote}</div>
    </div>
    <div class="card keep-native-tables">
      <div class="hist-section-head">
        <div class="hist-section-title">
          <div class="hist-section-icon icon-expense"><i class="fas fa-users"></i></div>
          <h2>Shared Expense Deductions</h2>
        </div>
        <div class="hist-section-tools">
          <div class="hist-search-wrap"><i class="fas fa-search"></i><input type="text" id="history-expense-search" class="search-input" style="width:auto;" placeholder="Search by title..." value="${historyExpenseSearch.replace(/"/g,'&quot;')}" oninput="setHistoryExpenseSearch(this.value)"></div>
          <button type="button" class="btn secondary hist-icon-btn" title="Search filters the list below" onclick="document.getElementById('history-expense-search').focus()"><i class="fas fa-filter"></i></button>
          <button type="button" class="btn secondary hist-icon-btn" title="Download as CSV" onclick="downloadHistoryExpenseCSV()"><i class="fas fa-download"></i></button>
        </div>
      </div>
      <div class="table-responsive">${expenseTable}</div>
      <div class="hist-total-note"><i class="fas fa-file-lines"></i>${expenseRecordNote}</div>
    </div>
    <div class="card keep-native-tables">
      <div class="hist-section-head">
        <div class="hist-section-title">
          <div class="hist-section-icon icon-wallet"><i class="fas fa-wallet"></i></div>
          <h2>Deposits &amp; Withdrawals</h2>
        </div>
        <div class="hist-section-tools">
          ${(session.role === 'admin' || session.role === 'superadmin') ? `
          <button type="button" class="btn secondary" style="margin-top:0; color:var(--success); border-color:var(--success);" onclick="goHistoryAddDeposit('deposit')"><i class="fas fa-plus" style="margin-right:6px;"></i>Add Deposit</button>
          <button type="button" class="btn secondary" style="margin-top:0; color:var(--danger); border-color:var(--danger);" onclick="goHistoryAddDeposit('withdrawal')"><i class="fas fa-plus" style="margin-right:6px;"></i>Add Withdrawal</button>
          ` : ''}
        </div>
      </div>
      <div class="table-responsive">${depositTable}</div>
    </div>`;
}

function setHistoryView(mode) {
  historyViewMode = mode;
  renderTabContent();
}

function attachHistoryHandlers() {
  const sel = document.getElementById('history-member-select');
  if (sel) {
    sel.addEventListener('change', e => {
      historyMemberId = e.target.value;
      renderTabContent();
    });
  }
}

/* ---------------- GROCERY COSTS ---------------- */
/* ===== 13-costs.js ===== */
// ---------------------------------------------------------------------------
// 13-costs.js  (originally app.js lines 4933-5163)
// Grocery cost tab: detail view, draft form state, renderCosts, add/delete cost
// ---------------------------------------------------------------------------
let costsViewMode = 'month';
// Populated fresh on every renderCosts() call — see _histExpDetailsCache above.
let _costsDetailsCache = [];

function showCostDetail(i) {
  const c = _costsDetailsCache[i];
  if (!c) return;
  const body = `
    ${detailRow('Date', c.date)}
    ${detailRow('Meal', mealBadge(c.mealType||'other'))}
    ${detailRow('Amount', fmtMoney(c.amount))}
    ${detailRow('Added By', escapeHtml(c.addedBy||''))}
    ${detailRow('Purchased By', escapeHtml(c.purchasedBy ? (memberById(c.purchasedBy)?.name || 'Unknown member') : (c.addedBy || 'Not recorded')))}
    ${detailRow('Full Note', c.note ? escapeHtml(c.note) : '<span class="small-note" style="margin:0;">No note added</span>')}
    ${shouldShowRecordedAt() ? detailRow('Recorded At', formatBDDateTime(c.createdAt)) : ''}
    ${c.editedAt ? detailRow('Last Edited By', escapeHtml(c.editedBy||'')) : ''}
    ${c.editedAt ? detailRow('Last Edited At', formatBDDateTime(c.editedAt)) : ''}
  `;
  openDetailsModal('Grocery Cost Details', body);
}
// Keeps whatever's been typed into the "Add Grocery Cost" form across any
// re-render (switching tabs away and back, or a live realtime-sync update
// arriving while the form is sitting there half-filled) — previously these
// fields were always rendered blank from scratch, so anything typed but not
// yet submitted could vanish on its own.
let costFormDraft = {
  date: '',
  mealtype: 'lunch',
  amount: '',
  note: '',
  purchasedby: '' // member id — empty means "not manually chosen yet", so the form keeps auto-defaulting to that date's market-duty member as the date changes (see defaultPurchaserIdForDate below)
};

function updateCostDraft(field, value) {
  costFormDraft[field] = value;
}
// Called when the Meal selector changes — re-renders so the "Purchased By"
// default (which depends on both date AND meal, see
// defaultPurchaserIdForDate) updates live, e.g. switching from Lunch to
// Dinner should suggest whoever's actually on dinner duty. Skipped once the
// member has manually picked a purchaser (costFormDraft.purchasedby is
// set) — at that point the default no longer applies anyway, so there's
// nothing to refresh and no reason to disturb the rest of the form.
function refreshCostPurchasedByDefault() {
  if (costFormDraft.purchasedby) return;
  renderTabContent();
}
// Grocery cost (and Shared Expense's "Charge based on meal count" split, see
// 14-expenses.js) is usually bought by whoever's on market duty that day,
// but sometimes someone else picks it up instead — "Purchased By" (separate
// from "Added By", which is just whoever is logged in and typing the entry)
// exists specifically to record that. Defaults to the member scheduled for
// market duty on the given date AND meal (state.members[].marketDay is the
// weekly day, marketShift is lunch/dinner/both — so picking "Dinner" here
// suggests whoever's actually on dinner duty, not a lunch-only person
// scheduled the same day), falling back to whoever's on duty that day
// regardless of shift (covers "Other/Grocery", which has no meal to match),
// and finally to whoever's currently logged in if nobody's scheduled at
// all. Purely a suggestion for the dropdown's default selection — whichever
// member is actually selected when Add is clicked is what gets saved,
// regardless of whether they matched this default or were changed.
function defaultPurchaserIdForDate(dateStr, mealType) {
  if (dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    if (!isNaN(d)) {
      const weekday = d.getDay(); // 0=Sunday, matching WEEKDAYS/member.marketDay
      let dutyMember = null;
      if (mealType === 'lunch' || mealType === 'dinner') {
        dutyMember = (state.members || []).find(m => hasMarketDay(m) && Number(m.marketDay) === weekday && (m.marketShift === 'both' || m.marketShift === mealType));
      }
      if (!dutyMember) {
        dutyMember = (state.members || []).find(m => hasMarketDay(m) && Number(m.marketDay) === weekday);
      }
      if (dutyMember) return dutyMember.id;
    }
  }
  return session.userId;
}
const MEAL_TIME_LABEL = {
  lunch: 'Lunch',
  dinner: 'Dinner',
  other: 'Other/Grocery'
};
let costsSearch = '';
let costsSort = {
  key: 'date',
  dir: 'desc'
};
// Client-side pagination for the Cost List table — purely a display-windowing
// concern over the already-filtered/sorted `list` computed in renderCosts();
// doesn't touch search, sort, or the underlying data in any way.
const COSTS_PAGE_SIZE = 10;
let costsPage = 1;

function setCostsPage(page) {
  costsPage = page;
  renderTabContent();
}
// Returns up to 5 page numbers centered (as much as possible) on `current`,
// clamped to the valid [1, total] range — mirrors typical compact pagers.
function costsPageWindow(current, total) {
  const span = 5;
  let start = Math.max(1, current - 2);
  let end = Math.min(total, start + span - 1);
  start = Math.max(1, end - span + 1);
  const nums = [];
  for (let p = start; p <= end; p++) nums.push(p);
  return nums;
}

function costsSortArrowHtml(key) {
  if (costsSort.key !== key) return '';
  return costsSort.dir === 'asc' ? ' <span class="sort-arrow">▲</span>' : ' <span class="sort-arrow">▼</span>';
}

function setCostsSort(key) {
  if (costsSort.key === key) {
    costsSort.dir = costsSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    costsSort.key = key;
    costsSort.dir = key === 'note' ? 'asc' : 'desc';
  }
  costsPage = 1;
  renderTabContent();
}

function setCostsSearch(val) {
  costsSearch = val;
  costsPage = 1;
  renderTabContent();
  const el = document.getElementById('costs-search');
  if (el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

function renderCosts() {
  const canDelete = session.role === 'superadmin';
  const list0 = (costsViewMode === 'month' ? state.costs.filter(c => c.date.startsWith(currentMonth)) : state.costs.slice());

  const q = costsSearch.trim().toLowerCase();
  let list = q ? list0.filter(c =>
    (c.note || '').toLowerCase().includes(q) ||
    (c.addedBy || '').toLowerCase().includes(q) ||
    (c.purchasedBy ? (memberById(c.purchasedBy)?.name || '') : '').toLowerCase().includes(q) ||
    (MEAL_TIME_LABEL[c.mealType || 'other'] || '').toLowerCase().includes(q) ||
    c.date.includes(q)
  ) : list0;

  const sortKey = costsSort.key;
  const dir = costsSort.dir === 'asc' ? 1 : -1;
  list = list.slice().sort((a, b) => {
    let av, bv;
    switch (sortKey) {
      case 'mealType':
        av = (MEAL_TIME_LABEL[a.mealType || 'other'] || '');
        bv = (MEAL_TIME_LABEL[b.mealType || 'other'] || '');
        break;
      case 'note':
        av = (a.note || '').toLowerCase();
        bv = (b.note || '').toLowerCase();
        break;
      case 'purchasedBy':
        av = (a.purchasedBy ? (memberById(a.purchasedBy)?.name || '') : (a.addedBy || '')).toLowerCase();
        bv = (b.purchasedBy ? (memberById(b.purchasedBy)?.name || '') : (b.addedBy || '')).toLowerCase();
        break;
      case 'amount':
        av = Number(a.amount);
        bv = Number(b.amount);
        break;
      default:
        av = a.date;
        bv = b.date;
        break; // 'date'
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    // Tie (e.g. same date) — fall back to actual add time, newest first
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
  const total = list0.reduce((s, c) => s + Number(c.amount || 0), 0);

  // Pagination is purely a display-window over the already filtered/sorted
  // `list` — clamp in case the list shrank (e.g. after a delete or a new
  // search) since the last time a page was picked.
  const totalPages = Math.max(1, Math.ceil(list.length / COSTS_PAGE_SIZE));
  if (costsPage > totalPages) costsPage = totalPages;
  if (costsPage < 1) costsPage = 1;
  const pageStart = (costsPage - 1) * COSTS_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + COSTS_PAGE_SIZE, list.length);
  const pagedList = list.slice(pageStart, pageEnd);

  _costsDetailsCache = [];
  const rows = pagedList.map((c, i) => {
    _costsDetailsCache[i] = c;
    let row = `<tr class="cl-tr">
      <td class="cl-td mono">${c.date}</td>
      <td class="cl-td">${mealBadge(c.mealType||'other')}</td>
      <td class="cl-td num cl-amount">${fmtMoney(c.amount)}</td>
      <td class="cl-td" style="max-width:120px;">${truncateCell(c.addedBy, 16)}</td>
      <td class="cl-td" style="max-width:120px;">${truncateCell(c.purchasedBy ? (memberById(c.purchasedBy)?.name || '?') : (c.addedBy || '—'), 16)}</td>
      <td class="cl-td" style="max-width:170px;">${truncateCell(c.note, 24)}</td>`;
    row += `<td class="cl-td cl-actions-cell">
      <div class="cl-actions">
        <button class="cl-action-btn cl-action-view" onclick="showCostDetail(${i})" title="View Details">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          View
        </button>
        ${canDelete?`<button class="cl-action-btn cl-action-edit" onclick="handleCostEditClick('${c.id}')" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          Edit
        </button>`:''}
        ${canDelete?`<button class="cl-action-btn cl-action-delete" onclick="deleteCost('${c.id}')" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          Delete
        </button>`:''}
      </div>
    </td>
    </tr>`;
    return row;
  }).join('');
  let header = `<tr>
    <th class="cl-th sortable-th" onclick="setCostsSort('date')">Date${costsSortArrowHtml('date')}</th>
    <th class="cl-th sortable-th" onclick="setCostsSort('mealType')">Meal${costsSortArrowHtml('mealType')}</th>
    <th class="cl-th num sortable-th" onclick="setCostsSort('amount')">Amount${costsSortArrowHtml('amount')}</th>
    <th class="cl-th">Added By</th>
    <th class="cl-th sortable-th" onclick="setCostsSort('purchasedBy')">Purchased By${costsSortArrowHtml('purchasedBy')}</th>
    <th class="cl-th sortable-th" onclick="setCostsSort('note')">Note${costsSortArrowHtml('note')}</th>
    <th class="cl-th"></th></tr>`;

  // Pagination footer — dynamically built from the current filtered list, never hardcoded.
  const pageNums = costsPageWindow(costsPage, totalPages);
  const paginationHtml = `
    <div class="cl-pagination">
      <div class="cl-pagination-info">${list.length === 0 ? 'Showing 0 of 0 entries' : `Showing ${pageStart + 1} to ${pageEnd} of ${list.length} entries`}</div>
      <div class="cl-pagination-pages">
        <button class="cl-page-btn" onclick="setCostsPage(1)" ${costsPage<=1?'disabled':''} title="First page">«</button>
        <button class="cl-page-btn" onclick="setCostsPage(${Math.max(1,costsPage-1)})" ${costsPage<=1?'disabled':''} title="Previous page">‹</button>
        ${pageNums.map(p => `<button class="cl-page-btn ${p===costsPage?'cl-page-active':''}" onclick="setCostsPage(${p})">${p}</button>`).join('')}
        <button class="cl-page-btn" onclick="setCostsPage(${Math.min(totalPages,costsPage+1)})" ${costsPage>=totalPages?'disabled':''} title="Next page">›</button>
        <button class="cl-page-btn" onclick="setCostsPage(${totalPages})" ${costsPage>=totalPages?'disabled':''} title="Last page">»</button>
      </div>
    </div>`;
  return `
    <style>
      .gc-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:16px; flex-wrap:wrap; }
      .gc-header-left { display:flex; align-items:flex-start; gap:12px; }
      .gc-header-icon {
        flex:0 0 auto; width:48px; height:48px; border-radius:14px;
        background:linear-gradient(135deg,#e5f0ff,#d6e8ff);
        display:flex; align-items:center; justify-content:center;
        color:#2563eb; box-shadow:inset 0 0 0 1px #cfe0fb;
      }
      .gc-header-icon svg { width:22px; height:22px; }
      .gc-header-text h2 {
        margin:0; font-size:20px; font-weight:800; color:#0f2a52; letter-spacing:-0.01em;
      }
      .gc-header-text p { margin:3px 0 0; font-size:12.5px; color:#6b7c93; font-weight:500; }
      .gc-about {
        flex:0 1 300px; display:flex; align-items:flex-start; gap:8px;
        background:#eef5ff; border:1px solid #cfe0fb; border-radius:12px;
        padding:10px 12px;
      }
      .gc-about-icon {
        flex:0 0 auto; width:20px; height:20px; border-radius:50%; margin-top:1px;
        background:#2563eb; color:#fff; display:flex; align-items:center; justify-content:center;
      }
      .gc-about-icon svg { width:12px; height:12px; }
      .gc-about-text strong { display:block; font-size:12px; font-weight:700; color:#0f2a52; margin-bottom:2px; }
      .gc-about-text p { margin:0; font-size:11.5px; color:#40536e; line-height:1.45; }
      .gc-divider { height:1px; background:linear-gradient(to right,#e7edf7,transparent); margin:0 0 16px; }
      .gc-form-grid {
        display:grid; grid-template-columns:repeat(4,1fr); gap:14px 14px;
      }
      .gc-field { display:flex; flex-direction:column; }
      .gc-field.gc-span-2 { grid-column:1 / -1; }
      .gc-label {
        display:flex; align-items:center; gap:5px; font-size:12.5px; font-weight:700;
        color:#33455e; margin-bottom:6px;
      }
      .gc-label svg { width:13px; height:13px; color:#2563eb; flex:0 0 auto; }
      .gc-input-wrap { position:relative; }
      .gc-input-icon {
        position:absolute; left:12px; top:50%; transform:translateY(-50%);
        color:#8493ab; pointer-events:none; display:flex; align-items:center; font-weight:700; font-size:13px;
      }
      .gc-input-icon svg { width:14px; height:14px; }
      .gc-input, .gc-select, .gc-textarea {
        width:100%; border-radius:11px; border:1.5px solid #dfe7f3;
        background:#f9fbff; padding:0 12px; font-size:13.5px; color:#16233b;
        font-family:inherit; box-sizing:border-box; transition:border-color .15s ease, box-shadow .15s ease, background .15s ease;
        appearance:none; -webkit-appearance:none;
      }
      .gc-input, .gc-select { height:44px; }
      .gc-input.has-icon, .gc-select.has-icon { padding-left:34px; }
      .gc-textarea { padding:10px 12px; resize:vertical; min-height:70px; line-height:1.45; }
      .gc-select { padding-right:30px; cursor:pointer; }
      .gc-input::placeholder, .gc-textarea::placeholder { color:#9aa8bd; }
      .gc-input:focus, .gc-select:focus, .gc-textarea:focus {
        outline:none; border-color:#2563eb; background:#ffffff;
        box-shadow:0 0 0 3px rgba(37,99,235,0.12);
      }
      /* Hide number input spinner arrows (visual only, type/behavior unchanged) */
      .gc-input[type=number]::-webkit-outer-spin-button,
      .gc-input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
      .gc-input[type=number] { -moz-appearance:textfield; }
      .gc-select-caret {
        position:absolute; right:11px; top:50%; transform:translateY(-50%);
        pointer-events:none; color:#7c8aa0;
      }
      .gc-select-caret svg { width:11px; height:11px; }
      .gc-footer-row {
        display:flex; align-items:center; gap:14px; margin-top:18px; flex-wrap:wrap;
      }
      .gc-add-btn {
        display:inline-flex; align-items:center; justify-content:center; gap:7px;
        background:linear-gradient(135deg,#2563eb,#1d4ed8); color:#fff; border:none;
        font-size:13.5px; font-weight:700; padding:11px 20px; border-radius:11px;
        cursor:pointer; box-shadow:0 3px 10px rgba(37,99,235,0.24);
        transition:transform .12s ease, box-shadow .12s ease, filter .12s ease;
        flex:0 0 auto;
      }
      .gc-add-btn:hover { filter:brightness(1.06); box-shadow:0 4px 12px rgba(37,99,235,0.3); }
      .gc-add-btn:active { transform:translateY(1px) scale(0.99); box-shadow:0 2px 6px rgba(37,99,235,0.24); }
      .gc-add-btn svg { width:14px; height:14px; }
      .gc-info-inline {
        display:flex; align-items:flex-start; gap:7px; flex:1 1 260px; min-width:0;
        background:#f4f8ff; border:1px solid #e2ecfb; border-radius:10px; padding:9px 12px;
      }
      .gc-info-inline svg {
        flex:0 0 auto; width:14px; height:14px; color:#2563eb; margin-top:1px;
      }
      .gc-info-inline p { margin:0; font-size:12px; color:#6b7c93; line-height:1.5; }
      @media (max-width:900px) {
        .gc-form-grid { grid-template-columns:1fr 1fr; }
      }
      @media (max-width:640px) {
        .gc-header { flex-direction:column; }
        .gc-about { flex-basis:auto; width:100%; }
        .gc-form-grid { grid-template-columns:1fr; }
        .gc-footer-row { flex-direction:column; align-items:stretch; }
        .gc-info-inline { flex:0 0 auto; width:100%; }
        .gc-add-btn { width:100%; }
      }

      /* ---- Cost List ---- */
      .cl-header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
      .cl-header-left { display:flex; align-items:flex-start; gap:10px; }
      .cl-header-icon {
        flex:0 0 auto; width:34px; height:34px; border-radius:9px;
        background:linear-gradient(135deg,#e5f0ff,#d6e8ff);
        display:flex; align-items:center; justify-content:center;
        color:#2563eb; box-shadow:inset 0 0 0 1px #cfe0fb;
      }
      .cl-header-icon svg { width:17px; height:17px; }
      .cl-title { margin:0; font-size:16px; font-weight:700; color:#0f2a52; letter-spacing:-0.01em; }
      .cl-total { margin:2px 0 0; font-size:12.5px; font-weight:700; color:#2563eb; }
      .cl-total span { color:#6b7c93; font-weight:500; }
      .cl-nav { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .cl-nav-btn {
        display:inline-flex; align-items:center; justify-content:center;
        height:30px; padding:0 10px; font-size:12px; font-weight:600;
        border-radius:7px; border:1px solid #dfe7f3; background:#fff; color:#33455e;
        cursor:pointer; transition:background .12s ease, border-color .12s ease;
      }
      .cl-nav-btn:hover { background:#f4f8ff; border-color:#c9dcfa; }
      .cl-nav-btn.cl-nav-arrow { width:30px; padding:0; }
      .cl-nav-btn.cl-nav-active {
        background:#0f2a52; border-color:#0f2a52; color:#fff;
      }
      .cl-nav-btn.cl-nav-active:hover { background:#16345f; }
      .cl-divider { height:1px; background:linear-gradient(to right,#e7edf7,transparent); margin:0 0 12px; }
      .cl-search-row { display:flex; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
      .cl-search-wrap { position:relative; flex:1 1 260px; min-width:0; }
      .cl-search-icon {
        position:absolute; left:11px; top:50%; transform:translateY(-50%);
        color:#8493ab; pointer-events:none;
      }
      .cl-search-icon svg { width:13px; height:13px; }
      input.cl-search-input[type=text] {
        width:100%; height:34px; border-radius:8px; border:1.5px solid #dfe7f3;
        background:#f9fbff; padding:0 11px 0 32px !important; font-size:13px; color:#16233b;
        font-family:inherit; box-sizing:border-box; transition:border-color .15s ease, box-shadow .15s ease, background .15s ease;
        min-height:34px;
      }
      .cl-search-input::placeholder { color:#9aa8bd; }
      .cl-search-input:focus {
        outline:none; border-color:#2563eb; background:#ffffff;
        box-shadow:0 0 0 3px rgba(37,99,235,0.12);
      }
      .cl-filter-btn {
        display:inline-flex; align-items:center; gap:5px; height:34px; padding:0 12px;
        border-radius:8px; border:1.5px solid #dfe7f3; background:#fff; color:#33455e;
        font-size:12px; font-weight:600; cursor:pointer; flex:0 0 auto;
        transition:background .12s ease, border-color .12s ease;
      }
      .cl-filter-btn:hover { background:#f4f8ff; border-color:#c9dcfa; }
      .cl-filter-btn svg { width:12px; height:12px; }
      .cl-result-note { margin:0 0 10px; font-size:11.5px; color:#8493ab; }
      .cl-table-wrap table { border-collapse:collapse; width:100%; }
      .cl-th {
        background:#f4f7fc; font-size:10.5px; font-weight:700; text-transform:uppercase;
        letter-spacing:0.04em; color:#5a6b85; padding:9px 10px; text-align:left;
        white-space:nowrap; border-bottom:1px solid #e9eef7;
      }
      .cl-th.num { text-align:right; }
      .cl-tr { border-bottom:1px solid #eef2f8; }
      .cl-tr:hover { background:#fafcff; }
      .cl-td { padding:9px 10px; font-size:12.5px; color:#22314a; vertical-align:middle; }
      .cl-td.num { text-align:right; }
      .cl-amount { font-weight:700; }
      .cl-actions-cell { white-space:nowrap; }
      .cl-actions { display:flex; align-items:center; gap:5px; flex-wrap:wrap; }
      .cl-action-btn {
        display:inline-flex; align-items:center; gap:4px; height:26px; padding:0 8px;
        border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;
        background:#fff; border:1px solid #dfe7f3; transition:background .12s ease, border-color .12s ease;
      }
      .cl-action-btn svg { width:11px; height:11px; }
      .cl-action-view { color:#33455e; }
      .cl-action-view:hover { background:#f4f8ff; border-color:#c9dcfa; }
      .cl-action-edit { color:#2563eb; border-color:#cfe0fb; }
      .cl-action-edit:hover { background:#f0f6ff; }
      .cl-action-delete { color:#dc2626; border-color:#f8d3d3; }
      .cl-action-delete:hover { background:#fef2f2; }
      .cl-pagination {
        display:flex; align-items:center; justify-content:space-between; gap:12px;
        flex-wrap:wrap; margin-top:14px; padding-top:12px; border-top:1px solid #eef2f8;
      }
      .cl-pagination-info { font-size:12px; color:#6b7c93; }
      .cl-pagination-pages { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
      .cl-page-btn {
        display:inline-flex; align-items:center; justify-content:center;
        min-width:26px; height:26px; padding:0 6px; border-radius:6px;
        border:1px solid #dfe7f3; background:#fff; color:#33455e;
        font-size:12px; font-weight:600; cursor:pointer;
        transition:background .12s ease, border-color .12s ease;
      }
      .cl-page-btn:hover { background:#f4f8ff; border-color:#c9dcfa; }
      .cl-page-btn.cl-page-active { background:#2563eb; border-color:#2563eb; color:#fff; }
      .cl-page-btn:disabled { opacity:0.4; cursor:not-allowed; }
      .cl-page-btn:disabled:hover { background:#fff; border-color:#dfe7f3; }
      @media (max-width:640px) {
        .cl-header { flex-direction:column; }
        .cl-nav { width:100%; }
        .cl-pagination { flex-direction:column; align-items:flex-start; }
      }
    </style>
    <div class="card">
      <div class="gc-header">
        <div class="gc-header-left">
          <div class="gc-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          </div>
          <div class="gc-header-text">
            <h2>Add Grocery Cost</h2>
            <p>Track your grocery expenses easily</p>
          </div>
        </div>
        <div class="gc-about">
          <div class="gc-about-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></div>
          <div class="gc-about-text">
            <strong>About Grocery Costs</strong>
            <p>Grocery costs are counted in the meal rate and split across active members by meal count.</p>
          </div>
        </div>
      </div>
      <div class="gc-divider"></div>
      <div class="gc-form-grid">
        <div class="gc-field">
          <label class="gc-label" for="cost-date">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            Date
          </label>
          <div class="gc-input-wrap">
            <span class="gc-input-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
            <input class="gc-input has-icon" type="date" id="cost-date" value="${costFormDraft.date || todayStr()}" oninput="updateCostDraft('date', this.value)">
          </div>
        </div>
        <div class="gc-field">
          <label class="gc-label" for="cost-mealtype">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4"/><path d="M18 8h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2"/><path d="M6 1v3M10 1v3"/></svg>
            Meal
          </label>
          <div class="gc-input-wrap">
            <select class="gc-select" id="cost-mealtype" onchange="updateCostDraft('mealtype', this.value); refreshCostPurchasedByDefault();">
              <option value="lunch" ${costFormDraft.mealtype==='lunch'?'selected':''}>Lunch</option>
              <option value="dinner" ${costFormDraft.mealtype==='dinner'?'selected':''}>Dinner</option>
              <option value="other" ${costFormDraft.mealtype==='other'?'selected':''}>Other/Grocery</option>
            </select>
            <span class="gc-select-caret"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>
          </div>
        </div>
        <div class="gc-field">
          <label class="gc-label" for="cost-amount">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/><circle cx="16" cy="14" r="1.5"/></svg>
            Amount (৳)
          </label>
          <div class="gc-input-wrap">
            <span class="gc-input-icon">৳</span>
            <input class="gc-input has-icon" type="number" id="cost-amount" min="0" value="${costFormDraft.amount}" oninput="updateCostDraft('amount', this.value)">
          </div>
        </div>
        <div class="gc-field">
          <label class="gc-label" for="cost-purchasedby">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Purchased By
          </label>
          <div class="gc-input-wrap">
            <span class="gc-input-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            <select class="gc-select has-icon" id="cost-purchasedby" onchange="updateCostDraft('purchasedby', this.value)">
              ${state.members.map(m => `<option value="${m.id}" ${(costFormDraft.purchasedby || defaultPurchaserIdForDate(costFormDraft.date || todayStr(), costFormDraft.mealtype)) === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
            </select>
            <span class="gc-select-caret"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>
          </div>
        </div>
        <div class="gc-field gc-span-2">
          <label class="gc-label" for="cost-note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>
            Note (what was bought)
          </label>
          <div class="gc-input-wrap">
            <textarea class="gc-textarea" id="cost-note" rows="3" placeholder="e.g. fish, vegetables, oil..." oninput="updateCostDraft('note', this.value)">${(costFormDraft.note||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</textarea>
          </div>
        </div>
      </div>
      <div class="gc-footer-row">
        <button class="gc-add-btn" onclick="addCost()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          Add Grocery Cost
        </button>
        <div class="gc-info-inline">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          <p>Add a separate entry for each meal — multiple entries per day are fine. "Purchased By" defaults to that date's scheduled market-duty member, but change it if someone else actually bought it.</p>
        </div>
      </div>
    </div>
    <div class="card keep-native-tables">
      <div class="cl-header">
        <div class="cl-header-left">
          <div class="cl-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
          </div>
          <div>
            <h2 class="cl-title">Cost List</h2>
            <div class="cl-total"><span>Total:</span> ${fmtMoney(total)}</div>
          </div>
        </div>
        <div class="cl-nav">
          <button class="cl-nav-btn cl-nav-arrow" onclick="navigateMonth(-1, setCostsView)" title="Previous month">‹</button>
          <button class="cl-nav-btn ${costsViewMode==='month'?'cl-nav-active':''}" onclick="setCostsView('month')">${currentMonth}</button>
          <button class="cl-nav-btn cl-nav-arrow" onclick="navigateMonth(1, setCostsView)" title="Next month">›</button>
          <button class="cl-nav-btn ${costsViewMode==='all'?'cl-nav-active':''}" onclick="setCostsView('all')">All Time</button>
        </div>
      </div>
      <div class="cl-divider"></div>
      <div class="cl-search-row">
        <div class="cl-search-wrap">
          <span class="cl-search-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></span>
          <input type="text" id="costs-search" class="cl-search-input" placeholder="   Search meal, note, added by, date..." value="${costsSearch.replace(/"/g,'&quot;')}" oninput="setCostsSearch(this.value)">
        </div>
        <button class="cl-filter-btn" onclick="document.getElementById('costs-search').focus()" title="Search filters the list below">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z"/></svg>
          Filter
        </button>
      </div>
      ${q ? `<div class="cl-result-note">${list.length} of ${list0.length} records match your search</div>` : ''}
      ${rows ? `<div class="table-responsive cl-table-wrap"><table><thead>${header}</thead><tbody>${rows}</tbody></table></div>${paginationHtml}` : `<div class="empty">${list0.length===0 ? '🧾 No grocery costs added yet — the ones you log will show up here.' : 'No records match your search.'}</div>`}
    </div>`;
}

function setCostsView(mode) {
  costsViewMode = mode;
  costsPage = 1;
  renderTabContent();
}

function attachCostHandlers() {}
async function addCost() {
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    showToast('You are not authorized to add cost records.', 'error');
    return;
  }
  const date = document.getElementById('cost-date').value;
  const mealType = document.getElementById('cost-mealtype').value;
  const amount = Number(document.getElementById('cost-amount').value);
  const note = document.getElementById('cost-note').value.trim();
  const purchasedBy = (document.getElementById('cost-purchasedby') || {}).value || session.userId;
  if (!date || !amount) {
    showToast('Date and amount are required.', 'error');
    return;
  }
  if (!guardAdminMonthAccess(date.slice(0, 7), 'costs')) return;
  const newId = 'c' + Date.now();
  state.costs.push({
    id: newId,
    date,
    mealType,
    amount,
    note,
    addedBy: memberById(session.userId).name,
    purchasedBy,
    createdAt: nowTimestamp()
  });

  // Send notification to all active members about the grocery cost
  if (notifTypeEnabled('deposit')) {
    const activeMembers = activeMemberIdsForMonth(date.slice(0, 7));
    activeMembers.forEach(memberId => {
      if (memberId !== session.userId) {
        addNotification(memberId, {
          type: 'deposit',
          title: 'Grocery cost added',
          message: `Grocery cost of ${fmtMoney(amount)} (${mealType}) was recorded on ${date} by ${memberById(session.userId).name}.`,
          dedupeKey: `cost::${newId}::${memberId}`
        });
      }
    });
  }

  costFormDraft = {
    date: '',
    mealtype: 'lunch',
    amount: '',
    note: '',
    purchasedby: ''
  };
  renderTabContent();
  showSuccessCheck('Grocery cost added.');
  persistCost(newId);
}
// Opens an editable version of the same details modal used by
// showCostDetail() (openDetailsModal/closeDetailsModal, 12-history.js), with
// real <input>/<select> fields instead of read-only rows. Restricted to
// superadmin (same as the Delete button on this list — see canDelete in
// renderCosts()); the button itself is only rendered for superadmin, this
// is a second line of defense against someone calling it directly.
function handleCostEditClick(id) {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can edit grocery cost entries.', 'error');
    return;
  }
  const c = state.costs.find(x => x.id === id);
  if (!c) {
    showToast('This cost record could not be found — it may have just been deleted.', 'error');
    return;
  }
  const body = `
    <div class="gc-form-grid" style="margin-top:2px;">
      <div class="gc-field">
        <label class="gc-label" for="editcost-date">Date</label>
        <div class="gc-input-wrap"><input class="gc-input" type="date" id="editcost-date" value="${c.date}"></div>
      </div>
      <div class="gc-field">
        <label class="gc-label" for="editcost-mealtype">Meal</label>
        <div class="gc-input-wrap">
          <select class="gc-select" id="editcost-mealtype">
            <option value="lunch" ${c.mealType==='lunch'?'selected':''}>Lunch</option>
            <option value="dinner" ${c.mealType==='dinner'?'selected':''}>Dinner</option>
            <option value="other" ${c.mealType==='other'?'selected':''}>Other/Grocery</option>
          </select>
        </div>
      </div>
      <div class="gc-field">
        <label class="gc-label" for="editcost-amount">Amount (৳)</label>
        <div class="gc-input-wrap"><input class="gc-input" type="number" min="0" id="editcost-amount" value="${c.amount}"></div>
      </div>
      <div class="gc-field">
        <label class="gc-label" for="editcost-purchasedby">Purchased By</label>
        <div class="gc-input-wrap">
          <select class="gc-select" id="editcost-purchasedby">
            ${state.members.map(m => `<option value="${m.id}" ${(c.purchasedBy||'')===m.id?'selected':''}>${escapeHtml(m.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="gc-field gc-span-2">
        <label class="gc-label" for="editcost-note">Note</label>
        <div class="gc-input-wrap"><textarea class="gc-textarea" id="editcost-note" rows="3">${escapeHtml(c.note||'')}</textarea></div>
      </div>
    </div>
    <div class="gc-footer-row" style="margin-top:16px;">
      <button class="gc-add-btn" onclick="saveCostEdit('${id}')">Save Changes</button>
      <button class="btn secondary" style="margin:0;" onclick="closeDetailsModal()">Cancel</button>
    </div>
  `;
  openDetailsModal('Edit Grocery Cost', body);
}

async function saveCostEdit(id) {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can edit grocery cost entries.', 'error');
    return;
  }
  const c = state.costs.find(x => x.id === id);
  if (!c) {
    closeDetailsModal();
    showToast('This cost record could not be found — it may have just been deleted.', 'error');
    return;
  }
  const date = document.getElementById('editcost-date').value;
  const mealType = document.getElementById('editcost-mealtype').value;
  const amount = Number(document.getElementById('editcost-amount').value);
  const purchasedBy = document.getElementById('editcost-purchasedby').value;
  const note = document.getElementById('editcost-note').value.trim();
  if (!date || !amount) {
    showToast('Date and amount are required.', 'error');
    return;
  }
  // A moved date can land in a different month than the one this record
  // originally belonged to — both the old and new month need to be allowed
  // for this admin (same reasoning guardAdminMonthAccess is used for
  // elsewhere: an edit that moves a record OUT of a month they can't touch,
  // or IN to one they can't touch, is blocked either way).
  const oldMonth = c.date.slice(0, 7);
  const newMonth = date.slice(0, 7);
  if (!guardAdminMonthAccess(oldMonth, 'costs')) return;
  if (newMonth !== oldMonth && !guardAdminMonthAccess(newMonth, 'costs')) return;

  c.date = date;
  c.mealType = mealType;
  c.amount = amount;
  c.purchasedBy = purchasedBy;
  c.note = note;
  // Audit trail: who last touched this record and when — separate from
  // addedBy/createdAt (which stay as the ORIGINAL add, never overwritten),
  // so both "who first logged this" and "who last changed it" stay visible.
  c.editedBy = memberById(session.userId).name;
  c.editedAt = nowTimestamp();

  closeDetailsModal();
  renderTabContent();
  showSuccessCheck('Grocery cost updated.');
  persistCost(id);
}
async function deleteCost(id) {
  if (session.role !== 'superadmin') {
    showToast('You are not authorized to delete cost records.', 'error');
    return;
  }
  const rec = state.costs.find(c => c.id === id);
  if (!rec) {
    showToast('This cost record could not be found — it may have just been deleted.', 'error');
    return;
  }
  if (!guardAdminMonthAccess(rec.date.slice(0, 7), 'costs')) return;
  // UNDO TOAST (replaces the old confirm() dialog): the record disappears
  // from the list immediately for a snappy feel, but the actual Firestore
  // delete (deleteCostDoc) is deferred until the toast's undo window runs
  // out. Clicking Undo just re-inserts the record locally — the server
  // delete never fires. See showUndoToast() in 00-utils-core.js.
  const mealLabel = MEAL_TIME_LABEL[rec.mealType || 'other'] || rec.mealType || '';
  const noteText = rec.note ? ` — "${rec.note}"` : '';
  const idx = state.costs.findIndex(c => c.id === id);
  state.costs = state.costs.filter(c => c.id !== id);
  renderTabContent();
  showUndoToast(
    `Deleted: ${rec.date} · ${mealLabel} · ${fmtMoney(rec.amount)}${noteText}`,
    () => {
      state.costs.splice(idx, 0, rec);
      renderTabContent();
    },
    () => deleteCostDoc(id)
  );
}

/* ---------------- SHARED EXPENSES ---------------- */
/* ===== 14-expenses.js ===== */
// ---------------------------------------------------------------------------
// 14-expenses.js  (originally app.js lines 5164-5520)
// Shared expense tab: split-mode state, draft form, renderExpenses, add/delete expense
// ---------------------------------------------------------------------------
let expenseSplitMode = 'all';
// Same fix as costFormDraft above, for the "Add Shared Expense" form —
// keeps typed text and checkbox picks alive across any re-render.
let expFormDraft = {
  date: '',
  amount: '',
  title: '',
  description: '',
  mealtypeSelect: 'both',
  checkedMembers: [],
  purchasedby: '' // member id — see defaultPurchaserIdForDate() in 13-costs.js; same "who actually paid/bought this, not just who's logged in and entering it" field as Grocery Cost
};

function updateExpDraft(field, value) {
  expFormDraft[field] = value;
}
// Cancel button on the Add Shared Expense card — wipes the draft back to
// defaults (same shape as the initial expFormDraft above) and resets split
// mode, then re-renders. Doesn't touch anything already saved.
function resetExpenseForm() {
  expFormDraft = {
    date: '',
    amount: '',
    title: '',
    description: '',
    mealtypeSelect: 'both',
    checkedMembers: [],
    purchasedby: ''
  };
  expenseSplitMode = 'all';
  renderTabContent();
}
// Same idea as refreshCostPurchasedByDefault() in 13-costs.js — re-renders
// so the "Purchased By" default (which factors in the meal, when "Charge
// based on meal count" + a specific Lunch/Dinner is picked — see
// defaultPurchaserIdForDate) updates live. Skipped once the member has
// manually picked a purchaser.
function refreshExpPurchasedByDefault() {
  if (expFormDraft.purchasedby) return;
  renderTabContent();
}

function toggleExpDraftMember(memberId, checked) {
  const idx = expFormDraft.checkedMembers.indexOf(memberId);
  if (checked && idx === -1) expFormDraft.checkedMembers.push(memberId);
  else if (!checked && idx !== -1) expFormDraft.checkedMembers.splice(idx, 1);
}
let expensesViewMode = 'month';
// Populated fresh on every renderExpenses() call — see _histExpDetailsCache above.
let _expDetailsCache = [];

function showExpenseDetail(i) {
  const e = _expDetailsCache[i];
  if (!e) return;
  const isMealSplit = e.splitType === 'meal' && e.shares;
  const memberCount = e.memberIds.length;
  const isEveryoneFallback = memberCount === state.members.length;
  const splitList = isMealSplit ?
    e.memberIds.map(id => `${escapeHtml(memberById(id)?.name||'?')}: ${fmtMoney(e.shares[id])}`).join('<br>') :
    e.memberIds.map(id => escapeHtml(memberById(id)?.name || '?')).join(', ');
  const per = isMealSplit ? null : Number(e.amount) / memberCount;
  const calcBreakdown = isMealSplit ?
    `Split by each member's meal count on ${e.date} (${MEAL_TIME_LABEL[e.mealTypeSplit] || 'Lunch + Dinner'}) — member charge = their meal count ÷ total meal count × ${fmtMoney(e.amount)}. Members with 0 relevant meals that date aren't charged.` :
    `${fmtMoney(e.amount)} ÷ ${memberCount} member${memberCount===1?'':'s'} = ${fmtMoney(per)} per person.`;
  const body = `
    ${detailRow('Date', e.date)}
    ${detailRow('Title', escapeHtml(e.title||''))}
    ${detailRow('Description', e.description ? escapeHtml(e.description) : '<span class="small-note" style="margin:0;">No description</span>')}
    ${detailRow('Total Amount', fmtMoney(e.amount))}
    ${detailRow('Method', expenseMethodLabel(e.splitType, e.mealTypeSplit, isEveryoneFallback))}
    ${e.splitType==='meal' ? detailRow('Meal', mealBadge(e.mealTypeSplit||'both')) : ''}
    ${detailRow('Split Among ('+memberCount+')', splitList)}
    ${detailRow('Calculation', calcBreakdown)}
    ${detailRow('Added By', escapeHtml(e.addedBy||''))}
    ${detailRow('Purchased By', escapeHtml(e.purchasedBy ? (memberById(e.purchasedBy)?.name || 'Unknown member') : (e.addedBy || 'Not recorded')))}
    ${shouldShowRecordedAt() ? detailRow('Recorded At', formatBDDateTime(e.createdAt)) : ''}
    ${e.editedAt ? detailRow('Last Edited By', escapeHtml(e.editedBy||'')) : ''}
    ${e.editedAt ? detailRow('Last Edited At', formatBDDateTime(e.editedAt)) : ''}
  `;
  openDetailsModal('Shared Expense Details', body);
}
let expensesSearch = '';
let expensesSort = {
  key: 'date',
  dir: 'desc'
};
// Client-side pagination for the Shared Expense List table — mirrors
// COSTS_PAGE_SIZE/costsPage/setCostsPage/costsPageWindow in 13-costs.js
// exactly, so both lists behave identically. Purely a display-windowing
// concern over the already-filtered/sorted `list`; doesn't touch search,
// sort, or the underlying data.
const EXPENSES_PAGE_SIZE = 10;
let expensesPage = 1;

function setExpensesPage(page) {
  expensesPage = page;
  renderTabContent();
}
// Returns up to 5 page numbers centered (as much as possible) on `current`,
// clamped to the valid [1, total] range — same windowing as costsPageWindow().
function expensesPageWindow(current, total) {
  const span = 5;
  let start = Math.max(1, current - 2);
  let end = Math.min(total, start + span - 1);
  start = Math.max(1, end - span + 1);
  const nums = [];
  for (let p = start; p <= end; p++) nums.push(p);
  return nums;
}

function expensesSortArrowHtml(key) {
  if (expensesSort.key !== key) return '';
  return expensesSort.dir === 'asc' ? ' <span class="sort-arrow">▲</span>' : ' <span class="sort-arrow">▼</span>';
}

function setExpensesSort(key) {
  if (expensesSort.key === key) {
    expensesSort.dir = expensesSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    expensesSort.key = key;
    expensesSort.dir = key === 'title' ? 'asc' : 'desc';
  }
  expensesPage = 1;
  renderTabContent();
}

function setExpensesView(mode) {
  expensesViewMode = mode;
  expensesPage = 1;
  renderTabContent();
}

function setExpensesSearch(val) {
  expensesSearch = val;
  expensesPage = 1;
  renderTabContent();
  const el = document.getElementById('expenses-search');
  if (el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

function expenseMethodLabel(splitType, mealTypeSplit, isEveryoneFallback) {
  if (splitType === 'meal') {
    if (mealTypeSplit === 'lunch') return 'Charge based on meal count (Lunch)';
    if (mealTypeSplit === 'dinner') return 'Charge based on meal count (Dinner)';
    return 'Charge based on meal count (Lunch + Dinner)';
  }
  if (splitType === 'selected') return 'Select specific members';
  if (splitType === 'all') return 'Split equally among all active members';
  // Very old expense records saved before splitType existed on the schema
  // won't have this field at all — infer the same way the "Split Among"
  // column already does elsewhere (comparing member count), instead of
  // just assuming "Split equally" for records that might actually have
  // been a specific-members split.
  return isEveryoneFallback ? 'Split equally among all active members' : 'Select specific members';
}

function renderExpenses() {
  const canDelete = session.role === 'superadmin';
  const memberChecks = state.members.map(m => `
    <label style="display:flex; align-items:center; gap:6px; font-size:13px; color:#33455e; margin:5px 0; font-weight:500;">
      <input type="checkbox" class="exp-member-check" value="${m.id}" ${expFormDraft.checkedMembers.includes(m.id)?'checked':''} onchange="toggleExpDraftMember('${m.id}', this.checked)"> ${escapeHtml(m.name)}
    </label>`).join('');
  const list0 = (expensesViewMode === 'month' ? state.expenses.filter(e => e.date.startsWith(currentMonth)) : state.expenses.slice())
    .map(e => ({
      ...e,
      splitNames: e.memberIds.map(id => memberById(id)?.name || '?').join(', ')
    }));

  const q = expensesSearch.trim().toLowerCase();
  let list = q ? list0.filter(e =>
    (e.title || '').toLowerCase().includes(q) ||
    (e.description || '').toLowerCase().includes(q) ||
    (e.addedBy || '').toLowerCase().includes(q) ||
    (e.purchasedBy ? (memberById(e.purchasedBy)?.name || '') : '').toLowerCase().includes(q) ||
    e.date.includes(q) ||
    e.splitNames.toLowerCase().includes(q)
  ) : list0;

  const sortKey = expensesSort.key;
  const dir = expensesSort.dir === 'asc' ? 1 : -1;
  list = list.slice().sort((a, b) => {
    let av, bv;
    switch (sortKey) {
      case 'title':
        av = (a.title || '').toLowerCase();
        bv = (b.title || '').toLowerCase();
        break;
      case 'amount':
        av = Number(a.amount);
        bv = Number(b.amount);
        break;
      case 'purchasedBy':
        av = (a.purchasedBy ? (memberById(a.purchasedBy)?.name || '') : (a.addedBy || '')).toLowerCase();
        bv = (b.purchasedBy ? (memberById(b.purchasedBy)?.name || '') : (b.addedBy || '')).toLowerCase();
        break;
      default:
        av = a.date;
        bv = b.date;
        break; // 'date'
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    // Tie (e.g. same date) — fall back to actual add time, newest first,
    // so multiple entries added the same day still show most-recent-first
    // instead of in arbitrary/insertion order.
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
  const totalExp = list0.reduce((s, e) => s + Number(e.amount || 0), 0);

  // Pagination is purely a display-window over the already filtered/sorted
  // `list` — clamp in case the list shrank (e.g. after a delete or a new
  // search) since the last time a page was picked. Mirrors renderCosts().
  const totalPages = Math.max(1, Math.ceil(list.length / EXPENSES_PAGE_SIZE));
  if (expensesPage > totalPages) expensesPage = totalPages;
  if (expensesPage < 1) expensesPage = 1;
  const pageStart = (expensesPage - 1) * EXPENSES_PAGE_SIZE;
  const pageEnd = Math.min(pageStart + EXPENSES_PAGE_SIZE, list.length);
  const pagedList = list.slice(pageStart, pageEnd);

  _expDetailsCache = [];
  const rows = pagedList.map((e, i) => {
    _expDetailsCache[i] = e;
    const isMealSplit = e.splitType === 'meal' && e.shares;
    const per = isMealSplit ? null : Number(e.amount) / e.memberIds.length;
    const memberCount = e.memberIds.length;
    let row = `<tr class="cl-tr">
      <td class="cl-td mono">${e.date}</td>
      <td class="cl-td" style="max-width:150px;">${truncateCell(e.title, 22)}</td>
      <td class="cl-td num cl-amount">${fmtMoney(e.amount)}</td>
      <td class="cl-td">${expenseMethodBadge(e.splitType, e.mealTypeSplit, memberCount===state.members.length)}</td>
      <td class="cl-td">${e.splitType==='meal' ? mealBadge(e.mealTypeSplit||'both') : '<span class="small-note" style="margin:0;">—</span>'}</td>
      <td class="cl-td num">${isMealSplit ? '—' : fmtMoney(per)}</td>
      <td class="cl-td" style="white-space:nowrap;">${memberCount} Member${memberCount===1?'':'s'}</td>
      <td class="cl-td" style="max-width:110px;">${truncateCell(e.addedBy, 14)}</td>
      <td class="cl-td" style="max-width:110px;">${truncateCell(e.purchasedBy ? (memberById(e.purchasedBy)?.name || '?') : (e.addedBy || '—'), 14)}</td>`;
    row += `<td class="cl-td cl-actions-cell">
      <div class="cl-actions">
        <button class="cl-action-btn cl-action-view" onclick="showExpenseDetail(${i})" title="View Details">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          View
        </button>
        ${canDelete?`<button class="cl-action-btn cl-action-edit" onclick="handleExpenseEditClick('${e.id}')" title="Edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          Edit
        </button>`:''}
        ${canDelete?`<button class="cl-action-btn cl-action-delete" onclick="deleteExpense('${e.id}')" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          Delete
        </button>`:''}
      </div>
    </td>
    </tr>`;
    return row;
  }).join('');
  let header = `<tr>
    <th class="cl-th sortable-th" onclick="setExpensesSort('date')">Date${expensesSortArrowHtml('date')}</th>
    <th class="cl-th sortable-th" onclick="setExpensesSort('title')">Title${expensesSortArrowHtml('title')}</th>
    <th class="cl-th num sortable-th" onclick="setExpensesSort('amount')">Total${expensesSortArrowHtml('amount')}</th>
    <th class="cl-th">Method</th>
    <th class="cl-th">Meal</th>
    <th class="cl-th num">Per Person</th>
    <th class="cl-th">Members</th>
    <th class="cl-th">Added By</th>
    <th class="cl-th sortable-th" onclick="setExpensesSort('purchasedBy')">Purchased By${expensesSortArrowHtml('purchasedBy')}</th>
    <th class="cl-th"></th></tr>`;

  // Pagination footer — dynamically built from the current filtered list, never hardcoded. Mirrors renderCosts().
  const pageNums = expensesPageWindow(expensesPage, totalPages);
  const paginationHtml = `
    <div class="cl-pagination">
      <div class="cl-pagination-info">${list.length === 0 ? 'Showing 0 of 0 entries' : `Showing ${pageStart + 1} to ${pageEnd} of ${list.length} entries`}</div>
      <div class="cl-pagination-pages">
        <button class="cl-page-btn" onclick="setExpensesPage(1)" ${expensesPage<=1?'disabled':''} title="First page">«</button>
        <button class="cl-page-btn" onclick="setExpensesPage(${Math.max(1,expensesPage-1)})" ${expensesPage<=1?'disabled':''} title="Previous page">‹</button>
        ${pageNums.map(p => `<button class="cl-page-btn ${p===expensesPage?'cl-page-active':''}" onclick="setExpensesPage(${p})">${p}</button>`).join('')}
        <button class="cl-page-btn" onclick="setExpensesPage(${Math.min(totalPages,expensesPage+1)})" ${expensesPage>=totalPages?'disabled':''} title="Next page">›</button>
        <button class="cl-page-btn" onclick="setExpensesPage(${totalPages})" ${expensesPage>=totalPages?'disabled':''} title="Last page">»</button>
      </div>
    </div>`;

  return `
    <style>
      .gc-header { display:flex; align-items:flex-start; gap:10px; margin-bottom:12px; }
      .gc-header-icon {
        flex:0 0 auto; width:34px; height:34px; border-radius:9px;
        background:linear-gradient(135deg,#e5f0ff,#d6e8ff);
        display:flex; align-items:center; justify-content:center;
        color:#2563eb; box-shadow:inset 0 0 0 1px #cfe0fb;
      }
      .gc-header-icon svg { width:17px; height:17px; }
      .gc-header-text h2 {
        margin:0; font-size:16px; font-weight:700; color:#0f2a52; letter-spacing:-0.01em;
      }
      .gc-header-text p { margin:2px 0 0; font-size:12px; color:#6b7c93; font-weight:500; }
      .gc-divider { height:1px; background:linear-gradient(to right,#e7edf7,transparent); margin:0 0 14px; }
      .gc-form-grid {
        display:grid; grid-template-columns:1fr 1fr; gap:12px 14px;
      }
      .gc-field { display:flex; flex-direction:column; }
      .gc-field.gc-span-2 { grid-column:1 / -1; }
      .gc-label {
        display:flex; align-items:center; gap:5px; font-size:12px; font-weight:600;
        color:#33455e; margin-bottom:5px;
      }
      .gc-label svg { width:12px; height:12px; color:#2563eb; flex:0 0 auto; }
      .gc-input-wrap { position:relative; }
      .gc-input, .gc-select, .gc-textarea {
        width:100%; border-radius:8px; border:1.5px solid #dfe7f3;
        background:#f9fbff; padding:0 11px; font-size:13px; color:#16233b;
        font-family:inherit; box-sizing:border-box; transition:border-color .15s ease, box-shadow .15s ease, background .15s ease;
        appearance:none; -webkit-appearance:none;
      }
      .gc-input, .gc-select { height:36px; }
      .gc-textarea { padding:8px 11px; resize:vertical; min-height:64px; line-height:1.45; }
      .gc-select { padding-right:28px; cursor:pointer; }
      .gc-input::placeholder, .gc-textarea::placeholder { color:#9aa8bd; }
      .gc-input:focus, .gc-select:focus, .gc-textarea:focus {
        outline:none; border-color:#2563eb; background:#ffffff;
        box-shadow:0 0 0 3px rgba(37,99,235,0.12);
      }
      /* Hide number input spinner arrows (visual only, type/behavior unchanged) */
      .gc-input[type=number]::-webkit-outer-spin-button,
      .gc-input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
      .gc-input[type=number] { -moz-appearance:textfield; }
      .gc-select-caret {
        position:absolute; right:10px; top:50%; transform:translateY(-50%);
        pointer-events:none; color:#7c8aa0;
      }
      .gc-select-caret svg { width:11px; height:11px; }
      .gc-footer-row {
        display:flex; align-items:center; gap:12px; margin-top:14px; flex-wrap:wrap;
      }
      .gc-add-btn {
        display:inline-flex; align-items:center; justify-content:center; gap:6px;
        background:linear-gradient(135deg,#2563eb,#1d4ed8); color:#fff; border:none;
        font-size:13px; font-weight:600; padding:8px 16px; border-radius:8px;
        cursor:pointer; box-shadow:0 3px 10px rgba(37,99,235,0.24);
        transition:transform .12s ease, box-shadow .12s ease, filter .12s ease;
        flex:0 0 auto;
      }
      .gc-add-btn:hover { filter:brightness(1.06); box-shadow:0 4px 12px rgba(37,99,235,0.3); }
      .gc-add-btn:active { transform:translateY(1px) scale(0.99); box-shadow:0 2px 6px rgba(37,99,235,0.24); }
      .gc-add-btn svg { width:13px; height:13px; }
      .gc-info-inline {
        display:flex; align-items:flex-start; gap:6px; flex:1 1 260px; min-width:0;
      }
      .gc-info-inline svg {
        flex:0 0 auto; width:14px; height:14px; color:#2563eb; margin-top:1px;
      }
      .gc-info-inline p { margin:0; font-size:12px; color:#6b7c93; line-height:1.5; }
      /* ---- Split-mode picker (Shared Expense specific) ---- */
      .gc-split-options { display:flex; flex-wrap:wrap; gap:8px 18px; margin-top:4px; }
      .gc-split-options label {
        display:inline-flex; align-items:center; gap:6px; font-size:12.5px;
        font-weight:600; color:#33455e; cursor:pointer;
      }
      .gc-split-options input[type=radio] { accent-color:#2563eb; width:14px; height:14px; cursor:pointer; }
      .gc-subbox {
        margin-top:10px; border:1.5px solid #dfe7f3; border-radius:8px;
        padding:10px 14px; background:#f9fbff;
      }
      .gc-subbox.gc-member-list { max-height:220px; overflow-y:auto; }
      @media (max-width:640px) {
        .gc-form-grid { grid-template-columns:1fr; }
        .gc-footer-row { flex-direction:column; align-items:stretch; }
        .gc-info-inline { flex:0 0 auto; width:100%; }
        .gc-add-btn { width:100%; }
      }

      /* ---- Add Shared Expense (redesigned card — scoped to this form only) ---- */
      .aeh-top-row { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:18px; }
      .aeh-header { display:flex; align-items:flex-start; gap:12px; }
      .aeh-icon-box {
        flex:0 0 auto; width:48px; height:48px; border-radius:12px;
        background:linear-gradient(135deg,#ece7fd,#ded5fb);
        display:flex; align-items:center; justify-content:center;
        color:#7c6fe8; box-shadow:inset 0 0 0 1px #ddd3fa;
      }
      .aeh-icon-box svg { width:22px; height:22px; }
      .aeh-header-text h2 { margin:0; font-size:19px; font-weight:800; color:#0f2a52; letter-spacing:-0.01em; }
      .aeh-header-text p { margin:4px 0 0; font-size:12.5px; color:#6b7c93; font-weight:500; }
      .aeh-info-box {
        display:flex; gap:7px; align-items:flex-start; background:#eafcf3;
        border:1px solid #bdf0d3; border-radius:10px; padding:9px 12px;
        flex:1 1 260px; min-width:0;
      }
      .aeh-info-icon {
        flex:0 0 auto; width:14px; height:14px; margin-top:1px; color:#16a34a;
      }
      .aeh-info-icon svg { width:14px; height:14px; }
      .aeh-info-box strong { display:none; }
      .aeh-info-box p { margin:0; font-size:12px; color:#4b7a5c; line-height:1.5; }
      .aeh-grid-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; margin-bottom:14px; }
      .aeh-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:20px; }
      .aeh-titledesc-box {
        display:grid; grid-template-columns:1fr 1fr; gap:14px;
        background:#fefdfd; border:1.5px solid #e9edf5; border-radius:12px;
        padding:16px; margin-bottom:20px;
      }
      .aeh-field { display:flex; flex-direction:column; }
      .aeh-label {
        display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700;
        color:#33455e; margin-bottom:7px;
      }
      .aeh-label svg { width:13px; height:13px; color:#2563eb; flex:0 0 auto; }
      .aeh-input-wrap { position:relative; }
      .aeh-input, .aeh-select {
        width:100%; height:42px; border-radius:10px; border:1.5px solid #e2e8f5;
        background:#f9fbff; padding:0 14px; font-size:13.5px; color:#16233b;
        font-family:inherit; box-sizing:border-box; transition:border-color .15s ease, box-shadow .15s ease, background .15s ease;
        appearance:none; -webkit-appearance:none;
      }
      .aeh-input::placeholder { color:#9aa8bd; }
      .aeh-input:focus, .aeh-select:focus {
        outline:none; border-color:#2563eb; background:#ffffff;
        box-shadow:0 0 0 3px rgba(37,99,235,0.12);
      }
      .aeh-input[type=number]::-webkit-outer-spin-button,
      .aeh-input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
      .aeh-input[type=number] { -moz-appearance:textfield; }
      .aeh-input.aeh-amount-input { padding-left:30px; }
      .aeh-amount-icon {
        position:absolute; left:12px; top:50%; transform:translateY(-50%);
        color:#8493ab; font-size:14px; font-weight:700; pointer-events:none;
      }
      .aeh-select { padding-right:32px; padding-left:38px; cursor:pointer; }
      .aeh-select-avatar {
        position:absolute; left:10px; top:50%; transform:translateY(-50%);
        width:22px; height:22px; border-radius:50%; background:#ece7fd; color:#7c6fe8;
        display:flex; align-items:center; justify-content:center; pointer-events:none;
      }
      .aeh-select-avatar svg { width:12px; height:12px; }
      .aeh-select-caret {
        position:absolute; right:12px; top:50%; transform:translateY(-50%);
        pointer-events:none; color:#7c8aa0;
      }
      .aeh-select-caret svg { width:12px; height:12px; }
      .aeh-split-wrap { margin-top:4px; }
      .aeh-split-heading {
        display:flex; align-items:center; gap:7px; font-size:13.5px; font-weight:700;
        color:#16233b; margin-bottom:10px;
      }
      .aeh-split-heading svg { width:15px; height:15px; color:#16a34a; }
      .aeh-split-cards { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
      .aeh-split-card {
        display:flex; align-items:flex-start; gap:10px; border:1.5px solid #e2e8f5;
        border-radius:12px; padding:14px; cursor:pointer; background:#fff; position:relative;
        transition:border-color .15s ease, background .15s ease, box-shadow .15s ease;
      }
      .aeh-split-card:hover { border-color:#c9dcfa; }
      .aeh-split-card.aeh-selected { border-color:#2563eb; background:#f0f6ff; box-shadow:0 0 0 1px #2563eb inset; }
      .aeh-split-card input[type=radio] { position:absolute; opacity:0; width:1px; height:1px; pointer-events:none; }
      .aeh-split-radio {
        flex:0 0 auto; width:16px; height:16px; border-radius:50%; border:2px solid #cbd5e1;
        margin-top:2px; display:flex; align-items:center; justify-content:center;
      }
      .aeh-split-card.aeh-selected .aeh-split-radio { border-color:#2563eb; }
      .aeh-split-card.aeh-selected .aeh-split-radio::after { content:''; width:8px; height:8px; border-radius:50%; background:#2563eb; }
      .aeh-split-icon { flex:0 0 auto; width:34px; height:34px; border-radius:9px; display:flex; align-items:center; justify-content:center; }
      .aeh-split-icon svg { width:16px; height:16px; }
      .aeh-split-icon.aeh-blue { background:#dbeafe; color:#2563eb; }
      .aeh-split-icon.aeh-green { background:#dcfce7; color:#16a34a; }
      .aeh-split-icon.aeh-purple { background:#ece7fd; color:#7c6fe8; }
      .aeh-split-title { font-size:13px; font-weight:700; color:#16233b; }
      .aeh-split-sub { font-size:11.5px; color:#6b7c93; margin-top:2px; }
      .aeh-subbox-wrap { margin-top:12px; }
      .aeh-footer { display:flex; align-items:center; gap:12px; margin-top:20px; flex-wrap:wrap; }
      .aeh-add-btn {
        display:inline-flex; align-items:center; justify-content:center; gap:7px;
        background:linear-gradient(135deg,#2563eb,#1d4ed8); color:#fff; border:none;
        font-size:13.5px; font-weight:700; padding:11px 20px; border-radius:10px;
        cursor:pointer; box-shadow:0 4px 12px rgba(37,99,235,0.28);
        transition:transform .12s ease, box-shadow .12s ease, filter .12s ease; flex:0 0 auto;
      }
      .aeh-add-btn:hover { filter:brightness(1.05); box-shadow:0 5px 14px rgba(37,99,235,0.34); }
      .aeh-add-btn:active { transform:translateY(1px) scale(0.99); }
      .aeh-add-btn svg { width:14px; height:14px; }
      .aeh-cancel-btn {
        display:inline-flex; align-items:center; justify-content:center; gap:7px;
        background:#fff; color:#33455e; border:1.5px solid #e2e8f5;
        font-size:13.5px; font-weight:700; padding:11px 18px; border-radius:10px;
        cursor:pointer; transition:background .12s ease, border-color .12s ease; flex:0 0 auto;
      }
      .aeh-cancel-btn:hover { background:#f4f8ff; border-color:#c9dcfa; }
      .aeh-cancel-btn svg { width:13px; height:13px; }
      .aeh-footer-info {
        display:flex; align-items:flex-start; gap:8px; flex:1 1 260px; min-width:0;
        background:#eef4ff; border-radius:10px; padding:10px 14px;
      }
      .aeh-footer-info svg { flex:0 0 auto; width:15px; height:15px; color:#2563eb; margin-top:1px; }
      .aeh-footer-info p { margin:0; font-size:12px; color:#33455e; line-height:1.5; }
      @media (max-width:640px) {
        .aeh-grid-3, .aeh-grid-2, .aeh-titledesc-box, .aeh-split-cards { grid-template-columns:1fr; }
        .aeh-top-row { flex-direction:column; }
        .aeh-info-box { flex:0 0 auto; width:100%; }
        .aeh-footer { flex-direction:column; align-items:stretch; }
        .aeh-footer-info { flex:0 0 auto; width:100%; }
        .aeh-add-btn, .aeh-cancel-btn { width:100%; }
      }

      /* ---- Cost/Expense List (shared visual language) ---- */
      .cl-header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
      .cl-header-left { display:flex; align-items:flex-start; gap:10px; }
      .cl-header-icon {
        flex:0 0 auto; width:34px; height:34px; border-radius:9px;
        background:linear-gradient(135deg,#e5f0ff,#d6e8ff);
        display:flex; align-items:center; justify-content:center;
        color:#2563eb; box-shadow:inset 0 0 0 1px #cfe0fb;
      }
      .cl-header-icon svg { width:17px; height:17px; }
      .cl-title { margin:0; font-size:16px; font-weight:700; color:#0f2a52; letter-spacing:-0.01em; }
      .cl-total { margin:2px 0 0; font-size:12.5px; font-weight:700; color:#2563eb; }
      .cl-total span { color:#6b7c93; font-weight:500; }
      .cl-nav { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .cl-nav-btn {
        display:inline-flex; align-items:center; justify-content:center;
        height:30px; padding:0 10px; font-size:12px; font-weight:600;
        border-radius:7px; border:1px solid #dfe7f3; background:#fff; color:#33455e;
        cursor:pointer; transition:background .12s ease, border-color .12s ease;
      }
      .cl-nav-btn:hover { background:#f4f8ff; border-color:#c9dcfa; }
      .cl-nav-btn.cl-nav-arrow { width:30px; padding:0; }
      .cl-nav-btn.cl-nav-active {
        background:#0f2a52; border-color:#0f2a52; color:#fff;
      }
      .cl-nav-btn.cl-nav-active:hover { background:#16345f; }
      .cl-divider { height:1px; background:linear-gradient(to right,#e7edf7,transparent); margin:0 0 12px; }
      .cl-search-row { display:flex; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
      .cl-search-wrap { position:relative; flex:1 1 260px; min-width:0; }
      .cl-search-icon {
        position:absolute; left:11px; top:50%; transform:translateY(-50%);
        color:#8493ab; pointer-events:none;
      }
      .cl-search-icon svg { width:13px; height:13px; }
      input.cl-search-input[type=text] {
        width:100%; height:34px; border-radius:8px; border:1.5px solid #dfe7f3;
        background:#f9fbff; padding:0 11px 0 32px !important; font-size:13px; color:#16233b;
        font-family:inherit; box-sizing:border-box; transition:border-color .15s ease, box-shadow .15s ease, background .15s ease;
        min-height:34px;
      }
      .cl-search-input::placeholder { color:#9aa8bd; }
      .cl-search-input:focus {
        outline:none; border-color:#2563eb; background:#ffffff;
        box-shadow:0 0 0 3px rgba(37,99,235,0.12);
      }
      .cl-filter-btn {
        display:inline-flex; align-items:center; gap:5px; height:34px; padding:0 12px;
        border-radius:8px; border:1.5px solid #dfe7f3; background:#fff; color:#33455e;
        font-size:12px; font-weight:600; cursor:pointer; flex:0 0 auto;
        transition:background .12s ease, border-color .12s ease;
      }
      .cl-filter-btn:hover { background:#f4f8ff; border-color:#c9dcfa; }
      .cl-filter-btn svg { width:12px; height:12px; }
      .cl-result-note { margin:0 0 10px; font-size:11.5px; color:#8493ab; }
      .cl-table-wrap table { border-collapse:collapse; width:100%; }
      .cl-th {
        background:#f4f7fc; font-size:10.5px; font-weight:700; text-transform:uppercase;
        letter-spacing:0.04em; color:#5a6b85; padding:9px 10px; text-align:left;
        white-space:nowrap; border-bottom:1px solid #e9eef7;
      }
      .cl-th.num { text-align:right; }
      .cl-tr { border-bottom:1px solid #eef2f8; }
      .cl-tr:hover { background:#fafcff; }
      .cl-td { padding:9px 10px; font-size:12.5px; color:#22314a; vertical-align:middle; }
      .cl-td.num { text-align:right; }
      .cl-amount { font-weight:700; }
      .cl-actions-cell { white-space:nowrap; }
      .cl-actions { display:flex; align-items:center; gap:5px; flex-wrap:wrap; }
      .cl-action-btn {
        display:inline-flex; align-items:center; gap:4px; height:26px; padding:0 8px;
        border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;
        background:#fff; border:1px solid #dfe7f3; transition:background .12s ease, border-color .12s ease;
      }
      .cl-action-btn svg { width:11px; height:11px; }
      .cl-action-view { color:#33455e; }
      .cl-action-view:hover { background:#f4f8ff; border-color:#c9dcfa; }
      .cl-action-edit { color:#2563eb; border-color:#cfe0fb; }
      .cl-action-edit:hover { background:#f0f6ff; }
      .cl-action-delete { color:#dc2626; border-color:#f8d3d3; }
      .cl-action-delete:hover { background:#fef2f2; }
      .cl-pagination {
        display:flex; align-items:center; justify-content:space-between; gap:12px;
        flex-wrap:wrap; margin-top:14px; padding-top:12px; border-top:1px solid #eef2f8;
      }
      .cl-pagination-info { font-size:12px; color:#6b7c93; }
      .cl-pagination-pages { display:flex; align-items:center; gap:4px; flex-wrap:wrap; }
      .cl-page-btn {
        display:inline-flex; align-items:center; justify-content:center;
        min-width:26px; height:26px; padding:0 6px; border-radius:6px;
        border:1px solid #dfe7f3; background:#fff; color:#33455e;
        font-size:12px; font-weight:600; cursor:pointer;
        transition:background .12s ease, border-color .12s ease;
      }
      .cl-page-btn:hover { background:#f4f8ff; border-color:#c9dcfa; }
      .cl-page-btn.cl-page-active { background:#2563eb; border-color:#2563eb; color:#fff; }
      .cl-page-btn:disabled { opacity:0.4; cursor:not-allowed; }
      .cl-page-btn:disabled:hover { background:#fff; border-color:#dfe7f3; }
      @media (max-width:640px) {
        .cl-header { flex-direction:column; }
        .cl-nav { width:100%; }
        .cl-pagination { flex-direction:column; align-items:flex-start; }
      }
    </style>
    <div class="card">
      <div class="aeh-top-row">
        <div class="aeh-header">
          <div class="aeh-icon-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 17h6"/><circle cx="9.5" cy="10.5" r="1.5"/></svg>
          </div>
          <div class="aeh-header-text">
            <h2>Add Shared Expense</h2>
            <p>e.g. Overheads are split equally; meal rates cover ingredients only.</p>
          </div>
        </div>
        <div class="aeh-info-box">
          <div class="aeh-info-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          </div>
          <div>
            <strong>About Shared Expenses</strong>
            <p>Shared expenses are divided among members separately and not included in meal calculations.</p>
          </div>
        </div>
      </div>
      <div class="aeh-grid-3">
        <div class="aeh-field">
          <label class="aeh-label" for="exp-date">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            Date
          </label>
          <div class="aeh-input-wrap">
            <input class="aeh-input" type="date" id="exp-date" value="${expFormDraft.date || todayStr()}" oninput="updateExpDraft('date', this.value)">
          </div>
        </div>
        <div class="aeh-field">
          <label class="aeh-label" for="exp-amount">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/><circle cx="16" cy="14" r="1.5"/></svg>
            Total Amount (৳)
          </label>
          <div class="aeh-input-wrap">
            <span class="aeh-amount-icon">৳</span>
            <input class="aeh-input aeh-amount-input" type="number" id="exp-amount" min="0" placeholder="0.00" value="${expFormDraft.amount}" oninput="updateExpDraft('amount', this.value)">
          </div>
        </div>
        <div class="aeh-field">
          <label class="aeh-label" for="exp-purchasedby">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Purchased By
          </label>
          <div class="aeh-input-wrap">
            <span class="aeh-select-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            <select class="aeh-select" id="exp-purchasedby" onchange="updateExpDraft('purchasedby', this.value)">
              ${state.members.map(m => `<option value="${m.id}" ${(expFormDraft.purchasedby || defaultPurchaserIdForDate(expFormDraft.date || todayStr(), expenseSplitMode === 'meal' && expFormDraft.mealtypeSelect !== 'both' ? expFormDraft.mealtypeSelect : undefined)) === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}
            </select>
            <span class="aeh-select-caret"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>
          </div>
        </div>
      </div>
      <div class="aeh-titledesc-box">
        <div class="aeh-field">
          <label class="aeh-label" for="exp-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7" cy="7" r="0.5" fill="currentColor"/></svg>
            Title
          </label>
          <div class="aeh-input-wrap">
            <input class="aeh-input" type="text" id="exp-title" placeholder="What was this expense for?" value="${(expFormDraft.title||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}" oninput="updateExpDraft('title', this.value)">
          </div>
        </div>
        <div class="aeh-field">
          <label class="aeh-label" for="exp-description">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M7 9h8"/><path d="M7 13h5"/></svg>
            Description (optional)
          </label>
          <div class="aeh-input-wrap">
            <input class="aeh-input" type="text" id="exp-description" placeholder="Add any details about this expense..." value="${(expFormDraft.description||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}" oninput="updateExpDraft('description', this.value)">
          </div>
        </div>
      </div>
      <div class="aeh-split-wrap">
        <div class="aeh-split-heading">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Split Among Members
        </div>
        <div class="aeh-split-cards">
          <label class="aeh-split-card ${expenseSplitMode==='all'?'aeh-selected':''}">
            <input type="radio" name="exp-split" value="all" ${expenseSplitMode==='all'?'checked':''} onchange="setExpenseSplitMode('all')">
            <span class="aeh-split-radio"></span>
            <span class="aeh-split-icon aeh-blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
            <span>
              <span class="aeh-split-title" style="display:block;">Split equally among all active members</span>
              <span class="aeh-split-sub" style="display:block;">(${activeMemberIdsForMonth(currentMonth).length} people)</span>
            </span>
          </label>
          <label class="aeh-split-card ${expenseSplitMode==='selected'?'aeh-selected':''}">
            <input type="radio" name="exp-split" value="selected" ${expenseSplitMode==='selected'?'checked':''} onchange="setExpenseSplitMode('selected')">
            <span class="aeh-split-radio"></span>
            <span class="aeh-split-icon aeh-green"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
            <span>
              <span class="aeh-split-title" style="display:block;">Select specific members</span>
              <span class="aeh-split-sub" style="display:block;">Choose who will share this expense</span>
            </span>
          </label>
          <label class="aeh-split-card ${expenseSplitMode==='meal'?'aeh-selected':''}">
            <input type="radio" name="exp-split" value="meal" ${expenseSplitMode==='meal'?'checked':''} onchange="setExpenseSplitMode('meal')">
            <span class="aeh-split-radio"></span>
            <span class="aeh-split-icon aeh-purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8.01" y2="10"/><line x1="12" y1="10" x2="12.01" y2="10"/><line x1="16" y1="10" x2="16.01" y2="10"/><line x1="8" y1="14" x2="8.01" y2="14"/><line x1="12" y1="14" x2="12.01" y2="14"/><line x1="16" y1="14" x2="16.01" y2="14"/><line x1="8" y1="18" x2="12.01" y2="18"/></svg></span>
            <span>
              <span class="aeh-split-title" style="display:block;">Charge based on meal count</span>
              <span class="aeh-split-sub" style="display:block;">Amount will be divided by meal count</span>
            </span>
          </label>
        </div>
      </div>
      <div id="exp-member-list" class="gc-subbox gc-member-list aeh-subbox-wrap" style="${expenseSplitMode==='selected'?'':'display:none;'}">
        ${memberChecks}
      </div>
      <div id="exp-meal-note" class="aeh-subbox-wrap" style="${expenseSplitMode==='meal'?'':'display:none;'}">
        <div class="gc-subbox">
          <label class="gc-label" for="exp-mealtype-select" style="margin-bottom:6px;">Which meal to base the split on</label>
          <div class="gc-input-wrap">
            <select class="gc-select" id="exp-mealtype-select" onchange="updateExpDraft('mealtypeSelect', this.value); refreshExpPurchasedByDefault();">
              <option value="both" ${expFormDraft.mealtypeSelect==='both'?'selected':''}>Both Lunch + Dinner</option>
              <option value="lunch" ${expFormDraft.mealtypeSelect==='lunch'?'selected':''}>Lunch only</option>
              <option value="dinner" ${expFormDraft.mealtypeSelect==='dinner'?'selected':''}>Dinner only</option>
            </select>
            <span class="gc-select-caret"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>
          </div>
          <div class="small-note" style="margin-top:8px;">Splits the total proportionally by each member's meal count on the Date above, using only the meal type selected here (Member Charge = their meal count ÷ total meal count × total expense). Members with 0 relevant meals that date aren't charged. Make sure that date's meals are already entered before adding this.</div>
        </div>
      </div>
      <div class="aeh-footer">
        <button class="aeh-add-btn" onclick="addExpense()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
          Add Shared Expense
        </button>
        <button class="aeh-cancel-btn" onclick="resetExpenseForm()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          Cancel
        </button>
        <div class="aeh-footer-info">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
          <p>"Purchased By" defaults to that date's scheduled market-duty member when relevant, but change it if someone else actually paid.</p>
        </div>
      </div>
    </div>
    <div class="card keep-native-tables">
      <div class="cl-header">
        <div class="cl-header-left">
          <div class="cl-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
          </div>
          <div>
            <h2 class="cl-title">Shared Expense List</h2>
            <div class="cl-total"><span>Total:</span> ${fmtMoney(totalExp)}</div>
          </div>
        </div>
        <div class="cl-nav">
          <button class="cl-nav-btn cl-nav-arrow" onclick="navigateMonth(-1, setExpensesView)" title="Previous month">‹</button>
          <button class="cl-nav-btn ${expensesViewMode==='month'?'cl-nav-active':''}" onclick="setExpensesView('month')">${currentMonth}</button>
          <button class="cl-nav-btn cl-nav-arrow" onclick="navigateMonth(1, setExpensesView)" title="Next month">›</button>
          <button class="cl-nav-btn ${expensesViewMode==='all'?'cl-nav-active':''}" onclick="setExpensesView('all')">All Time</button>
        </div>
      </div>
      <div class="cl-divider"></div>
      <div class="cl-search-row">
        <div class="cl-search-wrap">
          <span class="cl-search-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></span>
          <input type="text" id="expenses-search" class="cl-search-input" placeholder="   Search title, description, member, date..." value="${expensesSearch.replace(/"/g,'&quot;')}" oninput="setExpensesSearch(this.value)">
        </div>
        <button class="cl-filter-btn" onclick="document.getElementById('expenses-search').focus()" title="Search filters the list below">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3Z"/></svg>
          Filter
        </button>
      </div>
      ${q ? `<div class="cl-result-note">${list.length} of ${list0.length} records match your search</div>` : ''}
      ${rows ? `<div class="table-responsive cl-table-wrap"><table><thead>${header}</thead><tbody>${rows}</tbody></table></div>${paginationHtml}` : `<div class="empty">${list0.length===0 ? (expensesViewMode==='month' ? '🧾 No shared expenses added this month yet.' : '🧾 No shared expenses added yet — the ones you log will show up here.') : 'No records match your search.'}</div>`}
    </div>`;
}

function setExpenseSplitMode(mode) {
  expenseSplitMode = mode;
  const box = document.getElementById('exp-member-list');
  if (box) box.style.display = mode === 'selected' ? '' : 'none';
  const note = document.getElementById('exp-meal-note');
  if (note) note.style.display = mode === 'meal' ? '' : 'none';
  refreshExpPurchasedByDefault(); // "Purchased By" default depends on the picked meal only while split mode is 'meal' — see defaultPurchaserIdForDate
}

// Works out who owes what for a given split mode/date/amount — the exact
// same logic addExpense() always used inline, pulled out so both adding a
// NEW expense and editing/recalculating an EXISTING one (see
// handleExpenseEditClick()/saveExpenseEdit() below) share one
// implementation instead of two copies that could quietly drift apart.
// Always reads LIVE data (state.days for the 'meal' mode, current active
// members for 'all') — never anything cached — so calling this again later
// naturally picks up any meal on/off toggles made since the expense was
// first added. Returns { memberIds, shares?, mealTypeSplit?, error? }; on
// error, memberIds/shares are omitted and the caller should show `error`
// and stop, same as the old inline validation did.
function computeExpenseSplit(mode, date, amount, selectedMemberIds, mealTypeSplit) {
  if (mode === 'all') {
    const memberIds = activeMemberIdsForMonth(date.slice(0, 7));
    if (!memberIds.length) return { error: 'No active members for this month to split among.' };
    return { memberIds };
  }
  if (mode === 'selected') {
    const memberIds = selectedMemberIds || [];
    if (!memberIds.length) return { error: 'Select at least one member.' };
    return { memberIds };
  }
  if (mode === 'meal') {
    const mts = mealTypeSplit || 'both';
    const dayMeals = (state.days[date] && state.days[date].meals) || {};
    const counts = {};
    let totalMeals = 0;
    state.members.forEach(m => {
      const rec = dayMeals[m.id];
      let c = 0;
      if (rec) {
        if (mts === 'lunch') c = rec.lunch || 0;
        else if (mts === 'dinner') c = rec.dinner || 0;
        else c = (rec.lunch || 0) + (rec.dinner || 0);
      }
      if (c > 0) {
        counts[m.id] = c;
        totalMeals += c;
      }
    });
    if (totalMeals <= 0) {
      return { error: `No ${mts==='both'?'meals':mts} recorded on ${date} yet — enter that date's meals first.` };
    }
    const memberIds = Object.keys(counts);
    const shares = {};
    memberIds.forEach(id => {
      shares[id] = (counts[id] / totalMeals) * amount;
    });
    return { memberIds, shares, mealTypeSplit: mts };
  }
  return { error: 'Unknown split mode.' };
}

function attachExpenseHandlers() {}
async function addExpense() {
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    showToast('You are not authorized to add expense records.', 'error');
    return;
  }
  const date = document.getElementById('exp-date').value;
  const amount = Number(document.getElementById('exp-amount').value);
  const title = document.getElementById('exp-title').value.trim();
  const description = document.getElementById('exp-description').value.trim();
  const purchasedBy = (document.getElementById('exp-purchasedby') || {}).value || session.userId;
  if (!date || !amount) {
    showToast('Date and amount are required.', 'error');
    return;
  }
  if (!title) {
    showToast('Title is required.', 'error');
    return;
  }
  if (!guardAdminMonthAccess(date.slice(0, 7), 'expenses')) return;

  const selectedMemberIds = expenseSplitMode === 'selected'
    ? Array.from(document.querySelectorAll('.exp-member-check:checked')).map(el => el.value)
    : null;
  const mealtypeSelectVal = (document.getElementById('exp-mealtype-select') || {}).value || 'both';
  const split = computeExpenseSplit(expenseSplitMode, date, amount, selectedMemberIds, mealtypeSelectVal);
  if (split.error) {
    showToast(split.error, 'error');
    return;
  }
  const memberIds = split.memberIds;
  const shares = split.shares;
  const mealTypeSplit = split.mealTypeSplit;

  const newId = 'e' + Date.now();
  const expenseRecord = {
    id: newId,
    date,
    amount,
    memberIds,
    title,
    description,
    addedBy: memberById(session.userId).name,
    purchasedBy,
    createdAt: nowTimestamp(),
    splitType: expenseSplitMode
  };
  if (shares) expenseRecord.shares = shares;
  if (mealTypeSplit) expenseRecord.mealTypeSplit = mealTypeSplit;
  state.expenses.push(expenseRecord);

  // Send notification to each member about the shared expense
  if (notifTypeEnabled('deposit')) {
    memberIds.forEach(memberId => {
      if (memberId !== session.userId) {
        const share = shares ? shares[memberId] : (amount / memberIds.length);
        addNotification(memberId, {
          type: 'deposit',
          title: 'Shared expense added',
          message: `Shared expense "${title}" (${fmtMoney(share)} share) was added on ${date} by ${memberById(session.userId).name}.`,
          dedupeKey: `expense::${newId}::${memberId}`
        });
      }
    });
  }

  expFormDraft = {
    date: '',
    amount: '',
    title: '',
    description: '',
    mealtypeSelect: 'both',
    checkedMembers: [],
    purchasedby: ''
  };
  renderTabContent();
  showSuccessCheck('Shared expense added.');
  persistExpense(newId);
}
// ---------------------------------------------------------------------------
// EDIT SHARED EXPENSE
// Mirrors handleCostEditClick()/saveCostEdit() in 13-costs.js — same modal
// chrome (openDetailsModal/closeDetailsModal), same gc-form-grid styling,
// same superadmin-only gate, same editedBy/editedAt audit trail. The one
// extra piece here is the "Recalculate" step for meal-count-based splits
// (see computeExpenseSplit() above): editing a Shared Expense does NOT
// silently re-split it just because the modal was opened — someone has to
// explicitly hit Recalculate to see what the NEW split would be (using
// whatever the meal counts are RIGHT NOW, e.g. after someone corrected a
// wrongly-on/off meal), review it, then Save. This keeps balance changes
// visible and intentional instead of a background side-effect of merely
// opening the edit form.
// ---------------------------------------------------------------------------
let editExpDraft = null;

function _editExpMemberChecksHtml() {
  return state.members.map(m => `
    <label style="display:flex; align-items:center; gap:6px; font-size:13px; color:#33455e; margin:5px 0; font-weight:500;">
      <input type="checkbox" class="editexp-member-check" value="${m.id}" ${editExpDraft.checkedMembers.includes(m.id)?'checked':''} onchange="toggleEditExpDraftMember('${m.id}', this.checked)"> ${escapeHtml(m.name)}
    </label>`).join('');
}

function _editExpRecalcPreviewHtml() {
  if (!editExpDraft.preview) return '';
  if (editExpDraft.preview.error) {
    return `<div class="small-note" style="color:#dc2626; margin-top:8px;">${escapeHtml(editExpDraft.preview.error)}</div>`;
  }
  const p = editExpDraft.preview;
  const lines = p.memberIds.map(id => `${escapeHtml(memberById(id)?.name || '?')}: ${fmtMoney(p.shares[id])}`).join('<br>');
  return `<div class="small-note" style="margin-top:8px; border:1.5px solid #cfe0fb; border-radius:8px; padding:8px 10px; background:rgba(37,99,235,0.06);">
    <strong style="color:#0f2a52;">New split preview (based on current meal data):</strong><br>${lines}
  </div>`;
}

function renderExpenseEditModalBody() {
  const d = editExpDraft;
  return `
    <div class="gc-form-grid" style="margin-top:2px;">
      <div class="gc-field">
        <label class="gc-label" for="editexp-date">Date</label>
        <div class="gc-input-wrap"><input class="gc-input" type="date" id="editexp-date" value="${d.date}" onchange="updateEditExpDraft('date', this.value)"></div>
      </div>
      <div class="gc-field">
        <label class="gc-label" for="editexp-amount">Total Amount (৳)</label>
        <div class="gc-input-wrap"><input class="gc-input" type="number" min="0" id="editexp-amount" value="${d.amount}" oninput="updateEditExpDraft('amount', this.value)"></div>
      </div>
      <div class="gc-field gc-span-2">
        <label class="gc-label" for="editexp-purchasedby">Purchased By</label>
        <div class="gc-input-wrap">
          <select class="gc-select" id="editexp-purchasedby" onchange="updateEditExpDraft('purchasedby', this.value)">
            ${state.members.map(m => `<option value="${m.id}" ${d.purchasedby===m.id?'selected':''}>${escapeHtml(m.name)}</option>`).join('')}
          </select>
          <span class="gc-select-caret"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>
        </div>
      </div>
      <div class="gc-field gc-span-2">
        <label class="gc-label" for="editexp-title">Title</label>
        <div class="gc-input-wrap"><input class="gc-input" type="text" id="editexp-title" value="${escapeHtml(d.title||'')}" oninput="updateEditExpDraft('title', this.value)"></div>
      </div>
      <div class="gc-field gc-span-2">
        <label class="gc-label" for="editexp-description">Description (optional)</label>
        <div class="gc-input-wrap"><input class="gc-input" type="text" id="editexp-description" value="${escapeHtml(d.description||'')}" oninput="updateEditExpDraft('description', this.value)"></div>
      </div>
    </div>
    <div class="gc-split-options" style="margin-top:14px;">
      <label><input type="radio" name="editexp-split" value="all" ${d.splitMode==='all'?'checked':''} onchange="setEditExpSplitMode('all')"> Split equally among all active members</label>
      <label><input type="radio" name="editexp-split" value="selected" ${d.splitMode==='selected'?'checked':''} onchange="setEditExpSplitMode('selected')"> Select specific members</label>
      <label><input type="radio" name="editexp-split" value="meal" ${d.splitMode==='meal'?'checked':''} onchange="setEditExpSplitMode('meal')"> Charge based on meal count</label>
    </div>
    <div id="editexp-member-list" class="gc-subbox gc-member-list" style="${d.splitMode==='selected'?'':'display:none;'}">
      ${_editExpMemberChecksHtml()}
    </div>
    <div id="editexp-meal-note" style="${d.splitMode==='meal'?'':'display:none;'}">
      <div class="gc-subbox">
        <label class="gc-label" for="editexp-mealtype-select" style="margin-bottom:6px;">Which meal to base the split on</label>
        <div class="gc-input-wrap">
          <select class="gc-select" id="editexp-mealtype-select" onchange="updateEditExpDraft('mealtypeSelect', this.value)">
            <option value="both" ${d.mealtypeSelect==='both'?'selected':''}>Both Lunch + Dinner</option>
            <option value="lunch" ${d.mealtypeSelect==='lunch'?'selected':''}>Lunch only</option>
            <option value="dinner" ${d.mealtypeSelect==='dinner'?'selected':''}>Dinner only</option>
          </select>
          <span class="gc-select-caret"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>
        </div>
        <div class="small-note" style="margin-top:8px;">The saved split may be out of date if someone's meal for this date was turned on/off since this expense was added. Click Recalculate to see the split based on today's meal data before saving.</div>
        <button class="gc-add-btn" style="margin-top:10px; background:linear-gradient(135deg,#475569,#334155); box-shadow:0 3px 10px rgba(51,65,85,0.24);" onclick="recalcExpenseEditPreview()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Recalculate from current meal data
        </button>
        ${_editExpRecalcPreviewHtml()}
      </div>
    </div>
    <div class="gc-footer-row" style="margin-top:16px;">
      <button class="gc-add-btn" onclick="saveExpenseEdit('${d.id}')">Save Changes</button>
      <button class="btn secondary" style="margin:0;" onclick="closeDetailsModal()">Cancel</button>
    </div>
  `;
}

function refreshExpenseEditModal() {
  openDetailsModal('Edit Shared Expense', renderExpenseEditModalBody());
}

function updateEditExpDraft(field, value) {
  editExpDraft[field] = value;
  // Changing the date or which meal to split by invalidates any preview
  // already shown (it was computed for the OLD date/meal) — clear it so a
  // stale preview never gets mistaken for the current one.
  if (field === 'date' || field === 'mealtypeSelect' || field === 'amount') editExpDraft.preview = null;
}

function toggleEditExpDraftMember(memberId, checked) {
  const idx = editExpDraft.checkedMembers.indexOf(memberId);
  if (checked && idx === -1) editExpDraft.checkedMembers.push(memberId);
  else if (!checked && idx !== -1) editExpDraft.checkedMembers.splice(idx, 1);
}

function setEditExpSplitMode(mode) {
  editExpDraft.splitMode = mode;
  editExpDraft.preview = null;
  refreshExpenseEditModal();
}

// Preview-only: shows what the split WOULD be right now, without saving
// anything. Actual persistence only happens if/when Save is clicked — see
// saveExpenseEdit() below, which recomputes fresh from live data anyway
// (this preview is purely so the person can see it before committing).
function recalcExpenseEditPreview() {
  const d = editExpDraft;
  const result = computeExpenseSplit('meal', d.date, Number(d.amount), null, d.mealtypeSelect);
  editExpDraft.preview = result;
  refreshExpenseEditModal();
}

function handleExpenseEditClick(id) {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can edit shared expense entries.', 'error');
    return;
  }
  const e = state.expenses.find(x => x.id === id);
  if (!e) {
    showToast('This expense record could not be found — it may have just been deleted.', 'error');
    return;
  }
  editExpDraft = {
    id,
    date: e.date,
    amount: e.amount,
    title: e.title || '',
    description: e.description || '',
    purchasedby: e.purchasedBy || '',
    splitMode: e.splitType || 'all',
    checkedMembers: e.splitType === 'selected' ? e.memberIds.slice() : [],
    mealtypeSelect: e.mealTypeSplit || 'both',
    preview: null
  };
  refreshExpenseEditModal();
}

async function saveExpenseEdit(id) {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can edit shared expense entries.', 'error');
    return;
  }
  const e = state.expenses.find(x => x.id === id);
  if (!e || !editExpDraft) {
    closeDetailsModal();
    showToast('This expense record could not be found — it may have just been deleted.', 'error');
    return;
  }
  const date = document.getElementById('editexp-date').value;
  const amount = Number(document.getElementById('editexp-amount').value);
  const title = document.getElementById('editexp-title').value.trim();
  const description = document.getElementById('editexp-description').value.trim();
  const purchasedBy = document.getElementById('editexp-purchasedby').value;
  if (!date || !amount) {
    showToast('Date and amount are required.', 'error');
    return;
  }
  if (!title) {
    showToast('Title is required.', 'error');
    return;
  }
  const oldMonth = e.date.slice(0, 7);
  const newMonth = date.slice(0, 7);
  if (!guardAdminMonthAccess(oldMonth, 'expenses')) return;
  if (newMonth !== oldMonth && !guardAdminMonthAccess(newMonth, 'expenses')) return;

  // Always recompute fresh from LIVE data at save time — regardless of
  // whether Recalculate was clicked — so Save can never persist a split
  // that's already out of date the moment it lands, e.g. someone else
  // changed a meal in the second it took to click Save.
  const selectedMemberIds = editExpDraft.splitMode === 'selected'
    ? Array.from(document.querySelectorAll('.editexp-member-check:checked')).map(el => el.value)
    : null;
  const mealtypeSelectVal = document.getElementById('editexp-mealtype-select')
    ? document.getElementById('editexp-mealtype-select').value
    : editExpDraft.mealtypeSelect;
  const split = computeExpenseSplit(editExpDraft.splitMode, date, amount, selectedMemberIds, mealtypeSelectVal);
  if (split.error) {
    showToast(split.error, 'error');
    return;
  }

  e.date = date;
  e.amount = amount;
  e.title = title;
  e.description = description;
  e.purchasedBy = purchasedBy;
  e.memberIds = split.memberIds;
  e.splitType = editExpDraft.splitMode;
  if (split.shares) e.shares = split.shares; else delete e.shares;
  if (split.mealTypeSplit) e.mealTypeSplit = split.mealTypeSplit; else delete e.mealTypeSplit;
  // Audit trail — see the matching comment in saveCostEdit() (13-costs.js).
  e.editedBy = memberById(session.userId).name;
  e.editedAt = nowTimestamp();

  editExpDraft = null;
  closeDetailsModal();
  renderTabContent();
  showSuccessCheck('Shared expense updated.');
  persistExpense(id);
}

async function deleteExpense(id) {
  if (session.role !== 'superadmin') {
    showToast('You are not authorized to delete expense records.', 'error');
    return;
  }
  const rec = state.expenses.find(e => e.id === id);
  if (!rec) {
    showToast('This expense record could not be found — it may have just been deleted.', 'error');
    return;
  }
  if (!guardAdminMonthAccess(rec.date.slice(0, 7), 'expenses')) return;
  // UNDO TOAST (same pattern as deleteCost() in 13-costs.js): the record
  // disappears from the list immediately, but the actual Firestore delete
  // (deleteExpenseDoc) is deferred until the toast's undo window runs out.
  const idx = state.expenses.findIndex(e => e.id === id);
  state.expenses = state.expenses.filter(e => e.id !== id);
  renderTabContent();
  showUndoToast(
    `Deleted: ${rec.date} · "${rec.title || ''}" · ${fmtMoney(rec.amount)}`,
    () => {
      state.expenses.splice(idx, 0, rec);
      renderTabContent();
    },
    () => deleteExpenseDoc(id)
  );
}

/* ---------------- BALANCES / DEPOSITS ---------------- */
/* ===== 15-deposits.js ===== */
// ---------------------------------------------------------------------------
// 15-deposits.js  (originally app.js lines 5521-5832)
// Deposits/withdrawals tab: renderDeposits, balance preview updates, add deposit/withdrawal, delete
// ---------------------------------------------------------------------------
let depositsViewMode = 'month';
let depositsSearch = '';
let depositsSort = {
  key: 'date',
  dir: 'desc'
};

function depositsSortArrowHtml(key) {
  if (depositsSort.key !== key) return '';
  return depositsSort.dir === 'asc' ? ' <span class="sort-arrow">▲</span>' : ' <span class="sort-arrow">▼</span>';
}

function setDepositsSort(key) {
  if (depositsSort.key === key) {
    depositsSort.dir = depositsSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    depositsSort.key = key;
    depositsSort.dir = (key === 'member' || key === 'type') ? 'asc' : 'desc';
  }
  renderTabContent();
}

function setDepositsView(mode) {
  depositsViewMode = mode;
  renderTabContent();
}

function setDepositsSearch(val) {
  depositsSearch = val;
  renderTabContent();
  const el = document.getElementById('deposits-search');
  if (el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

function renderDeposits() {
  const canDelete = session.role === 'superadmin';
  const showTimeCol = shouldShowRecordedAt();
  const memberOptions = state.members.map(m => {
    const bal = memberTotalBalance(m.id);
    return `<option value="${m.id}">${m.name} — ${fmtMoney(bal)}</option>`;
  }).join('');
  const balRows = state.members.map(m => {
    const bal = memberTotalBalance(m.id);
    const fmt = bal >= 0 ? `<span class="pos">${fmtMoney(bal)}</span>` : `<span class="neg">-${fmtMoney(Math.abs(bal))}</span>`;
    return `<tr><td>${m.name} ${roleBadgeHtml(m)}</td><td class="num">${fmt}</td></tr>`;
  }).join('');

  const scoped = (depositsViewMode === 'month' ? state.deposits.filter(d => d.date.startsWith(currentMonth)) : state.deposits.slice())
    .map(d => ({
      ...d,
      memberName: memberById(d.memberId)?.name || '?'
    }));

  const q = depositsSearch.trim().toLowerCase();
  let list = q ? scoped.filter(d =>
    d.memberName.toLowerCase().includes(q) ||
    d.date.includes(q) ||
    (d.note || '').toLowerCase().includes(q) ||
    (d.type === 'withdrawal' ? 'withdrawal' : 'deposit').includes(q)
  ) : scoped;

  const sortKey = depositsSort.key;
  const dir = depositsSort.dir === 'asc' ? 1 : -1;
  list = list.slice().sort((a, b) => {
    let av, bv;
    switch (sortKey) {
      case 'member':
        av = a.memberName.toLowerCase();
        bv = b.memberName.toLowerCase();
        break;
      case 'type':
        av = (a.type === 'withdrawal' ? 'withdrawal' : 'deposit');
        bv = (b.type === 'withdrawal' ? 'withdrawal' : 'deposit');
        break;
      case 'amount':
        av = Number(a.amount);
        bv = Number(b.amount);
        break;
      default:
        av = a.date;
        bv = b.date;
        break; // 'date'
    }
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });

  const rows = list.map(d => {
    let row = `<tr>
      <td class="mono">${d.date}</td>
      <td>${d.memberName}</td>
      <td>${d.type==='withdrawal'?'Withdrawal':'Deposit'}</td>
      <td>${d.note||'-'}</td>
      <td class="num ${d.amount<0?'neg':'pos'}">${d.amount<0?'-':'+'}${fmtMoney(Math.abs(d.amount))}</td>`;
    if (showTimeCol) {
      row += `<td class="small-note" style="margin:0;">${formatBDDateTime(d.createdAt)}</td>`;
    }
    row += `<td>${d.addedBy||''}</td>
      <td>${canDelete?`<button class="del-btn" onclick="deleteDeposit('${d.id}')">Delete</button>`:''}</td>
    </tr>`;
    return row;
  }).join('');
  let header = `<tr>
    <th class="sortable-th" onclick="setDepositsSort('date')">Date${depositsSortArrowHtml('date')}</th>
    <th class="sortable-th" onclick="setDepositsSort('member')">Member${depositsSortArrowHtml('member')}</th>
    <th class="sortable-th" onclick="setDepositsSort('type')">Type${depositsSortArrowHtml('type')}</th>
    <th>Note</th>
    <th class="num sortable-th" onclick="setDepositsSort('amount')">Amount${depositsSortArrowHtml('amount')}</th>`;
  if (showTimeCol) header += `<th>Recorded At</th>`;
  header += `<th>Added By</th><th></th></tr>`;
  const emptyMsg = scoped.length === 0 ? 'No deposits or withdrawals recorded yet.' : 'No records match your search.';
  const monthDep = monthTotalDeposits(currentMonth);
  const monthWd = monthTotalWithdrawals(currentMonth);
  const monthNet = monthNetBalanceChange(currentMonth);
  const monthSummaryCard = depositsViewMode === 'month' ? `
    <div class="card">
      <h2>${currentMonth} Summary</h2>
      <div class="summary-grid">
        <div class="summary-box"><div class="label">Total Deposits</div><div class="value pos">${fmtMoney(monthDep)}</div></div>
        <div class="summary-box"><div class="label">Total Withdrawn</div><div class="value ${monthWd>0?'neg':''}">${fmtMoney(monthWd)}</div></div>
        <div class="summary-box"><div class="label">Remaining Operating Cash</div><div class="value ${monthNet>=0?'pos':'neg'}">${monthNet>=0?'':'-'}${fmtMoney(Math.abs(monthNet))}</div></div>
      </div>
    </div>` : '';
  return `
    <div class="card keep-native-tables">
      <h2>Current Balances</h2>
      <div class="table-responsive">
        <table><thead><tr><th>Name</th><th class="num">Balance</th></tr></thead><tbody>${balRows}</tbody></table>
      </div>
    </div>
    ${monthSummaryCard}
    <div class="card">
      <h2>Add Deposit</h2>
      <div class="form-grid">
        <div><label>Member</label><select id="dep-member">${memberOptions}</select></div>
        <div><label>Date</label><input type="date" id="dep-date" value="${todayStr()}"></div>
        <div><label>Amount (৳)</label><input type="number" id="dep-amount" min="0.001" step="0.001" placeholder="e.g. 10.75"></div>
        <div><label>Note</label><input type="text" id="dep-note" placeholder="Optional"></div>
      </div>
      <div id="dep-member-balance" class="small-note" style="margin-top:6px;"></div>
      <button class="btn" onclick="addDeposit()">Add</button>
    </div>
    <div class="card">
      <h2>Withdraw Funds</h2>
      <div class="small-note" style="margin-bottom:10px;">A member can only withdraw from a positive balance, and never more than what's currently available.</div>
      <div class="form-grid">
        <div><label>Member</label><select id="wd-member">${memberOptions}</select></div>
        <div><label>Date</label><input type="date" id="wd-date" value="${todayStr()}"></div>
        <div><label>Amount (৳)</label><input type="number" id="wd-amount" min="0.001" step="0.001" placeholder="e.g. 10.75"></div>
        <div><label>Note</label><input type="text" id="wd-note" placeholder="Optional"></div>
      </div>
      <div id="wd-member-balance" class="small-note" style="margin-top:6px;"></div>
      <button class="btn" onclick="addWithdrawal()">Withdraw</button>
    </div>
    <div class="card keep-native-tables">
      <div class="row-between">
        <h2>Deposit List</h2>
        <div>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(-1, setDepositsView)" title="Previous month">‹</button>
          <button class="btn secondary ${depositsViewMode==='month'?'active-toggle':''}" style="margin-top:0;" onclick="setDepositsView('month')">${currentMonth}</button>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(1, setDepositsView)" title="Next month">›</button>
          <button class="btn secondary ${depositsViewMode==='all'?'active-toggle':''}" style="margin-top:0;" onclick="setDepositsView('all')">All Time</button>
        </div>
      </div>
      <div class="row-between" style="margin-bottom:14px;">
        <input type="text" id="deposits-search" class="search-input" placeholder="Search member, note, date, type..." value="${depositsSearch.replace(/"/g,'&quot;')}" oninput="setDepositsSearch(this.value)">
        ${q ? `<div class="small-note" style="margin:0;">${list.length} of ${scoped.length} records</div>` : ''}
      </div>
      ${list.length ? `<div class="table-responsive"><table><thead>${header}</thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${emptyMsg}</div>`}
    </div>`;
}

function updateDepMemberBalance() {
  const sel = document.getElementById('dep-member');
  const el = document.getElementById('dep-member-balance');
  if (!sel || !el) return;
  const bal = memberTotalBalance(sel.value);
  el.innerHTML = bal >= 0 ?
    `Current balance: <span class="pos">${fmtMoney(bal)}</span>` :
    `Current balance: <span class="neg">-${fmtMoney(Math.abs(bal))}</span>`;
}

function updateWdMemberBalance() {
  const sel = document.getElementById('wd-member');
  const el = document.getElementById('wd-member-balance');
  if (!sel || !el) return;
  const bal = memberTotalBalance(sel.value);
  el.innerHTML = bal > 0 ?
    `Available to withdraw: <span class="pos">${fmtMoney(bal)}</span>` :
    `Available to withdraw: <span class="neg">${fmtMoney(0)}</span> <span class="small-note" style="margin:0;">(balance is ${bal===0?'zero':'negative'} — nothing can be withdrawn)</span>`;
}

function attachDepositHandlers() {
  const sel = document.getElementById('dep-member');
  if (sel) {
    sel.addEventListener('change', updateDepMemberBalance);
    updateDepMemberBalance();
  }
  const wdSel = document.getElementById('wd-member');
  if (wdSel) {
    wdSel.addEventListener('change', updateWdMemberBalance);
    updateWdMemberBalance();
  }
}
async function addDeposit() {
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    showToast('You are not authorized to add deposits.', 'error');
    return;
  }
  const memberId = document.getElementById('dep-member').value;
  const date = document.getElementById('dep-date').value;
  const amountRaw = document.getElementById('dep-amount').value;
  const amount = parseFloat(amountRaw);
  const note = document.getElementById('dep-note').value.trim();
  if (!date) {
    showToast('Date is required.', 'error');
    return;
  }
  if (amountRaw === '' || isNaN(amount) || amount <= 0) {
    showToast('Enter a valid positive amount (greater than 0).', 'error');
    return;
  }
  if (!guardAdminMonthAccess(date.slice(0, 7), 'deposits')) return;
  const newId = 'd' + Date.now();
  state.deposits.push({
    id: newId,
    memberId,
    date,
    amount,
    note,
    type: 'deposit',
    addedBy: memberById(session.userId).name,
    createdAt: nowTimestamp()
  });
  if (memberId !== session.userId && notifTypeEnabled('deposit')) {
    addNotification(memberId, {
      type: 'deposit',
      title: 'Deposit added',
      message: `৳${fmtMoney(amount)} was added to your balance on ${date} by ${memberById(session.userId).name}.`,
      dedupeKey: `deposit::${newId}`
    });
  }
  // Optimistic UI: paint immediately from local state instead of waiting on
  // the Firestore round trip. persistDeposit() still runs in the background
  // and still shows its own error toast if the write actually fails.
  renderTabContent();
  showSuccessCheck('Deposit added.');
  persistDeposit(newId);
}
// Withdraw money FROM a member's balance. Stored as a deposit record with a
// negative amount (type:'withdrawal') so the existing balance math (which
// just sums state.deposits amounts) subtracts it automatically — no changes
// needed anywhere else that reads deposits/balances.
async function addWithdrawal() {
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    showToast('You are not authorized to record withdrawals.', 'error');
    return;
  }
  const memberId = document.getElementById('wd-member').value;
  const date = document.getElementById('wd-date').value;
  const amountRaw = document.getElementById('wd-amount').value;
  const amount = parseFloat(amountRaw);
  const note = document.getElementById('wd-note').value.trim();
  if (!date) {
    showToast('Date is required.', 'error');
    return;
  }
  if (amountRaw === '' || isNaN(amount) || amount <= 0) {
    showToast('Enter a valid positive amount (greater than 0).', 'error');
    return;
  }
  const bal = memberTotalBalance(memberId);
  if (bal <= 0) {
    showToast(`${memberById(memberId).name}'s balance is ${bal===0?'zero':'negative'} — nothing can be withdrawn.`, 'error');
    return;
  }
  if (amount > bal) {
    showToast(`Can't withdraw ৳${amount} — ${memberById(memberId).name}'s available balance is only ${fmtMoney(bal)}.`, 'error');
    return;
  }
  if (!guardAdminMonthAccess(date.slice(0, 7), 'deposits')) return;
  const newId = 'd' + Date.now();
  state.deposits.push({
    id: newId,
    memberId,
    date,
    amount: -amount,
    note,
    type: 'withdrawal',
    addedBy: memberById(session.userId).name,
    createdAt: nowTimestamp()
  });
  if (memberId !== session.userId && notifTypeEnabled('withdrawal')) {
    addNotification(memberId, {
      type: 'withdrawal',
      title: 'Withdrawal recorded',
      message: `৳${fmtMoney(amount)} was withdrawn from your balance on ${date} by ${memberById(session.userId).name}.`,
      dedupeKey: `withdrawal::${newId}`
    });
  }
  // Optimistic UI — see addDeposit() for why this no longer awaits the write.
  renderTabContent();
  showSuccessCheck('Withdrawal recorded.');
  persistDeposit(newId);
}
async function deleteDeposit(id) {
  if (session.role !== 'superadmin') {
    showToast('You are not authorized to delete deposit records.', 'error');
    return;
  }
  const rec = state.deposits.find(d => d.id === id);
  if (!rec) {
    showToast('This deposit record could not be found — it may have just been deleted.', 'error');
    return;
  }
  if (!guardAdminMonthAccess(rec.date.slice(0, 7), 'deposits')) return;
  // UNDO TOAST (same pattern as deleteCost()/deleteExpense()): the record
  // disappears from the list immediately, but the actual Firestore delete
  // (deleteDepositDoc) is deferred until the toast's undo window runs out.
  const memberName = memberById(rec.memberId)?.name || 'Unknown member';
  const typeLabel = rec.type === 'withdrawal' ? 'Withdrawal' : 'Deposit';
  const idx = state.deposits.findIndex(d => d.id === id);
  state.deposits = state.deposits.filter(d => d.id !== id);
  renderTabContent();
  showUndoToast(
    `Deleted: ${rec.date} · ${memberName} · ${fmtMoney(Math.abs(rec.amount))}`,
    () => {
      state.deposits.splice(idx, 0, rec);
      renderTabContent();
    },
    () => deleteDepositDoc(id)
  );
}

/* ---------------- MEMBERS (superadmin only) ---------------- */
/* ===== 16-members.js ===== */
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
        <div class="member-avatar ${memberAvatarClass(m.id)}" title="${roleLabelFor[m.role]}">${initials}</div>
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
        <span class="mono" style="font-size:20px; font-weight:700; background:var(--surface-alt); color:var(--ink); border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px 14px;">${state.recoveryCode}</span>
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
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can add members.', 'error');
    return;
  }
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
/* ===== 17-logs.js ===== */
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
/* ===== 18-settings-admin.js ===== */
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
      <div style="border-bottom:1px solid var(--border); padding:16px 0; margin:16px 0;">
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
        <div style="background:var(--surface-alt); padding:12px; border-radius:6px; margin-top:12px;">
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
    <div class="card" style="border:1px solid var(--danger); ">
      <h2 style="color:var(--danger);">Danger Zone</h2>
      <div class="small-note" style="margin-bottom:14px;">For use before a real release: permanently wipes all meals, deposits, expenses, grocery costs, login logs and notifications for every member — in one go, instead of deleting each record by hand. Members and settings are kept.</div>
      <button class="btn" style="background:var(--danger); border-color:var(--danger);" onclick="resetTestData()">Reset All Test Data</button>
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
    ${session.role === 'superadmin' ? `
    <div class="card" style="border:1px solid ${s.maintenanceMode ? 'var(--danger)' : 'var(--border)'};">
      <h2><i class="fas fa-triangle-exclamation"></i> Maintenance Mode</h2>
      <div class="small-note" style="margin-bottom:14px;">
        When ON: only super admins can sign in. Everyone else sees the message below instead of the login screen, and anyone already using the app (except super admins) is immediately signed out to this same message — no further data is fetched for them while this is on.
      </div>
      ${s.maintenanceMode ? `<div class="small-note" style="color:var(--danger); font-weight:700; margin-bottom:10px;"><i class="fas fa-circle" style="font-size:8px;"></i> Currently ON — only super admins can use the app</div>` : ''}
      <div class="form-grid">
        <div>
          <label>Maintenance Mode</label>
          <select id="set-maintenanceMode">
            <option value="false" ${!s.maintenanceMode?'selected':''}>Off</option>
            <option value="true" ${s.maintenanceMode?'selected':''}>On</option>
          </select>
        </div>
        <div>
          <label>Message shown to everyone else</label>
          <textarea id="set-maintenanceMessage" rows="3" placeholder="e.g. We're doing scheduled maintenance — back shortly.">${escapeHtml(s.maintenanceMessage || '')}</textarea>
        </div>
      </div>
      <button class="btn" style="${s.maintenanceMode?'':'background:var(--danger); border-color:var(--danger);'}" onclick="saveMaintenanceSettings()">${s.maintenanceMode ? 'Save' : 'Save &amp; Turn On'}</button>
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
    notifications: state.settings.notifications,
    // Not edited by this form — see saveMaintenanceSettings() below. Carried
    // forward as-is so saving any other setting here doesn't silently wipe
    // maintenance mode back off.
    maintenanceMode: state.settings.maintenanceMode || false,
    maintenanceMessage: state.settings.maintenanceMessage || ''
  };
  await persistSettings();
  lastActivityWriteAt = 0;
  refreshSessionActivity();
  showToast('Settings saved.', 'success');
  renderTabContent();
}
// Superadmin-only kill switch — see the maintenanceMode/maintenanceMessage
// comment in defaultSettings() (02-state-storage.js) for the full design:
// once this saves with maintenanceMode true, doLogin() (06-auth.js) blocks
// every non-superadmin login, and applyFreshState() (05-session-sync.js)
// signs out anyone already inside the app the moment this snapshot reaches
// them. Kept as its own small save handler (like the notification settings
// card above) so it's a single, deliberate action — not bundled into the
// big saveSettings() form where it could be flipped on by accident while
// saving something unrelated.
async function saveMaintenanceSettings() {
  if (session.role !== 'superadmin') {
    showToast('Only the super admin can do this.', 'error');
    return;
  }
  const maintenanceMode = document.getElementById('set-maintenanceMode').value === 'true';
  const maintenanceMessage = document.getElementById('set-maintenanceMessage').value.trim();
  if (maintenanceMode && !maintenanceMessage) {
    showToast('Add a message for the people who\'ll see it before turning this on.', 'error');
    return;
  }
  if (maintenanceMode && !confirm('Turn maintenance mode ON? Everyone except super admins will be signed out immediately and unable to log back in until you turn this off.')) {
    return;
  }
  state.settings.maintenanceMode = maintenanceMode;
  state.settings.maintenanceMessage = maintenanceMessage;
  await persistSettings();
  lastActivityWriteAt = 0;
  refreshSessionActivity();
  showToast(maintenanceMode ? 'Maintenance mode is ON.' : 'Maintenance mode is off.', 'success');
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
/* ===== 19-backup-testdata.js ===== */
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

/* ===== 20-bootstrap.js ===== */
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
      // Superadmin-only kill switch — see the maintenanceMode/
      // maintenanceMessage comment in defaultSettings() (02-state-storage.js).
      // BUGFIX: this check was missing entirely on the persisted-session
      // auto-login path. doLogin() blocks a fresh manual sign-in, and
      // applyFreshState() signs out someone already active inside an open
      // session — but a device with a remembered (persisted) session for a
      // non-superadmin member was resuming straight into the app on every
      // page load/reopen, completely bypassing maintenance mode, until
      // some unrelated data change happened to trigger the next live
      // snapshot. `state.settings` is already the current data here (just
      // set from fetchLoginScreenState() right before this call — see
      // init() above), so this is checked before ever calling enterApp()/
      // enterAppWithFullData(), the same way doLogin() checks before
      // calling either of those.
      if (state.settings.maintenanceMode && m.role !== 'superadmin') {
        // Deliberately NOT clearing the persisted session — maintenance is
        // a temporary state, not a reason to force this person to type
        // their PIN again once it's back off. Just skip auto-entering for
        // now; the same persisted session resumes normally next time this
        // runs, once maintenanceMode is off again.
        renderLogin();
        return;
      }
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