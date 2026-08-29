// ---------------------------------------------------------------------------
// 07-ui-shell.js  (originally app.js lines 2176-2378)
// Top bar 'who' box, tab config + role filtering, tab bar rendering, tab switching/content routing
// ---------------------------------------------------------------------------
function renderTopWho() {
  const m = memberById(session.userId);
  const bal = myTotalBalance();
  let balColor = 'var(--success)',
    balBg = 'var(--success-bg)',
    balBorder = 'var(--border-success-tint)';
  if (bal < 0) {
    balColor = 'var(--danger)';
    balBg = 'var(--danger-bg)';
    balBorder = 'var(--border-danger-tint)';
  } else if (bal < state.settings.lowBalanceWarn) {
    balColor = 'var(--warning)';
    balBg = 'var(--warning-bg)';
    balBorder = 'var(--border-warning-tint)';
  }
  const balText = bal >= 0 ? `৳${Math.round(bal).toLocaleString('en-US')}` : `-৳${Math.round(Math.abs(bal)).toLocaleString('en-US')}`;
  checkLowBalanceNotification(session.userId, bal);
  const initial = m ? m.name.trim().charAt(0).toUpperCase() : '?';
  const isDark = currentTheme() === 'dark';
  const topMenuHtml = !topProfileMenuOpen ? '' : `
    <div class="header-profile-menu">
      <button type="button" onclick="changeMyPin()"><i class="fas fa-key"></i> Change PIN</button>
      <button type="button" onclick="toggleTheme()"><i class="fas fa-${isDark?'sun':'moon'}"></i> ${isDark?'Light Mode':'Dark Mode'}</button>
      <button type="button" onclick="logout()"><i class="fas fa-sign-out-alt"></i> Log Out</button>
    </div>`;
  document.getElementById('who-box').innerHTML = `
    ${renderNotifBell()}
    <span class="mono balance-pill" style="background:${balBg}; color:${balColor}; border-color:${balBorder};">${balText}${bal<state.settings.lowBalanceWarn?' ⚠':''}</span>
    <div class="header-profile-wrap" id="header-profile-wrap">
      <button type="button" class="header-profile-btn ${topProfileMenuOpen?'is-open':''}" onclick="toggleTopProfileMenu(event)" aria-label="Account menu" title="Account">
        <span class="header-profile-avatar">${initial}</span>
        <span class="header-profile-info">
          <span class="header-profile-name">${m?escapeHtml(m.name):''}</span>
          <span class="header-profile-role">${roleLabel(session.role)}</span>
        </span>
        <i class="fas fa-chevron-${topProfileMenuOpen?'up':'down'}"></i>
      </button>
      ${topMenuHtml}
    </div>
  `;
  renderHeaderGreeting(m);
}

// Fills the empty space on the left of the header row (desktop only — see
// .header-greeting's display:none base rule) with a time-of-day greeting
// and a one-line "essential info" summary, instead of leaving it blank
// next to the notification bell. Read-only reuse of dayMealTotals(), the
// same helper the dashboard/schedule tabs already use — nothing about the
// dashboard body itself is touched.
function renderHeaderGreeting(m) {
  const el = document.getElementById('header-greeting');
  if (!el) return;
  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : hour < 21 ? 'Good evening' : 'Good night';
  const firstName = m ? m.name.trim().split(/\s+/)[0] : '';
  let infoLine = '';
  try {
    const t = dayMealTotals(todayStr());
    infoLine = t.total > 0 ? `<i class="fas fa-utensils"></i> ${t.total} meal${t.total===1?'':'s'} logged today · ${t.lunch}L / ${t.dinner}D` : `<i class="fas fa-utensils"></i> No meals logged today yet`;
  } catch (e) {
    infoLine = '';
  }
  el.innerHTML = `
    <div class="header-greeting-title">${greeting}${firstName ? ', ' + escapeHtml(firstName) : ''}</div>
    ${infoLine ? `<div class="header-greeting-sub">${infoLine}</div>` : ''}
  `;
}

let topProfileMenuOpen = false;
// Whether the mobile "More" sheet (extra tabs beyond the 4 quick-access
// slots in the phone bottom bar) is currently open. See renderMobileTabbar()
// / openMoreSheet() / closeMoreSheet() below.
let moreSheetOpen = false;

function toggleTopProfileMenu(e) {
  if (e) e.stopPropagation();
  topProfileMenuOpen = !topProfileMenuOpen;
  if (topProfileMenuOpen) {
    document.addEventListener('click', closeTopProfileMenuOnOutsideClick);
  } else {
    document.removeEventListener('click', closeTopProfileMenuOnOutsideClick);
  }
  renderTopWho();
}

