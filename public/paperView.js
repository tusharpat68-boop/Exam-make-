// Pure HTML rendering of the question paper and answer sheet (no DOM access, everything escaped).
import { LABELS_BN, LABELS_EN, effectiveChoose } from './paperModel.js';
import { sanitizeLayout, toBn } from './layout.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = s => esc(s).replace(/\n/g, '<br>');

// $...$ and $$...$$ are formulas. "$5 and $10" is not (a formula cannot start or end with a space).
const MATH_RE = /\$\$([^$]{1,500}?)\$\$|\$([^\s$](?:[^$\n]{0,498}?[^\s$])?)\$/g;

// Text -> safe HTML. With a KaTeX-like `math` object formulas are typeset; without it they stay as plain text.
export function fmt(text, math) {
  const s = String(text ?? '');
  if (!math || !s.includes('$')) return plain(s);
  let out = '', last = 0, m;
  MATH_RE.lastIndex = 0;
  while ((m = MATH_RE.exec(s))) {
    out += plain(s.slice(last, m.index));
    const display = m[1] !== undefined;
    try {
      out += math.renderToString(display ? m[1] : m[2], {
        throwOnError: false, output: 'html', displayMode: display, trust: false, strict: 'ignore', maxExpand: 200
      });
    } catch (e) { out += plain(m[0]); }
    last = m.index + m[0].length;
  }
  return out + plain(s.slice(last));
}

export const STATUS_TEXT = {
  VERIFIED_CORRECT: 'Verified by SymPy',
  INCORRECT: 'Checker disagrees: review',
  PARTIALLY_VERIFIED: 'Partly verified',
  VERIFICATION_UNAVAILABLE: 'Not verified: teacher review',
  NEEDS_MANUAL_REVIEW: 'Needs manual review'
};
const STATUS_CLASSES = Object.keys(STATUS_TEXT);

export const MODES = [
  ['questions', 'Questions only'],
  ['with_answers', 'Questions + Answer sheet'],
  ['detailed', 'Questions + Detailed solutions'],
  ['answers_only', 'Answer sheet only']
];

const WORDS = {
  bn: { cls: 'শ্রেণি', subject: 'বিষয়', time: 'সময়', date: 'তারিখ', full: 'পূর্ণমান', eiin: 'ইআইআইএন', set: 'সেট', answer: 'উত্তরপত্র' },
  en: { cls: 'Class', subject: 'Subject', time: 'Time', date: 'Date', full: 'Full marks', eiin: 'EIIN', set: 'Set', answer: 'Answer Sheet' }
};

function header(meta, paper, L, N, w, setLabel) {
  const contact = [meta.eiin && `${w.eiin}: ${esc(N(meta.eiin))}`, meta.contact && esc(N(meta.contact)), meta.website && esc(meta.website)].filter(Boolean).join(' · ');
  const logo = L.logo ? `<img class="logo" alt="" src="${esc(L.logo)}">` : '';
  const bits = [
    meta.className && `${w.cls}: ${esc(N(meta.className))}`,
    meta.subject && `${w.subject}: ${esc(meta.subject)}`,
    meta.duration && `${w.time}: ${esc(N(meta.duration))}`,
    meta.date && `${w.date}: ${esc(N(meta.date))}`,
    meta.fullMarks && `${w.full}: ${esc(N(meta.fullMarks))}`
  ].filter(Boolean);
  return `<div class="ph align-${L.headerAlign}">${logo}<div class="ptxt">
    ${meta.school ? `<div class="school">${esc(meta.school)}</div>` : ''}
    ${meta.address ? `<div class="addr">${esc(meta.address)}</div>` : ''}
    ${contact ? `<div class="addr">${contact}</div>` : ''}
    <div class="exam">${esc(meta.examName || paper.title || '')}${setLabel ? ` <span class="setbadge">${w.set} ${esc(setLabel)}</span>` : ''}</div>
    ${bits.length ? `<div class="meta">${bits.join(' · ')}</div>` : ''}
  </div></div>`;
}

