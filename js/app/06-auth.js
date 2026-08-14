// ---------------------------------------------------------------------------
// 06-auth.js  (originally app.js lines 1719-2175)
// App entry (enterApp/hideBootLoader), login screen + doLogin/forgotPin, device detection, login/action logs, logout, PIN change + forced-PIN modal
// ---------------------------------------------------------------------------
function enterApp(m, opts) {
  hideBootLoader();
  opts = opts || {};
  session = {
    userId: m.id,
    role: m.role
  };
  sessionExpiresAt = opts.expiresAt || computeSessionExpiry();
  if (opts.persist !== false) persistSession(m);
  // Notifications aren't part of the full-state fetch above anymore (see
  // loadNotifications() in 02-state-storage.js) — fetch this member's own
  // on login so the bell isn't empty until the next scheduler tick/bell-open.
  // runScheduledNotificationChecks() is deliberately chained AFTER the fetch
  // resolves, not fired in parallel with it — those checks dedupe by
  // scanning state.notifications in memory, so running them before the
  // fetch lands (against a still-empty array) could create a genuine
  // duplicate of a reminder that already exists on the server. (They're
  // also individually gated behind the same "have we loaded yet" flag as a
  // second line of defense — see _notifBaselineLoaded in 01-notifications.js.)
  loadNotifications().then(() => {
    runScheduledNotificationChecks();
    if (session && session.userId) renderTopWho();
  }).catch(e => console.error('loadNotifications (login) failed:', e));
  startNotificationScheduler();
  startRealtimeSync(); // moved here from bindActivityTracking() — only open the live listener once someone is actually signed in
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('main-screen').style.display = 'block';
  activeTab = 'dashboard';
  // Recompute on every login — see getCurrentMonthStr() comment above for why
  // relying only on the value set when the script first loaded isn't enough.
  currentMonth = getCurrentMonthStr();
  const monthSelectEl = document.getElementById('month-select');
  monthSelectEl.value = currentMonth;
  if (!monthSelectEl._changeBound) {
    monthSelectEl.addEventListener('change', (e) => {
      currentMonth = e.target.value;
      renderTabContent();
    });
    monthSelectEl._changeBound = true; // prevents duplicate listeners if enterApp() runs again (logout -> login again) without a full page reload
  }
  renderTopWho();
  renderTabs();
  renderTabContent();
  startSessionCountdown();
  // Mandatory security gate: anyone still on the default PIN must change it
  // before doing anything else. The app underneath has already rendered
  // normally (existing behavior untouched) — this just locks it behind a
  // non-dismissible overlay until the PIN is changed.
  if (m.pin === DEFAULT_PIN) showForcedPinChangeModal(m.id);
}

// `state` at this point may only be the lightweight login-screen data
// (members/settings/meta/monthlyActive — see fetchLoginScreenState() in
// 02-state-storage.js), not the full days/deposits/expenses/costs/logs a
// signed-in session actually needs. This fetches the full data (via the
// same realtime listener the app keeps running afterwards — see
// waitForFirstSnapshot()/ensureRealtimeListener() in 05-session-sync.js,
// so it's still only ONE full read, not an extra one on top of the live
// listener) and only THEN calls enterApp(), so the dashboard never briefly
// flashes empty/zeroed data. Throws on failure — callers decide how to
// surface that (see doLogin() and paintFromState() below).
async function enterAppWithFullData(m, opts) {
  const items = await waitForFirstSnapshot();
  state = validateState(buildStateFromItems(items));
  _hasFullState = true; // see 02-state-storage.js — now safe for _markEdited() to cache `state`
  writeLocalCache(state);
  enterApp(m, opts);
}

/* ---------------- LOGIN ---------------- */
function hideBootLoader() {
  const el = document.getElementById('boot-loader');
  if (el) el.remove();
}

