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
  // BUGFIX (same as deleteCost() in 13-costs.js): show which record this
  // actually is — date/title/amount — instead of a generic message, so a
  // superadmin can't accidentally confirm deleting the wrong row.
  if (!confirm(`Delete this shared expense?\n\n${rec.date} · "${rec.title || ''}" · ${fmtMoney(rec.amount)}\n\nThis cannot be undone.`)) return;
  state.expenses = state.expenses.filter(e => e.id !== id);
  renderTabContent();
  showToast('Shared expense deleted.', 'success');
  deleteExpenseDoc(id);
}

/* ---------------- BALANCES / DEPOSITS ---------------- */