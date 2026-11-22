'use strict';
// Storage for saved papers. Firestore in production, an in-memory twin for tests.
// All methods are keyed by document id; ownership is enforced by the handlers, never trusted from the client.

function firestoreStore(name = 'questionPapers') {
  const col = () => require('./firebase').getDb().collection(name);
  return {
    async listByOwner(uid) {
      const snap = await col().where('ownerUid', '==', uid).limit(100).get();   // no composite index needed
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async get(id) {
      const d = await col().doc(id).get();
      return d.exists ? { id: d.id, ...d.data() } : null;
    },
    async create(data) { return (await col().add(data)).id; },
    async update(id, data) { await col().doc(id).update(data); },
    async remove(id) { await col().doc(id).delete(); }
  };
}

function memoryStore() {
  const docs = new Map();
  let n = 0;
  return {
    docs,
    async listByOwner(uid) { return [...docs.entries()].filter(([, d]) => d.ownerUid === uid).map(([id, d]) => ({ id, ...d })); },
    async get(id) { return docs.has(id) ? { id, ...docs.get(id) } : null; },
    async create(data) { const id = 'mem' + String(++n).padStart(8, '0'); docs.set(id, { ...data }); return id; },
    async update(id, data) { docs.set(id, { ...docs.get(id), ...data }); },
    async remove(id) { docs.delete(id); }
  };
}

module.exports = { firestoreStore, memoryStore };