// Shows (or updates, if already showing) the same branded full-screen
// loader used for the very first page load — see index.html's initial
// #boot-loader markup, which uses these exact class names (.bl-logo/
// .bl-ring/.bl-txt) so this never looks like a "different" loading state
// mid-flow. Used for: (1) a slow persisted-session auto-login (see
// paintFromState() in 20-bootstrap.js), and (2) doLogin() below, so
// waiting on a slow connection always shows this instead of a frozen-
// looking screen with just a button label change.
function showBootLoader(message) {
  let el = document.getElementById('boot-loader');
  if (el && el.querySelector('.bl-content')) {
    // Boot loader is already up on screen (e.g. going straight from the
    // initial "Loading MessLedger…" text into this one) — just update the
    // message in place instead of rebuilding. Previously this always
    // replaced the whole innerHTML, which destroyed and recreated the
    // logo/ring/dots too, restarting their animations and causing a
    // visible flash/jolt right when the text changed. A plain text swap
    // (with a quick crossfade) leaves everything else untouched.
    el.style.display = 'flex';
    const txt = el.querySelector('.bl-txt');
    if (txt && txt.textContent !== message) {
      txt.style.opacity = '0';
      setTimeout(() => {
        txt.textContent = message;
        txt.style.opacity = '1';
      }, 150);
    }
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-loader';
    document.body.insertBefore(el, document.body.firstChild);
  }
  el.innerHTML = `
    <div class="bl-dots"></div>
    <div class="bl-glow"></div>
    <div class="bl-content">
      <div class="bl-ring-wrap"><div class="bl-ring-track"></div><div class="bl-ring"></div><div class="bl-logo"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect x="0" y="0" width="100" height="100" rx="20" fill="#2E5DE8"/>
<rect x="23" y="23" width="54" height="56" rx="5" fill="#FFFFFF"/>
<rect x="30" y="35" width="26" height="3.5" rx="1.75" fill="#2E5DE8" opacity="0.5"/>
<rect x="30" y="45" width="38" height="3.5" rx="1.75" fill="#2E5DE8" opacity="0.5"/>
<rect x="30" y="55" width="38" height="3.5" rx="1.75" fill="#2E5DE8" opacity="0.5"/>
<circle cx="77" cy="77" r="19" fill="#22C08A"/>
<path d="M67.5 77 L74.5 84 L88 68" fill="none" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg></div></div>
      <div class="bl-brand">MessLedger</div>
      <div class="bl-txt">${message}</div>
    </div>`;
  el.style.display = 'flex';
}

function normalizePhone(p) {
  return (p || '').replace(/\D/g, '');
}
// Finds a member by phone number. Tries an exact normalized match first
// (digits only, ignoring spaces/dashes), then falls back to comparing just
// the last 10 digits so a stored "+8801712345678" still matches someone
// typing "01712345678" (or vice versa).
function findMemberByPhone(entered) {
  const norm = normalizePhone(entered);
  if (!norm) return null;
  let m = state.members.find(mm => mm.phone && normalizePhone(mm.phone) === norm);
  if (!m && norm.length >= 10) {
    const last10 = norm.slice(-10);
    m = state.members.find(mm => mm.phone && normalizePhone(mm.phone).slice(-10) === last10);
  }
  return m || null;
}

