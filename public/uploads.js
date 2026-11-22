// Study-material uploads: validation, image compression, per-file progress, OCR review/correction.
const MAX_PDF_BYTES = 6 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;   // before compression
const MAX_SENT_BYTES = 6 * 1024 * 1024;     // what the server accepts
const MAX_FILES = 10;
const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const fmtSize = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  kids.forEach(k => e.append(k));
  return e;
}

function checkFile(f) {
  if (!OK_TYPES.includes(f.type)) return 'Unsupported file type (use JPG, PNG, WEBP or PDF)';
  if (f.type === 'application/pdf' && f.size > MAX_PDF_BYTES) return 'PDF is larger than 6 MB';
  if (f.type !== 'application/pdf' && f.size > MAX_IMAGE_BYTES) return 'Image is larger than 20 MB';
  if (f.size === 0) return 'File is empty';
  return '';
}

async function shrinkImage(file) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= 1.5 * 1048576) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
    return blob && blob.size < file.size ? blob : file;
  } catch (e) { return file; }
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(blob);
  });
}

function post(url, token, body, onProgress, onUploaded) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('Content-Type', 'application/json');
    x.setRequestHeader('Authorization', 'Bearer ' + token);
    x.timeout = 150000;
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.upload.onload = onUploaded;
    x.onload = () => {
      if (x.status === 429) return reject(new Error('Too many uploads. Wait a minute, then press Retry.'));
      let j;
      try { j = JSON.parse(x.responseText); } catch (e) { return reject(new Error('Unexpected server response (' + x.status + ')')); }
      if (x.status >= 200 && x.status < 300 && j.ok) resolve(j);
      else reject(new Error(j?.error?.message || 'Failed (' + x.status + ')'));
    };
    x.onerror = () => reject(new Error('Network error. Check your connection, then press Retry.'));
    x.ontimeout = () => reject(new Error('Timed out. Press Retry.'));
    x.send(JSON.stringify(body));
  });
}

