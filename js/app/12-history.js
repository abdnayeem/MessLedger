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
    #details-modal-overlay .details-modal-box{position:relative; width:100%; max-width:460px; max-height:82vh; overflow-y:auto; background:var(--card-bg,#fff); color:var(--ink,#0f172a); border-radius:14px; padding:22px 22px 18px; box-shadow:0 20px 60px rgba(0,0,0,0.35); animation:detailsModalPop .16s ease-out;}
    @keyframes detailsModalPop{ from{opacity:0; transform:translateY(10px) scale(.98);} to{opacity:1; transform:translateY(0) scale(1);} }
    #details-modal-overlay .details-modal-close{position:absolute; top:12px; right:12px; background:none; border:none; font-size:20px; line-height:1; cursor:pointer; color:var(--ink,#0f172a); opacity:0.5; padding:6px;}
    #details-modal-overlay .details-modal-close:hover{opacity:1;}
    #details-modal-overlay h3{margin:0 26px 14px 0; font-size:17px;}
    #details-modal-overlay .detail-row{display:flex; justify-content:space-between; gap:16px; padding:9px 0; border-bottom:1px dashed var(--border,#e5e7eb); font-size:13.5px; line-height:1.4;}
    #details-modal-overlay .detail-row:last-child{border-bottom:none;}
    #details-modal-overlay .detail-label{color:var(--muted,#6b7280); flex-shrink:0; padding-top:1px;}
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
  if (splitType === 'meal') return `<span style="display:inline-block; background:#FEF3C7; border:1px solid #FDE68A; color:#92400E; font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; white-space:nowrap;">🟠 Meal Count</span>`;
  if (isSelected) return `<span style="display:inline-block; background:#DBEAFE; border:1px solid #BFDBFE; color:#1E40AF; font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; white-space:nowrap;">🔵 Specific Members</span>`;
  return `<span style="display:inline-block; background:#D1FAE5; border:1px solid #A7F3D0; color:#065F46; font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; white-space:nowrap;">🟢 Split Equally</span>`;
}
// Compact meal badge — Lunch / Dinner / Both / Other — used for grocery
// cost's meal, and for a shared expense's meal when it's a meal-count split.
const MEAL_BADGE_STYLE = {
  lunch: {
    bg: '#FEF3C7',
    border: '#FDE68A',
    color: '#92400E',
    label: 'Lunch'
  },
  dinner: {
    bg: '#E0E7FF',
    border: '#C7D2FE',
    color: '#3730A3',
    label: 'Dinner'
  },
  both: {
    bg: '#F3E8FF',
    border: '#E9D5FF',
    color: '#6B21A8',
    label: 'Both'
  },
  other: {
    bg: '#F1F5F9',
    border: '#E2E8F0',
    color: '#475569',
    label: 'Other/Grocery'
  }
};

function mealBadge(mealType) {
  const c = MEAL_BADGE_STYLE[mealType] || MEAL_BADGE_STYLE.other;
  return `<span style="display:inline-block; background:${c.bg}; border:1px solid ${c.border}; color:${c.color}; font-size:11px; font-weight:600; padding:3px 9px; border-radius:999px; white-space:nowrap;">${c.label}</span>`;
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
  const mealTable = mealRows.length ? `
    <table><thead><tr><th>Date</th><th>Meal Type</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Deducted</th><th class="num">Balance Before</th><th class="num">Balance After</th>${showTimeCol?'<th>Recorded At</th>':''}</tr></thead>
    <tbody>${mealRows.map(e=>`<tr>
      <td class="mono">${e.date}</td>
      <td>${MEAL_TYPE_LABEL[e.mealType]}</td>
      <td class="num">${e.qty}</td>
      <td class="num">${fmtMoney(e.rate)}</td>
      <td class="num neg">-${fmtMoney(e.amount)}</td>
      <td class="num ${e.balanceBefore<0?'neg':'pos'}">${fmtMoney(e.balanceBefore)}</td>
      <td class="num ${e.balanceAfter<0?'neg':'pos'}">${fmtMoney(e.balanceAfter)}</td>
      ${showTimeCol?`<td class="small-note" style="margin:0;">${formatBDDateTime(e.createdAt)}</td>`:''}
    </tr>`).join('')}</tbody></table>` : `<div class="empty">No meal deductions ${historyViewMode==='month'?'this month':'yet'}.</div>`;
  _histExpDetailsCache = [];
  const expenseTable = expenseRows.length ? `
    <table><thead><tr><th>Date</th><th>Title</th><th class="num">Amount</th><th>Method</th><th class="num">Balance</th>${showTimeCol?'<th>Recorded</th>':''}<th></th></tr></thead>
    <tbody>${expenseRows.map((e,i)=>{
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
    }).join('')}</tbody></table>` : `<div class="empty">🧾 No shared-expense deductions ${historyViewMode==='month'?'this month yet':'yet'}.</div>`;
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
    </tr>`).join('')}</tbody></table>` : `<div class="empty">No deposits or withdrawals ${historyViewMode==='month'?'this month':'yet'}.</div>`;
  const selMember = memberById(historyMemberId);
  const scopeLabel = historyViewMode === 'month' ? currentMonth : 'all time';
  const mealTotal = mealRows.reduce((s, e) => s + e.amount, 0);
  const expenseTotal = expenseRows.reduce((s, e) => s + e.amount, 0);
  const depositTotal = depositRows.filter(d => d.amount > 0).reduce((s, d) => s + d.amount, 0);
  const withdrawalTotal = depositRows.filter(d => d.amount < 0).reduce((s, d) => s + Math.abs(d.amount), 0);
  return `
    <div class="card">
      <div class="row-between">
        <h2>History — ${selMember?selMember.name:''}</h2>
        <div>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(-1, setHistoryView)" title="Previous month">‹</button>
          <button class="btn secondary ${historyViewMode==='month'?'active-toggle':''}" style="margin-top:0;" onclick="setHistoryView('month')">${currentMonth}</button>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(1, setHistoryView)" title="Next month">›</button>
          <button class="btn secondary ${historyViewMode==='all'?'active-toggle':''}" style="margin-top:0;" onclick="setHistoryView('all')">All Time</button>
        </div>
      </div>
      <div class="small-note" style="margin-bottom:12px;">Every meal and shared-expense deduction for ${scopeLabel}, most recent first.${showTimeCol ? ' Exact recording time (Bangladesh time) is shown below.' : ''}</div>
      ${selectBox}
      <div class="summary-grid">
        <div class="summary-box"><div class="label">Meal Deductions</div><div class="value neg">${fmtMoney(mealTotal)}</div></div>
        <div class="summary-box"><div class="label">Expense Deductions</div><div class="value neg">${fmtMoney(expenseTotal)}</div></div>
        <div class="summary-box"><div class="label">Deposits</div><div class="value pos">${fmtMoney(depositTotal)}</div></div>
        <div class="summary-box"><div class="label">Withdrawn</div><div class="value ${withdrawalTotal>0?'neg':''}">${fmtMoney(withdrawalTotal)}</div></div>
      </div>
    </div>
    <div class="card keep-native-tables">
      <h2>Grocery Deductions</h2>
      <div class="table-responsive">${mealTable}</div>
    </div>
    <div class="card keep-native-tables">
      <h2>Shared Expense Deductions</h2>
      <div class="table-responsive">${expenseTable}</div>
    </div>
    <div class="card keep-native-tables">
      <h2>Deposits &amp; Withdrawals</h2>
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