function renderLogin() {
  hideBootLoader();
  const s = document.getElementById('login-screen');
  s.innerHTML = `
    <div class="login-card">
      <div class="login-brand">
        <div class="logo-dot"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect x="0" y="0" width="100" height="100" rx="20" fill="#2E5DE8"/>
<rect x="23" y="23" width="54" height="56" rx="5" fill="#FFFFFF"/>
<rect x="30" y="35" width="26" height="3.5" rx="1.75" fill="#2E5DE8" opacity="0.5"/>
<rect x="30" y="45" width="38" height="3.5" rx="1.75" fill="#2E5DE8" opacity="0.5"/>
<rect x="30" y="55" width="38" height="3.5" rx="1.75" fill="#2E5DE8" opacity="0.5"/>
<circle cx="77" cy="77" r="19" fill="#22C08A"/>
<path d="M67.5 77 L74.5 84 L88 68" fill="none" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg></div>
        <div>
          <h1>MessLedger</h1>
          <div class="login-sub">Meal &amp; expense tracker</div>
        </div>
      </div>
      <div class="login-tagline">Enter your phone number and PIN to continue.</div>
      <label>Your phone number</label>
      <input type="tel" id="login-phone" inputmode="tel" placeholder="Enter your number" autocomplete="tel">
      <label>Your PIN</label>
      <input type="password" id="login-pin" inputmode="numeric" placeholder="4-digit PIN">
      <div class="error-text" id="login-error"></div>
      <button class="btn" id="login-btn" style="width:100%; text-align:center;">Sign In</button>
      <div class="login-links">
        <button class="link-btn subtle" onclick="forgotPin()">Forgot PIN?</button>
      </div>
    </div>`;
  document.getElementById('login-btn').addEventListener('click', doLogin);
}
// Resolves which member is trying to log in, by phone number. Shared by
// doLogin() and forgotPin().
function resolveLoginMember(errBox) {
  const phoneVal = document.getElementById('login-phone').value;
  const m = findMemberByPhone(phoneVal);
  if (!m && errBox) errBox.textContent = "No member found with that phone number.";
  return m;
}
async function forgotPin() {
  const m = resolveLoginMember(null);
  if (!m) {
    showToast('Enter your phone number first.', 'error');
    return;
  }
  const code = prompt(`Enter the recovery code to reset ${m.name}'s PIN:`);
  if (code === null) return;
  if (code.trim().toUpperCase() !== state.recoveryCode) {
    showToast('Invalid recovery code. Ask your super admin for it.', 'error');
    return;
  }
  m.pin = '0000';
  m.failedLoginAttempts = 0;
  m.accountDisabled = false;
  await persistMembers();
  showToast('PIN reset. Log in with 0000 and set a new PIN.', 'success');
}
async function doLogin() {
  const errBox = document.getElementById('login-error');
  errBox.textContent = '';
  const loginBtn = document.getElementById('login-btn');
  // Respond the instant the button is clicked — not just after all the
  // validation checks below — so there's never a moment where clicking
  // feels like it did nothing. Every early-return path below restores the
  // button, so it's never stuck showing "Checking…" if login fails fast.
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Checking…';
  }
  const resetBtn = () => {
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign In';
    }
  };
  const m = resolveLoginMember(errBox);
  if (!m) { resetBtn(); return; }
  if (m.accountDisabled) {
    errBox.textContent = `This account is disabled after ${MAX_LOGIN_ATTEMPTS} failed attempts. Ask your super admin to re-enable it, or use "Forgot PIN?" with the recovery code.`;
    resetBtn();
    return;
  }
  if (m.role !== 'superadmin' && !isMemberActiveInMonth(m.id, realCurrentMonth())) {
    errBox.textContent = `You're marked inactive for ${realCurrentMonth()} by the super admin, so you can't log in this month. Ask them to reactivate you for a future month.`;
    resetBtn();
    return;
  }
  const entered = document.getElementById('login-pin').value;
  if (entered !== m.pin) {
    // Super admin accounts are exempt from lockout — there'd be no one left
    // who could re-enable them if the only super admin got locked out.
    if (m.role !== 'superadmin') {
      m.failedLoginAttempts = (m.failedLoginAttempts || 0) + 1;
      if (m.failedLoginAttempts >= MAX_LOGIN_ATTEMPTS) {
        m.accountDisabled = true;
        await persistMembers();
        errBox.textContent = `Incorrect PIN. Account disabled after ${MAX_LOGIN_ATTEMPTS} failed attempts — ask your super admin to re-enable it.`;
        resetBtn();
        return;
      }
      await persistMembers();
      const left = MAX_LOGIN_ATTEMPTS - m.failedLoginAttempts;
      errBox.textContent = `Incorrect PIN. ${left} attempt${left===1?'':'s'} left before this account is disabled.`;
      resetBtn();
      return;
    }
    errBox.textContent = 'Incorrect PIN.';
    resetBtn();
    return;
  }
  if (m.failedLoginAttempts) {
    m.failedLoginAttempts = 0;
    await persistMembers();
  }
  recordLoginLog(m);
  // BUGFIX (login felt frozen on a slow connection): this used to only
  // change the button's own label to "Signing in…" while
  // enterAppWithFullData() awaited a full data fetch that can take several
  // seconds — everything else on screen (the login card, phone/PIN fields)
  // just sat there unchanged, which read as broken rather than loading.
  // showBootLoader() brings up the same branded full-screen loader used
  // for the initial page boot, so a slow login now always shows clear,
  // consistent progress instead of a static form with one changed word.
  showBootLoader('Signing you in…');
  // A couple of seconds in, swap to a message that sets the right
  // expectation instead of leaving the same static line up the whole
  // time — makes a genuinely slow connection feel handled, not stuck.
  const slowMsgTimer = setTimeout(() => {
    const txt = document.querySelector('#boot-loader .bl-txt');
    if (txt) txt.textContent = 'Still loading your data — this can take a few seconds on a slower connection…';
  }, 3000);
  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';
  }
  try {
    await enterAppWithFullData(m);
  } catch (err) {
    console.error('Failed to load full data after login:', err);
    hideBootLoader();
    errBox.textContent = 'Signed in, but could not load your data. Check your connection and try again.';
    resetBtn();
  } finally {
    clearTimeout(slowMsgTimer);
  }
}
// Best-effort browser/OS guess from the user agent string. Not exact (user
// agents can be spoofed or blocked), but good enough for "which device".
function detectDevice() {
  const ua = navigator.userAgent || '';
  let os = 'Unknown device';
  if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  let browser = 'Unknown browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = 'Chrome';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
  return `${browser} on ${os}`;
}
// Keeps only the newest MAX_LOGIN_LOGS entries so this collection doesn't
// grow forever; older docs are deleted from storage too, not just dropped
// from memory.
function trimLoginLogs() {
  if (state.loginLogs.length > MAX_LOGIN_LOGS) {
    const excess = state.loginLogs.slice(MAX_LOGIN_LOGS);
    state.loginLogs = state.loginLogs.slice(0, MAX_LOGIN_LOGS);
    excess.forEach(l => deleteLoginLogDoc(l.id));
  }
}
/* ---------------- DATABASE ACTION LOG (super admin only) ----------------
   Records every add/update/delete write this app makes to meals, grocery
   costs, shared expenses, deposits/withdrawals, members, and settings — who
   did it, which module, and when. Hooked directly into the low-level
   persist() / delete() functions above (persistDay, persistCost,
   deleteCostDoc, persistExpense, deleteExpenseDoc, persistDeposit,
   deleteDepositDoc, persistMembers, persistSettings) so every current AND
   future write that goes through them is caught automatically — no need to
   remember to log at each individual "add meal" / "add cost" call site.
   Fire-and-forget, same as the data write itself: logging never blocks or
   slows down the action the person is doing. Capped at MAX_ACTION_LOGS. */