function closeTopProfileMenuOnOutsideClick(e) {
  const wrap = document.getElementById('header-profile-wrap');
  if (wrap && !wrap.contains(e.target)) {
    topProfileMenuOpen = false;
    document.removeEventListener('click', closeTopProfileMenuOnOutsideClick);
    renderTopWho();
  }
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

// Category grouping for the sidebar menu — purely a display grouping on
// top of tabsForRole()'s existing role filtering below; it doesn't change
// which tabs a role can see, just how they're labeled/sectioned.
const tabGroups = {
  dashboard: 'Main',
  meals: 'Main',
  schedule: 'Main',
  history: 'Main',
  costs: 'Finance',
  expenses: 'Finance',
  deposits: 'Finance',
  members: 'Admin',
  loginlog: 'Admin',
  actionlog: 'Admin',
  settings: 'Admin'
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

// BUGFIX (tab switch looked like an abrupt "jhaki"/jump instead of a smooth
// color change): renderTabs() rebuilds #tabs'/the mobile tabbar's entire
// innerHTML from scratch on every single tab click. css/style.css already
// has transitions on .tab-btn i / .tab-icon-box / .mtab-btn for exactly
// this (color .15s ease, background .15s ease) — but a CSS transition only
// animates a property changing on the SAME DOM node over time. Destroying
// the old button and creating a brand new one already in its final
// "active" state (which is what innerHTML replacement does) gives the
// transition nothing to animate from, so the highlight just snaps into
// place instead of fading/sliding in. This walks the already-rendered
// buttons (tagged with data-tab-id — see renderTabs()/renderMobileTabbar()/
// renderMoreSheetBody() above) and only toggles the `active` class on the
// SAME nodes, so the existing CSS transitions actually get to run.
function updateActiveTabHighlight() {
  document.querySelectorAll('#tabs .tab-btn[data-tab-id]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tabId === activeTab);
  });
  const primaryTabIds = [];
  document.querySelectorAll('#mobile-tabbar .mtab-btn[data-tab-id]').forEach(btn => {
    const isActive = btn.dataset.tabId === activeTab;
    btn.classList.toggle('active', isActive);
    primaryTabIds.push(btn.dataset.tabId);
  });
  const moreBtn = document.querySelector('#mobile-tabbar .mtab-more');
  if (moreBtn) {
    // "More" itself is active when the selected tab isn't one of the fixed
    // primary slots — i.e. it's one of the tabs tucked in the sheet.
    moreBtn.classList.toggle('active', !primaryTabIds.includes(activeTab));
  }
  document.querySelectorAll('#more-sheet-body .more-sheet-item[data-tab-id]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tabId === activeTab);
  });
}

function renderTabs() {
  const tabs = tabsForRole();
  let lastGroup = null;
  const itemsHtml = tabs.map(t => {
    const cfg = tabConfig[t.id] || {
      label: t.id,
      icon: 'fa-circle'
    };
    const group = tabGroups[t.id] || 'Main';
    const groupLabelHtml = group !== lastGroup ? `<div class="tab-group-label">${group}</div>` : '';
    lastGroup = group;
    const pinClass = t.id === 'settings' ? ' tab-btn-pinned' : '';
    return `${groupLabelHtml}<button class="tab-btn ${activeTab===t.id?'active':''}${pinClass}" data-tab-id="${t.id}" onclick="setTab('${t.id}')">
      <span class="tab-icon-box"><i class="fas ${cfg.icon}"></i></span>
      <span class="tab-label">${cfg.label}</span>
      <span class="tab-chevron"><i class="fas fa-chevron-right"></i></span>
    </button>`;
  }).join('');
  document.getElementById('tabs').innerHTML = itemsHtml;

  renderMobileTabbar(tabs);
}

