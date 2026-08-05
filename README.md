# MessLedger — Setup & Deploy

## Project structure

```
messledger/
├── index.html              # page shell, loads everything else
├── css/
│   └── style.css           # all styling
├── js/
│   ├── firebase-config.js  # YOUR Firebase project keys go here
│   ├── storage.js          # Firestore read/write adapter
│   ├── responsive-tables.js
│   └── app/                # app logic, split by feature (was one 7200-line app.js)
│       ├── 00-utils-core.js
│       ├── 01-notifications.js
│       ├── 02-state-storage.js
│       ├── 03-persistence.js
│       ├── 04-format-helpers.js
│       ├── 05-session-sync.js
│       ├── 06-auth.js
│       ├── 07-ui-shell.js
│       ├── 08-calculations.js
│       ├── 09-dashboard.js
│       ├── 10-meals.js
│       ├── 11-reports.js
│       ├── 12-history.js
│       ├── 13-costs.js
│       ├── 14-expenses.js
│       ├── 15-deposits.js
│       ├── 16-members.js
│       ├── 17-logs.js
│       ├── 18-settings-admin.js
│       ├── 19-backup-testdata.js
│       └── 20-bootstrap.js   # paintFromState()/init() — must load last
├── firebase.json           # Hosting + Firestore config
├── firestore.rules         # database security rules
└── README.md
```

`index.html` loads all 21 files in `js/app/` as plain deferred `<script>` tags, in the numbered order above (no bundler needed — they share the same global scope the old single `app.js` had, so behavior is identical, just organized). To add a feature, edit the one file it belongs to instead of scrolling a 7000-line file. Each file's header comment says what it covers and which original line range it came from.

**Bug fix included in this pass:** while splitting the file, a section of `app.js` (roughly the Settings/Admin templates — Admin Month Access, Notification Settings, Session & Login, and one restore-backup prompt) had gotten mangled by some earlier automated edit — broken template literals that caused a JavaScript **syntax error**, which would have made the *entire app* fail to load (blank white screen) the next time it was deployed. That's fixed now; `js/app/*.js` all pass a syntax check and were verified in a headless browser to boot correctly end-to-end.

## 1. Create the Firebase project (one-time, ~5 minutes)

1. Go to https://console.firebase.google.com → **Add project** → give it a name (e.g. `messledger`) → finish the wizard (Google Analytics is optional, you can skip it).
2. Inside the project, click **Build → Firestore Database → Create database**. Choose a region close to you (e.g. `asia-south1` for Bangladesh/India) and start in **production mode** (we ship our own rules below).
3. Click **Build → Authentication → Get started**. Under **Sign-in method**, enable **Anonymous**. (This is only used internally so Firestore rules can block outside traffic — your members will never see or use it; they'll keep using the app's own PIN screen.)
4. Go to **Project settings** (gear icon) → scroll to **Your apps** → click the **Web** icon (`</>`) → register the app (any nickname) → you'll get a config object that looks like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "messledger-xxxxx.firebaseapp.com",
     projectId: "messledger-xxxxx",
     storageBucket: "messledger-xxxxx.appspot.com",
     messagingSenderId: "...",
     appId: "..."
   };
   ```

5. Copy those values into `js/firebase-config.js`, replacing the `YOUR_...` placeholders.

## 2. Deploy

Install the Firebase CLI once (needs Node.js):

```bash
npm install -g firebase-tools
firebase login
```

From inside the `messledger/` folder:

```bash
firebase init
```
- Select **Firestore** and **Hosting** (space to select, enter to confirm).
- Choose **Use an existing project** → pick the project you made in step 1.
- For Firestore rules file: keep the default `firestore.rules` (already provided — don't overwrite it if asked, or just re-paste its contents if it does).
- For Hosting: set the public directory to `.` (current folder), say **No** to single-page app rewrite question (we already handle that in `firebase.json`), say **No** to GitHub deploys unless you want that.

Then deploy:

```bash
firebase deploy
```

You'll get a live URL like `https://messledger-xxxxx.web.app` — that's it, share that link with your mess members.

To push future changes, just run `firebase deploy` again after editing files.

## 3. About the API key

The `apiKey` in `js/firebase-config.js` is **not a secret** — Firebase API keys are meant to be visible in client-side code, and Google's own docs say so. Real protection comes from `firestore.rules`, which we've already set to require a signed-in (anonymous) session before any read/write is allowed. You do not need to hide this file or add it to `.gitignore` for security reasons.

## 4. Notes on the current setup

- The whole app's data (members, meals, costs, deposits, expenses, settings) is stored as **one Firestore document**. That matches how the app worked before (single shared JSON blob) — simple and fine for a mess of up to ~50 members.
- There's currently **no live multi-device sync** — if two people are using the app on different phones at the same moment, the second save wins (last write wins). This matches the previous behavior. If you'd like real-time sync (so everyone's screen updates instantly when someone else changes something), that's a follow-up feature I can add using Firestore's `onSnapshot` listener — just ask.
- PINs are still stored in plain text inside the Firestore document, same as before. This is fine for a small trusted household but isn't bank-grade security. If you ever want stronger login security, Firebase Authentication (real accounts, not anonymous) is the upgrade path — let me know if you want that swapped in later.
