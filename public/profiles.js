// UI for school profiles and exam templates.
import { PRESETS, templateFromConfig, profileFromMeta, metaFromProfile } from './presets.js';

export function initProfiles({ api, getConfig, setConfig, editor, onActive }) {
  const $ = id => document.getElementById(id);
  const say = (id, t, ok) => { const m = $(id); m.textContent = t; m.className = 'msg noprint ' + (ok ? 'ok' : 'err'); };
  let schools = [], templates = [], active = null;   // active = full profile in use for new papers

  const opt = (v, t) => Object.assign(document.createElement('option'), { value: v, textContent: t });
  function fillSelects() {
    const ps = $('profSelect'); ps.replaceChildren(opt('', schools.length ? '— choose —' : '— none saved —'), ...schools.map(s => opt(s.id, s.name + (s.hasLogo ? ' (logo)' : ''))));
    if (active?.id && schools.some(s => s.id === active.id)) ps.value = active.id;
    const ts = $('tplSelect'); ts.replaceChildren(opt('', '— choose —'));
    const g1 = document.createElement('optgroup'); g1.label = 'Built-in examples (editable)';
    g1.append(...PRESETS.map(p => opt(p.id, p.name)));
    ts.append(g1);
    if (templates.length) { const g2 = document.createElement('optgroup'); g2.label = 'My templates'; g2.append(...templates.map(t => opt(t.id, t.name))); ts.append(g2); }
    $('activeProf').textContent = active ? `In use: ${active.name}` : 'No profile in use.';
  }

  async function refresh() {
    try {
      [schools, templates] = (await Promise.all([api('GET', '/api/schools'), api('GET', '/api/templates')])).map(r => r.items);
      fillSelects();
    } catch (e) { say('profMsg', e.message, false); }
  }

  const selectedSchool = () => schools.find(s => s.id === $('profSelect').value);
  async function fullProfile(id) { return (await api('GET', '/api/schools/' + id)).item; }

  $('profUse').onclick = async () => {
    const s = selectedSchool(); if (!s) return say('profMsg', 'Choose a profile first.', false);
    try {
      active = { id: s.id, name: s.name, ...await fullProfile(s.id) };
      active.id = s.id;
      const m = metaFromProfile(active);
      $('school').value = m.school; $('language').value = m.language;
      fillSelects(); onActive(active);
      say('profMsg', 'Profile will be used for new papers.', true);
    } catch (e) { say('profMsg', e.message, false); }
  };
  $('profApply').onclick = async () => {
    if (!active) return say('profMsg', 'Press "Use for new papers" first.', false);
    if (!editor.applyMeta(metaFromProfile(active))) return say('profMsg', 'Open a paper first.', false);
    say('profMsg', 'Applied to the open paper.', true);
  };
  const body = name => profileFromMeta(name, editor.getMeta() || { ...(active ? metaFromProfile(active) : {}), school: $('school').value, language: $('language').value });
  $('profSave').onclick = async () => {
    const name = $('profName').value.trim(); if (!name) return say('profMsg', 'Type a name for the profile.', false);
    try { await api('POST', '/api/schools', body(name)); $('profName').value = ''; await refresh(); say('profMsg', 'Profile saved.', true); }
    catch (e) { say('profMsg', e.message, false); }
  };
  $('profUpdate').onclick = async () => {
    const s = selectedSchool(); if (!s) return say('profMsg', 'Choose a profile to update.', false);
    if (!confirm(`Replace "${s.name}" with the current details and layout?`)) return;
    try { await api('PUT', '/api/schools/' + s.id, body(s.name)); await refresh(); say('profMsg', 'Profile updated.', true); }
    catch (e) { say('profMsg', e.message, false); }
  };
  $('profDelete').onclick = async () => {
    const s = selectedSchool(); if (!s) return say('profMsg', 'Choose a profile to delete.', false);
    if (!confirm(`Delete profile "${s.name}"?`)) return;
    try { await api('DELETE', '/api/schools/' + s.id); if (active?.id === s.id) { active = null; onActive(null); } await refresh(); say('profMsg', 'Deleted.', true); }
    catch (e) { say('profMsg', e.message, false); }
  };

  $('tplLoad').onclick = async () => {
    const id = $('tplSelect').value; if (!id) return say('tplMsg', 'Choose a template first.', false);
    try {
      const t = PRESETS.find(p => p.id === id) || (await api('GET', '/api/templates/' + id)).item;
      setConfig(t); say('tplMsg', 'Loaded into the form. Review it, then press Generate.', true);
    } catch (e) { say('tplMsg', e.message, false); }
  };
  $('tplSave').onclick = async () => {
    const name = $('tplName').value.trim(); if (!name) return say('tplMsg', 'Type a name for the template.', false);
    try { await api('POST', '/api/templates', templateFromConfig(name, getConfig())); $('tplName').value = ''; await refresh(); say('tplMsg', 'Template saved.', true); }
    catch (e) { say('tplMsg', e.message, false); }
  };
  $('tplDelete').onclick = async () => {
    const id = $('tplSelect').value, t = templates.find(x => x.id === id);
    if (!t) return say('tplMsg', 'Choose one of "My templates" to delete (built-in examples cannot be deleted).', false);
    if (!confirm(`Delete template "${t.name}"?`)) return;
    try { await api('DELETE', '/api/templates/' + id); await refresh(); say('tplMsg', 'Deleted.', true); }
    catch (e) { say('tplMsg', e.message, false); }
  };

  return {
    refresh, fillSelects,
    reset() { schools = []; templates = []; active = null; onActive(null); fillSelects(); say('profMsg', '', true); say('tplMsg', '', true); }
  };
}
