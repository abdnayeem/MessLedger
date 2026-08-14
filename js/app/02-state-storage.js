// ---------------------------------------------------------------------------
// 02-state-storage.js  (originally app.js lines 482-1019)
// Default settings, local cache read/write, storage key constants, admin month-access rules, state defaults/migration, Firestore doc assembly, loadState()
// ---------------------------------------------------------------------------
// BUGFIX (partial state silently overwriting the full local cache): `state`
// can now briefly hold only the lightweight login-screen data (members/
// settings/meta/monthlyActive — see fetchLoginScreenState() below) before a
// session exists — e.g. while sitting on the login screen, or right after a
// failed login attempt. persistMembers() (03-persistence.js) can run in
// that exact window (a wrong-PIN attempt or account lockout both call it),
// and _markEdited() used to unconditionally write whatever `state` is to
// the local cache — which would replace a previously-good FULL cached
// snapshot with this near-empty one, so an offline reload afterwards would
// show an alarming "all data is gone" screen even though nothing was
// actually lost server-side. This flag is only true once `state` genuinely
// holds the complete dataset (set in loadState(), enterAppWithFullData(),
// applyFreshState(), and the offline-cache-fallback path in init()) —
// _markEdited() checks it before writing to cache.
let _hasFullState = false;

function defaultSettings() {
  return {
    mealLockHour: 11,
    mealLockMinute: 59, // NEW: minute-level cutoff precision (previously whole-hour only, so 11:59 AM wasn't selectable)
    maxMealQty: 3,
    maxMealQtyScope: 'member', // 'member' = only members capped (admin & super admin unlimited) | 'member_admin' = members & admins capped (only super admin unlimited)
    lowBalanceWarn: 100,
    marketDeadlineLunch: 10,
    marketDeadlineDinner: 17,
    negativeBalanceBuffer: 0,
    sessionInactivityDays: 7,
    recordedAtVisibility: 'superadmin',
    addedByVisibility: 'superadmin',
    mealsHistoryVisibility: 'superadmin', // who can see OTHER members' entries in All Meals History — everyone always sees their own
    mealLockEnabled: true,
    adminMonthAccess: {
      meals: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      },
      costs: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      },
      expenses: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      },
      deposits: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      }
    },
    notifications: {
      depositEnabled: true,
      withdrawalEnabled: true,
      lowBalanceEnabled: true,
      marketReminderEnabled: true,
      mealEditReminderEnabled: true,
      mealEditReminderTime: '20:00', // BD time, HH:MM — daily reminder that tomorrow's meal edit cutoff is approaching
      marketReminderTime: '08:00' // BD time, HH:MM — daily reminder sent to whoever has market/bazar duty that day
    }
  };
}
// REMOVED: defaultState() used to generate a hardcoded 14-member demo
// roster (pin '0000', first member auto-promoted to superadmin) and was
// used as a silent fallback in two places whenever real member data
// couldn't be read. This app is already live with real data — there is no
// scenario where fabricating fake members is an acceptable fallback. Both
// call sites below (buildStateFromItems and loadState) now throw an error
// instead of silently seeding/overwriting real data. See those functions
// for details.

// Local, same-device cache of the last known state. localStorage is
// synchronous — reading it costs ~0ms, unlike the Firestore round-trip in
// loadState(). This is what lets the next reload paint instantly with
// last-known data while the real (accurate) data loads in the background.
function readLocalCache() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function writeLocalCache(s) {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(s));
  } catch (e) {
    /* storage full/disabled — safe to ignore, Firestore stays the source of truth */
  }
}

