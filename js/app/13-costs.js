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
      .cl-search-input {
        width:100%; height:34px; border-radius:8px; border:1.5px solid #dfe7f3;
        background:#f9fbff; padding:0 11px 0 32px; font-size:13px; color:#16233b;
        font-family:inherit; box-sizing:border-box; transition:border-color .15s ease, box-shadow .15s ease, background .15s ease;
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
  const rec = state.costs.find(c => c.id === id);
  if (!rec) {
    showToast('This cost record could not be found — it may have just been deleted.', 'error');
    return;
  }
  if (!guardAdminMonthAccess(rec.date.slice(0, 7), 'costs')) return;
  // BUGFIX: the confirm() dialog used to just say "Delete this cost
  // record?" with no way to tell WHICH record — on the Cost List, several
  // rows can look similar at a glance (same date, same meal type), so a
  // superadmin clicking Delete on the wrong row could easily confirm the
  // wrong one without noticing. Now spells out date/meal/amount/note so the
  // person can actually verify it's the right record before confirming.
  const mealLabel = MEAL_TIME_LABEL[rec.mealType || 'other'] || rec.mealType || '';
  const noteText = rec.note ? ` — "${rec.note}"` : '';
  if (!confirm(`Delete this grocery cost?\n\n${rec.date} · ${mealLabel} · ${fmtMoney(rec.amount)}${noteText}\n\nThis cannot be undone.`)) return;
  state.costs = state.costs.filter(c => c.id !== id);
  renderTabContent();
  showToast('Cost record deleted.', 'success');
  deleteCostDoc(id);
}

/* ---------------- SHARED EXPENSES ---------------- */