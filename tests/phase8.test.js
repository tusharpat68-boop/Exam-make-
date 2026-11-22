'use strict';
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const load = () => import('../public/docx.js');

// minimal reader for the stored ZIP the exporter writes: checks signatures, sizes and CRCs
function readZip(buf) {
  const eocd = buf.length - 22;
  assert.strictEqual(buf.readUInt32LE(eocd), 0x06054b50, 'end-of-central-directory');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16); const out = {};
  for (let i = 0; i < n; i++) {
    assert.strictEqual(buf.readUInt32LE(p), 0x02014b50, 'central header');
    const size = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString();
    assert.strictEqual(buf.readUInt32LE(off), 0x04034b50, 'local header');
    const ln = buf.readUInt16LE(off + 26), data = buf.slice(off + 30 + ln, off + 30 + ln + size);
    assert.strictEqual(zlib.crc32 ? zlib.crc32(data) : buf.readUInt32LE(p + 16), buf.readUInt32LE(p + 16), 'crc ' + name);
    out[name] = data; p += 46 + nl;
  }
  return out;
}
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const paper = () => ({ title: 'T', sections: [
  { heading: 'ক-বিভাগ', type: 'mcq', questions: [{ id: 'a', text: 'ক্ষুদ্র $x^2 + \\frac{1}{2}$ <b>&</b> "q"\u0001', marks: 1, options: ['$x=2$', 'b', 'c', 'd'] }] },
  { heading: 'খ-বিভাগ', type: 'creative', choose: 2, questions: [1, 2, 3].map(i => ({ id: 'c' + i, text: 'প্রশ্ন ' + i, marks: 10, parts: [{ label: 'ক', text: 'p', marks: 10 }] })) }] });
const meta = { school: 'ঢাকা', examName: 'E', subject: 'গণিত', language: 'bn', fullMarks: 21, eiin: '123' };

test('texToText: common school-maths LaTeX becomes readable Unicode', async () => {
  const { texToText: t, plainText } = await load();
  assert.strictEqual(t('x^2 + y_1'), 'x² + y₁');
  assert.strictEqual(t('\\frac{a}{b}'), '(a)/(b)');
  assert.strictEqual(t('\\sqrt{x+1}'), '√(x+1)');
  assert.strictEqual(t('2 \\times 3 \\le \\pi'), '2 × 3 ≤ π');
  assert.strictEqual(t('x^{10}'), 'x¹⁰');
  assert.strictEqual(t('x^{a+b}'), 'x^(a+b)');
  assert.strictEqual(t('\\frac{\\sqrt{2}}{3}'), '(√(2))/(3)');
  assert.strictEqual(plainText('cost $5 and $10'), 'cost $5 and $10');         // not a formula, same rule as the preview
});

test('zip is structurally valid with correct CRCs and the expected parts', async () => {
  const { buildDocx } = await load();
  const files = readZip(Buffer.from(buildDocx(paper(), meta, { layout: { headerText: 'H', footerText: 'F', logo: 'data:image/png;base64,' + PNG } })));
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels', 'word/header1.xml', 'word/footer1.xml', 'word/media/logo.png'])
    assert.ok(files[n], 'missing ' + n);
  const plain = readZip(Buffer.from(buildDocx(paper(), meta, { layout: { pageNumbers: false } })));
  assert.ok(!plain['word/header1.xml'] && !plain['word/footer1.xml'] && !plain['word/media/logo.png'], 'no unused parts');
});

test('document text: Bengali intact, XML escaped, control chars dropped, formulas flattened, rule line present', async () => {
  const { buildDocx } = await load();
  const xml = readZip(Buffer.from(buildDocx(paper(), meta, { layout: { numerals: 'bn' } })))['word/document.xml'].toString();
  assert.ok(xml.includes('ক্ষুদ্র') && xml.includes('ঢাকা'));
  assert.ok(xml.includes('&lt;b&gt;&amp;&lt;/b&gt; &quot;q&quot;'), 'user text escaped');
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(xml), 'no forbidden control characters');
  assert.ok(xml.includes('x² + (1)/(2)') && !xml.includes('\\frac') && !xml.includes('$x'));
  assert.ok(xml.includes('নিচের ৩টি প্রশ্নের মধ্যে যেকোনো ২টির উত্তর দাও।'));
  assert.ok(xml.includes('ইআইআইএন: ১২৩'));
  // well-formed: every tag balances (simple stack check over the tags we emit)
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([A-Za-z0-9:]+)([^>]*?)(\/?)>/g)) {
    if (m[2] === 'xml' || m[4] === '/') continue;
    if (m[1]) assert.strictEqual(stack.pop(), m[2], 'unbalanced ' + m[2]); else stack.push(m[2]);
  }
  assert.strictEqual(stack.length, 0);
});

