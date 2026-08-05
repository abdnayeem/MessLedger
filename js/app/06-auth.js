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
  runScheduledNotificationChecks();
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

/* ---------------- LOGIN ---------------- */
function hideBootLoader() {
  const el = document.getElementById('boot-loader');
  if (el) el.remove();
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
        <div class="logo-dot">M</div>
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
  const m = resolveLoginMember(errBox);
  if (!m) return;
  if (m.accountDisabled) {
    errBox.textContent = `This account is disabled after ${MAX_LOGIN_ATTEMPTS} failed attempts. Ask your super admin to re-enable it, or use "Forgot PIN?" with the recovery code.`;
    return;
  }
  if (m.role !== 'superadmin' && !isMemberActiveInMonth(m.id, realCurrentMonth())) {
    errBox.textContent = `You're marked inactive for ${realCurrentMonth()} by the super admin, so you can't log in this month. Ask them to reactivate you for a future month.`;
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
        return;
      }
      await persistMembers();
      const left = MAX_LOGIN_ATTEMPTS - m.failedLoginAttempts;
      errBox.textContent = `Incorrect PIN. ${left} attempt${left===1?'':'s'} left before this account is disabled.`;
      return;
    }
    errBox.textContent = 'Incorrect PIN.';
    return;
  }
  if (m.failedLoginAttempts) {
    m.failedLoginAttempts = 0;
    await persistMembers();
  }
  recordLoginLog(m);
  enterApp(m);
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
