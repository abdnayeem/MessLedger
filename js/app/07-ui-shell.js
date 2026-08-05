// ---------------------------------------------------------------------------
// 07-ui-shell.js  (originally app.js lines 2176-2378)
// Top bar 'who' box, tab config + role filtering, tab bar rendering, tab switching/content routing
// ---------------------------------------------------------------------------
function renderTopWho() {
  const m = memberById(session.userId);
  const bal = myTotalBalance();
  let balColor = 'var(--success)',
    balBg = 'var(--success-bg)',
    balBorder = '#C8ECD6';
  if (bal < 0) {
    balColor = 'var(--danger)';
    balBg = 'var(--danger-bg)';
    balBorder = '#FBD5D5';
  } else if (bal < state.settings.lowBalanceWarn) {
    balColor = 'var(--warning)';
    balBg = 'var(--warning-bg)';
    balBorder = '#FCE3B0';
  }
  const balText = bal >= 0 ? `৳${Math.round(bal).toLocaleString('en-US')}` : `-৳${Math.round(Math.abs(bal)).toLocaleString('en-US')}`;
  checkLowBalanceNotification(session.userId, bal);
  document.getElementById('who-box').innerHTML = `
    ${renderNotifBell()}
    <span class="mono balance-pill" style="background:${balBg}; color:${balColor}; border-color:${balBorder};">${balText}${bal<state.settings.lowBalanceWarn?' ⚠':''}</span>
    <span class="role-chip role-${session.role}"><i class="fas fa-user-shield"></i> ${m.name} · ${roleLabel(session.role)}</span>
    <button class="link-btn" onclick="changeMyPin()"><i class="fas fa-key"></i> Change PIN</button>
    <button class="link-btn" onclick="logout()"><i class="fas fa-sign-out-alt"></i> Log Out</button>
  `;
}

// Tab configuration with icons
const tabConfig = {
  dashboard: {
    label: 'Dashboard',
    icon: 'fa-gauge-high'
  },
  meals: {
    label: 'Meals',
    icon: 'fa-utensils'
  },
  schedule: {
    label: 'Market Schedule',
    icon: 'fa-calendar-day'
  },
  history: {
    label: 'History',
    icon: 'fa-clock-rotate-left'
  },
  costs: {
    label: 'Grocery Costs',
    icon: 'fa-bag-shopping'
  },
  expenses: {
    label: 'Shared Expenses',
    icon: 'fa-money-bill-wave'
  },
  deposits: {
    label: 'Balances',
    icon: 'fa-scale-balanced'
  },
  members: {
    label: 'Members',
    icon: 'fa-users'
  },
  loginlog: {
    label: 'Login Log',
    icon: 'fa-right-to-bracket'
  },
  actionlog: {
    label: 'Database Log',
    icon: 'fa-database'
  },
  settings: {
    label: 'Settings',
    icon: 'fa-gear'
  }
};

function tabsForRole() {
  const base = [{
      id: 'dashboard'
    },
    {
      id: 'meals'
    },
    {
      id: 'schedule'
    },
    {
      id: 'history'
    }
  ];
  if (session.role === 'admin' || session.role === 'superadmin') {
    base.push({
      id: 'costs'
    });
    base.push({
      id: 'expenses'
    });
    base.push({
      id: 'deposits'
    });
  }
  if (session.role === 'superadmin') {
    base.push({
      id: 'members'
    });
    base.push({
      id: 'loginlog'
    });
    base.push({
      id: 'actionlog'
    });
    base.push({
      id: 'settings'
    });
  }
  return base;
}

function renderTabs() {
  const tabs = tabsForRole();
  document.getElementById('tabs').innerHTML = tabs.map(t => {
    const cfg = tabConfig[t.id] || {
      label: t.id,
      icon: 'fa-circle'
    };
    const pinClass = t.id === 'settings' ? ' tab-btn-pinned' : '';
    return `<button class="tab-btn ${activeTab===t.id?'active':''}${pinClass}" onclick="setTab('${t.id}')">
      <i class="fas ${cfg.icon}"></i> ${cfg.label}
    </button>`;
  }).join('');
}

function scrollContentToTop() {
  // On desktop .content-wrap is the independently-scrolling panel; on
  // mobile the window itself scrolls. Reset whichever is active so every
  // tab opens from the top instead of wherever the previous tab left off.
  const cw = document.querySelector('.content-wrap');
  if (cw) cw.scrollTop = 0;
  window.scrollTo(0, 0);
}
async function setTab(id) {
  activeTab = id;
  if (id !== 'members') _maDirty = false;
  if (id !== 'settings') _adminMonthAccessDraft = null; // force a fresh draft next time Settings is opened
  renderTabs();
  scrollContentToTop();
  const c = document.getElementById('content');
  if (c) {
    c.innerHTML = '<div class="card empty"><i class="fas fa-spinner fa-spin"></i>&nbsp; Loading latest data…</div>';
  }
  try {
    state = await loadState();
    clearCalcCache();
  } catch (e) {
    console.error('Tab refresh failed:', e);
    showToast('Could not refresh latest data — showing last known data.', 'error');
  }
  renderTabContent();
}

function renderTabContent() {
  console.time('renderTabContent');
  renderTopWho();
  const c = document.getElementById('content');
  if (activeTab === 'dashboard') {
    c.innerHTML = renderDashboard();
    attachDashboardHandlers();
  } else if (activeTab === 'meals') {
    c.innerHTML = renderMeals();
    attachMealHandlers();
  } else if (activeTab === 'schedule') {
    c.innerHTML = renderSchedule();
  } else if (activeTab === 'history') {
    c.innerHTML = renderHistory();
    attachHistoryHandlers();
  } else if (activeTab === 'costs') {
    c.innerHTML = renderCosts();
    attachCostHandlers();
  } else if (activeTab === 'expenses') {
    c.innerHTML = renderExpenses();
    attachExpenseHandlers();
  } else if (activeTab === 'deposits') {
    c.innerHTML = renderDeposits();
    attachDepositHandlers();
  } else if (activeTab === 'members') {
    c.innerHTML = renderMembers();
    attachMemberHandlers();
  } else if (activeTab === 'loginlog') {
    c.innerHTML = renderLoginLog();
    attachLoginLogHandlers();
  } else if (activeTab === 'actionlog') {
    c.innerHTML = renderActionLog();
    attachActionLogHandlers();
  } else if (activeTab === 'settings') {
    // Only (re)initialize the draft from saved state if it doesn't exist yet.
    // Resetting unconditionally here used to wipe out in-progress edits
    // (Add Year / Remove Year / "all months" toggle) every time those
    // actions called renderTabContent() to redraw themselves.
    if (!_adminMonthAccessDraft) resetAdminMonthAccessDraft();
    c.innerHTML = renderSettings();
  }
  console.timeEnd('renderTabContent');
}

/* ---------------- CALC HELPERS ---------------- */