export function renderPaper(paper, meta, { mode = 'questions', answers = {}, layout, math, setLabel = '', breakBefore = false } = {}) {
  const L = sanitizeLayout(layout ?? meta.layout);
  const N = L.numerals === 'bn' ? toBn : String;
  const w = meta.language === 'bn' ? WORDS.bn : WORDS.en;
  const labels = meta.language === 'en' ? LABELS_EN : LABELS_BN;
  const f = t => fmt(t, math);
  const showQuestions = mode !== 'answers_only';
  const showAnswers = mode !== 'questions';
  const detailed = mode === 'detailed';

  const questionHtml = (q, n) => {
    const opts = q.options ? `<div class="opts">${q.options.map((o, i) => `<div>(${labels[i] || N(i + 1)}) ${f(o)}</div>`).join('')}</div>` : '';
    const parts = q.parts ? `<div class="parts">${q.parts.map(p => `<div>${esc(p.label)}. ${f(p.text)} <b>[${esc(N(p.marks))}]</b></div>`).join('')}</div>` : '';
    return `<div class="q"><span class="m">[${esc(N(q.marks))}]</span><b>${N(n)}.</b> ${f(q.text)}${opts}${parts}</div>`;
  };

  const answerHtml = (q, n, a) => {
    if (!a) return `<div class="ans"><b>${N(n)}.</b> <span class="noans">No answer generated yet.</span></div>`;
    const st = STATUS_CLASSES.includes(a.verification?.status) ? a.verification.status : 'VERIFICATION_UNAVAILABLE';
    let shown = f(a.answer);
    if (q.options && Number.isInteger(a.correctOption) && q.options[a.correctOption] !== undefined) {
      shown = `(${labels[a.correctOption] || N(a.correctOption + 1)}) ${f(q.options[a.correctOption])}`;
    }
    const steps = detailed && a.steps?.length ? `<ol class="steps">${a.steps.map(s => `<li>${f(s)}</li>`).join('')}</ol>` : '';
    const checked = detailed && a.checked ? `<div class="chk">Checked form: <code>${esc(a.checked)}</code></div>` : '';
    return `<div class="ans"><b>${N(n)}.</b> ${shown}
      <span class="badge ${st}">${esc(STATUS_TEXT[st])}</span>
      ${a.verification?.message && st !== 'VERIFIED_CORRECT' ? `<div class="vmsg">${esc(a.verification.message)}</div>` : ''}
      ${steps}${checked}</div>`;
  };

  let n = 0, qHtml = '', aHtml = '';
  for (const s of paper.sections) {
    let sq = '', sa = '';
    for (const q of s.questions) {
      n++;
      sq += questionHtml(q, n);
      sa += answerHtml(q, n, answers[q.id]);
    }
    const k = effectiveChoose(s);
    const rule = k ? `<div class="choose">${meta.language === 'en' ? `Answer any ${N(k)} of the following ${N(s.questions.length)} questions.` : `নিচের ${N(s.questions.length)}টি প্রশ্নের মধ্যে যেকোনো ${N(k)}টির উত্তর দাও।`}</div>` : '';
    qHtml += `<h4>${esc(s.heading)}</h4>${rule}${sq}`;
    aHtml += `<h4>${esc(s.heading)}</h4>${sa}`;
  }

  let html = '';
  if (showQuestions) html += header(meta, paper, L, N, w, setLabel) + qHtml;
  if (showAnswers) {
    html += `<div class="${showQuestions ? 'answers-page' : ''}">
      <div class="ph align-${L.headerAlign}"><div class="ptxt"><div class="exam">${w.answer}${meta.subject ? ' · ' + esc(meta.subject) : ''}${setLabel ? ` <span class="setbadge">${w.set} ${esc(setLabel)}</span>` : ''}</div>
      <div class="meta">${esc(meta.examName || paper.title || '')}</div></div></div>
      <p class="note">Answers marked "Verified by SymPy" were checked by an independent program against the question as restated for the checker. All others were not independently verified.</p>
      ${aHtml}</div>`;
  }
  const wm = L.watermark ? `<div class="wm">${esc(L.watermark)}</div>` : '';
  return `<div class="sheet tpl-${L.template} bd-${L.border}${breakBefore ? ' newset' : ''}">${wm}${html}</div>`;
}
