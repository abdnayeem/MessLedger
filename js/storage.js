// ---------------------------------------------------------------------------
// Firestore-backed storage adapter.
//
// This app was originally built against a simple key-value storage API
// (window.storage.get/set/delete/list). This file re-implements that exact
// interface on top of Firestore, so the rest of app.js barely had to change —
// it just calls storage.get(...) / storage.set(...) same as before.
//
// All keys are stored as documents in a single Firestore collection.
// This app only ever really uses one key ('meal-app-v1', shared=true), but
// get/list/delete are implemented generally in case that changes later.
// ---------------------------------------------------------------------------
const STORAGE_COLLECTION = 'mealAppStorage';

// Debounce timer for real-time updates to prevent backpressure
let _snapshotPendingUpdate = null;

const storage = {
  async get(key, shared = false) {
    await authReady;
    const snap = await db.collection(STORAGE_COLLECTION).doc(key).get();
    if (!snap.exists) {
      throw new Error('Key not found: ' + key);
    }
    return { key, value: snap.data().value, shared };
  },

  async set(key, value, shared = false) {
    await authReady;
    await db.collection(STORAGE_COLLECTION).doc(key).set({
      value,
      shared,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { key, value, shared };
  },

  async delete(key, shared = false) {
    await authReady;
    await db.collection(STORAGE_COLLECTION).doc(key).delete();
    return { key, deleted: true, shared };
  },

  async list(prefix = '', shared = false) {
    await authReady;
    const snap = await db.collection(STORAGE_COLLECTION).get();
    const keys = [];
    snap.forEach((doc) => {
      if (doc.id.startsWith(prefix)) keys.push(doc.id);
    });
    return { keys, prefix, shared };
  },

  // Fetches every document in the collection, WITH its value, in a single
  // network round trip (Firestore's collection.get() already returns full
  // document data — list() above was throwing that data away and keeping
  // only doc.id). This is what lets the app load its whole state (spread
  // across many small per-item documents) in one request instead of one
  // request per document.
  async getAll(shared = false) {
    await authReady;
    const snap = await db.collection(STORAGE_COLLECTION).get();
    const items = [];
    snap.forEach((doc) => {
      const data = doc.data();
      items.push({ key: doc.id, value: data.value, shared: data.shared });
    });
    return { items, shared };
  },

  // One-time (non-live) read of every document whose ID starts with
  // `prefix`. Same range-query shape as onSnapshotByPrefix() below, but a
  // single .get() instead of an open listener — used for small, bounded
  // slices of data (like monthly-active records) where we want the data
  // once, not a standing subscription that keeps costing reads while
  // nobody's even looking at the page.
  async getByPrefix(prefix, shared = false) {
    await authReady;
    const snap = await db.collection(STORAGE_COLLECTION)
      .where(firebase.firestore.FieldPath.documentId(), '>=', prefix)
      .where(firebase.firestore.FieldPath.documentId(), '<', prefix + '\uf8ff')
      .get();
    const items = [];
    snap.forEach((doc) => {
      const data = doc.data();
      items.push({ key: doc.id, value: data.value, shared: data.shared });
    });
    return { items, shared };
  },

  // Real-time version of getAll(): instead of one round trip, this opens a
  // live Firestore listener on the whole collection. `callback` fires
  // immediately with the current data, then again every time ANY document
  // in the collection changes — whether that change came from this browser
  // tab, another admin's browser, or a direct Firestore edit — usually
  // within a few hundred milliseconds. No polling needed.
  //
  // Returns an unsubscribe function; call it to stop listening (e.g. on
  // logout, if the app wants to stop pushing updates to a signed-out tab).
  onSnapshotAll(callback, shared = false, onError) {
    let unsub = () => {};
    authReady.then(() => {
      unsub = db.collection(STORAGE_COLLECTION).onSnapshot(
        (snap) => {
          const items = [];
          snap.forEach((doc) => {
            const data = doc.data();
            items.push({ key: doc.id, value: data.value, shared: data.shared });
          });
          
          // Debounce rapid-fire updates to prevent backpressure
          if (_snapshotPendingUpdate) {
            clearTimeout(_snapshotPendingUpdate);
          }
          _snapshotPendingUpdate = setTimeout(() => {
            callback(items);
            _snapshotPendingUpdate = null;
          }, 100);
        },
        (err) => {
          console.error('onSnapshotAll listener error:', err);
          if (onError) onError(err);
        }
      );
    }).catch((authErr) => {
      console.error('onSnapshotAll: Failed to initialize auth:', authErr);
      if (onError) onError(authErr);
    });
    
    // Wrapping in a closure means calling the returned function always hits
    // whatever `unsub` currently is, even if authReady hadn't resolved yet
    // at the moment the caller decided to unsubscribe.
    return () => {
      if (_snapshotPendingUpdate) {
        clearTimeout(_snapshotPendingUpdate);
        _snapshotPendingUpdate = null;
      }
      unsub();
    };
  },

  // Live-listens to only a fixed, small list of exact document IDs (e.g.
  // ['meal-app-members', 'meal-app-settings', 'meal-app-meta']) instead of
  // the whole collection. Firestore's 'in' filter supports up to 30 IDs,
  // which comfortably covers this use case. Same callback/return shape as
  // onSnapshotAll — fires immediately, then on every change to any of these
  // specific docs.
  onSnapshotByKeys(keys, callback, shared = false, onError) {
    let unsub = () => {};
    if (!keys || keys.length === 0) return unsub;
    authReady.then(() => {
      unsub = db.collection(STORAGE_COLLECTION)
        .where(firebase.firestore.FieldPath.documentId(), 'in', keys)
        .onSnapshot(
          (snap) => {
            const items = [];
            snap.forEach((doc) => {
              const data = doc.data();
              items.push({ key: doc.id, value: data.value, shared: data.shared });
            });
            callback(items);
          },
          (err) => {
            console.error('onSnapshotByKeys listener error:', err);
            if (onError) onError(err);
          }
        );
    }).catch((authErr) => {
      console.error('onSnapshotByKeys: Failed to initialize auth:', authErr);
      if (onError) onError(authErr);
    });
    return () => unsub();
  },

  // Live-listens to only the documents whose ID starts with `prefix`, using
  // a Firestore documentId() range query — e.g. prefix
  // 'meal-app-day__2026-07' matches only that month's day docs, not the
  // whole day history. This is what keeps the cost of "someone ticked a
  // meal" bounded to "this month's data", regardless of how many months of
  // history the mess has accumulated.
  onSnapshotByPrefix(prefix, callback, shared = false, onError) {
    let unsub = () => {};
    authReady.then(() => {
      const col = db.collection(STORAGE_COLLECTION);
      unsub = col
        .where(firebase.firestore.FieldPath.documentId(), '>=', prefix)
        .where(firebase.firestore.FieldPath.documentId(), '<', prefix + '\uf8ff')
        .onSnapshot(
          (snap) => {
            const items = [];
            snap.forEach((doc) => {
              const data = doc.data();
              items.push({ key: doc.id, value: data.value, shared: data.shared });
            });
            callback(items);
          },
          (err) => {
            console.error('onSnapshotByPrefix listener error:', err);
            if (onError) onError(err);
          }
        );
    }).catch((authErr) => {
      console.error('onSnapshotByPrefix: Failed to initialize auth:', authErr);
      if (onError) onError(authErr);
    });
    return () => unsub();
  }
};