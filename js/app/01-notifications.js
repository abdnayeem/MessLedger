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