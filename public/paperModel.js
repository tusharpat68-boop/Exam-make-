// Pure paper-editing logic (no DOM), shared by the editor and its tests.
export const LABELS_BN = ['ক', 'খ', 'গ', 'ঘ', 'ঙ', 'চ'];
export const LABELS_EN = ['a', 'b', 'c', 'd', 'e', 'f'];
export const SECTION_TYPES = [['mcq', 'MCQ'], ['short', 'Short'], ['creative', 'Creative (ক খ গ ঘ)'], ['broad', 'Broad'],
  ['fill', 'Fill in the blanks'], ['truefalse', 'True / False'], ['math', 'Math problem']];

export const newId = () => 'q' + Math.random().toString(16).slice(2, 12).padEnd(10, '0');
export const clone = x => JSON.parse(JSON.stringify(x));

export function ensureIds(paper) {
  const seen = new Set();
  for (const s of paper.sections || []) {
    s.questions = s.questions || [];
    for (const q of s.questions) {
      if (typeof q.id !== 'string' || !q.id || seen.has(q.id)) q.id = newId();
      seen.add(q.id);
    }
  }
  return paper;
}

export function blankQuestion(type) {
  const q = { id: newId(), text: '', marks: 1, difficulty: 'medium' };
  if (type === 'mcq') q.options = ['', '', '', ''];
  if (type === 'creative') {
    q.marks = 10;
    q.parts = [['ক', 1], ['খ', 2], ['গ', 3], ['ঘ', 4]].map(([label, marks]) => ({ label, text: '', marks }));
  }
  return q;
}

export const blankSection = type => ({ heading: '', type, questions: [] });

export function addQuestion(paper, si, type) {
  const s = paper.sections[si];
  const q = blankQuestion(type || s.type);
  s.questions.push(q);
  return q;
}

export function deleteQuestion(paper, si, qi) { return paper.sections[si].questions.splice(qi, 1)[0]; }

export function duplicateQuestion(paper, si, qi) {
  const copy = clone(paper.sections[si].questions[qi]);
  copy.id = newId();
  paper.sections[si].questions.splice(qi + 1, 0, copy);
  return copy;
}

function swap(arr, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return false;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  return true;
}
export const moveQuestion = (paper, si, qi, dir) => swap(paper.sections[si].questions, qi, dir);
export const moveSection = (paper, si, dir) => swap(paper.sections, si, dir);

export function addSection(paper, type) {
  const s = blankSection(type);
  s.heading = (SECTION_TYPES.find(t => t[0] === type) || [0, 'Section'])[1];
  paper.sections.push(s);
  return s;
}
export const deleteSection = (paper, si) => paper.sections.splice(si, 1)[0];

export const round2 = n => Math.round(n * 100) / 100;
export const questionMarks = q => Number(q.marks) || 0;
// Effective choose: only meaningful when 1 <= choose < number of questions. Mirrors src/services/marks.js sectionMarks.
export const effectiveChoose = s => (Number.isInteger(s.choose) && s.choose >= 1 && s.choose < s.questions.length ? s.choose : 0);
export function sectionMarks(s) {
  const m = s.questions.map(questionMarks), k = effectiveChoose(s);
  return round2((k ? [...m].sort((a, b) => a - b).slice(0, k) : m).reduce((a, b) => a + b, 0));
}
export const totalMarks = paper => round2(paper.sections.reduce((a, s) => a + sectionMarks(s), 0));
export const questionCount = paper => paper.sections.reduce((a, s) => a + s.questions.length, 0);

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Problems the teacher should fix before printing. Never silently "fixes" anything.
export function checkPaper(paper, fullMarks) {
  const w = [];
  const total = totalMarks(paper);
  if (fullMarks > 0 && total !== fullMarks) w.push(`Questions add up to ${total} marks, but full marks is ${fullMarks}.`);
  const seen = new Map();
  let n = 0;
  paper.sections.forEach((s, si) => {
    if (s.questions.length === 0) w.push(`Section "${s.heading || si + 1}" has no questions.`);
    if (s.choose !== undefined && !effectiveChoose(s)) w.push(`Section "${s.heading || si + 1}": "answer any ${s.choose}" needs more than ${s.choose} questions. All questions count as compulsory.`);
    if (effectiveChoose(s) && new Set(s.questions.map(questionMarks)).size > 1) w.push(`Section "${s.heading || si + 1}": questions in an "answer any ${s.choose}" section should have equal marks. The total uses the ${s.choose} lowest.`);
    s.questions.forEach(q => {
      n++;
      if (!norm(q.text)) w.push(`Question ${n} is empty.`);
      if (!(Number(q.marks) > 0)) w.push(`Question ${n} needs marks greater than 0.`);
      if (q.options) {
        if (q.options.length !== 4) w.push(`Question ${n}: an MCQ needs exactly 4 options.`);
        if (q.options.some(o => !norm(o))) w.push(`Question ${n}: an MCQ option is empty.`);
      }
      if (q.parts) {
        const sum = round2(q.parts.reduce((a, p) => a + (Number(p.marks) || 0), 0));
        if (sum !== questionMarks(q)) w.push(`Question ${n}: part marks add up to ${sum}, not ${questionMarks(q)}.`);
      }
      const key = norm(q.text);
      if (key) {
        if (seen.has(key)) w.push(`Question ${n} repeats question ${seen.get(key)}.`);
        else seen.set(key, n);
      }
    });
  });
  return w;
}

// Payload for /api/answers/generate: only what the server needs.
export function answerPayload(paper, ids, meta) {
  const want = new Set(ids);
  const questions = [];
  for (const s of paper.sections) {
    for (const q of s.questions) {
      if (!want.has(q.id)) continue;
      questions.push({ id: q.id, type: s.type || 'short', text: q.text, marks: q.marks, difficulty: q.difficulty,
        ...(q.options ? { options: q.options } : {}), ...(q.parts ? { parts: q.parts } : {}) });
    }
  }
  return { meta: { language: meta.language, className: meta.className, subject: meta.subject }, questions };
}

export const missingAnswerIds = (paper, answers) =>
  paper.sections.flatMap(s => s.questions.filter(q => norm(q.text) && !answers[q.id]).map(q => q.id));

export function batches(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
