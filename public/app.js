import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendPasswordResetEmail, signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';
import { initUploads } from './uploads.js';
import { initEditor } from './editor.js';
import { makeApi } from './api.js';
import { initProfiles } from './profiles.js';

const auth = getAuth(initializeApp(firebaseConfig));
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Auth ----------
let registering = false;
function authMsg(text, ok) { const m = $('authMsg'); m.textContent = text; m.className = 'msg ' + (ok ? 'ok' : 'err'); }

$('toggleAuth').onclick = e => {
  e.preventDefault(); registering = !registering;
  $('authTitle').textContent = registering ? 'Create account' : 'Login';
  $('authSubmit').textContent = registering ? 'Register' : 'Login';
  $('toggleAuth').textContent = registering ? 'I have an account' : 'Create an account';
};

$('authForm').onsubmit = async e => {
  e.preventDefault(); authMsg('');
  try {
    const fn = registering ? createUserWithEmailAndPassword : signInWithEmailAndPassword;
    await fn(auth, $('email').value.trim(), $('password').value);
  } catch (err) { authMsg(err.code ? err.code.replace('auth/', '').replace(/-/g, ' ') : 'Failed'); }
};

$('resetLink').onclick = async e => {
  e.preventDefault();
  const email = $('email').value.trim();
  if (!email) return authMsg('Enter your email first');
  try { await sendPasswordResetEmail(auth, email); authMsg('Password reset email sent', true); }
  catch (err) { authMsg('Could not send reset email'); }
};

$('logoutBtn').onclick = () => signOut(auth);

const editor = initEditor({
  getToken: () => auth.currentUser.getIdToken(),
  getSourceText: () => $('sourceText').value
});

let activeProfile = null;   // chosen school profile; its details and layout go into new papers
const profiles = initProfiles({
  api: makeApi(() => auth.currentUser.getIdToken()),
  editor,
  onActive: p => { activeProfile = p; },
  getConfig: () => buildConfig(),
  setConfig: t => {
    $('fullMarks').value = t.fullMarks; $('language').value = t.language || 'bn';
    for (const [id, v] of [['className', t.className], ['subject', t.subject], ['chapter', t.chapter]]) if (v) $(id).value = v;
    $('dEasy').value = t.difficulty.easy; $('dMed').value = t.difficulty.medium; $('dHard').value = t.difficulty.hard;
    $('sections').replaceChildren();
    t.sections.forEach(s => addSection(s.type, s.count, s.marksEach, s.choose));
    updateInfo();
  }
});

onAuthStateChanged(auth, user => {
  $('authView').classList.toggle('hidden', !!user);
  $('appView').classList.toggle('hidden', !user);
  $('logoutBtn').classList.toggle('hidden', !user);
  if (user) { editor.loadList(); profiles.refresh(); } else { editor.reset(); profiles.reset(); }
});

// ---------- Sections builder ----------
const TYPES = [['mcq', 'MCQ'], ['short', 'Short'], ['creative', 'Creative (ক খ গ ঘ)'], ['broad', 'Broad'],
  ['fill', 'Fill in the blanks'], ['truefalse', 'True / False'], ['math', 'Math problem']];