function trimActionLogs() {
  if (state.actionLogs.length > MAX_ACTION_LOGS) {
    const excess = state.actionLogs.slice(MAX_ACTION_LOGS);
    state.actionLogs = state.actionLogs.slice(0, MAX_ACTION_LOGS);
    excess.forEach(l => deleteActionLogDoc(l.id));
  }
}

function logAction(module, action, recordId, detail) {
  if (!session.userId) return; // nothing to attribute a system-level write to (e.g. first-run seeding) — skip
  const me = memberById(session.userId);
  const entry = {
    id: 'al' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    memberId: session.userId,
    memberName: me ? me.name : 'Unknown',
    role: session.role,
    module,
    action,
    recordId: recordId !== undefined ? String(recordId) : '',
    detail: detail || '',
    at: nowTimestamp()
  };
  state.actionLogs.unshift(entry);
  trimActionLogs();
  persistActionLog(entry.id); // fire-and-forget — see comment above
  if (activeTab === 'actionlog') renderTabContent();
}
// Best-effort public IP lookup. This is genuinely best-effort: it depends on
// an external service and the user's network/browser allowing it, so it can
// fail (offline, blocked, slow) without that ever holding up sign-in/out —
// callers don't await this before proceeding, and the log entry is saved
// immediately with whatever it has, then quietly updated if an IP arrives.
async function fetchClientIp() {
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('https://api.ipify.org?format=json', {
      signal: ctrl.signal
    });
    clearTimeout(timeout);
    if (!res.ok) return '';
    const data = await res.json();
    return (data && data.ip) ? data.ip : '';
  } catch (e) {
    return '';
  }
}
// Logs who signed in/out, when (Bangladesh time), from which device, action
// (login/logout), and IP if it can be determined. Every entry is saved
// right away so it shows up in the Login Log immediately; the IP (when it
// resolves) is patched onto the same entry and re-saved a moment later.
async function recordLoginLog(member, action) {
  action = action || 'login';
  const id = 'lg' + Date.now() + '_' + member.id + '_' + action;
  const entry = {
    id,
    memberId: member.id,
    memberName: member.name,
    role: member.role,
    timestamp: nowTimestamp(),
    device: detectDevice(),
    action,
    ip: ''
  };
  state.loginLogs.unshift(entry);
  trimLoginLogs();
  await persistLoginLog(id);
  if (activeTab === 'loginlog') renderTabContent();
  fetchClientIp().then(ip => {
    if (!ip) return;
    const e = state.loginLogs.find(x => x.id === id);
    if (!e) return; // already trimmed off (extremely unlikely this soon)
    e.ip = ip;
    persistLoginLog(id);
    if (activeTab === 'loginlog') renderTabContent();
  });
}

