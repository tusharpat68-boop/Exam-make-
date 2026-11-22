// Built-in example patterns and pure helpers for profiles/templates (no DOM, testable in Node).
// These are editable EXAMPLES, not official board formats. Check them against your institution's current rules.
export const PRESETS = [
  { id: 'p-class20', name: 'Class test (20 marks)', fullMarks: 20,
    sections: [{ type: 'mcq', count: 10, marksEach: 1 }, { type: 'short', count: 5, marksEach: 2 }] },
  { id: 'p-weekly25', name: 'Weekly test (25 marks)', fullMarks: 25,
    sections: [{ type: 'mcq', count: 5, marksEach: 1 }, { type: 'short', count: 5, marksEach: 2 }, { type: 'broad', count: 2, marksEach: 5 }] },
  { id: 'p-half50', name: 'Half-yearly style (50 marks)', fullMarks: 50,
    sections: [{ type: 'mcq', count: 10, marksEach: 1 }, { type: 'short', count: 10, marksEach: 2 }, { type: 'creative', count: 2, marksEach: 10 }] },
  { id: 'p-model100', name: 'Model practice (100 marks)', fullMarks: 100,
    sections: [{ type: 'mcq', count: 30, marksEach: 1 }, { type: 'creative', count: 10, marksEach: 10, choose: 7 }] }
].map(p => ({ ...p, language: 'bn', difficulty: { easy: 30, medium: 50, hard: 20 }, builtin: true }));

// Form config -> template body for the server.
export function templateFromConfig(name, c) {
  return {
    name, language: c.language, fullMarks: c.fullMarks, difficulty: { ...c.difficulty },
    sections: c.sections.map(s => ({ type: s.type, count: s.count, marksEach: s.marksEach, ...(s.choose ? { choose: s.choose } : {}) })),
    className: c.className || '', subject: c.subject || '', chapter: c.chapter || ''
  };
}

// Open paper meta (or form values + active profile) -> school profile body.
export function profileFromMeta(name, m) {
  return {
    name, school: m.school || '', address: m.address || '', eiin: m.eiin || '', contact: m.contact || '', website: m.website || '',
    defaults: { language: m.language || 'bn', duration: m.duration || '' }, layout: m.layout || {}
  };
}

// Profile -> the header/layout fields it controls.
export function metaFromProfile(p) {
  return { school: p.school || '', address: p.address || '', eiin: p.eiin || '', contact: p.contact || '', website: p.website || '',
    duration: p.defaults?.duration || '', language: p.defaults?.language || 'bn', layout: p.layout };
}