const KEY_MEMBERS = 'meal-app-members';
const KEY_SETTINGS = 'meal-app-settings';
const KEY_META = 'meal-app-meta';
const PFX_DAY = 'meal-app-day__';
const PFX_DEPOSIT = 'meal-app-deposit__';
const PFX_EXPENSE = 'meal-app-expense__';
const PFX_COST = 'meal-app-cost__';
const PFX_LOGINLOG = 'meal-app-loginlog__';
const PFX_ACTIONLOG = 'meal-app-actionlog__';
const PFX_MONTHLYACTIVE = 'meal-app-monthlyactive__';
const PFX_NOTIF = 'meal-app-notif__';
const KEY_TEST_DATA_BACKUP = 'meal-app-testdata-backup'; // single doc: {createdAt, items:[{key,value}]} — snapshot taken right before "Reset All Test Data" wipes things, so a super admin can undo it within 7 days
// Point-in-time backups of members + settings specifically — this is the
// data that actually gets damaged by a bad edit/role change/PIN reset/bug
// (as opposed to meals/deposits/expenses, which are append-only and already
// covered by per-record delete confirmations + the test-data backup above).
// Kept as ONE doc holding an array of up to MAX_MEMBER_SNAPSHOTS entries
// (not one doc per snapshot) — members+settings are small, so this stays
// cheap to fetch on every load while still giving several restore points,
// rather than multiplying the data pulled on every app load.
const KEY_MEMBER_SNAPSHOTS = 'meal-app-member-snapshots';
const MAX_MEMBER_SNAPSHOTS = 15;
// Login lockout: after this many consecutive wrong-PIN attempts, the account
// is disabled and can only be re-enabled by the super admin (Members tab) or
// via "Forgot PIN?" with the recovery code. Super admin accounts are exempt —
// locking out the only super admin would have no way back in.
const MAX_LOGIN_ATTEMPTS = 3;
// The PIN every new/reset account starts on ('0000' — set at member creation,
// "Forgot PIN?" recovery, and super admin "Reset PIN"). Anyone still on this
// PIN is forced through the mandatory change-PIN modal on login — see
// enterApp() / showForcedPinChangeModal() below.
const DEFAULT_PIN = '0000';
// Login log: keep only the most recent N successful-login records so storage
// doesn't grow unbounded forever. Oldest entries are dropped once the cap is hit.
const MAX_LOGIN_LOGS = 300;
// Cap for the Database Action Log (below) — same reasoning as MAX_LOGIN_LOGS:
// every login/tab-refresh fetches the ENTIRE data set in one go, so an
// unbounded log would keep growing and slowly make every load a bit slower.
// 500 keeps it bounded while still holding a good few weeks of activity.
const MAX_ACTION_LOGS = 500;

/* -------- ADMIN MONTH ACCESS CONTROL -------- */
// Evaluates whether a given YYYY-MM is accessible by an Admin for a given module.
// Super Admin always has full access (returns true immediately).
// Admin access depends on: current/past/future flags + specific year→month grants.
function isMonthAllowedForAdmin(yearMonth, module) {
  if (!state || !state.settings || !state.settings.adminMonthAccess) return true;
  const cfg = state.settings.adminMonthAccess[module];
  if (!cfg) return true; // fallback: allow if config missing

  const today = getCurrentMonthStr(); // local date, not UTC — a UTC-based "today" could disagree with the real local current month and wrongly block admin edits
  const isCurrentMonth = yearMonth === today;
  const isPastMonth = yearMonth < today;
  const isFutureMonth = yearMonth > today;

  // Check current/past/future flags
  if (isCurrentMonth && cfg.current) return true;
  if (isPastMonth && cfg.past) return true;
  if (isFutureMonth && cfg.future) return true;

  // Check specific year→month grants
  if (cfg.specificYears && Object.keys(cfg.specificYears).length > 0) {
    const [year, month] = yearMonth.split('-');
    if (cfg.specificYears[year] && cfg.specificYears[year].includes(month)) {
      return true;
    }
  }

  return false;
}

// Wrapper: checks both role (super admin always allowed) and month access for admin.
function canRoleAccessMonth(yearMonth, module, role) {
  if (role === 'superadmin') return true; // super admin always unrestricted
  if (role === 'admin') return isMonthAllowedForAdmin(yearMonth, module);
  return false; // members don't have access to these operations (they only log meals)
}