function logout() {
  const m = memberById(session.userId);
  if (m) recordLoginLog(m, 'logout');
  stopSessionCountdown();
  stopRealtimeSync();
  stopNotificationScheduler();
  // Reset so the next login re-gates checkLowBalanceNotification/
  // checkMarketDutyReminders/checkMealEditReminders behind a fresh
  // loadNotifications() (see the flag's comment in 01-notifications.js) —
  // otherwise a same-tab re-login (logout -> log back in without a full
  // page reload) would incorrectly treat stale notification data as
  // "already loaded" and risk creating duplicates.
  _notifBaselineLoaded = false;
  if (_backgroundPauseTimer) {
    clearTimeout(_backgroundPauseTimer);
    _backgroundPauseTimer = null;
  }
  _listenerPausedForBackground = false;
  clearPersistedSession();
  if (notifPanelOpen) {
    notifPanelOpen = false;
    document.removeEventListener('click', closeNotifPanelOnOutsideClick);
  }
  session = {
    userId: null,
    role: null
  };
  sessionExpiresAt = null;
  document.getElementById('main-screen').style.display = 'none';
  document.getElementById('login-screen').style.display = 'block';
  renderLogin();
}
async function changeMyPin() {
  const me = memberById(session.userId);
  const oldPin = prompt('Enter your current PIN:');
  if (oldPin === null) return;
  if (oldPin !== me.pin) {
    showToast('Current PIN is incorrect.', 'error');
    return;
  }
  const newPin = prompt('Enter new PIN (at least 4 digits):');
  if (newPin === null) return;
  if (!newPin || newPin.length < 4) {
    showToast('PIN must be at least 4 digits.', 'error');
    return;
  }
  const confirmPin = prompt('Re-enter new PIN to confirm:');
  if (confirmPin !== newPin) {
    showToast("PINs don't match. Try again.", 'error');
    return;
  }
  me.pin = newPin;
  await persistMembers();
  showToast('PIN updated.', 'success');
}

/* ---------------- MANDATORY DEFAULT-PIN CHANGE (security gate) ----------------
   Anyone who logs in still on the default PIN (0000 — see DEFAULT_PIN above)
   gets a full-screen, non-dismissible modal on top of the app the instant
   they land in enterApp(). There is deliberately no close/cancel/skip button,
   no backdrop-click handler, and no Escape handler — the only way out is a
   successful PIN change, which then forces a fresh login with the new PIN.
   Everything else in the app (menus, tabs, dashboard) keeps rendering
   normally underneath; this overlay is what actually blocks interaction
   with it while it's open. */
let _forcedPinStylesInjected = false;

function injectForcedPinStyles() {
  if (_forcedPinStylesInjected) return;
  _forcedPinStylesInjected = true;
  const style = document.createElement('style');
  style.id = 'forced-pin-styles';
  style.textContent = `
    #forced-pin-overlay{position:fixed; inset:0; z-index:99999; display:none; align-items:center; justify-content:center; padding:16px;}
    #forced-pin-overlay .forced-pin-backdrop{position:absolute; inset:0; background:rgba(15,23,42,0.72); backdrop-filter:blur(2px);}
    #forced-pin-overlay .forced-pin-modal{position:relative; width:100%; max-width:400px; background:var(--card-bg,#fff); color:var(--text,#0f172a); border-radius:16px; padding:28px 24px; box-shadow:0 20px 60px rgba(0,0,0,0.35); animation:forcedPinPop .25s ease-out;}
    @keyframes forcedPinPop{ from{opacity:0; transform:translateY(12px) scale(.97);} to{opacity:1; transform:translateY(0) scale(1);} }
    #forced-pin-overlay .forced-pin-icon{font-size:32px; text-align:center; margin-bottom:6px;}
    #forced-pin-overlay h2{font-size:19px; text-align:center; margin:0 0 8px;}
    #forced-pin-overlay .forced-pin-msg{font-size:13.5px; text-align:center; opacity:0.8; margin:0 0 20px; line-height:1.45;}
    #forced-pin-overlay .forced-pin-field{margin-bottom:14px;}
    #forced-pin-overlay .forced-pin-field label{display:block; font-size:12.5px; font-weight:600; margin-bottom:5px; opacity:0.85;}
    #forced-pin-overlay .forced-pin-field input{width:100%; box-sizing:border-box; padding:11px 12px; border-radius:9px; border:1px solid var(--border,#d8dee9); font-size:15px; background:var(--input-bg,#fff); color:inherit; transition:border-color .15s, box-shadow .15s;}
    #forced-pin-overlay .forced-pin-field input:focus{outline:none; border-color:var(--accent,#4f46e5); box-shadow:0 0 0 3px rgba(79,70,229,0.15);}
    #forced-pin-overlay #fpin-error{min-height:18px; margin-bottom:10px;}
    #forced-pin-overlay #fpin-submit{width:100%; text-align:center;}
    body.forced-pin-lock #main-screen{filter:blur(2px); pointer-events:none; user-select:none;}
  `;
  document.head.appendChild(style);
}

