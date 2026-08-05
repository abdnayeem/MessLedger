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
    #market-completion-overlay .mc-modal{position:relative; width:100%; max-width:400px; background:var(--card-bg,#fff); color:var(--text,#0f172a); border-radius:16px; padding:26px 24px; box-shadow:0 20px 60px rgba(0,0,0,0.35); animation:mcModalPop .25s ease-out;}
    @keyframes mcModalPop{ from{opacity:0; transform:translateY(12px) scale(.97);} to{opacity:1; transform:translateY(0) scale(1);} }
    #market-completion-overlay .mc-icon{font-size:30px; text-align:center; margin-bottom:6px;}
    #market-completion-overlay h2{font-size:18px; text-align:center; margin:0 0 14px;}
    #market-completion-overlay .mc-row{display:flex; justify-content:space-between; gap:10px; font-size:13.5px; padding:8px 0; border-bottom:1px solid var(--border,#e5e7eb);}
    #market-completion-overlay .mc-row:last-of-type{border-bottom:none;}
    #market-completion-overlay .mc-row .mc-label{opacity:0.65; font-weight:600;}
    #market-completion-overlay .mc-row .mc-value{text-align:right; font-weight:600;}
    #market-completion-overlay .mc-items-box{margin-top:6px; margin-bottom:18px; font-size:13px; background:var(--input-bg,#f8fafc); border-radius:9px; padding:10px 12px; line-height:1.5;}
    #market-completion-overlay .mc-btns{display:flex; flex-direction:column; gap:9px; margin-top:18px;}
    #market-completion-overlay .mc-btn-primary{width:100%; text-align:center;}
    #market-completion-overlay .mc-btn-later{width:100%; text-align:center; background:transparent; border:1px solid var(--border,#d8dee9); color:inherit; border-radius:9px; padding:10px; font-size:14px; cursor:pointer; font-family:inherit;}
    #market-completion-overlay .mc-btn-later:hover{background:var(--input-bg,#f1f5f9);}
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