// Human-readable description of allowed months for a given module config.
function describeMonthAccessCfg(cfg, module) {
  const parts = [];
  const today = getCurrentMonthStr(); // local date, not UTC

  if (cfg.current) parts.push(`Current month (${today})`);
  if (cfg.past) parts.push('All past months');
  if (cfg.future) parts.push('All future months');

  if (cfg.specificYears && Object.keys(cfg.specificYears).length > 0) {
    const specs = [];
    Object.keys(cfg.specificYears).sort().forEach(year => {
      const months = cfg.specificYears[year];
      if (months.length === 12) {
        specs.push(`All months of ${year}`);
      } else {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const names = months.map(m => monthNames[parseInt(m) - 1]).join(', ');
        specs.push(`${year}: ${names}`);
      }
    });
    parts.push(specs.join('; '));
  }

  return parts.length > 0 ? parts.join(' + ') : 'None (blocked)';
}

// Guard: throws/toasts if admin tries to access a disallowed month for a module.
function guardAdminMonthAccess(yearMonth, module) {
  if (session.role === 'superadmin') return true; // always ok
  if (session.role !== 'admin') return true; // members don't hit this guard

  if (!canRoleAccessMonth(yearMonth, module, 'admin')) {
    const cfg = state.settings.adminMonthAccess[module];
    const allowed = describeMonthAccessCfg(cfg, module);
    const msg = `Admin access restricted. This module only allows: ${allowed}`;
    showToast(msg, 'error');
    return false;
  }
  return true;
}

function fillStateDefaults(s) {
  if (!s.expenses) s.expenses = [];
  if (!s.costs) s.costs = [];
  if (!s.deposits) s.deposits = [];
  if (!s.days) s.days = {};
  if (!s.loginLogs) s.loginLogs = [];
  s.loginLogs.forEach(l => {
    if (!l.action) l.action = 'login'; // older entries were only ever recorded for logins
    if (l.ip === undefined) l.ip = '';
  });
  if (!s.actionLogs) s.actionLogs = [];
  if (!s.monthlyActive) s.monthlyActive = {};
  if (!s.notifications) s.notifications = [];
  if (s.testDataBackup === undefined) s.testDataBackup = null;
  if (!Array.isArray(s.memberSnapshots)) s.memberSnapshots = [];
  if (!s.recoveryCode) s.recoveryCode = generateRecoveryCode();
  if (!s.settings) s.settings = defaultSettings();
  else {
    const d = defaultSettings();
    const isExistingConfiguredCutoff = s.settings.mealLockHour !== undefined && s.settings.mealLockMinute === undefined;
    Object.keys(d).forEach(k => {
      if (s.settings[k] === undefined) s.settings[k] = d[k];
    });
    // BACKFILL NOTE: mealLockMinute is new — every previously-saved settings
    // doc is missing it. The generic loop above would've quietly given an
    // already-configured mess defaultSettings()'s new 11:59 (minute=59),
    // silently shifting its actual cutoff by up to 59 minutes with no one
    // having chosen that. An existing configured hour should keep meaning
    // exactly "HH:00" (its behavior before minutes existed) until a super
    // admin explicitly picks a new time in Settings.
    if (isExistingConfiguredCutoff) s.settings.mealLockMinute = 0;
  }
  s.expenses.forEach(e => {
    if (!e.title) {
      e.title = e.note || 'Shared expense';
    }
    if (e.description === undefined) {
      e.description = '';
    }
  });
  s.members.forEach(m => {
    if (!m.pin) m.pin = (s.pins && s.pins[m.role]) ? s.pins[m.role] : '0000';
    if (m.phone === undefined) m.phone = '';
    if (m.marketDay === undefined) m.marketDay = null;
    if (m.marketShift === undefined) m.marketShift = '';
    if (m.marketItems === undefined) m.marketItems = '';
    // Per-meal (lunch/dinner) shopping-confirmation state, keyed by
    // "YYYY-MM-DD::lunch" / "YYYY-MM-DD::dinner" — see the Market Completion
    // Reminders section below.
    if (!m.marketCompletions) m.marketCompletions = {};
    if (!m.mealLock) m.mealLock = {
      blocked: false,
      reason: '',
      by: ''
    };
    if (m.failedLoginAttempts === undefined) m.failedLoginAttempts = 0;
    if (m.accountDisabled === undefined) m.accountDisabled = false;
    if (m.createdAt === undefined) m.createdAt = null;
  });
  // Auto-migrate adminMonthAccess if missing (new feature)
  if (!s.settings.adminMonthAccess) {
    s.settings.adminMonthAccess = {
      meals: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      },
      costs: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      },
      expenses: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      },
      deposits: {
        current: true,
        past: false,
        future: false,
        specificYears: {}
      }
    };
  }
  // Auto-migrate notification settings if missing/partial (new feature)
  if (!s.settings.notifications) {
    s.settings.notifications = defaultSettings().notifications;
  } else {
    const dn = defaultSettings().notifications;
    Object.keys(dn).forEach(k => {
      if (s.settings.notifications[k] === undefined) s.settings.notifications[k] = dn[k];
    });
  }
  return s;
}

