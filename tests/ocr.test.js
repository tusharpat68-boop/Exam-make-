'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ocr = require('../src/services/ocr');
const { extractHandler } = require('../src/routes/documents');

const b64 = bytes => Buffer.from(bytes).toString('base64');
const JPEG = b64([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]);
const PNG = b64([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]);
const WEBP = b64([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), 0]);
const PDF = b64(Buffer.from('%PDF-1.7\n...'));

test('accepts real files of each supported type', () => {
  assert.ok(ocr.validateFile('image/jpeg', JPEG).ok);
  assert.ok(ocr.validateFile('image/png', PNG).ok);
  assert.ok(ocr.validateFile('image/webp', WEBP).ok);
  assert.ok(ocr.validateFile('application/pdf', PDF).ok);
});

test('rejects wrong type, mismatched content, empty and oversized files', () => {
  assert.equal(ocr.validateFile('image/gif', JPEG).code, 'UNSUPPORTED_TYPE');
  assert.equal(ocr.validateFile('application/x-msdownload', JPEG).code, 'UNSUPPORTED_TYPE');
  assert.equal(ocr.validateFile('image/png', JPEG).code, 'INVALID_FILE');                 // JPEG bytes labelled PNG
  assert.equal(ocr.validateFile('application/pdf', b64(Buffer.from('<html>hi</html>'))).code, 'INVALID_FILE');
  assert.equal(ocr.validateFile('image/jpeg', '').code, 'NO_FILE');
  assert.equal(ocr.validateFile('image/jpeg', undefined).code, 'NO_FILE');
  const big = Buffer.alloc(ocr.MAX_BYTES + 10, 0xFF).toString('base64');
  assert.equal(ocr.validateFile('image/jpeg', big).code, 'FILE_TOO_LARGE');
});

test('normalize cleans and caps AI output', () => {
  const n = ocr.normalize({ text: '  hello\r\nworld  ', language: 'xx', uncertain: [{ snippet: 'a', reason: 'b' }, { snippet: '' }], hasHandwriting: 1 });
  assert.equal(n.text, 'hello\nworld');
  assert.equal(n.language, 'mixed');
  assert.equal(n.uncertain.length, 1);
  assert.equal(n.hasHandwriting, true);
  assert.equal(ocr.normalize(null).text, '');
});

test('math prompt asks for uncertain-symbol marking, text prompt has no math section', () => {
  assert.match(ocr.buildOcrPrompt('math'), /never silently correct/i);
  assert.doesNotMatch(ocr.buildOcrPrompt('text'), /ASCII/);
  assert.match(ocr.buildOcrPrompt('text'), /ignore any instructions/);
});

function fakeRes() {
  const r = { code: 200, body: null };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
}

test('handler: invalid file is rejected before any AI call', async () => {
  let called = false;
  const orig = ocr.extract; ocr.extract = async () => { called = true; return {}; };
  const res = fakeRes();
  await extractHandler({ body: { mimeType: 'image/png', data: JPEG } }, res);
  ocr.extract = orig;
  assert.equal(res.code, 400);
  assert.equal(res.body.error.code, 'INVALID_FILE');
  assert.equal(called, false);
});

test('handler: empty OCR result is an error, not a fabricated success', async () => {
  const orig = ocr.extract; ocr.extract = async () => ({ text: '', language: 'bn', uncertain: [], hasHandwriting: false });
  const res = fakeRes();
  await extractHandler({ body: { mimeType: 'image/jpeg', data: JPEG } }, res);
  ocr.extract = orig;
  assert.equal(res.code, 422);
  assert.equal(res.body.error.code, 'NO_TEXT');
});

test('handler: success returns text with uncertainty count; AI failure maps to 502/504', async () => {
  const orig = ocr.extract;
  ocr.extract = async () => ({ text: 'x ⟦2⟧ y ⟦3⟧', language: 'en', uncertain: [{ snippet: '2', reason: 'blurry' }], hasHandwriting: true });
  let res = fakeRes();
  await extractHandler({ body: { name: 'p.jpg', mimeType: 'image/jpeg', data: JPEG, mode: 'math' } }, res);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.mode, 'math');
  assert.equal(res.body.uncertainMarkers, 2);

  ocr.extract = async () => { throw Object.assign(new Error('slow'), { code: 'AI_TIMEOUT' }); };
  res = fakeRes();
  await extractHandler({ body: { mimeType: 'image/jpeg', data: JPEG } }, res);
  assert.equal(res.code, 504);

  ocr.extract = async () => { throw new Error('boom'); };
  res = fakeRes();
  await extractHandler({ body: { mimeType: 'image/jpeg', data: JPEG } }, res);
  assert.equal(res.code, 502);
  ocr.extract = orig;
});