export function initUploads({ getToken, useForPaper, useForMath }) {
  const $ = id => document.getElementById(id);
  const list = $('fileList'), msg = $('uploadMsg');
  const items = [];
  let seq = 0, running = false;

  const say = (t, ok) => { msg.textContent = t; msg.className = 'msg ' + (ok ? 'ok' : 'err'); };

  function build(it) {
    const isImg = it.file.type.startsWith('image/');
    it.thumb = isImg ? el('img', { className: 'thumb', alt: '', src: URL.createObjectURL(it.file) }) : el('div', { className: 'thumb pdf', textContent: 'PDF' });
    it.title = el('div', { className: 'ftitle', textContent: it.file.name + ' · ' + fmtSize(it.file.size) });
    it.status = el('div', { className: 'fstatus' });
    it.bar = el('div', { className: 'bar' }, (it.fill = el('div', { className: 'fill' })));
    it.btnRemove = el('button', { type: 'button', className: 'ghost small', textContent: 'Remove', onclick: () => remove(it) });
    it.btnRetry = el('button', { type: 'button', className: 'ghost small', textContent: 'Retry', onclick: () => { it.state = 'queued'; sync(it); pump(); } });
    it.replaceInput = el('input', { type: 'file', hidden: true, accept: OK_TYPES.join(','), onchange: e => replace(it, e.target.files[0]) });
    it.btnReplace = el('button', { type: 'button', className: 'ghost small', textContent: 'Replace', onclick: () => it.replaceInput.click() });
    it.body = el('div', { className: 'fbody hidden' });
    it.node = el('div', { className: 'file' },
      el('div', { className: 'frow' }, it.thumb,
        el('div', { className: 'finfo' }, it.title, it.status, it.bar),
      ),
      el('div', { className: 'frow actions' }, it.btnRetry, it.btnReplace, it.btnRemove, it.replaceInput),
      it.body);
    list.append(it.node);
  }

  const STATE_TEXT = {
    queued: 'Waiting…', preparing: 'Preparing image…', uploading: 'Uploading…',
    reading: 'Reading text with AI… (can take up to a minute)', done: 'Text extracted. Review it below.', error: ''
  };

  function sync(it) {
    it.status.textContent = it.state === 'error' ? it.error : STATE_TEXT[it.state];
    it.status.className = 'fstatus' + (it.state === 'error' ? ' err' : it.state === 'done' ? ' ok' : '');
    it.btnRetry.classList.toggle('hidden', !(it.state === 'error' && !it.fatal));
    it.bar.classList.toggle('hidden', !['uploading', 'reading', 'preparing'].includes(it.state));
    it.fill.style.width = it.state === 'reading' ? '100%' : Math.round((it.progress || 0) * 100) + '%';
    it.fill.classList.toggle('pulse', it.state === 'reading');
    it.btnReplace.classList.toggle('hidden', ['uploading', 'reading', 'preparing'].includes(it.state));
    if (it.state !== 'done') it.body.classList.add('hidden');
  }

  function remove(it) {
    it.removed = true;
    if (it.thumb.src) URL.revokeObjectURL(it.thumb.src);
    items.splice(items.indexOf(it), 1);
    it.node.remove();
  }

  function replace(it, f) {
    if (!f) return;
    const err = checkFile(f);
    if (it.thumb.src) URL.revokeObjectURL(it.thumb.src);
    it.file = f; it.text = ''; it.mode = $('uploadMode').value;
    it.node.remove(); build(it);
    it.fatal = !!err; it.error = err; it.state = err ? 'error' : 'queued';
    sync(it); if (!err) pump();
  }

  function showResult(it, r) {
    it.body.replaceChildren();
    if (r.hasHandwriting) it.body.append(el('div', { className: 'warn', textContent: 'Handwriting detected. Please check the text carefully.' }));
    if (r.uncertain.length) {
      const ul = el('ul', { className: 'uncertain' });
      r.uncertain.forEach(u => ul.append(el('li', { textContent: '⟦' + u.snippet + '⟧ ' + (u.reason ? '(' + u.reason + ')' : '') })));
      it.body.append(el('div', { className: 'warn' }, el('b', { textContent: 'Hard to read, please check: ' }), ul));
    }
    it.area = el('textarea', { rows: 8, value: r.text });
    it.done = el('div', { className: 'msg ok' });
    const toPaper = el('button', {
      type: 'button', className: 'small', textContent: 'Use for question paper',
      onclick: () => use(it, useForPaper, 'Added to the study material of your paper.')
    });
    const toMath = el('button', {
      type: 'button', className: 'ghost small', textContent: 'Use as math problem',
      onclick: () => use(it, useForMath, 'Sent to the Math Solver.')
    });
    it.body.append(
      el('p', { className: 'note', textContent: 'Edit anything that is wrong. Parts marked ⟦ ⟧ were uncertain; the marks are removed when you use the text.' }),
      it.area, el('div', { className: 'frow actions' }, toPaper, toMath), it.done);
    it.body.classList.remove('hidden');
  }

  function use(it, fn, okText) {
    const markers = (it.area.value.match(/⟦/g) || []).length;
    if (markers && !confirm(markers + ' uncertain spot(s) are still marked ⟦ ⟧. Use the text anyway?')) return;
    const note = fn(it.area.value.replace(/[⟦⟧]/g, '').trim());
    it.done.className = 'msg ' + (note ? 'err' : 'ok');
    it.done.textContent = note || okText;
  }

  async function processItem(it) {
    try {
      it.state = 'preparing'; it.progress = 0; sync(it);
      const blob = await shrinkImage(it.file);
      if (it.removed) return;
      if (blob.size > MAX_SENT_BYTES) throw Object.assign(new Error('File is too large even after compression'), { fatal: true });
      const data = await toBase64(blob);
      if (it.removed) return;
      const token = await getToken();
      it.state = 'uploading'; sync(it);
      const r = await post('/api/documents/extract', token,
        { name: it.file.name, mimeType: blob.type || it.file.type, data, mode: it.mode },
        p => { it.progress = p; sync(it); },
        () => { it.state = 'reading'; sync(it); });
      if (it.removed) return;
      it.state = 'done'; sync(it); showResult(it, r);
    } catch (e) {
      if (it.removed) return;
      it.state = 'error'; it.error = e.message || 'Failed'; it.fatal = !!e.fatal; sync(it);
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const it = items.find(i => i.state === 'queued');
        if (!it) break;
        await processItem(it);
      }
    } finally { running = false; }
  }

  function addFiles(files) {
    say('');
    for (const f of files) {
      if (items.length >= MAX_FILES) { say('You can upload up to ' + MAX_FILES + ' files at a time.'); break; }
      const err = checkFile(f);
      const it = { id: ++seq, file: f, mode: $('uploadMode').value, state: err ? 'error' : 'queued', error: err, fatal: !!err, progress: 0 };
      items.push(it); build(it); sync(it);
    }
    pump();
  }

  $('pickBtn').onclick = () => $('fileInput').click();
  $('camBtn').onclick = () => $('cameraInput').click();
  for (const id of ['fileInput', 'cameraInput']) {
    $(id).onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
  }
  const dz = $('dropzone');
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); addFiles([...e.dataTransfer.files]); };
}