// One-time migration: this app used to keep EVERYTHING in one Firestore
// document (key 'meal-app-v1'). That meant every single meal tick, deposit,
// or expense rewrote the entire mess's data in one go — harmless with one
// person using it, but a real risk of one save clobbering another's once
// several members are saving around the same time. This splits that one
// document into many small ones (one per day / deposit / expense / cost),
// so everyday edits only ever touch the one small document they actually
// changed.
async function migrateFromSingleDoc(old) {
  fillStateDefaults(old);
  const writes = [];
  writes.push(storage.set(KEY_MEMBERS, JSON.stringify(old.members), true));
  writes.push(storage.set(KEY_SETTINGS, JSON.stringify(old.settings), true));
  Object.keys(old.days).forEach(date => {
    writes.push(storage.set(PFX_DAY + date, JSON.stringify(old.days[date]), true));
  });
  old.deposits.forEach(d => {
    writes.push(storage.set(PFX_DEPOSIT + d.id, JSON.stringify(d), true));
  });
  old.expenses.forEach(e => {
    writes.push(storage.set(PFX_EXPENSE + e.id, JSON.stringify(e), true));
  });
  old.costs.forEach(c => {
    writes.push(storage.set(PFX_COST + c.id, JSON.stringify(c), true));
  });
  Object.keys(old.monthlyActive || {}).forEach(month => {
    writes.push(storage.set(PFX_MONTHLYACTIVE + month, JSON.stringify(old.monthlyActive[month]), true));
  });
  // Notifications go to logStorage (LOGS_COLLECTION), not storage — same
  // reason as login/action logs below (see the LOGS_COLLECTION comment in
  // storage.js).
  (old.notifications || []).forEach(n => {
    writes.push(logStorage.set(PFX_NOTIF + n.id, JSON.stringify(n), true));
  });
  await Promise.all(writes);
  // meta (with a migrated:true marker) is written LAST, only after every
  // other piece above is confirmed written. loadState() checks THIS marker
  // — not just whether meal-app-members exists — to decide whether
  // migration is actually finished. If the browser closes or the network
  // dies partway through, this line never runs, so the next reload sees no
  // marker and safely re-runs the whole migration (storage.set overwrites,
  // so re-running it is harmless — no duplicates).
  await storage.set(KEY_META, JSON.stringify({
    recoveryCode: old.recoveryCode,
    migrated: true
  }), true);
  // Only delete the old combined doc once migration is fully confirmed done.
  try {
    await storage.delete(STATE_KEY, true);
  } catch (e) {
    /* not fatal — old key just lingers unused */
  }
}