function showForcedPinChangeModal(memberId) {
  injectForcedPinStyles();
  let overlay = document.getElementById('forced-pin-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'forced-pin-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="forced-pin-backdrop"></div>
    <div class="forced-pin-modal" role="dialog" aria-modal="true" aria-labelledby="forced-pin-title">
      <div class="forced-pin-icon">🔒</div>
      <h2 id="forced-pin-title">Change Your Default PIN</h2>
      <p class="forced-pin-msg">For your account security, you must change your default PIN before continuing.</p>
      <div class="forced-pin-field">
        <label>Current PIN</label>
        <input type="password" id="fpin-current" inputmode="numeric" autocomplete="off" placeholder="Enter current PIN">
      </div>
      <div class="forced-pin-field">
        <label>New PIN</label>
        <input type="password" id="fpin-new" inputmode="numeric" autocomplete="off" placeholder="At least 4 digits">
      </div>
      <div class="forced-pin-field">
        <label>Confirm New PIN</label>
        <input type="password" id="fpin-confirm" inputmode="numeric" autocomplete="off" placeholder="Re-enter new PIN">
      </div>
      <div class="error-text" id="fpin-error"></div>
      <button class="btn" id="fpin-submit">Change PIN</button>
    </div>
  `;
  // No backdrop click-to-close and no Escape handler — intentionally absent
  // so the modal cannot be dismissed any way other than a successful change.
  overlay.style.display = 'flex';
  document.body.classList.add('forced-pin-lock');
  document.getElementById('fpin-submit').addEventListener('click', () => submitForcedPinChange(memberId));
  overlay.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitForcedPinChange(memberId);
      }
    });
  });
  document.getElementById('fpin-current').focus();
}

function closeForcedPinModal() {
  const overlay = document.getElementById('forced-pin-overlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  }
  document.body.classList.remove('forced-pin-lock');
}
async function submitForcedPinChange(memberId) {
  const errBox = document.getElementById('fpin-error');
  const m = memberById(memberId);
  if (!m) {
    closeForcedPinModal();
    return;
  } // shouldn't happen, but don't leave someone stuck behind a dead overlay
  errBox.textContent = '';
  const cur = document.getElementById('fpin-current').value;
  const next = document.getElementById('fpin-new').value;
  const conf = document.getElementById('fpin-confirm').value;
  if (!cur) {
    errBox.textContent = 'Enter your current PIN.';
    return;
  }
  if (cur !== m.pin) {
    errBox.textContent = 'Current PIN is incorrect.';
    return;
  }
  if (!next || next.length < 4) {
    errBox.textContent = 'New PIN must be at least 4 digits.';
    return;
  }
  if (next === DEFAULT_PIN) {
    errBox.textContent = 'New PIN cannot be the default PIN (0000).';
    return;
  }
  if (conf !== next) {
    errBox.textContent = "PINs don't match. Try again.";
    return;
  }
  const submitBtn = document.getElementById('fpin-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Changing...';
  try {
    m.pin = next; // account is now off the default PIN, so this modal won't trigger again
    m.failedLoginAttempts = 0;
    await persistMembers();
  } catch (e) {
    errBox.textContent = 'Something went wrong saving your new PIN. Please try again.';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Change PIN';
    return;
  }
  closeForcedPinModal();
  showToast('Your PIN has been changed successfully. Please log in again using your new PIN.', 'success');
  logout(); // clears session and returns to the login screen, per the mandatory-relogin requirement
}

/* ---------------- SHELL ---------------- */