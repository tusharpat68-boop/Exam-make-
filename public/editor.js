// Question paper editor: edit, reorder, regenerate, answers, save, print modes.
import {
  SECTION_TYPES, ensureIds, clone, addQuestion, deleteQuestion, duplicateQuestion, moveQuestion, moveSection,
  addSection, deleteSection, totalMarks, checkPaper, answerPayload, missingAnswerIds, batches
} from './paperModel.js';
import { renderPaper, MODES, esc } from './paperView.js';
import { sanitizeLayout, layoutCss } from './layout.js';
import { makeSets } from './sets.js';
import { buildDocx } from './docx.js';

const ANSWER_BATCH = 8;

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  kids.forEach(k => e.append(k));
  return e;
}

export function initEditor({ getToken, getSourceText }) {
  const $ = id => document.getElementById(id);
  const state = { paper: null, meta: {}, answers: {}, id: null, dirty: false, sets: null };

  // ---------- network ----------
  async function api(method, url, body) {
    let r;
    try {
      r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await getToken() },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) { throw new Error('Network error. Check your connection and try again.'); }
    let j;
    try { j = await r.json(); } catch (e) { throw new Error('Unexpected server response (' + r.status + ')'); }
    if (!r.ok || !j.ok) throw new Error(j?.error?.message || 'Failed (' + r.status + ')');
    return j;
  }

  const say = (text, ok) => { const m = $('editorMsg'); m.textContent = text; m.className = 'msg ' + (ok ? 'ok' : 'err'); };

  async function withButton(btn, label, fn) {
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = label;
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
  }

  // ---------- refresh (cheap: warnings, totals, preview) ----------
  function refresh() {
    const p = state.paper; if (!p) return;
    const warns = checkPaper(p, Number(state.meta.fullMarks) || 0);
    $('editorWarnings').innerHTML = warns.map(w => `<div class="warn">⚠ ${esc(w)}</div>`).join('');
    const total = totalMarks(p), full = Number(state.meta.fullMarks) || 0;
    const line = $('marksLine');
    line.textContent = full ? `Total ${total} / full marks ${full}` + (total === full ? ' ✓' : '') : `Total ${total} marks`;
    line.className = 'msg ' + (!full || total === full ? 'ok' : 'err');
    const missing = missingAnswerIds(p, state.answers).length;
    $('answersBtn').textContent = missing ? `Generate answers (${missing})` : 'Answers ready ✓';
    $('layoutStyle').textContent = layoutCss(state.meta.layout);
    $('paper').innerHTML = renderPreview();
  }

  function renderPreview() {
    const base = { mode: $('viewMode').value, layout: state.meta.layout, math: window.katex };
    if (!state.sets) return renderPaper(state.paper, state.meta, { ...base, answers: state.answers });
    const view = $('setView').value;
    const list = view === 'ALL' ? state.sets : state.sets.filter(x => x.name === view);
    return list.map((x, i) => renderPaper(x.paper, state.meta, { ...base, answers: x.answers, setLabel: x.name, breakBefore: i > 0 })).join('');
  }

  // ---------- paper sets ----------
  function showSetControls() {
    const on = !!state.sets;
    $('setsClear').classList.toggle('hidden', !on);
    $('setViewWrap').classList.toggle('hidden', !on);
    $('setsBtn').textContent = on ? 'Recreate sets' : 'Create sets';
  }
  function clearSets(announce) {
    if (!state.sets) return;
    state.sets = null; showSetControls();
    const m = $('setsMsg');
    m.textContent = announce ? 'Sets were removed because the paper changed. Create them again when you finish editing.' : '';
    m.className = 'msg noprint err';
  }
  function createSets() {
    const count = Number($('setCount').value);
    const { sets, notes } = makeSets(state.paper, state.answers, count, Math.floor(Math.random() * 2 ** 31));
    state.sets = sets;
    $('setView').replaceChildren(...sets.map(x => el('option', { value: x.name, textContent: 'Set ' + x.name })),
      el('option', { value: 'ALL', textContent: 'All sets (print together)' }));
    $('setView').value = 'ALL';
    showSetControls();
    const m = $('setsMsg');
    m.textContent = `${sets.length} sets created.` + (notes.length ? ' ' + notes.join(' ') : '') +
      (missingAnswerIds(state.paper, state.answers).length ? ' Some questions have no answer yet; generate answers first if you want complete answer sheets.' : '');
    m.className = 'msg noprint ' + (notes.length ? 'err' : 'ok');           // keep "noprint": status text must never reach the paper
    refresh();
  }

  const metaEdited = () => { state.dirty = true; refresh(); };            // header details and layout: sets stay valid
  const edited = () => { clearSets(true); metaEdited(); };                // question content: sets must be rebuilt
  const textEdited = q => { delete state.answers[q.id]; edited(); };     // a changed question invalidates its answer
  const structural = () => { clearSets(true); state.dirty = true; rebuild(); };

  // ---------- editor DOM ----------
  function numInput(value, onchange, min = 0) {
    return el('input', {
      type: 'number', className: 'mini', min, step: 0.5, value,
      oninput: e => onchange(e.target.value === '' ? 0 : Number(e.target.value))
    });
  }

  async function regenerate(si, qi, btn) {
    const s = state.paper.sections[si], q = s.questions[qi];
    const instruction = prompt('Optional: tell the AI what to change (leave empty to just replace this question).', '');
    if (instruction === null) return;
    const others = state.paper.sections.flatMap(x => x.questions).filter(x => x !== q).map(x => x.text).filter(Boolean);
    try {
      const r = await withButton(btn, '…', () => api('POST', '/api/questions/regenerate', {
        question: { text: q.text || '(blank)', marks: q.marks }, type: s.type || 'short', difficulty: q.difficulty, others,
        language: state.meta.language, className: state.meta.className, subject: state.meta.subject,
        chapter: state.meta.chapter, instruction, sourceText: getSourceText()
      }));
      const nq = r.question; nq.id = q.id;
      s.questions[qi] = nq; delete state.answers[q.id];
      say('Question replaced.', true); structural();
    } catch (e) { say(e.message + ' You can try again.', false); }
  }

  function questionCard(s, si, q, qi, num) {
    const card = el('div', { className: 'qcard' });
    const btn = (text, title, fn, disabled) => el('button', { type: 'button', className: 'ghost small', textContent: text, title, disabled: !!disabled, onclick: e => fn(e.currentTarget) });
    const diff = el('select', { className: 'mini', onchange: e => { q.difficulty = e.target.value; edited(); } },
      ...['easy', 'medium', 'hard'].map(d => el('option', { value: d, textContent: d, selected: q.difficulty === d })));
    card.append(el('div', { className: 'qhead' },
      el('b', { textContent: 'Q' + num }), numInput(q.marks, v => { q.marks = v; edited(); }), el('span', { className: 'note', textContent: 'marks' }), diff,
      btn('↑', 'Move up', () => { moveQuestion(state.paper, si, qi, -1); structural(); }, qi === 0),
      btn('↓', 'Move down', () => { moveQuestion(state.paper, si, qi, 1); structural(); }, qi === s.questions.length - 1),
      btn('⧉', 'Duplicate', () => { duplicateQuestion(state.paper, si, qi); structural(); }),
      btn('↻', 'Regenerate with AI', b => regenerate(si, qi, b)),
      btn('✕', 'Delete', () => {
        if (q.text.trim() && !confirm('Delete this question?')) return;
        delete state.answers[q.id]; deleteQuestion(state.paper, si, qi); structural();
      })));
    card.append(el('textarea', { rows: 3, value: q.text, placeholder: 'Question text', oninput: e => { q.text = e.target.value; textEdited(q); } }));
    if (q.options) {
      q.options.forEach((o, i) => card.append(el('input', {
        value: o, placeholder: 'Option ' + (i + 1), oninput: e => { q.options[i] = e.target.value; textEdited(q); }
      })));
    }
    if (q.parts) {
      q.parts.forEach(p => card.append(el('div', { className: 'partrow' },
        el('b', { textContent: p.label }),
        el('input', { value: p.text, placeholder: 'Part text', oninput: e => { p.text = e.target.value; textEdited(q); } }),
        numInput(p.marks, v => { p.marks = v; edited(); }))));
    }
    return card;
  }

  function rebuild() {
    const body = $('editorBody'); body.replaceChildren();
    let num = 0;
    state.paper.sections.forEach((s, si) => {
      const box = el('div', { className: 'secbox' });
      const sb = (text, title, fn, disabled) => el('button', { type: 'button', className: 'ghost small', textContent: text, title, disabled: !!disabled, onclick: fn });
      box.append(el('div', { className: 'qhead' },
        el('input', { value: s.heading, placeholder: 'Section heading', className: 'sechead', oninput: e => { s.heading = e.target.value; edited(); } }),
        sb('↑', 'Move section up', () => { moveSection(state.paper, si, -1); structural(); }, si === 0),
        sb('↓', 'Move section down', () => { moveSection(state.paper, si, 1); structural(); }, si === state.paper.sections.length - 1),
        sb('✕', 'Delete section', () => {
          if (s.questions.length && !confirm('Delete this section and its ' + s.questions.length + ' question(s)?')) return;
          s.questions.forEach(q => delete state.answers[q.id]);
          deleteSection(state.paper, si); structural();
        })));
      box.append(el('label', { className: 'chooserow' }, 'Answer any ',
        el('input', { type: 'number', min: 1, max: 50, value: s.choose || '', placeholder: 'all', className: 'choosein',
          oninput: e => { const v = parseInt(e.target.value, 10); if (v >= 1) s.choose = v; else delete s.choose; edited(); } }),
        ` of ${s.questions.length} (leave blank: all compulsory)`));
      box.append(el('div', { className: 'note', textContent: 'Type: ' + ((SECTION_TYPES.find(t => t[0] === s.type) || [0, s.type || 'custom'])[1]) }));
      s.questions.forEach((q, qi) => box.append(questionCard(s, si, q, qi, ++num)));
      box.append(sb('+ Add question', 'Add a blank question', () => { addQuestion(state.paper, si); structural(); }));
      body.append(box);
    });
    refresh();
  }

  // ---------- answers ----------
  async function generateAnswers(all) {
    if (all && !confirm('Replace all existing answers with new ones?')) return;
    if (all) state.answers = {};
    const ids = missingAnswerIds(state.paper, state.answers);
    if (!ids.length) { say('Every question already has an answer.', true); refresh(); return; }
    const btns = [$('answersBtn'), $('answersAllBtn')];
    btns.forEach(b => { b.disabled = true; });
    let done = 0;
    try {
      for (const chunk of batches(ids, ANSWER_BATCH)) {
        say(`Writing and checking answers… ${done}/${ids.length}`, true);
        const r = await api('POST', '/api/answers/generate', answerPayload(state.paper, chunk, state.meta));
        Object.assign(state.answers, r.answers);
        clearSets(true);
        done += chunk.length; state.dirty = true; refresh();
      }
      say(`Answers ready for ${done} question(s). Only items marked "Verified by SymPy" were independently checked; review the rest.`, true);
    } catch (e) {
      say(`Stopped after ${done}/${ids.length}: ${e.message} Press "Generate answers" to continue with the rest.`, false);
    } finally { btns.forEach(b => { b.disabled = false; }); refresh(); }
  }

  // ---------- save / list ----------
  async function save() {
    try {
      await withButton($('saveBtn'), 'Saving…', async () => {
        const body = { paper: state.paper, meta: state.meta, answers: state.answers };
        const r = state.id ? await api('PUT', '/api/papers/' + state.id, body) : await api('POST', '/api/papers', body);
        state.id = r.id; state.dirty = false;
      });
      say('Saved ✓', true); loadList();
    } catch (e) { say('Could not save: ' + e.message, false); }
  }

  function listMsg(t, ok) { const m = $('listMsg'); m.textContent = t; m.className = 'msg ' + (ok ? 'ok' : 'err'); }

  async function loadList() {
    const box = $('paperList');
    try {
      const r = await api('GET', '/api/papers');
      box.replaceChildren();
      if (!r.papers.length) { box.append(el('p', { className: 'note', textContent: 'No saved papers yet. Generate a paper, edit it, then press Save.' })); listMsg(''); return; }
      r.papers.forEach(p => {
        box.append(el('div', { className: 'file' },
          el('div', { className: 'ftitle', textContent: p.title }),
          el('div', { className: 'note', textContent: [p.className && 'Class ' + p.className, p.subject, p.fullMarks && p.fullMarks + ' marks', p.hasAnswers && 'has answers', (p.updatedAt || '').slice(0, 10)].filter(Boolean).join(' · ') }),
          el('div', { className: 'frow actions' },
            el('button', { type: 'button', className: 'small', textContent: 'Open', onclick: () => openPaper(p.id) }),
            el('button', { type: 'button', className: 'ghost small', textContent: 'Delete', onclick: () => removePaper(p) }))));
      });
      listMsg('');
    } catch (e) { listMsg('Could not load your papers: ' + e.message, false); }
  }

  async function openPaper(id) {
    if (!canReplace()) return;
    try {
      const r = await api('GET', '/api/papers/' + id);
      load(r.paper, r.meta, { answers: r.answers, id: r.id });
      say('Opened. Changes are saved only when you press Save.', true);
    } catch (e) { listMsg('Could not open: ' + e.message, false); }
  }

  async function removePaper(p) {
    if (!confirm('Delete "' + p.title + '"? This cannot be undone.')) return;
    try {
      await api('DELETE', '/api/papers/' + p.id);
      if (state.id === p.id) { state.id = null; state.dirty = true; say('The open paper was deleted from your account. Press Save to store it again.', false); }
      loadList();
    } catch (e) { listMsg('Could not delete: ' + e.message, false); }
  }

  // ---------- public ----------
  function canReplace() {
    return !state.paper || !state.dirty || confirm('You have unsaved changes to the current paper. Discard them?');
  }

  function load(paper, meta, { answers = {}, id = null, notes = [] } = {}) {
    state.paper = ensureIds(clone(paper));
    state.paper.sections.forEach(s => s.questions.forEach(q => {
      if (s.type === 'mcq' && !Array.isArray(q.options)) q.options = ['', '', '', ''];   // shown as "option is empty" warnings
    }));
    state.meta = { ...meta, layout: sanitizeLayout(meta.layout) }; state.answers = { ...answers }; state.id = id; state.dirty = false;
    state.sets = null; showSetControls(); $('setsMsg').textContent = '';
    fillLayoutInputs();
    $('metaSchool').value = state.meta.school || '';
    $('metaExam').value = state.meta.examName || '';
    $('metaFull').value = state.meta.fullMarks || '';
    for (const [id, key] of [['metaAddress', 'address'], ['metaDate', 'date'], ['metaDuration', 'duration'], ['metaEiin', 'eiin'], ['metaContact', 'contact'], ['metaWebsite', 'website']]) $(id).value = state.meta[key] || '';
    $('genNotes').innerHTML = notes.map(n => `<div class="warn">ℹ ${esc(n)}</div>`).join('');
    $('editorCard').classList.remove('hidden'); $('previewCard').classList.remove('hidden');
    say('');
    rebuild();
    $('editorCard').scrollIntoView({ behavior: 'smooth' });
  }

  function reset() {          // on logout: nothing of the user's data stays on screen
    state.paper = null; state.answers = {}; state.id = null; state.dirty = false; state.sets = null; showSetControls(); $('setsMsg').textContent = '';
    $('layoutStyle').textContent = '';
    $('editorCard').classList.add('hidden'); $('previewCard').classList.add('hidden');
    $('paperList').replaceChildren(); $('editorBody').replaceChildren(); $('paper').replaceChildren(); say(''); listMsg('');
  }

  // ---------- wire static controls ----------
  $('viewMode').replaceChildren(...MODES.map(([v, t]) => el('option', { value: v, textContent: t })));
  $('viewMode').onchange = refresh;
  $('newSecType').replaceChildren(...SECTION_TYPES.map(([v, t]) => el('option', { value: v, textContent: t })));
  $('newSecBtn').onclick = () => { if (!state.paper) return; addSection(state.paper, $('newSecType').value); structural(); };
  $('metaSchool').oninput = e => { state.meta.school = e.target.value; metaEdited(); };
  $('metaExam').oninput = e => { state.meta.examName = e.target.value; metaEdited(); };
  $('metaFull').oninput = e => { state.meta.fullMarks = Number(e.target.value) || 0; metaEdited(); };
  $('saveBtn').onclick = save;
  $('answersBtn').onclick = () => generateAnswers(false);
  $('answersAllBtn').onclick = () => generateAnswers(true);
  $('printBtn').onclick = () => window.print();
  $('docxBtn').onclick = () => {          // same selection as the preview: print mode and, with sets, one set or all
    if (!state.paper) return;
    const m = $('docxMsg');
    try {
      let sets, tag = '';
      if (state.sets) {
        const view = $('setView').value;
        const list = view === 'ALL' ? state.sets : state.sets.filter(x => x.name === view);
        sets = list.map(x => ({ paper: x.paper, answers: x.answers, setLabel: x.name }));
        tag = view === 'ALL' ? '-all-sets' : '-set-' + view;
      }
      const bytes = buildDocx(state.paper, state.meta, { mode: $('viewMode').value, answers: state.answers, layout: state.meta.layout, sets });
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: 'question-paper' + tag + '.docx' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      m.textContent = 'Word file created. Formulas are plain text there, and the watermark, KaTeX typesetting and Bengali page numerals are not included.'; m.className = 'msg noprint ok';
    } catch (e) { m.textContent = 'Could not create the Word file: ' + e.message; m.className = 'msg noprint err'; }
  };
  window.addEventListener('beforeunload', e => { if (state.dirty && state.paper) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- details, layout and logo ----------
  for (const [id, key] of [['metaAddress', 'address'], ['metaDate', 'date'], ['metaDuration', 'duration'], ['metaEiin', 'eiin'], ['metaContact', 'contact'], ['metaWebsite', 'website']]) {
    $(id).oninput = e => { state.meta[key] = e.target.value; metaEdited(); };
  }
  const LAYOUT_FIELDS = [['lyTemplate', 'template'], ['lyPage', 'pageSize'], ['lyMargin', 'margin'], ['lyFont', 'fontFamily'],
    ['lyFontSize', 'fontSize'], ['lyLine', 'lineHeight'], ['lySpacing', 'questionSpacing'], ['lyNumerals', 'numerals'],
    ['lyAlign', 'headerAlign'], ['lyBorder', 'border'], ['lyHeader', 'headerText'], ['lyFooter', 'footerText'], ['lyWatermark', 'watermark']];

  function setField(id, value) {
    const e = $(id); const v = String(value);
    if (e.tagName === 'SELECT' && ![...e.options].some(o => (o.value || o.textContent) === v)) e.append(el('option', { value: v, textContent: v }));
    e.value = v;
  }
  function fillLayoutInputs() {
    const L = state.meta.layout;
    for (const [id, key] of LAYOUT_FIELDS) setField(id, L[key]);
    $('lyPageNum').checked = L.pageNumbers;
    $('lyLogoClear').classList.toggle('hidden', !L.logo);
    $('lyMsg').textContent = '';
  }
  const setLayout = patch => { state.meta.layout = sanitizeLayout({ ...state.meta.layout, ...patch }); metaEdited(); };
  for (const [id, key] of LAYOUT_FIELDS) $(id).addEventListener('input', e => setLayout({ [key]: e.target.value }));
  $('lyPageNum').onchange = e => setLayout({ pageNumbers: e.target.checked });

  const lyMsg = (t, ok) => { const m = $('lyMsg'); m.textContent = t; m.className = 'msg ' + (ok ? 'ok' : 'err'); };
  async function logoDataUrl(file) {
    const bmp = await createImageBitmap(file);
    for (const [max, type, q] of [[220, 'image/png'], [220, 'image/jpeg', 0.85], [150, 'image/jpeg', 0.8], [100, 'image/jpeg', 0.75]]) {
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      const g = c.getContext('2d');
      if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(bmp, 0, 0, c.width, c.height);
      const url = c.toDataURL(type, q);
      if (url.length <= 110000) return url;
    }
    throw new Error('This image is too detailed. Use a simpler or smaller logo.');
  }
  $('lyLogoBtn').onclick = () => $('lyLogo').click();
  $('lyLogo').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return lyMsg('Use a PNG, JPG or WEBP image.', false);
    if (f.size > 8 * 1048576) return lyMsg('Image is larger than 8 MB.', false);
    try {
      const url = await logoDataUrl(f);
      setLayout({ logo: url }); $('lyLogoClear').classList.remove('hidden'); lyMsg('Logo added.', true);
    } catch (err) { lyMsg(err.message || 'Could not read that image.', false); }
  };
  $('lyLogoClear').onclick = () => { setLayout({ logo: '' }); $('lyLogoClear').classList.add('hidden'); lyMsg('Logo removed.', true); };

  $('setsBtn').onclick = () => { if (state.paper) createSets(); };
  $('setsClear').onclick = () => { clearSets(false); refresh(); };
  $('setView').onchange = refresh;

  // Profiles: read the open paper's header/layout, or apply a profile to it (sets stay valid; this is header-only).
  function getMeta() { return state.paper ? JSON.parse(JSON.stringify(state.meta)) : null; }
  function applyMeta(m) {
    if (!state.paper) return false;
    for (const k of ['school', 'address', 'eiin', 'contact', 'website', 'duration']) state.meta[k] = m[k] || '';
    state.meta.layout = sanitizeLayout(m.layout);
    $('metaSchool').value = state.meta.school;
    for (const [id, key] of [['metaAddress', 'address'], ['metaDuration', 'duration'], ['metaEiin', 'eiin'], ['metaContact', 'contact'], ['metaWebsite', 'website']]) $(id).value = state.meta[key];
    fillLayoutInputs(); metaEdited();
    return true;
  }
  return { load, canReplace, loadList, reset, getMeta, applyMeta };
}