async function writeFullState(s) {
  const writes = [
    storage.set(KEY_MEMBERS, JSON.stringify(s.members), true),
    storage.set(KEY_SETTINGS, JSON.stringify(s.settings), true),
    storage.set(KEY_META, JSON.stringify({
      recoveryCode: s.recoveryCode,
      migrated: true
    }), true)
  ];
  Object.keys(s.days).forEach(date => {
    writes.push(storage.set(PFX_DAY + date, JSON.stringify(s.days[date]), true));
  });
  s.deposits.forEach(d => {
    writes.push(storage.set(PFX_DEPOSIT + d.id, JSON.stringify(d), true));
  });
  s.expenses.forEach(e => {
    writes.push(storage.set(PFX_EXPENSE + e.id, JSON.stringify(e), true));
  });
  s.costs.forEach(c => {
    writes.push(storage.set(PFX_COST + c.id, JSON.stringify(c), true));
  });
  Object.keys(s.monthlyActive || {}).forEach(month => {
    writes.push(storage.set(PFX_MONTHLYACTIVE + month, JSON.stringify(s.monthlyActive[month]), true));
  });
  // Logs and notifications go to logStorage (LOGS_COLLECTION), not storage
  // — same reason as everywhere else they're written, see the
  // LOGS_COLLECTION comment in storage.js. This only runs once, for a mess
  // still migrating off the old single-doc format, so it's the one place
  // old-format logs/notifications get routed to their new home.
  (s.loginLogs || []).forEach(l => {
    writes.push(logStorage.set(PFX_LOGINLOG + l.id, JSON.stringify(l), true));
  });
  (s.actionLogs || []).forEach(l => {
    writes.push(logStorage.set(PFX_ACTIONLOG + l.id, JSON.stringify(l), true));
  });
  (s.notifications || []).forEach(n => {
    writes.push(logStorage.set(PFX_NOTIF + n.id, JSON.stringify(n), true));
  });
  await Promise.all(writes);
}

// Fallback only: used if a deployed storage.js is ever older than this file
// and doesn't expose getAll() yet. The real storage.js (see storage.js)
// implements getAll() as a single collection.get() round trip; this shim
// gets the same {items:[...]} shape the slow way (list, then one get() per
// key) so loadState() keeps working either way.
async function storageGetAll(shared) {
  const listRes = await storage.list(undefined, shared);
  const keys = (listRes && listRes.keys) || [];
  const items = (await Promise.all(keys.map(async key => {
    try {
      const res = await storage.get(key, shared);
      return res ? {
        key: res.key,
        value: res.value
      } : null;
    } catch (e) {
      return null;
    }
  }))).filter(Boolean);
  return {
    items
  };
}
async function fetchAllStorageItems() {
  if (typeof storage.getAll === 'function') {
    return await storage.getAll(true); // one round trip — collection.get() already returns every doc's data
  }
  return await storageGetAll(true); // older storage.js without getAll() — list + N parallel gets
}

// BUGFIX (data-loss incident): fetchAllStorageItems() can come back with
// ZERO items on a real, previously-used mess — a brief network hiccup, a
// Firestore rule/permission blip, a partial read during a listener restart,
// etc. loadState() used to treat "0 items" as "this mess has never been
// used" and would immediately WRITE defaultState() over Firestore, silently
// replacing every real member (name/role/PIN/phone) with a hardcoded demo
// roster. That is exactly what happened: the demo seed's first member is
// always promoted to superadmin with pin '0000' and blank phone, and every
// other member's role/pin/phone got reset to the same demo defaults.
//
// This app is already live with real data, so there is no longer any
// legitimate "seed brand new data" path at all: an empty read is ALWAYS
// treated as a problem to retry and, failing that, to surface as an error —
// never as a reason to fabricate data. Retrying here just avoids treating a
// harmless transient blip as a hard failure.
async function fetchAllStorageItemsWithRetry(retries, delayMs) {
  retries = retries == null ? 2 : retries;
  delayMs = delayMs == null ? 800 : delayMs;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fetchAllStorageItems();
      const gotItems = result && Array.isArray(result.items) && result.items.length > 0;
      if (gotItems || attempt === retries) return result; // trust it once retries are exhausted
      await new Promise(res => setTimeout(res, delayMs)); // empty on this attempt — could be a blip, try again
    } catch (e) {
      lastErr = e;
      if (attempt === retries) throw lastErr;
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
  throw lastErr || new Error('fetchAllStorageItems failed after retries');
}