/* ---------------- DASHBOARD ---------------- */
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
        <div class="stat-grid-2col">
          <div class="stat-tile"><i class="fas fa-utensils"></i><div class="stat-tile-title">Meals</div><div class="stat-tile-value">${meals}</div></div>
          <div class="stat-tile"><i class="fas fa-piggy-bank"></i><div class="stat-tile-title">Deposits</div><div class="stat-tile-value">${fmtMoney(dep)}</div></div>
          <div class="stat-tile"><i class="fas fa-bowl-food"></i><div class="stat-tile-title">Meal Cost</div><div class="stat-tile-value">${fmtMoney(cost)}</div></div>
          <div class="stat-tile"><i class="fas fa-receipt"></i><div class="stat-tile-title">Shared Expense</div><div class="stat-tile-value">${fmtMoney(expShare)}</div></div>
          <div class="stat-tile"><i class="fas fa-wallet"></i><div class="stat-tile-title">Total Expense</div><div class="stat-tile-value">${fmtMoney(totalExpense)}</div></div>
          <div class="stat-tile"><i class="fas fa-calculator"></i><div class="stat-tile-title">Personal Rate</div><div class="stat-tile-value">${personalRate!==null ? fmtMoney(personalRate) : '—'}</div></div>
          <div class="stat-tile"><i class="fas fa-clock-rotate-left"></i><div class="stat-tile-title">Prior Balance</div><div class="stat-tile-value ${opening>=0?'pos':'neg'}">${opening>=0?'':'-'}${fmtMoney(Math.abs(opening))}</div></div>
          <div class="stat-tile"><i class="fas fa-scale-balanced"></i><div class="stat-tile-title">Total Balance</div><div class="stat-tile-value ${grandTotal>=0?'pos':'neg'}" style="font-weight:800;">${grandTotal>=0?'':'-'}${fmtMoney(Math.abs(grandTotal))}</div></div>
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
        <div class="small-note" style="margin:0;">Your personal meal rate — for reference only, not used in balance calculations.</div>
        <div class="mono" style="font-size:22px; font-weight:700; margin-top:6px; cursor:help;" title="${myPersonalRate!==null ? myRateBreakdown : 'No meals recorded this month yet'}">${myPersonalRate!==null ? fmtMoney(myPersonalRate) : '—'} <span class="small-note" style="font-weight:400; font-size:13px;">/ meal</span></div>
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
          <span><b>${e.title}</b>${e.description ? `<span class="small-note" style="margin:0;"> — ${e.description}</span>` : ''}</span>
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
      <div class="small-note" style="margin-top:6px;">Everything logged in Costs + Expenses on ${dashboardExpenseDate}. This is raw money spent that day, not per-member meal charges.</div>
    </div>`;
  const schedList = membersWithSchedule();
  const todayDuty = schedList.filter(x => x.info && x.info.isToday);
  const upcomingDuty = schedList.filter(x => x.info && !x.info.isToday).sort((a, b) => a.info.daysLeft - b.info.daysLeft);
  let marketBox = '';
  if (todayDuty.length) {
    const t = dayMealTotals(todayStr());
    marketBox = `<div class="card" style="background:var(--success-bg); border-color:#C8ECD6;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
        <div><b style="color:var(--success);">🛒 Market duty today:</b> ${todayDuty.map(x=>`${x.member.name} (${shiftLabel(x.member.marketShift)})`).join(', ')}</div>
        <button class="btn secondary" style="margin-top:0;" onclick="setTab('schedule')">View full schedule</button>
      </div>
      ${todayDuty.filter(x=>x.member.marketItems).map(x=>`<div class="small-note" style="margin-top:4px;">🧺 <b>${x.member.name}</b>'s items: ${x.member.marketItems}</div>`).join('')}
      <div class="small-note" style="margin-top:8px; background:#FEF3C7; border:1px dashed #F59E0B; border-radius:var(--radius-sm); padding:7px 10px; color:#92400E; font-weight:600;">🛒 Shop for today's meals — <b style="font-size:17px;">${t.lunch}</b> Lunch, <b style="font-size:17px;">${t.dinner}</b> Dinner (<b style="font-size:17px;">${t.total}</b> total). <span style="font-weight:400;">Numbers may still change if members update their meals later.</span></div>
    </div>`;
  } else if (upcomingDuty.length) {
    // Show everyone whose duty falls on that same nearest date (e.g. one
    // person on Lunch and another on Dinner the same day) — not just
    // whichever one happened to sort first.
    const nearestDays = upcomingDuty[0].info.daysLeft;
    const nextGroup = upcomingDuty.filter(x => x.info.daysLeft === nearestDays);
    const names = nextGroup.map(x => `<b>${x.member.name}</b> (${shiftLabel(x.member.marketShift)})`).join(', ');
    const g = nextGroup[0].info;
    marketBox = `<div class="card" style="background:var(--warning-bg); border-color:#FCE3B0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
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
      <div class="small-note" style="margin:0 0 10px;">Pick a day to download that day's meal rate report for everyone, or grab your own full-month report at once.</div>
      <div style="margin-bottom:10px;">
        <label style="font-size:12.5px;">Select day</label>
        <input type="date" id="personal-report-date" value="${todayStr()}">
      </div>
      <div style="display:flex; gap:10px; flex-wrap:nowrap;">
        <button class="btn btn-download-highlight" style="flex:1; min-width:0;" onclick="downloadDailyMealRateReport()"><span class="dl-icon">⬇️</span> <span class="dl-label">Day Report (Everyone)</span></button>
        <button class="btn btn-download-highlight" style="flex:1; min-width:0;" onclick="downloadPersonalMonthReport()"><span class="dl-icon">⬇️</span> <span class="dl-label">${currentMonth} (Mine)</span></button>
      </div>
    </div>`;

  return `
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
              <th class="num">Dep+Carry</th>
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
      <h2>Mess Account Summary</h2>
      <div class="small-note" style="margin:0 0 10px; background:#FEF3C7; border:1px dashed #F59E0B; border-radius:var(--radius-sm); padding:7px 10px; color:#92400E; font-weight:600;">⚠️ These are ALL-TIME totals — everything since the mess started, added across all ${state.members.length} member(s) and every past month combined. This is NOT ${currentMonth}'s number — see the ${currentMonth} Summary card above for that.</div>
      <div class="summary-grid">
        <div class="summary-box"><div class="label">Total Grocery Cost (All-Time)</div><div class="value">${fmtMoney(allTimeTotalGroceryCost())}</div></div>
        <div class="summary-box"><div class="label">Total Shared Expenses (All-Time)</div><div class="value">${fmtMoney(allTimeTotalSharedExpense())}</div></div>
        <div class="summary-box"><div class="label">Total Cost, Grocery + Shared (All-Time)</div><div class="value neg">${fmtMoney(groupExpenses)}</div></div>
        <div class="summary-box"><div class="label">Total Deposit (All-Time)</div><div class="value pos">${fmtMoney(allTimeTotalDepositsGross())}</div></div>
        <div class="summary-box"><div class="label">Total Withdrawal (All-Time)</div><div class="value ${allTimeTotalWithdrawals()>0?'neg':''}">${fmtMoney(allTimeTotalWithdrawals())}</div></div>
        <div class="summary-box"><div class="label">Cash in Hand (All-Time)</div><div class="value ${groupCash>=0?'pos':'neg'}">${fmtMoney(groupCash)}</div></div>
      </div>
    </div>
    ${personalReportCard}
    ${(session.role==='admin' || session.role==='superadmin') ? `
    <div class="card">
      <h2>Member Info</h2>
      <div class="small-note" style="margin-bottom:10px;">Account creation date/time (Bangladesh time).</div>
      <div class="table-responsive member-info-desktop-table">
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Role</th><th>Account Created</th></tr></thead>
          <tbody>${state.members.map(m=>`<tr>
            <td>${m.name}</td>
            <td>${m.phone||'-'}</td>
            <td>${roleBadgeHtml(m)}</td>
            <td>${m.createdAt ? formatBDDateTime(m.createdAt) : '<span class="small-note" style="margin:0;">Unknown (before tracking)</span>'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="member-info-list">
        ${state.members.map(m=>`
        <div class="member-info-card">
          <div class="member-info-row">
            <span class="member-info-name"><b>Name:</b> ${m.name}</span>
            ${roleBadgeHtml(m)}
          </div>
          <div class="member-info-row">
            <span class="member-info-phone"><b>Phone:</b> ${m.phone||'-'}</span>
            <span class="member-info-created"><b>Created:</b> ${m.createdAt ? formatBDDateTime(m.createdAt) : 'Unknown (before tracking)'}</span>
          </div>
        </div>`).join('')}
      </div>
    </div>` : ''}`;
}

/* ---------------- MARKET SCHEDULE ---------------- */
function renderSchedule() {
  const list = membersWithSchedule();
  const todayDuty = list.filter(x => x.info && x.info.isToday);
  const upcoming = list.filter(x => x.info && !x.info.isToday).sort((a, b) => a.info.daysLeft - b.info.daysLeft);

  const todayCard = todayDuty.length ?
    `<div class="card" style="background:var(--success-bg); border-color:#C8ECD6;">
        <h2 style="color:var(--success);">🛒 On market duty today</h2>
        ${todayDuty.map(x=>`<div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <div>
            <b>${x.member.name}</b>
            <span class="small-note" style="display:inline; margin-left:6px;">${shiftLabel(x.member.marketShift)}${x.member.phone?` · ${x.member.phone}`:''}</span>
            ${x.member.marketItems ? `<div class="small-note" style="margin-top:3px;">🧺 Items: ${x.member.marketItems}</div>` : ''}
          </div>
          <span class="badge" style="background:${x.info.overdue?'var(--danger-bg)':'var(--success-bg)'}; color:${x.info.overdue?'var(--danger)':'var(--success)'}; border:1px solid ${x.info.overdue?'#F5C2C2':'#C8ECD6'};">${x.info.overdue ? `⚠ Overdue by ${formatCountdown(x.info.remDays, x.info.remHours, x.info.remMinutes)} (deadline was ${formatHour12(x.info.deadlineHour)})` : `Today ✅ · ${formatCountdown(x.info.remDays, x.info.remHours, x.info.remMinutes)} left (by ${formatHour12(x.info.deadlineHour)})`}</span>
        </div>`).join('')}
        <div class="small-note" style="margin-top:10px; background:#FEF3C7; border:1px dashed #F59E0B; border-radius:var(--radius-sm); padding:7px 10px; color:#92400E; font-weight:600;">${(function(){const t=dayMealTotals(todayStr()); return `🛒 Shop for today's meals — <b style="font-size:17px;">${t.lunch}</b> Lunch, <b style="font-size:17px;">${t.dinner}</b> Dinner (<b style="font-size:17px;">${t.total}</b> total).`;})()}</div>
      </div>` :
    `<div class="card"><div class="empty">No one is scheduled for market duty today.</div></div>`;

  // Everyone whose duty falls on that same nearest date (e.g. Lunch person
  // and Dinner person on the same day) — not just whichever sorted first.
  const nearestDaysLeft = upcoming.length ? upcoming[0].info.daysLeft : null;
  const nextGroup = upcoming.filter(x => x.info.daysLeft === nearestDaysLeft);
  const nextCard = nextGroup.length ?
    `<div class="card" style="background:var(--warning-bg); border-color:#FCE3B0;">
        <h2>Next Market Duty</h2>
        ${nextGroup.map(x=>`<div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
          <div>
            <div style="font-size:19px; font-weight:700;">${x.member.name}</div>
            <div class="small-note" style="margin-top:2px;">${WEEKDAYS[x.member.marketDay]} · ${shiftLabel(x.member.marketShift)} · ${fmtShortDate(x.info.date)}</div>
          </div>
          <span class="badge" style="background:#fff; color:var(--warning); border:1px solid #FCE3B0;">${formatCountdown(x.info.remDays, x.info.remHours, x.info.remMinutes)} left</span>
        </div>`).join('')}
      </div>` :
    '';

  const rows = list.map(x => {
    const m = x.member,
      info = x.info;
    let statusCell;
    if (!info) {
      statusCell = `<span class="small-note">Not set</span>`;
    } else if (info.isToday) {
      statusCell = info.overdue ?
        `<span class="neg">Today — ⚠ overdue by ${formatCountdown(info.remDays, info.remHours, info.remMinutes)} (deadline was ${formatHour12(info.deadlineHour)})</span>` :
        `<span class="pos">Today (${formatCountdown(info.remDays, info.remHours, info.remMinutes)} left, by ${formatHour12(info.deadlineHour)})</span>`;
    } else {
      statusCell = `<span class="gold-text">${formatCountdown(info.remDays, info.remHours, info.remMinutes)} left</span> — ${fmtShortDate(info.date)}`;
    }
    const canEditItems = session.role === 'superadmin';
    const itemsCell = canEditItems ?
      `<textarea id="items-${m.id}" rows="2" style="width:170px; font-size:12.5px; padding:5px 7px; border:1px solid var(--border); border-radius:6px; font-family:inherit;" placeholder="e.g. fish, potato, onion">${m.marketItems||''}</textarea><br><button class="btn secondary" style="margin-top:4px; padding:3px 9px; font-size:11px;" onclick="saveMarketItems('${m.id}')">Save</button>` :
      `<span class="small-note">${m.marketItems ? m.marketItems : '—'}</span>`;
    return `<tr>
      <td>${m.name}</td>
      <td>${m.phone || '—'}</td>
      <td>${hasMarketDay(m) ? WEEKDAYS[m.marketDay] : '—'}</td>
      <td>${shiftLabel(m.marketShift)}</td>
      <td>${statusCell}</td>
      <td>${itemsCell}</td>
    </tr>`;
  }).join('');

  // Same data as the table above, laid out as an ultra-compact card per
  // member for phones: Name+Active on line 1, Phone on line 2, Day/Shift/
  // Next-turn as one chip line, then the shopping list.
  const mobileCards = list.map(x => {
    const m = x.member,
      info = x.info;
    const active = isMemberActiveInMonth(m.id, currentMonth);
    const dayChip = hasMarketDay(m) ? WEEKDAYS[m.marketDay].slice(0, 3) : '—';
    const shiftIcon = m.marketShift === 'lunch' ? '☀️' : m.marketShift === 'dinner' ? '🌙' : m.marketShift === 'both' ? '🌗' : '';
    let nextTurnText;
    if (!info) {
      nextTurnText = 'Not set';
    } else if (info.isToday) {
      nextTurnText = info.overdue ? `⚠ Overdue (${formatCountdown(info.remDays, info.remHours, info.remMinutes)})` : `Today (${formatCountdown(info.remDays, info.remHours, info.remMinutes)} left)`;
    } else {
      nextTurnText = `${fmtShortDate(info.date)} (${formatCountdown(info.remDays, info.remHours, info.remMinutes)} left)`;
    }
    const canEditItems = session.role === 'superadmin';
    const itemsBlock = canEditItems ?
      `<div class="sched-label">Shopping List</div>
         <textarea id="items-m-${m.id}" rows="2" class="sched-textarea" placeholder="e.g. fish, potato, onion">${m.marketItems||''}</textarea>
         <button class="btn sched-save-btn" onclick="saveMarketItems('${m.id}', 'items-m-${m.id}')">Save</button>` :
      (m.marketItems ? `<div class="sched-label">Shopping List</div><div class="sched-items-readonly">${m.marketItems}</div>` : '');
    return `<div class="sched-card">
      <div class="sched-row sched-row-top">
        <span class="sched-name">${m.name}</span>
        <span class="badge" style="${active ? 'background:var(--success-bg); color:var(--success);' : 'background:var(--danger-bg); color:var(--danger);'}">${active ? '🟢 Active' : 'Inactive'}</span>
      </div>
      <div class="sched-row sched-phone">📞 ${m.phone || '—'}</div>
      <div class="sched-row sched-meta">🗓 ${dayChip} • ${shiftIcon} ${shiftLabel(m.marketShift)} • ⏳ ${nextTurnText}</div>
      ${itemsBlock}
    </div>`;
  }).join('');

  return `
    ${todayCard}
    ${nextCard}
    <div class="card">
      <h2>Weekly Market Schedule</h2>
      <div class="table-responsive schedule-desktop-table">
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Market Day</th><th>Shift</th><th>Next Turn</th><th>Items to Buy</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="sched-list">${mobileCards}</div>
    </div>`;
}
async function saveMarketItems(memberId, elId) {
  if (session.role !== 'superadmin') {
    showToast('Only super admin can edit the shopping list.', 'error');
    return;
  }
  const ta = document.getElementById(elId || ('items-' + memberId));
  if (!ta) return;
  const m = memberById(memberId);
  m.marketItems = ta.value.trim();
  await persistMembers();
  renderTabContent();
}

/* ---------------- TIMESTAMPS & VISIBILITY ---------------- */