test('modes: questions only / answers only / detailed; sets get page breaks; unknown status never shown as verified', async () => {
  const { buildDocx } = await load();
  const answers = { a: { answer: '2', correctOption: 0, steps: ['s1'], checked: 'k', verification: { status: 'WHATEVER', message: 'm' } } };
  const doc = o => readZip(Buffer.from(buildDocx(paper(), meta, o)))['word/document.xml'].toString();
  assert.ok(!doc({ mode: 'questions', answers }).includes('Verified'));
  const ao = doc({ mode: 'answers_only', answers });
  assert.ok(!ao.includes('ক্ষুদ্র') && ao.includes('উত্তরপত্র'));
  assert.ok(!ao.includes('Verified by SymPy]'), 'bogus status falls back to not verified');
  assert.ok(ao.includes('Not verified: teacher review'));
  assert.ok(doc({ mode: 'detailed', answers }).includes('1) s1'));
  const sets = ['A', 'B', 'C'].map(n => ({ paper: paper(), answers: {}, setLabel: n }));
  const sx = doc({ mode: 'questions', sets });
  assert.strictEqual((sx.match(/w:br w:type="page"/g) || []).length, 2);
  assert.ok(sx.includes('সেট B'));
});

test('page size, margins and border follow the layout', async () => {
  const { buildDocx } = await load();
  const x = l => readZip(Buffer.from(buildDocx(paper(), meta, { layout: l })))['word/document.xml'].toString();
  assert.ok(x({ pageSize: 'A5' }).includes('w:w="8391"'));                // 148 mm
  assert.ok(x({ pageSize: 'A4' }).includes('w:w="11906"'));               // 210 mm
  assert.ok(x({ border: 'double' }).includes('w:val="double"') && !x({ border: 'none' }).includes('pgBorders'));
});

test('logo: PNG and JPEG are read, WEBP and junk are skipped without failing', async () => {
  const { buildDocx } = await load();
  const has = l => !!readZip(Buffer.from(buildDocx(paper(), meta, { layout: { logo: l } })))['word/media/logo.png'];
  assert.ok(has('data:image/png;base64,' + PNG));
  assert.ok(!has('data:image/webp;base64,AAAA'));
  assert.ok(!has('data:image/png;base64,AAAA'));
  const jpg = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xC0, 0, 17, 8, 0, 90, 0, 120, 3]), Buffer.alloc(20)]).toString('base64');
  const f = readZip(Buffer.from(buildDocx(paper(), meta, { layout: { logo: 'data:image/jpeg;base64,' + jpg } })));
  assert.ok(f['word/media/logo.jpeg']);
  assert.ok(f['word/document.xml'].toString().includes('cx="'));
});

test('python-docx opens the output (skipped when python-docx is not installed)', async t => {
  const probe = spawnSync('python3', ['-c', 'import docx']);
  if (probe.status !== 0) return t.skip('python-docx not available');
  const { buildDocx } = await load();
  const f = path.join(os.tmpdir(), 'exammaker-test-' + process.pid + '.docx');
  fs.writeFileSync(f, buildDocx(paper(), meta, { layout: { headerText: 'H', pageNumbers: true, border: 'single', logo: 'data:image/png;base64,' + PNG } }));
  const r = spawnSync('python3', ['-c', 'import docx,sys; d=docx.Document(sys.argv[1]); print(len(d.paragraphs)); print(any("ক্ষুদ্র" in p.text for p in d.paragraphs))', f], { encoding: 'utf8' });
  fs.unlinkSync(f);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /True/);
});
