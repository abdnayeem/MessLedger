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

const _debouncedHistoryGrocerySearchRender = debounce(() => {
  renderTabContent();
  const el = document.getElementById('history-grocery-search');
  if (el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}, 180);
function setHistoryGrocerySearch(val) {
  historyGrocerySearch = val;
  _debouncedHistoryGrocerySearchRender();
}

const _debouncedHistoryExpenseSearchRender = debounce(() => {
  renderTabContent();
  const el = document.getElementById('history-expense-search');
  if (el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}, 180);
function setHistoryExpenseSearch(val) {
  historyExpenseSearch = val;
  _debouncedHistoryExpenseSearchRender();
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