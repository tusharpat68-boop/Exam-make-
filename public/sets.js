// Paper sets (A, B, C...): same questions and marks, different question order and MCQ option order.
// Answers are copied and remapped so each set's answer key stays correct. Pure (no DOM).
import { clone } from './paperModel.js';

export const MAX_SETS = 5;
const KEEP_LAST = /(all|none) of the above|উপরের সবগুলো|উপরের কোনোটিই|সবগুলো|কোনোটিই নয়|কোনটিই নয়/i;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffledIndexes(n, rnd) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

const factorial = n => (n <= 1 ? 1 : n * factorial(n - 1));
const letter = i => String.fromCharCode(65 + i);

export function makeSets(paper, answers, count, seed) {
  count = Math.max(1, Math.min(MAX_SETS, Math.floor(count) || 1));
  const notes = [];
  const sets = [{ name: 'A', paper: clone(paper), answers: clone(answers || {}) }];
  const seenOrders = paper.sections.map(s => [s.questions.map(q => q.id).join('|')]);
  const rnd = mulberry32(seed);

  for (let k = 1; k < count; k++) {
    const p = clone(paper); const a = clone(answers || {});
    p.sections.forEach((s, si) => {
      const n = s.questions.length;
      if (n >= 2) {
        let order, key, tries = 0;
        do {
          order = shuffledIndexes(n, rnd);
          key = order.map(i => s.questions[i].id).join('|');
          tries++;
        } while (seenOrders[si].includes(key) && tries < 40 && factorial(n) > seenOrders[si].length);
        if (seenOrders[si].includes(key)) notes.push(`"${s.heading || 'Section ' + (si + 1)}" has too few questions for set ${letter(k)} to differ from the other sets.`);
        seenOrders[si].push(key);
        s.questions = order.map(i => s.questions[i]);
      }
      s.questions.forEach(q => {
        if (!Array.isArray(q.options) || q.options.length < 2 || q.options.some(o => KEEP_LAST.test(o))) return;
        const perm = shuffledIndexes(q.options.length, rnd);       // new position i holds old option perm[i]
        const old = q.options;
        q.options = perm.map(i => old[i]);
        const ans = a[q.id];
        if (ans && Number.isInteger(ans.correctOption)) ans.correctOption = perm.indexOf(ans.correctOption);
      });
    });
    sets.push({ name: letter(k), paper: p, answers: a });
  }
  return { sets: sets.filter((s, i) => i < count), notes: [...new Set(notes)] };
}
