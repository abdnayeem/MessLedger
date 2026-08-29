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