function addSection(type = 'mcq', count = 10, marksEach = 1, choose = '') {
  const div = document.createElement('div');
  div.className = 'sec';
  div.innerHTML = `
    <label>Type<select class="sType">${TYPES.map(([v, l]) => `<option value="${v}"${v === type ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Count<input class="sCount" type="number" min="1" max="50" value="${count}"></label>
    <label>Marks each<input class="sMarks" type="number" min="0.5" step="0.5" value="${marksEach}"></label>
    <label>Answer any<input class="sChoose" type="number" min="1" max="49" placeholder="all" value="${choose || ''}"></label>
    <button type="button" class="ghost">✕</button>`;
  div.querySelector('button').onclick = () => { div.remove(); updateInfo(); };
  div.addEventListener('input', updateInfo);
  $('sections').appendChild(div);
  updateInfo();
}
$('addSection').onclick = () => addSection('short', 5, 2);

function readSections() {
  return [...document.querySelectorAll('.sec')].map(d => ({
    type: d.querySelector('.sType').value,
    count: Number(d.querySelector('.sCount').value),
    marksEach: Number(d.querySelector('.sMarks').value),
    ...(d.querySelector('.sChoose').value ? { choose: Number(d.querySelector('.sChoose').value) } : {})
  }));
}

function updateInfo() {
  const total = readSections().reduce((a, s) => a + (s.choose >= 1 && s.choose < s.count ? s.choose : s.count) * s.marksEach, 0);
  const full = Number($('fullMarks').value);
  const m = $('marksInfo');
  m.textContent = total === full ? `Sections total ${total} marks ✓` : `Sections total ${total}, but full marks is ${full}`;
  m.className = 'msg ' + (total === full ? 'ok' : 'err');
}
$('fullMarks').addEventListener('input', updateInfo);
addSection('mcq', 10, 1); addSection('short', 5, 2); addSection('creative', 2, 5);

// ---------- Generate ----------
function buildConfig() {
  return {
    school: $('school').value, examName: $('examName').value, className: $('className').value,
    subject: $('subject').value.trim(), fullMarks: Number($('fullMarks').value), language: $('language').value,
    chapter: $('chapter').value, sections: readSections(),
    difficulty: { easy: Number($('dEasy').value), medium: Number($('dMed').value), hard: Number($('dHard').value) }
  };
}

const metaFrom = c => ({
  school: c.school, examName: c.examName, className: c.className, subject: c.subject,
  chapter: c.chapter, language: c.language, fullMarks: c.fullMarks,
  ...(activeProfile ? { address: activeProfile.address, eiin: activeProfile.eiin, contact: activeProfile.contact,
    website: activeProfile.website, duration: activeProfile.defaults?.duration || '', layout: activeProfile.layout } : {})
});

$('paperForm').onsubmit = async e => {
  e.preventDefault();
  if (!editor.canReplace()) return;
  const msg = $('genMsg'), btn = $('genBtn');
  msg.className = 'msg'; msg.textContent = 'Generating… this can take up to a minute.';
  btn.disabled = true;
  try {
    const token = await auth.currentUser.getIdToken();
    const config = buildConfig();
    const r = await fetch('/api/questions/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ config, sourceText: $('sourceText').value })
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error?.message || 'Failed');
    // Section types decide how questions are regenerated and answered. When the AI returned the same number of
    // sections as your form, the form's types are used; otherwise the AI's own (valid) type is kept.
    const known = new Set(TYPES.map(t => t[0]));
    const sameShape = data.paper.sections.length === config.sections.length;
    data.paper.sections.forEach((s, i) => {
      if (sameShape) { s.type = config.sections[i].type; if (config.sections[i].choose) s.choose = config.sections[i].choose; }
      else if (!known.has(s.type)) s.type = 'short';
    });
    editor.load(data.paper, metaFrom(config), { notes: data.warnings || [] });
    msg.textContent = '';
  } catch (err) {
    msg.className = 'msg err'; msg.textContent = err.message + ' — you can try again.';
  } finally { btn.disabled = false; }
};

// ---------- Math Solver ----------
const LABELS = {
  VERIFIED_CORRECT: 'Verified correct', INCORRECT: 'Incorrect', PARTIALLY_VERIFIED: 'Partially verified',
  VERIFICATION_UNAVAILABLE: 'Not verified', NEEDS_MANUAL_REVIEW: 'Needs manual review'
};
const list = a => (Array.isArray(a) && a.length) ? `<ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

$('mathForm').onsubmit = async e => {
  e.preventDefault();
  const msg = $('mathMsg'), btn = $('mathBtn');
  msg.className = 'msg'; msg.textContent = 'Solving and checking…'; btn.disabled = true;
  try {
    const token = await auth.currentUser.getIdToken();
    const r = await fetch('/api/math/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ problem: $('mathProblem').value, classLevel: $('mathClass').value, language: $('mathLang').value })
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error?.message || 'Failed');
    const s = data.solution, v = data.verification;
    $('mathResult').innerHTML = `
      <h3>Given</h3>${list(s.given)}
      <h3>Find</h3><p>${esc(s.find)}</p>
      <h3>Formula</h3>${list(s.formulas)}
      <h3>Steps</h3><ol>${(s.steps || []).map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      <h3>Independent verification</h3>
      <p><span class="badge ${esc(v.status)}">${esc(LABELS[v.status] || v.status)}</span> ${esc(v.message)}</p>
      ${data.checkedSpec ? `<p class="note">Checked form: <code>${esc(JSON.stringify(data.checkedSpec))}</code><br>${esc(data.note)}</p>` : ''}
      <h3>Final answer</h3><p><b>${esc(s.finalAnswer)}</b></p>`;
    msg.textContent = '';
  } catch (err) {
    msg.className = 'msg err'; msg.textContent = err.message + ' — you can try again.';
  } finally { btn.disabled = false; }
};

// ---------- Uploads wiring ----------
initUploads({
  getToken: () => auth.currentUser.getIdToken(),
  useForPaper: text => {
    const area = $('sourceText');
    area.value = (area.value.trim() ? area.value.trim() + '\n\n' : '') + text;
    if (area.value.length > 20000) return 'The material is over 20,000 characters; only the first 20,000 will be used.';
    return '';
  },
  useForMath: text => {
    $('mathProblem').value = text.slice(0, 2000);
    $('mathProblem').scrollIntoView({ behavior: 'smooth' });
    return text.length > 2000 ? 'Problem was cut to 2,000 characters.' : '';
  }
});
