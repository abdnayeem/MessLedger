// ---------------------------------------------------------------------------
// 15-deposits.js  (originally app.js lines 5521-5832)
// Deposits/withdrawals tab: renderDeposits, balance preview updates, add deposit/withdrawal, delete
// ---------------------------------------------------------------------------
let depositsViewMode = 'month';
let depositsSearch = '';
let depositsSort = {
  key: 'date',
  dir: 'desc'
};

function depositsSortArrowHtml(key) {
  if (depositsSort.key !== key) return '';
  return depositsSort.dir === 'asc' ? ' <span class="sort-arrow">▲</span>' : ' <span class="sort-arrow">▼</span>';
}

function setDepositsSort(key) {
  if (depositsSort.key === key) {
    depositsSort.dir = depositsSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    depositsSort.key = key;
    depositsSort.dir = (key === 'member' || key === 'type') ? 'asc' : 'desc';
  }
  renderTabContent();
}

function setDepositsView(mode) {
  depositsViewMode = mode;
  renderTabContent();
}

function setDepositsSearch(val) {
  depositsSearch = val;
  renderTabContent();
  const el = document.getElementById('deposits-search');
  if (el) {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }
}

function renderDeposits() {
  const canDelete = session.role === 'superadmin';
  const showTimeCol = shouldShowRecordedAt();
  const memberOptions = state.members.map(m => {
    const bal = memberTotalBalance(m.id);
    return `<option value="${m.id}">${m.name} — ${fmtMoney(bal)}</option>`;
  }).join('');
  const balRows = state.members.map(m => {
    const bal = memberTotalBalance(m.id);
    const fmt = bal >= 0 ? `<span class="pos">${fmtMoney(bal)}</span>` : `<span class="neg">-${fmtMoney(Math.abs(bal))}</span>`;
    return `<tr><td>${m.name} ${roleBadgeHtml(m)}</td><td class="num">${fmt}</td></tr>`;
  }).join('');

  const scoped = (depositsViewMode === 'month' ? state.deposits.filter(d => d.date.startsWith(currentMonth)) : state.deposits.slice())
    .map(d => ({
      ...d,
      memberName: memberById(d.memberId)?.name || '?'
    }));

  const q = depositsSearch.trim().toLowerCase();
  let list = q ? scoped.filter(d =>
    d.memberName.toLowerCase().includes(q) ||
    d.date.includes(q) ||
    (d.note || '').toLowerCase().includes(q) ||
    (d.type === 'withdrawal' ? 'withdrawal' : 'deposit').includes(q)
  ) : scoped;

  const sortKey = depositsSort.key;
  const dir = depositsSort.dir === 'asc' ? 1 : -1;
  list = list.slice().sort((a, b) => {
    let av, bv;
    switch (sortKey) {
      case 'member':
        av = a.memberName.toLowerCase();
        bv = b.memberName.toLowerCase();
        break;
      case 'type':
        av = (a.type === 'withdrawal' ? 'withdrawal' : 'deposit');
        bv = (b.type === 'withdrawal' ? 'withdrawal' : 'deposit');
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
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });

  const rows = list.map(d => {
    let row = `<tr>
      <td class="mono">${d.date}</td>
      <td>${d.memberName}</td>
      <td>${d.type==='withdrawal'?'Withdrawal':'Deposit'}</td>
      <td>${d.note||'-'}</td>
      <td class="num ${d.amount<0?'neg':'pos'}">${d.amount<0?'-':'+'}${fmtMoney(Math.abs(d.amount))}</td>`;
    if (showTimeCol) {
      row += `<td class="small-note" style="margin:0;">${formatBDDateTime(d.createdAt)}</td>`;
    }
    row += `<td>${d.addedBy||''}</td>
      <td>${canDelete?`<button class="del-btn" onclick="deleteDeposit('${d.id}')">Delete</button>`:''}</td>
    </tr>`;
    return row;
  }).join('');
  let header = `<tr>
    <th class="sortable-th" onclick="setDepositsSort('date')">Date${depositsSortArrowHtml('date')}</th>
    <th class="sortable-th" onclick="setDepositsSort('member')">Member${depositsSortArrowHtml('member')}</th>
    <th class="sortable-th" onclick="setDepositsSort('type')">Type${depositsSortArrowHtml('type')}</th>
    <th>Note</th>
    <th class="num sortable-th" onclick="setDepositsSort('amount')">Amount${depositsSortArrowHtml('amount')}</th>`;
  if (showTimeCol) header += `<th>Recorded At</th>`;
  header += `<th>Added By</th><th></th></tr>`;
  const emptyMsg = scoped.length === 0 ? 'No deposits or withdrawals recorded yet.' : 'No records match your search.';
  const monthDep = monthTotalDeposits(currentMonth);
  const monthWd = monthTotalWithdrawals(currentMonth);
  const monthNet = monthNetBalanceChange(currentMonth);
  const monthSummaryCard = depositsViewMode === 'month' ? `
    <div class="card">
      <h2>${currentMonth} Summary</h2>
      <div class="summary-grid">
        <div class="summary-box"><div class="label">Total Deposits</div><div class="value pos">${fmtMoney(monthDep)}</div></div>
        <div class="summary-box"><div class="label">Total Withdrawn</div><div class="value ${monthWd>0?'neg':''}">${fmtMoney(monthWd)}</div></div>
        <div class="summary-box"><div class="label">Remaining Operating Cash</div><div class="value ${monthNet>=0?'pos':'neg'}">${monthNet>=0?'':'-'}${fmtMoney(Math.abs(monthNet))}</div></div>
      </div>
    </div>` : '';
  return `
    <div class="card keep-native-tables">
      <h2>Current Balances</h2>
      <div class="table-responsive">
        <table><thead><tr><th>Name</th><th class="num">Balance</th></tr></thead><tbody>${balRows}</tbody></table>
      </div>
    </div>
    ${monthSummaryCard}
    <div class="card">
      <h2>Add Deposit</h2>
      <div class="form-grid">
        <div><label>Member</label><select id="dep-member">${memberOptions}</select></div>
        <div><label>Date</label><input type="date" id="dep-date" value="${todayStr()}"></div>
        <div><label>Amount (৳)</label><input type="number" id="dep-amount" min="0.001" step="0.001" placeholder="e.g. 10.75"></div>
        <div><label>Note</label><input type="text" id="dep-note" placeholder="Optional"></div>
      </div>
      <div id="dep-member-balance" class="small-note" style="margin-top:6px;"></div>
      <button class="btn" onclick="addDeposit()">Add</button>
    </div>
    <div class="card">
      <h2>Withdraw Funds</h2>
      <div class="small-note" style="margin-bottom:10px;">A member can only withdraw from a positive balance, and never more than what's currently available.</div>
      <div class="form-grid">
        <div><label>Member</label><select id="wd-member">${memberOptions}</select></div>
        <div><label>Date</label><input type="date" id="wd-date" value="${todayStr()}"></div>
        <div><label>Amount (৳)</label><input type="number" id="wd-amount" min="0.001" step="0.001" placeholder="e.g. 10.75"></div>
        <div><label>Note</label><input type="text" id="wd-note" placeholder="Optional"></div>
      </div>
      <div id="wd-member-balance" class="small-note" style="margin-top:6px;"></div>
      <button class="btn" onclick="addWithdrawal()">Withdraw</button>
    </div>
    <div class="card keep-native-tables">
      <div class="row-between">
        <h2>Deposit List</h2>
        <div>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(-1, setDepositsView)" title="Previous month">‹</button>
          <button class="btn secondary ${depositsViewMode==='month'?'active-toggle':''}" style="margin-top:0;" onclick="setDepositsView('month')">${currentMonth}</button>
          <button class="btn secondary" style="margin-top:0; padding:6px 11px;" onclick="navigateMonth(1, setDepositsView)" title="Next month">›</button>
          <button class="btn secondary ${depositsViewMode==='all'?'active-toggle':''}" style="margin-top:0;" onclick="setDepositsView('all')">All Time</button>
        </div>
      </div>
      <div class="row-between" style="margin-bottom:14px;">
        <input type="text" id="deposits-search" class="search-input" placeholder="Search member, note, date, type..." value="${depositsSearch.replace(/"/g,'&quot;')}" oninput="setDepositsSearch(this.value)">
        ${q ? `<div class="small-note" style="margin:0;">${list.length} of ${scoped.length} records</div>` : ''}
      </div>
      ${list.length ? `<div class="table-responsive"><table><thead>${header}</thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${emptyMsg}</div>`}
    </div>`;
}

function updateDepMemberBalance() {
  const sel = document.getElementById('dep-member');
  const el = document.getElementById('dep-member-balance');
  if (!sel || !el) return;
  const bal = memberTotalBalance(sel.value);
  el.innerHTML = bal >= 0 ?
    `Current balance: <span class="pos">${fmtMoney(bal)}</span>` :
    `Current balance: <span class="neg">-${fmtMoney(Math.abs(bal))}</span>`;
}

function updateWdMemberBalance() {
  const sel = document.getElementById('wd-member');
  const el = document.getElementById('wd-member-balance');
  if (!sel || !el) return;
  const bal = memberTotalBalance(sel.value);
  el.innerHTML = bal > 0 ?
    `Available to withdraw: <span class="pos">${fmtMoney(bal)}</span>` :
    `Available to withdraw: <span class="neg">${fmtMoney(0)}</span> <span class="small-note" style="margin:0;">(balance is ${bal===0?'zero':'negative'} — nothing can be withdrawn)</span>`;
}

function attachDepositHandlers() {
  const sel = document.getElementById('dep-member');
  if (sel) {
    sel.addEventListener('change', updateDepMemberBalance);
    updateDepMemberBalance();
  }
  const wdSel = document.getElementById('wd-member');
  if (wdSel) {
    wdSel.addEventListener('change', updateWdMemberBalance);
    updateWdMemberBalance();
  }
}
async function addDeposit() {
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    showToast('You are not authorized to add deposits.', 'error');
    return;
  }
  const memberId = document.getElementById('dep-member').value;
  const date = document.getElementById('dep-date').value;
  const amountRaw = document.getElementById('dep-amount').value;
  const amount = parseFloat(amountRaw);
  const note = document.getElementById('dep-note').value.trim();
  if (!date) {
    showToast('Date is required.', 'error');
    return;
  }
  if (amountRaw === '' || isNaN(amount) || amount <= 0) {
    showToast('Enter a valid positive amount (greater than 0).', 'error');
    return;
  }
  if (!guardAdminMonthAccess(date.slice(0, 7), 'deposits')) return;
  const newId = 'd' + Date.now();
  state.deposits.push({
    id: newId,
    memberId,
    date,
    amount,
    note,
    type: 'deposit',
    addedBy: memberById(session.userId).name,
    createdAt: nowTimestamp()
  });
  if (memberId !== session.userId && notifTypeEnabled('deposit')) {
    addNotification(memberId, {
      type: 'deposit',
      title: 'Deposit added',
      message: `৳${fmtMoney(amount)} was added to your balance on ${date} by ${memberById(session.userId).name}.`,
      dedupeKey: `deposit::${newId}`
    });
  }
  // Optimistic UI: paint immediately from local state instead of waiting on
  // the Firestore round trip. persistDeposit() still runs in the background
  // and still shows its own error toast if the write actually fails.
  renderTabContent();
  showSuccessCheck('Deposit added.');
  persistDeposit(newId);
}
// Withdraw money FROM a member's balance. Stored as a deposit record with a
// negative amount (type:'withdrawal') so the existing balance math (which
// just sums state.deposits amounts) subtracts it automatically — no changes
// needed anywhere else that reads deposits/balances.
async function addWithdrawal() {
  if (session.role !== 'admin' && session.role !== 'superadmin') {
    showToast('You are not authorized to record withdrawals.', 'error');
    return;
  }
  const memberId = document.getElementById('wd-member').value;
  const date = document.getElementById('wd-date').value;
  const amountRaw = document.getElementById('wd-amount').value;
  const amount = parseFloat(amountRaw);
  const note = document.getElementById('wd-note').value.trim();
  if (!date) {
    showToast('Date is required.', 'error');
    return;
  }
  if (amountRaw === '' || isNaN(amount) || amount <= 0) {
    showToast('Enter a valid positive amount (greater than 0).', 'error');
    return;
  }
  const bal = memberTotalBalance(memberId);
  if (bal <= 0) {
    showToast(`${memberById(memberId).name}'s balance is ${bal===0?'zero':'negative'} — nothing can be withdrawn.`, 'error');
    return;
  }
  if (amount > bal) {
    showToast(`Can't withdraw ৳${amount} — ${memberById(memberId).name}'s available balance is only ${fmtMoney(bal)}.`, 'error');
    return;
  }
  if (!guardAdminMonthAccess(date.slice(0, 7), 'deposits')) return;
  const newId = 'd' + Date.now();
  state.deposits.push({
    id: newId,
    memberId,
    date,
    amount: -amount,
    note,
    type: 'withdrawal',
    addedBy: memberById(session.userId).name,
    createdAt: nowTimestamp()
  });
  if (memberId !== session.userId && notifTypeEnabled('withdrawal')) {
    addNotification(memberId, {
      type: 'withdrawal',
      title: 'Withdrawal recorded',
      message: `৳${fmtMoney(amount)} was withdrawn from your balance on ${date} by ${memberById(session.userId).name}.`,
      dedupeKey: `withdrawal::${newId}`
    });
  }
  // Optimistic UI — see addDeposit() for why this no longer awaits the write.
  renderTabContent();
  showSuccessCheck('Withdrawal recorded.');
  persistDeposit(newId);
}
async function deleteDeposit(id) {
  if (session.role !== 'superadmin') {
    showToast('You are not authorized to delete deposit records.', 'error');
    return;
  }
  const rec = state.deposits.find(d => d.id === id);
  if (!rec) {
    showToast('This deposit record could not be found — it may have just been deleted.', 'error');
    return;
  }
  if (!guardAdminMonthAccess(rec.date.slice(0, 7), 'deposits')) return;
  // BUGFIX (same as deleteCost()/deleteExpense()): show which record this
  // is — date/member/amount — instead of a generic message.
  const memberName = memberById(rec.memberId)?.name || 'Unknown member';
  const typeLabel = rec.type === 'withdrawal' ? 'Withdrawal' : 'Deposit';
  if (!confirm(`Delete this ${typeLabel.toLowerCase()}?\n\n${rec.date} · ${memberName} · ${fmtMoney(Math.abs(rec.amount))}\n\nThis cannot be undone.`)) return;
  state.deposits = state.deposits.filter(d => d.id !== id);
  renderTabContent();
  showToast('Deposit record deleted.', 'success');
  deleteDepositDoc(id);
}

/* ---------------- MEMBERS (superadmin only) ---------------- */