// ---------------------------------------------------------------------------
// Mobile bottom tab bar (phones only — desktop keeps using the .tabs sidebar
// list built above). Replaces the old design, which crammed every tab
// (up to 11 for a superadmin) into one horizontally-scrolling row with no
// way to tell there was more off-screen.
//
// New layout: the 4 tabs every role shares (Dashboard/Meals/Schedule/
// History) always get a fixed, evenly-spaced slot — no scrolling, nothing
// hidden. Anything role-specific beyond that (Finance tabs for admins,
// Admin tabs for superadmins) collapses into a single "More" slot that
// opens a bottom sheet, grouped exactly like the desktop sidebar so it's
// still easy to scan.
// ---------------------------------------------------------------------------
function renderMobileTabbar(tabs) {
  const bar = document.getElementById('mobile-tabbar');
  if (!bar) return;

  const primary = tabs.slice(0, 4);
  const rest = tabs.slice(4);

  const mtabBtn = t => {
    const cfg = tabConfig[t.id] || { label: t.id, icon: 'fa-circle' };
    return `<button type="button" class="mtab-btn ${activeTab === t.id ? 'active' : ''}" data-tab-id="${t.id}" onclick="setTab('${t.id}')">
      <span class="mtab-icon"><i class="fas ${cfg.icon}"></i></span>
      <span class="mtab-label">${cfg.label}</span>
    </button>`;
  };

  let html = primary.map(mtabBtn).join('');

  if (rest.length) {
    const restActive = rest.some(t => t.id === activeTab);
    html += `<button type="button" class="mtab-btn mtab-more ${restActive ? 'active' : ''}" onclick="toggleMoreSheet()" aria-haspopup="true" aria-expanded="${moreSheetOpen ? 'true' : 'false'}">
      <span class="mtab-icon"><i class="fas fa-ellipsis"></i></span>
      <span class="mtab-label">More</span>
    </button>`;
  }

  bar.innerHTML = html;
  renderMoreSheetBody(rest);
}

function renderMoreSheetBody(rest) {
  const body = document.getElementById('more-sheet-body');
  if (!body) return;
  if (!rest.length) {
    body.innerHTML = '';
    return;
  }
  let lastGroup = null;
  body.innerHTML = rest.map(t => {
    const cfg = tabConfig[t.id] || { label: t.id, icon: 'fa-circle' };
    const group = tabGroups[t.id] || 'More';
    const groupLabelHtml = group !== lastGroup ? `<div class="more-sheet-group-label">${group}</div>` : '';
    lastGroup = group;
    return `${groupLabelHtml}<button type="button" class="more-sheet-item ${activeTab === t.id ? 'active' : ''}" data-tab-id="${t.id}" onclick="selectFromMoreSheet('${t.id}')">
      <span class="more-sheet-item-icon"><i class="fas ${cfg.icon}"></i></span>
      <span class="more-sheet-item-label">${cfg.label}</span>
      <i class="fas fa-chevron-right more-sheet-item-chevron"></i>
    </button>`;
  }).join('');
}

function openMoreSheet() {
  moreSheetOpen = true;
  document.getElementById('more-sheet')?.classList.add('open');
  document.getElementById('more-sheet-backdrop')?.classList.add('open');
  document.body.classList.add('more-sheet-locked');
  const moreBtn = document.querySelector('.mtab-more');
  if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
}
function closeMoreSheet() {
  moreSheetOpen = false;
  document.getElementById('more-sheet')?.classList.remove('open');
  document.getElementById('more-sheet-backdrop')?.classList.remove('open');
  document.body.classList.remove('more-sheet-locked');
  const moreBtn = document.querySelector('.mtab-more');
  if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
}
function toggleMoreSheet() {
  if (moreSheetOpen) closeMoreSheet();
  else openMoreSheet();
}
function selectFromMoreSheet(id) {
  closeMoreSheet();
  setTab(id);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && moreSheetOpen) closeMoreSheet();
});

