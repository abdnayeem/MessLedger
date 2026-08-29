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