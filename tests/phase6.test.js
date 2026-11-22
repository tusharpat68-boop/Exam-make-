'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { memoryStore } = require('../src/services/store');
const { schoolHandlers, templateHandlers } = require('../src/routes/collections');
const { sanitizeSchool, sanitizeTemplate } = require('../src/services/profiles');
const { sanitizeMeta } = require('../src/services/paper');
const { validateConfig } = require('../src/services/marks');

const mockRes = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const call = async (fn, uid, { params, body } = {}) => { const res = mockRes(); await fn({ user: { uid }, params, body }, res); return res; };
const tpl = (o = {}) => ({ name: 'T', fullMarks: 20, sections: [{ type: 'mcq', count: 10, marksEach: 1 }, { type: 'short', count: 5, marksEach: 2 }], difficulty: { easy: 30, medium: 50, hard: 20 }, ...o });

test('sanitizeSchool: name required, junk cleaned, logo validated', () => {
  assert.throws(() => sanitizeSchool({ name: '  ' }), /name/);
  const s = sanitizeSchool({ name: 'A', school: 'X\u0000Y', eiin: '1'.repeat(50), layout: { logo: 'javascript:alert(1)', border: 'evil' }, defaults: { language: 'zz' } });
  assert.strictEqual(s.school, 'X Y'); assert.strictEqual(s.eiin.length, 20);
  assert.strictEqual(s.layout.logo, ''); assert.strictEqual(s.layout.border, 'none'); assert.strictEqual(s.defaults.language, 'bn');
});

test('sanitizeTemplate: rejects marks mismatch, bad types, too many sections', () => {
  assert.ok(sanitizeTemplate(tpl()));
  assert.throws(() => sanitizeTemplate(tpl({ fullMarks: 25 })));
  assert.throws(() => sanitizeTemplate(tpl({ sections: [{ type: '<b>', count: 1, marksEach: 20 }] })), /type/);
  assert.throws(() => sanitizeTemplate(tpl({ sections: Array(11).fill({ type: 'mcq', count: 1, marksEach: 1 }), fullMarks: 11 })), /1-10/);
  assert.throws(() => sanitizeTemplate(tpl({ difficulty: { easy: 10, medium: 10, hard: 10 } })));
});

test('collection handlers: create/list/get/update/delete, ownership, limit', async () => {
  const store = memoryStore();
  const h = schoolHandlers(store);
  const c = await call(h.create, 'u1', { body: { name: 'Main', school: 'Dhaka School' } });
  assert.ok(c.body.ok); const id = c.body.id;
  assert.strictEqual((await call(h.list, 'u1')).body.items.length, 1);
  assert.strictEqual((await call(h.list, 'u2')).body.items.length, 0);
  const g = await call(h.get, 'u1', { params: { id } });
  assert.strictEqual(g.body.item.school, 'Dhaka School'); assert.strictEqual(g.body.item.ownerUid, undefined);
  // other user: 404 on get/update/delete, doc untouched
  for (const fn of [h.get, h.remove]) assert.strictEqual((await call(fn, 'u2', { params: { id } })).code, 404);
  assert.strictEqual((await call(h.update, 'u2', { params: { id }, body: { name: 'Hack' } })).code, 404);
  assert.strictEqual(store.docs.get(id).name, 'Main');
  // update keeps owner, cannot be hijacked via body
  await call(h.update, 'u1', { params: { id }, body: { name: 'Main2', ownerUid: 'u2' } });
  assert.strictEqual(store.docs.get(id).ownerUid, 'u1'); assert.strictEqual(store.docs.get(id).name, 'Main2');
  assert.strictEqual((await call(h.get, 'u1', { params: { id: '../x' } })).code, 404);
  assert.strictEqual((await call(h.create, 'u1', { body: { name: '' } })).code, 400);
  for (let i = 1; i < 20; i++) await call(h.create, 'u1', { body: { name: 'P' + i } });
  assert.strictEqual((await call(h.create, 'u1', { body: { name: 'one more' } })).code, 400);
  assert.ok((await call(h.remove, 'u1', { params: { id } })).body.ok);
});

test('template handlers store valid templates only', async () => {
  const h = templateHandlers(memoryStore());
  assert.strictEqual((await call(h.create, 'u1', { body: tpl({ fullMarks: 99 }) })).code, 400);
  assert.ok((await call(h.create, 'u1', { body: tpl() })).body.ok);
  assert.strictEqual((await call(h.list, 'u1')).body.items[0].sections.length, 2);
});

test('store errors become a clean 500', async () => {
  const bad = { listByOwner: async () => { throw new Error('boom secret'); } };
  const res = await call(schoolHandlers(bad).list, 'u1');
  assert.strictEqual(res.code, 500); assert.ok(!JSON.stringify(res.body).includes('secret'));
});

test('paper meta keeps eiin/contact/website', () => {
  const m = sanitizeMeta({ eiin: '123456', contact: '017', website: 'x.edu.bd' });
  assert.deepStrictEqual([m.eiin, m.contact, m.website], ['123456', '017', 'x.edu.bd']);
});

test('built-in presets all add up to their full marks', async () => {
  const { PRESETS } = await import('../public/presets.js');
  for (const p of PRESETS) {
    const v = validateConfig({ subject: 'x', fullMarks: p.fullMarks, sections: p.sections, difficulty: p.difficulty });
    assert.ok(v.ok, p.name + ': ' + (v.errors || []).join());
    assert.doesNotThrow(() => sanitizeTemplate({ ...p }));
  }
});

test('header shows EIIN/contact/website, escaped, Bengali label and numerals', async () => {
  const { renderPaper } = await import('../public/paperView.js');
  const paper = { title: 't', sections: [{ heading: 'h', type: 'short', questions: [{ id: 'a', text: 'q', marks: 2 }] }] };
  const html = renderPaper(paper, { school: 'S', language: 'bn', eiin: '123456', contact: '<b>017</b>', website: 'x.edu.bd', layout: { numerals: 'bn' } });
  assert.ok(html.includes('ইআইআইএন: ১২৩৪৫৬'));
  assert.ok(!html.includes('<b>017'));
  assert.ok(html.includes('x.edu.bd'));
  const none = renderPaper(paper, { school: 'S', language: 'en' });
  assert.ok(!none.includes('EIIN'));
});