function scrollContentToTop() {
  // On desktop .content-wrap is the independently-scrolling panel; on
  // mobile the window itself scrolls. Reset whichever is active so every
  // tab opens from the top instead of wherever the previous tab left off.
  const cw = document.querySelector('.content-wrap');
  if (cw) cw.scrollTop = 0;
  window.scrollTo(0, 0);
}
async function setTab(id) {
  // Quick crossfade-out of whatever's currently in #content before we
  // swap tabs. Scoped to setTab (not renderTabContent itself) on purpose:
  // renderTabContent() is also called from dozens of places elsewhere
  // (every meal/expense/deposit edit re-renders the current tab to reflect
  // the change) and those in-place updates should stay instant — only an
  // actual tab switch should pay the small fade delay below. Without this,
  // the old tab's content was replaced by the new tab's content in the
  // same synchronous tick, so the "fade in" of the new content had nothing
  // to fade in *from* — it just snapped, which is what read as a jhaki.
  const outgoing = id !== activeTab ? document.getElementById('content') : null;
  if (outgoing && outgoing.childNodes.length) {
    outgoing.classList.add('tab-content-leaving');
    await new Promise(res => setTimeout(res, 150));
  }
  activeTab = id;
  if (moreSheetOpen) closeMoreSheet();
  if (id !== 'members') _maDirty = false;
  if (id !== 'settings') _adminMonthAccessDraft = null; // force a fresh draft next time Settings is opened
  // Build the sidebar/tabbar DOM once (login, or role/tab-set genuinely
  // changed); every subsequent tab click just toggles which button has the
  // `active` class on the SAME nodes (see updateActiveTabHighlight() above)
  // so the CSS color/background transitions can actually animate instead
  // of a rebuilt node snapping straight into its final state.
  if (document.querySelectorAll('#tabs .tab-btn[data-tab-id]').length) {
    updateActiveTabHighlight();
  } else {
    renderTabs();
  }
  scrollContentToTop();
  // BUGFIX (full-collection Firestore read on every single tab click): this
  // used to call loadState() here — a full re-fetch of the entire
  // mealAppStorage collection — every time a tab was opened, even though
  // the realtime listener (startRealtimeSync -> applyFreshState, see
  // 05-session-sync.js) already keeps `state` continuously up to date in
  // the background the whole time the app is open. That made every tab
  // click cost as much as a full app reload, for data that was already
  // current. `state` reflects the live listener's last snapshot (or the
  // polling fallback's), so we can just render it directly.
  //
  // The one case that still needs an explicit fetch: the realtime sync
  // isn't actually running (e.g. it failed to start and polling hasn't
  // kicked in yet either) — then `state` could genuinely be stale, so fall
  // back to a real fetch only in that situation.
  const syncIsLive = (typeof _snapshotUnsub !== 'undefined' && _snapshotUnsub) ||
    (typeof _autoSyncInterval !== 'undefined' && _autoSyncInterval);
  if (!syncIsLive) {
    const c = document.getElementById('content');
    if (c) {
      c.innerHTML = '<div class="card empty"><i class="fas fa-spinner fa-spin"></i>&nbsp; Loading latest data…</div>';
    }
    try {
      state = await loadState();
    } catch (e) {
      console.error('Tab refresh failed:', e);
      showToast('Could not refresh latest data — showing last known data.', 'error');
    }
  }
  // Login Log / Database Log aren't part of the live-synced state anymore
  // (see loadLogs() in 02-state-storage.js and the LOGS_COLLECTION comment
  // in storage.js) — they're fetched fresh, once, only when someone
  // actually opens one of these two tabs, instead of being pushed to every
  // signed-in member's listener for the entire session.
  if (id === 'loginlog' || id === 'actionlog') {
    const c = document.getElementById('content');
    if (c) {
      c.innerHTML = '<div class="card empty"><i class="fas fa-spinner fa-spin"></i>&nbsp; Loading logs…</div>';
    }
    try {
      await loadLogs();
    } catch (e) {
      console.error('loadLogs failed:', e);
      showToast('Could not load logs — check your connection and try again.', 'error');
    }
  }
  clearCalcCache();
  renderTabContent(true);
}

function renderTabContent(animate) {
  if (animate === undefined) animate = false;
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
  // Replay the tab-switch fade/slide-in animation ONLY when explicitly
  // requested (animate=true) — i.e. a genuine tab switch (setTab()) or the
  // initial paint right after login (enterApp()). Every other caller — the
  // dozens of in-place repaints after adding/removing a meal, grocery cost,
  // shared expense, or deposit/balance change on the SAME tab, plus the
  // live Firestore listener repainting someone else's change — leaves
  // animate unset and now defaults to false, so #content swaps in silently
  // instead of replaying the fade+shift+scale entrance animation. That
  // animation used to fire unconditionally on every render regardless of
  // caller, which is why simply adding/removing a meal, cost, expense, or
  // deposit made the whole page visibly "jolt" every single time — even
  // though nothing about it was actually navigation. Tab switches and the
  // post-login entrance still get the normal animated transition.
  if (animate) {
    // The class is already present on #content from the previous render, so
    // just adding it again wouldn't restart the CSS animation — removing
    // it, forcing a reflow (reading offsetWidth), then re-adding it is what
    // makes the browser treat it as a fresh animation start each time.
    c.classList.remove('tab-content-anim', 'tab-content-leaving');
    void c.offsetWidth;
    c.classList.add('tab-content-anim');
  }
  console.timeEnd('renderTabContent');
}

/* ---------------- CALC HELPERS ---------------- */