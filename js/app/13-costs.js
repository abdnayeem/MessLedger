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
    ${detailRow('Full Note', c.note ? escapeHtml(c.note) : '<span class="small-note" style="margin:0;">No note added</span>')}
    ${shouldShowRecordedAt() ? detailRow('Recorded At', formatBDDateTime(c.createdAt)) : ''}
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
  note: ''
};

function updateCostDraft(field, value) {
  costFormDraft[field] = value;
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
  renderTabContent();
}

function setCostsSearch(val) {
  costsSearch = val;
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
  _costsDetailsCache = [];
  const rows = list.map((c, i) => {
    _costsDetailsCache[i] = c;
    let row = `<tr style="${COMPACT_ROW_STYLE}">
      <td class="mono" style="${COMPACT_CELL_STYLE}">${c.date}</td>
      <td style="${COMPACT_CELL_STYLE}">${mealBadge(c.mealType||'other')}</td>
      <td class="num" style="${COMPACT_CELL_STYLE}">${fmtMoney(c.amount)}</td>
      <td style="${COMPACT_CELL_STYLE} max-width:120px;">${truncateCell(c.addedBy, 16)}</td>
      <td style="${COMPACT_CELL_STYLE} max-width:170px;">${truncateCell(c.note, 24)}</td>`;
    row += `<td style="${COMPACT_CELL_STYLE} white-space:nowrap;">
      <button class="btn secondary" style="margin:0; padding:5px 10px; font-size:12px;" onclick="showCostDetail(${i})">View Details</button>
      ${canDelete?` <button class="del-btn" onclick="deleteCost('${c.id}')">Delete</button>`:''}
    </td>
    </tr>`;
    return row;
  }).join('');
  let header = `<tr>
    <th class="sortable-th" onclick="setCostsSort('date')">Date${costsSortArrowHtml('date')}</th>
    <th class="sortable-th" onclick="setCostsSort('mealType')">Meal${costsSortArrowHtml('mealType')}</th>
    <th class="num sortable-th" onclick="setCostsSort('amount')">Amount${costsSortArrowHtml('amount')}</th>
    <th>Added By</th>
    <th class="sortable-th" onclick="setCostsSort('note')">Note${costsSortArrowHtml('note')}</th>
    <th></th></tr>`;
  return `
    <div class="card">
      <h2>Add Grocery Cost</h2>
      <div class="form-grid">
        <div><label>Date</label><input type="date" id="cost-date" value="${costFormDraft.date || todayStr()}" oninput="updateCostDraft('date', this.value)"></div>
        <div><label>Meal</label>
          <select id="cost-mealtype" onchange="updateCostDraft('mealtype', this.value)">
            <option value="lunch" ${costFormDraft.mealtype==='lunch'?'selected':''}>Lunch</option>
            <option value="dinner" ${costFormDraft.mealtype==='dinner'?'selected':''}>Dinner</option>
            <option value="other" ${costFormDraft.mealtype==='other'?'selected':''}>Other/Grocery</option>
          </select>
        </div>
        <div><label>Amount (৳)</label><input type="number" id="cost-amount" min="0" value="${costFormDraft.amount}" oninput="updateCostDraft('amount', this.value)"></div>
        <div><label>Note (what was bought)</label><input type="text" id="cost-note" placeholder="e.g. fish, vegetables, oil..." value="${(costFormDraft.note||'').replace(/"/g,'&quot;')}" oninput="updateCostDraft('note', this.value)"></div>
      </div>
      <button class="btn" onclick="addCost()">Add</button>
      <div class="small-note">Add a separate entry for each meal — multiple entries per day are fine.</div>
    </div>
    <div class="card keep-native-tables">
      <div class="row-between">
        <h2>Cost List</h2>
        <div>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(-1, setCostsView)" title="Previous month">‹</button>
          <button class="btn secondary ${costsViewMode==='month'?'active-toggle':''}" style="margin-top:0;" onclick="setCostsView('month')">${currentMonth}</button>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(1, setCostsView)" title="Next month">›</button>
          <button class="btn secondary ${costsViewMode==='all'?'active-toggle':''}" style="margin-top:0;" onclick="setCostsView('all')">All Time</button>
        </div>
      </div>
      <div class="mono" style="font-weight:700; margin:8px 0 10px;">Total: ${fmtMoney(total)}</div>
      <div class="row-between" style="margin-bottom:14px;">
        <input type="text" id="costs-search" class="search-input" placeholder="Search meal, note, added by, date..." value="${costsSearch.replace(/"/g,'&quot;')}" oninput="setCostsSearch(this.value)">
        ${q ? `<div class="small-note" style="margin:0;">${list.length} of ${list0.length} records</div>` : ''}
      </div>
      ${rows ? `<div class="table-responsive"><table><thead>${header}</thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${list0.length===0 ? '🧾 No grocery costs added yet — the ones you log will show up here.' : 'No records match your search.'}</div>`}
    </div>`;
}

function setCostsView(mode) {
  costsViewMode = mode;
  renderTabContent();
}

function attachCostHandlers() {}
async function addCost() {
  const date = document.getElementById('cost-date').value;
  const mealType = document.getElementById('cost-mealtype').value;
  const amount = Number(document.getElementById('cost-amount').value);
  const note = document.getElementById('cost-note').value.trim();
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
    note: ''
  };
  renderTabContent();
  showSuccessCheck('Grocery cost added.');
  persistCost(newId);
}
async function deleteCost(id) {
  const rec = state.costs.find(c => c.id === id);
  if (rec && !guardAdminMonthAccess(rec.date.slice(0, 7), 'costs')) return;
  if (!confirm('Delete this cost record? This cannot be undone.')) return;
  state.costs = state.costs.filter(c => c.id !== id);
  renderTabContent();
  showToast('Cost record deleted.', 'success');
  deleteCostDoc(id);
}

/* ---------------- SHARED EXPENSES ---------------- */
