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