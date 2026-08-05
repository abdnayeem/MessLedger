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
  checkedMembers: []
};

function updateExpDraft(field, value) {
  expFormDraft[field] = value;
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
    ${shouldShowRecordedAt() ? detailRow('Recorded At', formatBDDateTime(e.createdAt)) : ''}
  `;
  openDetailsModal('Shared Expense Details', body);
}
let expensesSearch = '';
let expensesSort = {
  key: 'date',
  dir: 'desc'
};

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
  renderTabContent();
}

function setExpensesView(mode) {
  expensesViewMode = mode;
  renderTabContent();
}

function setExpensesSearch(val) {
  expensesSearch = val;
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
    <label style="display:flex; align-items:center; gap:6px; font-size:14px; color:var(--ink); margin:4px 0;">
      <input type="checkbox" class="exp-member-check" value="${m.id}" ${expFormDraft.checkedMembers.includes(m.id)?'checked':''} onchange="toggleExpDraftMember('${m.id}', this.checked)"> ${m.name}
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
  _expDetailsCache = [];
  const rows = list.map((e, i) => {
    _expDetailsCache[i] = e;
    const isMealSplit = e.splitType === 'meal' && e.shares;
    const per = isMealSplit ? null : Number(e.amount) / e.memberIds.length;
    const memberCount = e.memberIds.length;
    let row = `<tr style="${COMPACT_ROW_STYLE}">
      <td class="mono" style="${COMPACT_CELL_STYLE}">${e.date}</td>
      <td style="${COMPACT_CELL_STYLE} max-width:160px;">${truncateCell(e.title, 22)}</td>
      <td class="num" style="${COMPACT_CELL_STYLE}">${fmtMoney(e.amount)}</td>
      <td style="${COMPACT_CELL_STYLE}">${expenseMethodBadge(e.splitType, e.mealTypeSplit, memberCount===state.members.length)}</td>
      <td style="${COMPACT_CELL_STYLE}">${e.splitType==='meal' ? mealBadge(e.mealTypeSplit||'both') : '<span class="small-note" style="margin:0;">—</span>'}</td>
      <td class="num" style="${COMPACT_CELL_STYLE}">${isMealSplit ? '—' : fmtMoney(per)}</td>
      <td style="${COMPACT_CELL_STYLE} white-space:nowrap;">${memberCount} Member${memberCount===1?'':'s'}</td>
      <td style="${COMPACT_CELL_STYLE} max-width:110px;">${truncateCell(e.addedBy, 14)}</td>`;
    row += `<td style="${COMPACT_CELL_STYLE} white-space:nowrap;">
      <button class="btn secondary" style="margin:0; padding:5px 10px; font-size:12px;" onclick="showExpenseDetail(${i})">View Details</button>
      ${canDelete?` <button class="del-btn" onclick="deleteExpense('${e.id}')">Delete</button>`:''}
    </td>
    </tr>`;
    return row;
  }).join('');
  const totalExp = list0.reduce((s, e) => s + Number(e.amount || 0), 0);
  let header = `<tr>
    <th class="sortable-th" onclick="setExpensesSort('date')">Date${expensesSortArrowHtml('date')}</th>
    <th class="sortable-th" onclick="setExpensesSort('title')">Title${expensesSortArrowHtml('title')}</th>
    <th class="num sortable-th" onclick="setExpensesSort('amount')">Total${expensesSortArrowHtml('amount')}</th>
    <th>Method</th>
    <th>Meal</th>
    <th class="num">Per Person</th>
    <th>Members</th>
    <th>Added By</th>
    <th></th></tr>`;
  return `
    <div class="card">
      <h2>Add Shared Expense</h2>
      <div class="small-note" style="margin-bottom:10px;">e.g. gas bill, house help wages, internet — split equally among selected members, not counted in the meal rate.</div>
      <div class="form-grid">
        <div><label>Date</label><input type="date" id="exp-date" value="${expFormDraft.date || todayStr()}" oninput="updateExpDraft('date', this.value)"></div>
        <div><label>Total Amount (৳)</label><input type="number" id="exp-amount" min="0" value="${expFormDraft.amount}" oninput="updateExpDraft('amount', this.value)"></div>
        <div class="full"><label>Title</label><input type="text" id="exp-title" placeholder="What was this expense for?" value="${(expFormDraft.title||'').replace(/"/g,'&quot;')}" oninput="updateExpDraft('title', this.value)"></div>
        <div class="full"><label>Description (optional)</label><input type="text" id="exp-description" value="${(expFormDraft.description||'').replace(/"/g,'&quot;')}" oninput="updateExpDraft('description', this.value)"></div>
      </div>
      <div style="margin-top:14px;">
        <label style="display:inline-flex; align-items:center; gap:6px; margin-right:18px;">
          <input type="radio" name="exp-split" value="all" ${expenseSplitMode==='all'?'checked':''} onchange="setExpenseSplitMode('all')"> Split equally among all active members (${activeMemberIdsForMonth(currentMonth).length} people)
        </label>
        <label style="display:inline-flex; align-items:center; gap:6px; margin-right:18px;">
          <input type="radio" name="exp-split" value="selected" ${expenseSplitMode==='selected'?'checked':''} onchange="setExpenseSplitMode('selected')"> Select specific members
        </label>
        <label style="display:inline-flex; align-items:center; gap:6px;">
          <input type="radio" name="exp-split" value="meal" ${expenseSplitMode==='meal'?'checked':''} onchange="setExpenseSplitMode('meal')"> Charge based on meal count
        </label>
      </div>
      <div id="exp-member-list" style="margin-top:8px; ${expenseSplitMode==='selected'?'':'display:none;'} border:1px solid var(--border); border-radius:var(--radius-sm); padding:10px 14px; max-height:220px; overflow-y:auto;">
        ${memberChecks}
      </div>
      <div id="exp-meal-note" style="margin-top:8px; ${expenseSplitMode==='meal'?'':'display:none;'}">
        <label>Which meal to base the split on</label>
        <select id="exp-mealtype-select" onchange="updateExpDraft('mealtypeSelect', this.value)">
          <option value="both" ${expFormDraft.mealtypeSelect==='both'?'selected':''}>Both Lunch + Dinner</option>
          <option value="lunch" ${expFormDraft.mealtypeSelect==='lunch'?'selected':''}>Lunch only</option>
          <option value="dinner" ${expFormDraft.mealtypeSelect==='dinner'?'selected':''}>Dinner only</option>
        </select>
        <div class="small-note" style="margin-top:6px;">Splits the total proportionally by each member's meal count on the Date above, using only the meal type selected here (Member Charge = their meal count ÷ total meal count × total expense). Members with 0 relevant meals that date aren't charged. Make sure that date's meals are already entered before adding this.</div>
      </div>
      <button class="btn" onclick="addExpense()">Add</button>
    </div>
    <div class="card keep-native-tables">
      <div class="row-between">
        <h2>Shared Expense List</h2>
        <div>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(-1, setExpensesView)" title="Previous month">‹</button>
          <button class="btn secondary ${expensesViewMode==='month'?'active-toggle':''}" style="margin-top:0;" onclick="setExpensesView('month')">${currentMonth}</button>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(1, setExpensesView)" title="Next month">›</button>
          <button class="btn secondary ${expensesViewMode==='all'?'active-toggle':''}" style="margin-top:0;" onclick="setExpensesView('all')">All Time</button>
        </div>
      </div>
      <div class="mono" style="font-weight:700; margin:8px 0 10px;">Total: ${fmtMoney(totalExp)}</div>
      <div class="row-between" style="margin-bottom:14px;">
        <input type="text" id="expenses-search" class="search-input" placeholder="Search title, description, member, date..." value="${expensesSearch.replace(/"/g,'&quot;')}" oninput="setExpensesSearch(this.value)">
        ${q ? `<div class="small-note" style="margin:0;">${list.length} of ${list0.length} records</div>` : ''}
      </div>
      ${rows ? `<div class="table-responsive"><table><thead>${header}</thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${list0.length===0 ? (expensesViewMode==='month' ? '🧾 No shared expenses added this month yet.' : '🧾 No shared expenses added yet — the ones you log will show up here.') : 'No records match your search.'}</div>`}
    </div>`;
}

function setExpenseSplitMode(mode) {
  expenseSplitMode = mode;
  const box = document.getElementById('exp-member-list');
  if (box) box.style.display = mode === 'selected' ? '' : 'none';
  const note = document.getElementById('exp-meal-note');
  if (note) note.style.display = mode === 'meal' ? '' : 'none';
}

function attachExpenseHandlers() {}
async function addExpense() {
  const date = document.getElementById('exp-date').value;
  const amount = Number(document.getElementById('exp-amount').value);
  const title = document.getElementById('exp-title').value.trim();
  const description = document.getElementById('exp-description').value.trim();
  if (!date || !amount) {
    showToast('Date and amount are required.', 'error');
    return;
  }
  if (!title) {
    showToast('Title is required.', 'error');
    return;
  }
  if (!guardAdminMonthAccess(date.slice(0, 7), 'expenses')) return;

  let memberIds, shares, mealTypeSplit;
  if (expenseSplitMode === 'all') {
    memberIds = activeMemberIdsForMonth(date.slice(0, 7));
    if (!memberIds.length) {
      showToast('No active members for this month to split among.', 'error');
      return;
    }
  } else if (expenseSplitMode === 'selected') {
    memberIds = Array.from(document.querySelectorAll('.exp-member-check:checked')).map(el => el.value);
    if (!memberIds.length) {
      showToast('Select at least one member.', 'error');
      return;
    }
  } else if (expenseSplitMode === 'meal') {
    mealTypeSplit = (document.getElementById('exp-mealtype-select') || {}).value || 'both';
    const dayMeals = (state.days[date] && state.days[date].meals) || {};
    const counts = {};
    let totalMeals = 0;
    state.members.forEach(m => {
      const rec = dayMeals[m.id];
      let c = 0;
      if (rec) {
        if (mealTypeSplit === 'lunch') c = rec.lunch || 0;
        else if (mealTypeSplit === 'dinner') c = rec.dinner || 0;
        else c = (rec.lunch || 0) + (rec.dinner || 0);
      }
      if (c > 0) {
        counts[m.id] = c;
        totalMeals += c;
      }
    });
    if (totalMeals <= 0) {
      showToast(`No ${mealTypeSplit==='both'?'meals':mealTypeSplit} recorded on ${date} yet — enter that date's meals first, then add this expense.`, 'error');
      return;
    }
    memberIds = Object.keys(counts);
    shares = {};
    memberIds.forEach(id => {
      shares[id] = (counts[id] / totalMeals) * amount;
    });
  }

  const newId = 'e' + Date.now();
  const expenseRecord = {
    id: newId,
    date,
    amount,
    memberIds,
    title,
    description,
    addedBy: memberById(session.userId).name,
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
    checkedMembers: []
  };
  renderTabContent();
  showSuccessCheck('Shared expense added.');
  persistExpense(newId);
}
async function deleteExpense(id) {
  const rec = state.expenses.find(e => e.id === id);
  if (rec && !guardAdminMonthAccess(rec.date.slice(0, 7), 'expenses')) return;
  if (!confirm('Delete this shared expense? This cannot be undone.')) return;
  state.expenses = state.expenses.filter(e => e.id !== id);
  renderTabContent();
  showToast('Shared expense deleted.', 'success');
  deleteExpenseDoc(id);
}

/* ---------------- BALANCES / DEPOSITS ---------------- */