// Turns the flat {key, value} documents from storage into the shaped state
// object the rest of the app works with. Shared by loadState() (the initial
// boot fetch) and the realtime listener (every live push update), so both
// paths parse data identically.
function buildStateFromItems(items) {
  const byKey = {};
  items.forEach(it => {
    byKey[it.key] = it.value;
  });
  // BUGFIX: this used to fall back to defaultState().members (hardcoded demo
  // roster, pin '0000', first member auto-promoted to superadmin) whenever
  // KEY_MEMBERS was missing from the fetched items — even though other items
  // existed, meaning this is a real, previously-used mess. A partial/flaky
  // read that happened to miss just the members doc would silently replace
  // every real member. There is no safe default here: if members data can't
  // be read, we must stop and surface an error, never fabricate members.
  if (!byKey[KEY_MEMBERS]) {
    throw new Error('Member data (KEY_MEMBERS) was not found in Firestore, even though other data exists. Refusing to substitute demo data — this is likely a partial/failed read. Please check your connection and reload.');
  }
  const s = {
    members: JSON.parse(byKey[KEY_MEMBERS]),
    settings: byKey[KEY_SETTINGS] ? JSON.parse(byKey[KEY_SETTINGS]) : defaultSettings(),
    recoveryCode: byKey[KEY_META] ? JSON.parse(byKey[KEY_META]).recoveryCode : generateRecoveryCode(),
    testDataBackup: byKey[KEY_TEST_DATA_BACKUP] ? JSON.parse(byKey[KEY_TEST_DATA_BACKUP]) : null,
    memberSnapshots: byKey[KEY_MEMBER_SNAPSHOTS] ? JSON.parse(byKey[KEY_MEMBER_SNAPSHOTS]) : [],
    days: {},
    costs: [],
    deposits: [],
    expenses: [],
    loginLogs: [],
    actionLogs: [],
    monthlyActive: {},
    notifications: []
  };
  items.forEach(it => {
    if (it.key.startsWith(PFX_DAY)) s.days[it.key.slice(PFX_DAY.length)] = JSON.parse(it.value);
    else if (it.key.startsWith(PFX_DEPOSIT)) s.deposits.push(JSON.parse(it.value));
    else if (it.key.startsWith(PFX_EXPENSE)) s.expenses.push(JSON.parse(it.value));
    else if (it.key.startsWith(PFX_COST)) s.costs.push(JSON.parse(it.value));
    else if (it.key.startsWith(PFX_MONTHLYACTIVE)) s.monthlyActive[it.key.slice(PFX_MONTHLYACTIVE.length)] = JSON.parse(it.value);
    // NOTE: PFX_LOGINLOG/PFX_ACTIONLOG/PFX_NOTIF are intentionally NOT
    // handled here anymore — login logs, action logs, AND notifications now
    // all live in their own Firestore collection (LOGS_COLLECTION, see
    // storage.js) instead of inside mealAppStorage, so none of them ever
    // show up in `items` (the live-listened collection) at all. Notifications
    // used to live right here (their own small doc per notification), which
    // meant every deposit/withdrawal/low-balance/reminder notification —
    // and every "mark as read" delete — got pushed to the SAME live listener
    // every other signed-in member has open, billing a phantom read to every
    // open tab for an alert that, 99% of the time, wasn't even about them.
    // They're loaded separately, one-time/on-demand, instead — see
    // loadLogs()/loadNotifications() below.
  });
  // BUGFIX: buildStateFromItems() is called on every single realtime
  // snapshot (every login/logout/meal/cost/expense/deposit/settings
  // change from ANYONE), and its result wholesale-replaces `state` (see
  // applyFreshState() in 05-session-sync.js: `state = fresh`). Since
  // items never contains log or notification docs anymore,
  // `s.loginLogs`/`s.actionLogs`/`s.notifications` above are always
  // freshly-initialized empty arrays — without this, whatever loadLogs()/
  // loadNotifications() had fetched would get silently wiped back to []
  // the instant ANY unrelated change happened anywhere in the app,
  // clearing the bell (or an open log tab) out from under whoever was
  // looking at it. Logs and notifications are only ever loaded/refreshed
  // by loadLogs()/loadNotifications() now, so every other path that
  // rebuilds state must carry forward whatever was already loaded instead
  // of resetting it.
  if (typeof state !== 'undefined' && state) {
    s.loginLogs = state.loginLogs || [];
    s.actionLogs = state.actionLogs || [];
    s.notifications = state.notifications || [];
  }
  fillStateDefaults(s);
  return s;
}

