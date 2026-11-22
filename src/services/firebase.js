'use strict';
let initialized = false;
function init() {
  const admin = require('firebase-admin'); // loaded lazily so tests don't need it
  if (!initialized) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not set');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    initialized = true;
  }
  return admin;
}

const getAuth = () => init().auth();
const getDb = () => init().firestore();

module.exports = { getAuth, getDb };