// One-time (non-live) load of login/action logs from their own collection.
// These deliberately aren't part of state.days/deposits/etc's live sync —
// see the LOGS_COLLECTION comment in storage.js for why. Call this right
// before rendering the Login Log / Database Log tabs (see setTab() in
// 07-ui-shell.js) rather than keeping them subscribed all the time; nobody
// is looking at those tabs most of the time, so there's no reason to pay
// for a live listener (or a bigger live-collection snapshot) on their
// behalf for every signed-in member, every session.
async function loadLogs() {
  const [loginRes, actionRes] = await Promise.all([
    logStorage.getByPrefix(PFX_LOGINLOG, true),
    logStorage.getByPrefix(PFX_ACTIONLOG, true)
  ]);
  state.loginLogs = (loginRes.items || [])
    .map(it => JSON.parse(it.value))
    .sort((a, b) => b.timestamp - a.timestamp);
  state.actionLogs = (actionRes.items || [])
    .map(it => JSON.parse(it.value))
    .sort((a, b) => b.at - a.at);
  // BUGFIX (log cap silently stopped working): trimLoginLogs()/
  // trimActionLogs() (06-auth.js) only ever prune state.loginLogs/
  // actionLogs down to MAX_LOGIN_LOGS/MAX_ACTION_LOGS when THIS array
  // holds the complete history — but a normal session no longer loads
  // full log history (see the LOGS_COLLECTION comment in storage.js), so
  // that array is usually just the handful of entries made during the
  // current session, and the length check almost never trips. This is
  // the one place the true full list is actually in memory, so this is
  // the right (and only reliably correct) place to enforce the cap —
  // right after fetching it, before anyone views/searches it.
  if (typeof trimLoginLogs === 'function') trimLoginLogs();
  if (typeof trimActionLogs === 'function') trimActionLogs();
}

// One-time (non-live) load of notifications from their own collection —
// same reasoning and same collection as loadLogs() above (see the
// LOGS_COLLECTION comment in storage.js): notifications used to be small
// per-item docs inside mealAppStorage, which meant every deposit/
// withdrawal/low-balance/reminder notification — and every "mark as read"
// delete — got pushed live to EVERY signed-in member's listener, almost
// always for someone else's alert. Moving them here means they're fetched
// on-demand instead: right after login (enterApp(), 06-auth.js), every
// time the bell panel is opened (toggleNotifPanel(), 01-notifications.js),
// and once a minute via the same scheduler that already runs the market/
// meal-edit reminder checks (startNotificationScheduler(), 05-session-
// sync.js) — close enough to real-time for an in-app bell, without paying
// for a live listener that fires on every signed-in member's every action.
async function loadNotifications() {
  const res = await logStorage.getByPrefix(PFX_NOTIF, true);
  let fresh = (res.items || []).map(it => JSON.parse(it.value));
  // Same race guard the old live-listener path used (see
  // deleteNotificationDoc() in 03-persistence.js): don't let a fetch that
  // started before a local "mark as read" delete has confirmed bring an
  // already-read notification back to life.
  if (typeof _pendingDeletedNotifIds !== 'undefined' && _pendingDeletedNotifIds.size) {
    fresh = fresh.filter(n => !_pendingDeletedNotifIds.has(n.id));
  }
  state.notifications = fresh.sort((a, b) => b.createdAt - a.createdAt);
  _notifBaselineLoaded = true; // safe for checkLowBalance/MarketDuty/MealEditReminders to dedupe against this now
}
// BUGFIX (full-collection read for every visitor, even ones who never log
// in): loadState()/the realtime listener both read the ENTIRE
// mealAppStorage collection — every day's meals, every deposit/expense/
// cost, every log — which is only actually needed once someone is signed
// in. But init() used to fetch all of that just to decide what to show on
// the *login screen*, so simply opening the site and not logging in still
// cost a full collection read (and, before this fix, kept a live listener
// open racking up further reads for as long as the tab sat idle there).
//
// The login screen and login-attempt validation (doLogin() in 06-auth.js)
// only ever touch: the member list+PINs (KEY_MEMBERS), the recovery code
// (KEY_META), and monthly-active records (PFX_MONTHLYACTIVE, for the
// "you're marked inactive this month" check) — never the day/deposit/
// expense/cost/log data. This fetches only those, as a one-time (not
// live) read, so an idle or never-logging-in visitor costs a handful of
// small document reads instead of the whole dataset. The full listener
// (ensureRealtimeListener()/waitForFirstSnapshot() in 05-session-sync.js)
// only gets opened once someone actually has a session — see enterAppFull()
// below and doLogin()'s success path.
async function fetchLoginScreenState() {
  let membersRes;
  try {
    membersRes = await storage.get(KEY_MEMBERS, true);
  } catch (e) {
    // BUGFIX: a mess that hasn't finished migrating from the old
    // single-document format yet has no KEY_MEMBERS per-item doc at all —
    // storage.get() above throws "Key not found", which used to just
    // break the login screen outright. loadState() already knows how to
    // detect and run that one-time migration (see migrateFromSingleDoc()
    // above), so fall back to it here; this only ever costs the full read
    // on a mess that genuinely still needs migrating, which should be
    // rare/one-time, not the normal case.
    return await loadState();
  }
  const [metaRes, settingsRes, monthlyRes] = await Promise.all([
    storage.get(KEY_META, true).catch(() => null),
    storage.get(KEY_SETTINGS, true).catch(() => null),
    (typeof storage.getByPrefix === 'function'
      ? storage.getByPrefix(PFX_MONTHLYACTIVE, true)
      : Promise.resolve({ items: [] })
    ).catch(() => ({ items: [] }))
  ]);
  const s = {
    members: JSON.parse(membersRes.value),
    settings: settingsRes ? JSON.parse(settingsRes.value) : defaultSettings(),
    recoveryCode: metaRes ? JSON.parse(metaRes.value).recoveryCode : generateRecoveryCode(),
    testDataBackup: null,
    memberSnapshots: [],
    days: {},
    costs: [],
    deposits: [],
    expenses: [],
    loginLogs: [],
    actionLogs: [],
    monthlyActive: {},
    notifications: []
  };
  (monthlyRes.items || []).forEach(it => {
    s.monthlyActive[it.key.slice(PFX_MONTHLYACTIVE.length)] = JSON.parse(it.value);
  });
  fillStateDefaults(s);
  return s;
}

async function loadState() {
  // NOTE ON A PAST DATA-LOSS INCIDENT: this function used to (a) treat any
  // empty read from Firestore as "brand new mess" and immediately overwrite
  // real data with defaultState()'s hardcoded demo roster, and (b) fall back
  // to that same defaultState() on ANY error at all (network drop, permission
  // error, etc.), silently handing the app fake in-memory data that a
  // superadmin's next edit (e.g. Settings save) could then persist over real
  // Firestore docs. This app is already live with real data, so there is no
  // "brand new mess" case to support anymore: defaultState() has been
  // removed entirely, and an empty read is ALWAYS treated as a failure to
  // surface (via try/catch), never as a reason to fabricate/seed data.
  // init()'s existing fallback (last-known local cache, then a visible boot
  // error) takes over from there instead of pretending everything loaded fine.
  const all = await fetchAllStorageItemsWithRetry();
  const byKey = {};
  all.items.forEach(it => {
    byKey[it.key] = it.value;
  });

  const metaParsed = byKey[KEY_META] ? JSON.parse(byKey[KEY_META]) : null;
  const migrationComplete = !!(metaParsed && metaParsed.migrated);
  if (!migrationComplete && byKey[STATE_KEY]) {
    await migrateFromSingleDoc(JSON.parse(byKey[STATE_KEY]));
    return await loadState(); // re-read, now from the migrated per-item docs
  }

  if (all.items.length === 0) {
    // No legitimate reason for this to ever be empty on a live deployment —
    // treat it strictly as a failed/blip read (network, permissions, quota)
    // and let the caller's try/catch handle it. Never seed, ever.
    throw new Error('Firestore returned no data. Refusing to seed/fabricate data — this is likely a temporary connectivity or permissions issue; please check your connection and reload.');
  }

  const s = buildStateFromItems(all.items);
  _hasFullState = true;
  writeLocalCache(s);
  return s;
}

