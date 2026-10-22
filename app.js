'use strict';
/* =========================================================
   Camp — app.js
   The only lines you may want to edit are in CONFIG below.
   ========================================================= */

const CONFIG = {
  // "Report a mistake" contact.
  // WhatsApp: country code + number, digits only, e.g. '919876543210'.
  // If left empty, WhatsApp opens and lets the user choose the chat; email opens with a blank "To".
  reportWhatsApp: '',
  reportEmail: 'pallavijoshi.pj77@gmail.com',
  // Where the question bank lives on GitHub (used only by the admin "Add question" form).
  github: { owner: 'peel-oranges', repo: 'Camp', branch: 'main', path: 'questions.json' }
};

const REVISION_DAYS = [1, 3, 7, 14];          // the 4th step (14 days) is the final check
const PROG_KEY = 'litquiz-progress-v1';
const THEME_KEY = 'litquiz-theme';
const ADMIN_KEY = 'litquiz-admin';
const LETTERS = ['A', 'B', 'C', 'D'];
const MODES = [
  ['pyq', 'PYQs only'], ['probable', 'Probable only'], ['mix', 'Mix'],
  ['abrams', 'M H Abrams'], ['mistakes', 'My mistakes'], ['bookmarks', 'Bookmarks']
];
const TYPES = ['MCQ', 'match', 'chronology', 'assertion-reason', 'passage', 'numerical'];
// Answer formats: MCQ = one correct option, MSQ = one or more (answer like "A;C"), NAT = a number.
const FORMATS = ['MCQ', 'MSQ', 'NAT'];

/* ---------- Small helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return todayStr(d); };
const shuffleArr = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmtTime = ms => { const s = Math.round(ms / 1000), m = Math.floor(s / 60); return m ? `${m} min ${s % 60} s` : `${s} s`; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const splitList = s => String(s || '').split(String(s).includes(';') ? ';' : ',').map(x => x.trim()).filter(Boolean);

let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- Answer formats (single, multiple, number) ---------- */
const letterList = s => [...new Set(String(s == null ? '' : s).toUpperCase().split(/[^A-D]+/).filter(x => LETTERS.includes(x)))].sort();
const ansList = q => letterList(q.answer);
const hasOptions = q => !!q.options && LETTERS.some(L => q.options[L] != null && q.options[L] !== '');
const isNAT = q => q.format === 'NAT' || !hasOptions(q);
const isMSQ = q => !isNAT(q) && (q.format === 'MSQ' || ansList(q).length > 1);
const toNum = s => parseFloat(String(s == null ? '' : s).trim().replace(',', '.'));
function isCorrect(q, given) {
  if (given == null || given === '') return false;
  if (isNAT(q)) {
    const g = toNum(given);
    if (isNaN(g)) return false;
    const parts = String(q.answer).split(/\s+to\s+/i).map(toNum);   // official keys may give a range like "2.5 to 2.7"
    const lo = Math.min(...parts), hi = Math.max(...parts);
    return g >= lo - 1e-9 && g <= hi + 1e-9;
  }
  return letterList(given).join(';') === ansList(q).join(';');
}
const answerLetters = q => isNAT(q) ? String(q.answer) : ansList(q).join(', ');
const answerText = q => isNAT(q) ? String(q.answer) : ansList(q).map(L => `${L}. ${(q.options || {})[L] || ''}`).join('  ·  ');
const givenText = (q, g) => isNAT(q) ? String(g) : letterList(g).join(', ');

/* ---------- Personal progress (this device only) ---------- */
function blankProg() { return { v: 1, attempts: {}, mistakes: {}, bookmarks: {}, revision: {}, history: [] }; }
function loadProg() {
  try {
    const p = JSON.parse(localStorage.getItem(PROG_KEY));
    if (p && p.v) return Object.assign(blankProg(), p);
  } catch (e) { /* ignore */ }
  return blankProg();
}
function saveProg() {
  try { localStorage.setItem(PROG_KEY, JSON.stringify(S.prog)); }
  catch (e) { toast('Could not save progress on this device'); }
}

/* ---------- App state ---------- */
const S = {
  questions: [], guide: { topics: [] }, loaded: false, loadError: false,
  prog: loadProg(),
  filters: { mode: 'mix', query: '', tags: null, count: '10', shuffle: true },
  screen: 'home', tab: 'home', prevScreen: 'home',
  quiz: null, guideId: null, guideQuery: '', adminQuery: '', edit: null
};

/* ---------- Question helpers ---------- */
const isPYQ = q => q.exam === 'NET' || q.exam === 'GATE';
const isAbrams = q => q.exam === 'Abrams' || (q.topics || []).some(t => t.toLowerCase() === 'abrams');
const byId = id => S.questions.find(q => q.id === id);
function sourceTag(q) {
  if (q.source) return q.source;
  if (q.exam === 'NET') return `UGC NET ${[q.session, q.year].filter(Boolean).join(' ')}${q.shift ? ` · Shift ${q.shift}` : ''}`.trim();
  if (q.exam === 'GATE') return `GATE ${q.year || q.session || ''}`.trim();
  return q.exam || 'Question';
}
function hasTags(q, tags) {
  const t = (q.topics || []).map(x => x.toLowerCase());
  return tags.every(x => t.includes(String(x).toLowerCase()));
}

/* ---------- Search (broad or narrow) ---------- */
const SYN = { nineteenth: '19th', twentieth: '20th', eighteenth: '18th', seventeenth: '17th', sixteenth: '16th', fifteenth: '15th', fourteenth: '14th' };
const STOP = new Set('the of and in on a an by to for with from about quiz questions question me my'.split(' '));
const IDX = new WeakMap();
function words(str) {
  return String(str || '').toLowerCase().replace(/twenty[\s-]first/g, '21st')
    .split(/[^a-z0-9]+/).filter(Boolean).map(w => SYN[w] || w);
}
function indexQ(q) {
  let w = IDX.get(q);
  if (!w) {
    const parts = [...(q.topics || []), ...(q.writers || []), ...(q.works || []), ...(q.keywords || []),
      q.question, q.id, q.exam, sourceTag(q), q.type];
    w = [...new Set(words(parts.join(' ')))];
    IDX.set(q, w);
  }
  return w;
}
function tokenMatch(tok, W) {
  const stem = tok.length > 4 ? tok.slice(0, Math.max(4, tok.length - 2)) : tok;
  return W.some(w => w.startsWith(stem) || (w.length >= 4 && tok.startsWith(w)));
}
const queryTokens = s => words(s).filter(t => !STOP.has(t) && (t.length > 1 || /\d/.test(t)));
function matchesQuery(q, toks) { const W = indexQ(q); return toks.every(t => tokenMatch(t, W)); }

function poolForMode(mode) {
  const Q = S.questions, p = S.prog;
  switch (mode) {
    case 'pyq': return Q.filter(isPYQ);
    case 'probable': return Q.filter(q => q.exam === 'Probable');
    case 'abrams': return Q.filter(isAbrams);
    case 'mistakes': return Q.filter(q => p.mistakes[q.id]);
    case 'bookmarks': return Q.filter(q => p.bookmarks[q.id]);
    default: return Q.slice();
  }
}
function filtered() {
  const f = S.filters;
  let list = poolForMode(f.mode);
  if (f.tags && f.tags.length) list = list.filter(q => hasTags(q, f.tags));
  const raw = f.query.trim();
  if (raw) {
    const exact = list.filter(q => q.id.toLowerCase() === raw.toLowerCase());
    if (exact.length) return exact;
    const toks = queryTokens(raw);
    if (toks.length) list = list.filter(q => matchesQuery(q, toks));
  }
  return list;
}

/* ---------- Spaced revision ---------- */
function dueList() {
  const t = todayStr();
  return S.questions.filter(q => { const r = S.prog.revision[q.id]; return r && r.due <= t; });
}
function recordAnswer(q, correct) {
  const p = S.prog, id = q.id, t = todayStr();
  const a = p.attempts[id] || (p.attempts[id] = { a: 0, c: 0 });
  a.a++; if (correct) a.c++; a.last = t;
  if (!correct) {
    if (!p.mistakes[id]) p.mistakes[id] = Date.now();
    p.revision[id] = { stage: 0, due: addDays(REVISION_DAYS[0]) };   // wrong = reset
  } else {
    const r = p.revision[id];
    if (r && r.due <= t) {                                           // only counts when it is due
      r.stage++;
      if (r.stage >= REVISION_DAYS.length) {                         // passed the final check
        delete p.revision[id]; delete p.mistakes[id];
        if (S.quiz) S.quiz.mastered = (S.quiz.mastered || 0) + 1;
      } else r.due = addDays(REVISION_DAYS[r.stage]);
    }
  }
  saveProg();
}

/* ---------- Theme ---------- */
const MOON = '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';
const isDark = () => document.documentElement.dataset.theme === 'dark';
function setTheme(t, remember = true) {
  document.documentElement.dataset.theme = t;
  if (remember) { try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ } }
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.content = t === 'dark' ? '#2a2038' : '#f6eef8';
  $('#theme-btn').innerHTML = t === 'dark' ? SUN : MOON;
}

/* ---------- Admin (GitHub key on this device only) ---------- */
function adminCfg() { try { return JSON.parse(localStorage.getItem(ADMIN_KEY)) || null; } catch (e) { return null; } }
const isAdmin = () => !!(adminCfg() && adminCfg().token);

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, '')); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
const serializeBank = arr => '[\n' + arr.map(q => JSON.stringify(q)).join(',\n') + '\n]\n';
function ghErr(status) {
  if (status === 401) return 'GitHub did not accept the key. Check it, or make a new one.';
  if (status === 403) return 'The key has no write permission (it needs Contents: Read and write).';
  if (status === 404) return 'Repository or questions.json not found. Check owner, repo and branch.';
  if (status === 409) return 'Someone else saved at the same moment. Please try again.';
  return `GitHub error ${status}. Please try again.`;
}
function ghSettings() { return Object.assign({}, CONFIG.github, adminCfg() || {}); }
async function ghFetchMeta(g, token) {
  const api = `https://api.github.com/repos/${g.owner}/${g.repo}/contents/${g.path}`;
  const H = { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  const r = await fetch(`${api}?ref=${encodeURIComponent(g.branch)}&t=${Date.now()}`, { headers: Object.assign({ Accept: 'application/vnd.github+json' }, H), cache: 'no-store' });
  if (!r.ok) throw new Error(ghErr(r.status));
  return { api, H, meta: await r.json() };
}
async function ghUpdate(mutate, message) {
  const g = ghSettings();
  if (!g.token) throw new Error('Admin key not set on this device.');
  for (let attempt = 0; attempt < 2; attempt++) {
    const { api, H, meta } = await ghFetchMeta(g, g.token);
    let text;
    if (meta.content && meta.encoding === 'base64') text = b64ToUtf8(meta.content);
    else {
      const raw = await fetch(`${api}?ref=${encodeURIComponent(g.branch)}&t=${Date.now()}`, { headers: Object.assign({ Accept: 'application/vnd.github.raw+json' }, H), cache: 'no-store' });
      if (!raw.ok) throw new Error(ghErr(raw.status));
      text = await raw.text();
    }
    let arr = text.trim() ? JSON.parse(text) : [];
    if (!Array.isArray(arr)) arr = arr.questions || [];
    arr = mutate(arr);
    const put = await fetch(api, {
      method: 'PUT',
      headers: Object.assign({ Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, H),
      body: JSON.stringify({ message, content: utf8ToB64(serializeBank(arr)), sha: meta.sha, branch: g.branch })
    });
    if (put.status === 409 && attempt === 0) continue;
    if (!put.ok) throw new Error(ghErr(put.status));
    return arr;
  }
  throw new Error(ghErr(409));
}
function applyBank(arr) {
  S.questions = arr.filter(q => q && q.id && q.question && (hasOptions(q) || q.format === 'NAT'));
  if (S.quiz) S.quiz.list = S.quiz.list.map(q => byId(q.id) || q);
}

/* =========================================================
   VIEWS
   ========================================================= */
const VIEWS = {};

/* ---------- Home ---------- */
function matchText(n) {
  const c = S.filters.count, take = c === 'all' ? n : Math.min(n, +c);
  return n ? `${plural(n, 'question')} match · this quiz will have ${take}` : 'No questions match yet. Try a broader search or another chip.';
}
VIEWS.home = () => {
  const f = S.filters, due = dueList().length, n = filtered().length;
  const firstTags = new Map();
  S.questions.forEach(q => { const t = (q.topics || [])[0]; if (t) firstTags.set(t, (firstTags.get(t) || 0) + 1); });
  const browse = [...firstTags].sort((a, b) => b[1] - a[1]).slice(0, 16);
  return `
  <section class="card revise ${due ? 'has-due' : ''}">
    <div>
      <span class="label">Due for revision today</span>
      <div class="big">${due}</div>
      <div class="muted small">${due ? 'Questions you missed, back on schedule.' : 'All caught up ✿'}</div>
    </div>
    ${due ? '<button class="btn" data-act="revise">Revise now</button>' : ''}
  </section>

  <section class="card">
    <h2>Build a quiz</h2>
    <label class="field-label" for="q-search">Topic, writer, work or keyword</label>
    <div class="search">
      <input id="q-search" type="search" data-in="query" value="${esc(f.query)}" placeholder="e.g. 19th century Indian dramatists" autocomplete="off" enterkeyhint="search">
      <button class="icon-btn" id="clear-q" data-act="clearQuery" aria-label="Clear search" ${f.query ? '' : 'hidden'}>✕</button>
    </div>
    ${f.tags ? `<div class="chips" style="margin-top:10px"><button class="chip on" data-act="clearTags">Topic: ${esc(f.tags.join(' › '))} ✕</button></div>` : ''}

    <span class="field-label">Questions from</span>
    <div class="chips">${MODES.map(([k, l]) => `<button class="chip ${f.mode === k ? 'on' : ''}" data-act="mode" data-v="${k}">${l} <span class="count">${poolForMode(k).length}</span></button>`).join('')}</div>

    <span class="field-label">How many</span>
    <div class="seg">${['5', '10', '20', '50', 'all'].map(c => `<button class="${f.count === c ? 'on' : ''}" data-act="count" data-v="${c}">${c === 'all' ? 'All' : c}</button>`).join('')}</div>

    <label class="switch-row"><span>Shuffle questions</span><input type="checkbox" class="switch" data-change="shuffle" ${f.shuffle ? 'checked' : ''}></label>

    <p class="match muted" id="match-count">${matchText(n)}</p>
    <button class="btn" id="start-btn" data-act="start" ${n ? '' : 'disabled'}>Start quiz</button>
  </section>

  ${browse.length ? `<section class="card"><h3>Browse topics</h3><div class="chips">${browse.map(([t, c]) => `<button class="chip soft" data-act="pickTopic" data-v="${esc(t)}">${esc(t)} <span class="count">${c}</span></button>`).join('')}</div></section>` : ''}
  <p class="foot muted small">${plural(S.questions.length, 'question')} in the bank</p>`;
};

/* ---------- Quiz ---------- */
VIEWS.quiz = () => {
  const z = S.quiz;
  if (!z) return VIEWS.home();
  const q = z.list[z.i], picked = z.answers[q.id], n = z.list.length;
  const bm = !!S.prog.bookmarks[q.id];
  const nat = isNAT(q), multi = isMSQ(q);
  const right = ansList(q), chosen = picked ? letterList(picked) : [];
  const sel = (z.sel && z.sel[q.id]) || [];
  const opts = nat ? '' : LETTERS.filter(L => q.options[L] != null && q.options[L] !== '').map(L => {
    let cls = '';
    if (picked) cls = right.includes(L) ? 'correct' : chosen.includes(L) ? 'wrong' : 'dim';
    else if (sel.includes(L)) cls = 'selected';
    const mark = picked && right.includes(L) ? '<span class="mark">✓</span>'
      : picked && chosen.includes(L) ? '<span class="mark">✕</span>'
      : !picked && sel.includes(L) ? '<span class="mark">●</span>' : '';
    return `<button class="opt ${cls}" data-act="answer" data-v="${L}" ${picked ? 'disabled' : ''} ${multi && !picked ? `aria-pressed="${sel.includes(L)}"` : ''}><span class="letter">${L}</span><span class="otext">${esc(q.options[L])}</span>${mark}</button>`;
  }).join('');
  const natBox = !nat ? '' : picked
    ? `<p class="nat-given">Your answer: <b>${esc(picked)}</b></p>`
    : `<label class="field-label" for="nat-input">Type your answer (a number)</label>
       <input type="text" id="nat-input" inputmode="decimal" enterkeyhint="done" autocomplete="off" placeholder="e.g. 25">`;
  const ok = picked ? isCorrect(q, picked) : false;
  const needsCheck = !picked && (multi || nat);
  return `
  <div class="quiz-top">
    <button class="icon-btn" data-act="endQuiz" aria-label="End quiz">✕</button>
    <div class="progress"><div style="width:${((z.i + (picked ? 1 : 0)) / n) * 100}%"></div></div>
    <span class="small muted"><b>${z.i + 1}</b> / ${n}</span>
  </div>
  <article class="card">
    <div class="tags">
      <span class="tag src">${esc(sourceTag(q))}</span>
      ${q.type && q.type !== 'MCQ' ? `<span class="tag">${esc(q.type)}</span>` : ''}
      ${multi ? '<span class="tag">One or more answers</span>' : ''}
      ${nat ? '<span class="tag">Number answer</span>' : ''}
      ${q.verified === false ? '<span class="tag warn">Unverified</span>' : ''}
    </div>
    <div class="qtext">${esc(q.question)}</div>
    ${multi && !picked ? '<p class="small muted">Select all that apply, then tap Check answer.</p>' : ''}
    <div class="opts">${opts}</div>
    ${natBox}
    ${picked ? `
      <div class="verdict ${ok ? 'ok' : 'bad'}" id="verdict">${ok ? 'Correct ✿' : `Not quite — the answer is ${esc(answerLetters(q))}`}</div>
      ${q.infoBite ? `<div class="bite"><div class="bite-h">✦ Info bite</div><p>${esc(q.infoBite)}</p></div>` : ''}
      ${q.studyNote ? `<div class="bite study"><div class="bite-h">Study note</div><p>${esc(q.studyNote)}</p></div>` : ''}
      ${q.note ? `<p class="small ${q.verified === false ? 'warn-text' : 'muted'}">Note: ${esc(q.note)}</p>` : ''}
      ${(q.topics || []).length ? `<p class="small muted path">${esc(q.topics.join(' › '))}</p>` : ''}` : ''}
    <div class="qactions">
      <button class="chip ${bm ? 'on' : ''}" data-act="bookmark" data-id="${esc(q.id)}">${bm ? '★ Bookmarked' : '☆ Bookmark'}</button>
      <button class="chip" data-act="report" data-id="${esc(q.id)}">⚑ Report a mistake</button>
      ${isAdmin() ? `<button class="chip" data-act="editQ" data-id="${esc(q.id)}">✎ Edit</button>` : ''}
    </div>
  </article>
  ${needsCheck ? '<button class="btn" data-act="check">Check answer</button>' : ''}
  ${picked ? `<button class="btn" data-act="next">${z.i < n - 1 ? 'Next question' : 'See results'}</button>` : ''}
  <p class="center small muted" style="margin-top:14px">${esc(q.id)}</p>`;
};

function startQuiz(list, title) {
  if (!list.length) { toast('No questions match yet'); return; }
  S.quiz = { list, i: 0, answers: {}, sel: {}, start: Date.now(), title, mastered: 0 };
  go('quiz');
}
function submitAnswer(q, given) {
  const z = S.quiz;
  z.answers[q.id] = given;
  recordAnswer(q, isCorrect(q, given));
  go('quiz', true);
  const vd = $('#verdict'); if (vd) vd.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function finishQuiz() {
  const z = S.quiz;
  z.ms = Date.now() - z.start;
  z.done = z.list.filter(q => z.answers[q.id]);
  if (!z.done.length) { S.quiz = null; go('home'); return; }
  z.wrong = z.done.filter(q => !isCorrect(q, z.answers[q.id]));
  z.score = z.done.length - z.wrong.length;
  S.prog.history.unshift({ date: new Date().toISOString(), title: z.title, score: z.score, total: z.done.length, ms: z.ms });
  S.prog.history = S.prog.history.slice(0, 60);
  saveProg();
  go('results');
}

/* ---------- Results ---------- */
VIEWS.results = () => {
  const z = S.quiz;
  if (!z || !z.done) return VIEWS.home();
  const total = z.done.length, pct = Math.round((z.score / total) * 100);
  const missed = new Map();
  z.wrong.forEach(q => { const k = (q.topics || []).join(' › ') || 'Untagged'; missed.set(k, (missed.get(k) || 0) + 1); });
  const missedList = [...missed].sort((a, b) => b[1] - a[1]);
  return `
  <section class="card score">
    <span class="label">${esc(z.title || 'Quiz')} · results</span>
    <div class="big">${z.score} / ${total}</div>
    <div class="meta"><span>${pct}%</span><span>⏱ ${fmtTime(z.ms)}</span>${total < z.list.length ? `<span>${z.list.length - total} skipped</span>` : ''}</div>
    ${z.mastered ? `<p class="small" style="margin-top:10px">✿ ${plural(z.mastered, 'question')} passed the final revision check</p>` : ''}
  </section>

  ${z.wrong.length ? `
  <div class="btn-row" style="margin-bottom:16px">
    <button class="btn" data-act="retryWrong">Retry the wrong ones</button>
    <button class="btn ghost" data-act="bookmarkWrong">Bookmark all wrong</button>
  </div>
  <section class="card">
    <h3>Topics missed</h3>
    <div class="list">${missedList.map(([k, c]) => `<div class="row"><div class="grow">${esc(k)}</div><span class="pill High">${c}</span></div>`).join('')}</div>
  </section>
  <section class="card">
    <h3>Questions to look at again</h3>
    ${z.wrong.map(q => {
      const bm = !!S.prog.bookmarks[q.id];
      return `<div class="wrong-item">
        <div class="tags"><span class="tag src">${esc(sourceTag(q))}</span></div>
        <div class="q">${esc(q.question)}</div>
        <div class="ans">You chose <s>${esc(givenText(q, z.answers[q.id]))}</s> · Correct: <b>${esc(answerText(q))}</b></div>
        <button class="chip ${bm ? 'on' : ''}" data-act="bookmark" data-id="${esc(q.id)}">${bm ? '★ Bookmarked' : '☆ Bookmark'}</button>
      </div>`;
    }).join('')}
  </section>` : '<section class="card center"><h3>A perfect round ✿</h3><p class="muted">Every answer correct.</p></section>'}

  <button class="btn ghost" data-act="tab" data-tab="home">Back to quiz home</button>`;
};

/* ---------- Study guide ---------- */
function guideData() {
  const topics = (S.guide.topics || []).map(t => {
    const tags = t.tags && t.tags.length ? t.tags : [t.name];
    const qs = S.questions.filter(q => hasTags(q, tags));
    const pyq = qs.filter(isPYQ);
    return Object.assign({}, t, {
      tags, qs, pyq,
      net: pyq.filter(q => q.exam === 'NET').length,
      gate: pyq.filter(q => q.exam === 'GATE').length,
      total: pyq.length
    });
  });
  const ranked = topics.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const withQs = ranked.filter(t => t.total > 0).length;
  ranked.forEach((t, i) => {
    t.level = t.weight || (t.total === 0 ? 'Low' : i < Math.ceil(withQs / 3) ? 'High' : i < Math.ceil((2 * withQs) / 3) ? 'Medium' : 'Low');
  });
  return ranked;
}
function guideListHTML() {
  const qs = queryTokens(S.guideQuery);
  const list = guideData().map((t, i) => Object.assign(t, { rank: i + 1 }))
    .filter(t => !qs.length || qs.every(tok => tokenMatch(tok, words([t.name, ...t.tags].join(' ')))));
  if (!list.length) return '<p class="muted">No guide topics match.</p>';
  return `<div class="list">${list.map(t => `
    <button class="row" data-act="openGuide" data-id="${esc(t.id)}">
      <span class="rank">${t.rank}</span>
      <span class="grow"><span class="name">${esc(t.name)}</span><br><span class="sub">NET ${t.net} · GATE ${t.gate}${t.qs.length > t.total ? ` · ${t.qs.length - t.total} practice` : ''}</span></span>
      <span class="pill ${esc(t.level)}">${esc(t.level)}</span><span class="chev">›</span>
    </button>`).join('')}</div>`;
}
VIEWS.guide = () => `
  <section class="card">
    <h2>Must-learn overview</h2>
    <p class="muted small">Topics ranked by how often they appear in NET and GATE papers. Counts update automatically as PYQs are added.</p>
    <div class="search"><input type="search" data-in="guideQuery" value="${esc(S.guideQuery)}" placeholder="Find a topic" autocomplete="off"></div>
  </section>
  <section class="card" id="guide-list">${guideListHTML()}</section>`;

function freqList(qs, field) {
  const m = new Map();
  qs.forEach(q => (q[field] || []).forEach(x => { const k = String(x).trim(); if (k) m.set(k, (m.get(k) || 0) + 1); }));
  return [...m].sort((a, b) => b[1] - a[1]).map(([name, count], i) => ({ name, count, frequent: count >= 3 || (count >= 2 && i < 3) }));
}
VIEWS.guideTopic = () => {
  const t = guideData().find(x => x.id === S.guideId);
  if (!t) return VIEWS.guide();
  const writers = freqList(t.pyq, 'writers');
  const extraPink = (t.highlightWriters || []).map(x => x.toLowerCase());
  const liveWorks = freqList(t.pyq, 'works');
  const wmap = new Map();
  liveWorks.forEach(w => wmap.set(w.name.toLowerCase(), { title: w.name, count: w.count, frequent: w.frequent }));
  (t.works || []).forEach(g => { const k = g.title.toLowerCase(); wmap.set(k, Object.assign({ count: 0 }, wmap.get(k) || {}, g)); });
  const works = [...wmap.values()].sort((a, b) => (b.count || 0) - (a.count || 0));
  const types = freqList(t.pyq.map(q => ({ t: [q.type || 'MCQ'] })), 't');

  return `
  <button class="chip back" data-act="tab" data-tab="guide">‹ All topics</button>
  <section class="card">
    ${t.demo ? '<div class="demo-note">Layout demo — the notes on this page are placeholders until PYQ batches are analysed.</div>' : ''}
    <h2>${esc(t.name)}</h2>
    <div class="chips" style="margin-bottom:10px">
      <span class="pill ${esc(t.level)}">${esc(t.level)} weightage</span>
      <span class="pill Low">NET ${t.net}</span><span class="pill Low">GATE ${t.gate}</span>
    </div>
    ${t.about ? `<p class="muted">${esc(t.about)}</p>` : ''}
    <button class="btn" data-act="quizTopic" data-id="${esc(t.id)}">Quiz me on this topic</button>
  </section>

  <section class="card">
    <h3>Must-read writers</h3>
    ${writers.length ? `<table class="freq">${writers.map(w => `<tr class="${w.frequent || extraPink.includes(w.name.toLowerCase()) ? 'pink' : ''}"><td>${esc(w.name)}</td><td>${w.count}×</td></tr>`).join('')}</table>
      <p class="small muted" style="margin-top:8px">Pink rows = frequently asked.</p>` : '<p class="muted small">No PYQs tagged here yet.</p>'}
  </section>

  <section class="card">
    <h3>Works: study whole or selective</h3>
    ${works.length ? works.map(w => `
      <div class="work">
        <div class="wt">${esc(w.title)}${w.writer ? ` <span class="muted small">— ${esc(w.writer)}</span>` : ''}</div>
        <div class="chips" style="margin-top:6px">
          ${w.count ? `<span class="pill ${w.frequent ? 'High' : 'Low'}">asked ${w.count}×</span>` : ''}
          ${w.study === 'whole' ? '<span class="pill whole">Study whole</span>' : w.study === 'selective' ? '<span class="pill selective">Selective</span>' : ''}
        </div>
        ${w.note ? `<p class="small" style="margin:6px 0 0">${esc(w.note)}</p>` : ''}
        ${(w.asked || []).length ? `<ul>${w.asked.map(a => `<li>${esc(a.what)}${a.source ? ` <span class="muted">· ${esc(a.source)}</span>` : ''}</li>`).join('')}</ul>` : ''}
      </div>`).join('') : '<p class="muted small">No works tagged here yet.</p>'}
  </section>

  <section class="card">
    <h3>Lines asked</h3>
    ${(t.lines || []).length ? t.lines.map(l => `<blockquote>${esc(l.text)}<cite>${esc([l.work, l.source].filter(Boolean).join(' · '))}</cite></blockquote>`).join('') : '<p class="muted small">No quoted lines recorded yet.</p>'}
  </section>

  <section class="card">
    <h3>Recurring question patterns</h3>
    ${types.length ? `<div class="chips" style="margin-bottom:10px">${types.map(x => `<span class="chip soft">${esc(x.name)} ×${x.count}</span>`).join('')}</div>` : ''}
    ${(t.patterns || []).length ? `<ul>${t.patterns.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : (types.length ? '' : '<p class="muted small">Patterns appear once PYQs are tagged.</p>')}
  </section>`;
};

/* ---------- Stats ---------- */
function topicStats() {
  const m = new Map();
  S.questions.forEach(q => {
    const a = S.prog.attempts[q.id]; if (!a) return;
    const tp = q.topics || [];
    for (let i = 1; i <= tp.length; i++) {
      const key = tp.slice(0, i).join(' › ');
      const s = m.get(key) || { key, depth: i - 1, a: 0, c: 0 };
      s.a += a.a; s.c += a.c; m.set(key, s);
    }
  });
  return [...m.values()].map(s => Object.assign(s, { acc: s.c / s.a })).sort((x, y) => x.acc - y.acc || y.a - x.a);
}
VIEWS.stats = () => {
  let a = 0, c = 0;
  Object.values(S.prog.attempts).forEach(x => { a += x.a; c += x.c; });
  const ts = topicStats(), hist = S.prog.history.slice(0, 6);
  return `
  <section class="card">
    <h2>Your progress</h2>
    <div class="stat-grid">
      <div><div class="n">${a}</div><div class="l">Attempted</div></div>
      <div><div class="n">${c}</div><div class="l">Correct</div></div>
      <div><div class="n">${a - c}</div><div class="l">Wrong</div></div>
      <div><div class="n">${a ? Math.round((c / a) * 100) : 0}%</div><div class="l">Accuracy</div></div>
    </div>
    <p class="small muted center" style="margin-top:12px">${plural(Object.keys(S.prog.mistakes).length, 'mistake')} saved · ${plural(dueList().length, 'question')} due today · ${plural(Object.keys(S.prog.bookmarks).length, 'bookmark')}</p>
  </section>
  <section class="card">
    <h3>By topic — weakest first</h3>
    ${ts.length ? `<div class="list">${ts.map(s => {
      const parts = s.key.split(' › '), leaf = parts.pop();
      return `<button class="row" data-act="statTopic" data-key="${esc(s.key)}">
        <span class="grow">
          ${parts.length ? `<span class="sub">${esc(parts.join(' › '))} ›</span><br>` : ''}
          <span class="name">${esc(leaf)}</span>
          <div class="bar"><div style="width:${Math.round(s.acc * 100)}%"></div></div>
          <span class="sub">${Math.round(s.acc * 100)}% · ${s.a} attempted · ${s.c} ✓ · ${s.a - s.c} ✕</span>
        </span><span class="chev">›</span></button>`;
    }).join('')}</div>` : '<p class="muted small">Answer a few questions and your topic stats appear here.</p>'}
  </section>
  ${hist.length ? `<section class="card"><h3>Recent quizzes</h3><div class="list">${hist.map(h => `
    <div class="row"><span class="grow"><span class="name">${esc(h.title || 'Quiz')}</span><br><span class="sub">${new Date(h.date).toLocaleDateString()} · ${fmtTime(h.ms)}</span></span><span class="pill Medium">${h.score}/${h.total}</span></div>`).join('')}</div></section>` : ''}`;
};

/* ---------- More ---------- */
VIEWS.more = () => {
  const g = ghSettings(), admin = isAdmin();
  return `
  <section class="card">
    <h2>Appearance</h2>
    <label class="switch-row"><span>Night mode</span><input type="checkbox" class="switch" data-change="theme" ${isDark() ? 'checked' : ''}></label>
  </section>

  <section class="card">
    <h2>Backup</h2>
    <p class="muted small">Your mistakes, bookmarks, stats and revision schedule are saved only on this device. Export a backup now and then, and import it on a new phone.</p>
    <div class="btn-row">
      <button class="btn ghost" data-act="export">Export backup</button>
      <button class="btn ghost" data-act="import">Import backup</button>
    </div>
    <input type="file" id="import-file" accept="application/json,.json" data-change="importFile" hidden>
  </section>

  <section class="card">
    <h2>Install on your phone</h2>
    <p class="small"><b>iPhone:</b> open the link in Safari → tap Share (square with arrow) → <i>Add to Home Screen</i>.</p>
    <p class="small"><b>Android:</b> open the link in Chrome → tap ⋮ → <i>Install app</i> (or <i>Add to Home screen</i>).</p>
    <p class="small muted">It then opens full-screen and works offline.</p>
  </section>

  <section class="card">
    <h2>Admin</h2>
    ${admin ? `
      <p class="small muted">Signed in on this device · ${esc(g.owner)}/${esc(g.repo)} (${esc(g.branch)})</p>
      <div class="btn-row">
        <button class="btn" data-act="adminAdd">Add question</button>
        <button class="btn ghost" data-act="adminList">Edit or delete</button>
      </div>
      <button class="btn text" data-act="logout">Remove admin key from this device</button>` : `
      <p class="small muted">For the app owner only. Paste your GitHub key to add, edit and delete questions. Friends can skip this.</p>
      <label class="field-label" for="gh-token">GitHub key</label>
      <input type="password" id="gh-token" placeholder="github_pat_…" autocomplete="off">
      <details style="margin-top:10px"><summary>Repository settings</summary>
        <div class="grid3">
          <div><label class="field-label" for="gh-owner">Owner</label><input type="text" id="gh-owner" value="${esc(g.owner)}"></div>
          <div><label class="field-label" for="gh-repo">Repo</label><input type="text" id="gh-repo" value="${esc(g.repo)}"></div>
          <div><label class="field-label" for="gh-branch">Branch</label><input type="text" id="gh-branch" value="${esc(g.branch)}"></div>
        </div>
      </details>
      <button class="btn" data-act="saveToken" id="token-btn">Check key and sign in</button>`}
  </section>

  <section class="card">
    <h2>Reset</h2>
    <button class="btn ghost danger" data-act="resetProg">Clear all my progress</button>
  </section>
  <p class="foot muted small">Camp · ${plural(S.questions.length, 'question')}</p>`;
};

/* ---------- Admin: list ---------- */
function adminListHTML() {
  const toks = queryTokens(S.adminQuery), raw = S.adminQuery.trim().toLowerCase();
  let list = S.questions;
  if (raw) list = list.filter(q => q.id.toLowerCase().includes(raw) || (toks.length && matchesQuery(q, toks)));
  const shown = list.slice(-60).reverse();
  if (!shown.length) return '<p class="muted">No questions match.</p>';
  return `<p class="small muted">Showing ${shown.length} of ${list.length} (newest first)</p>` + shown.map(q => `
    <div class="wrong-item">
      <div class="tags"><span class="tag src">${esc(sourceTag(q))}</span><span class="tag">${esc(q.id)}</span></div>
      <div class="q">${esc(q.question)}</div>
      <div class="btn-row"><button class="chip" data-act="editQ" data-id="${esc(q.id)}">✎ Edit</button><button class="chip" data-act="deleteQ" data-id="${esc(q.id)}">🗑 Delete</button></div>
    </div>`).join('');
}
VIEWS.adminList = () => `
  <button class="chip back" data-act="tab" data-tab="more">‹ Back</button>
  <section class="card">
    <h2>Edit or delete</h2>
    <div class="search"><input type="search" data-in="adminQuery" value="${esc(S.adminQuery)}" placeholder="Search by ID, writer, work, words…" autocomplete="off"></div>
    <button class="btn" data-act="adminAdd">Add a new question</button>
  </section>
  <section class="card" id="admin-list">${adminListHTML()}</section>`;

/* ---------- Admin: form ---------- */
VIEWS.adminForm = () => {
  const q = S.edit || { exam: 'NET', type: 'MCQ', format: 'MCQ', options: {}, answer: 'A', verified: true };
  const o = q.options || {};
  const fmt = q.format || (isNAT(q) && S.edit ? 'NAT' : ansList(q).length > 1 ? 'MSQ' : 'MCQ');
  const sel = (id, opts, v) => `<select id="${id}">${opts.map(x => `<option ${String(v) === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
  const txt = (id, label, v, ph = '') => `<label class="field-label" for="${id}">${label}</label><input type="text" id="${id}" value="${esc(v)}" placeholder="${esc(ph)}">`;
  const area = (id, label, v, rows = 3, ph = '') => `<label class="field-label" for="${id}">${label}</label><textarea id="${id}" rows="${rows}" placeholder="${esc(ph)}">${esc(v)}</textarea>`;
  return `
  <button class="chip back" data-act="cancelForm">‹ Cancel</button>
  <section class="card form">
    <h2>${S.edit ? 'Edit question' : 'Add question'}</h2>
    ${txt('f-id', 'Question ID', q.id, 'e.g. NET-2024-JUN-S1-Q37 (blank = automatic)')}
    <div class="grid2">
      <div><label class="field-label" for="f-exam">Exam</label>${sel('f-exam', ['NET', 'GATE', 'Probable', 'Abrams'], q.exam)}</div>
      <div><label class="field-label" for="f-type">Type</label>${sel('f-type', TYPES, q.type || 'MCQ')}</div>
    </div>
    <div class="grid3">
      <div>${txt('f-year', 'Year', q.year, '2024')}</div>
      <div>${txt('f-session', 'Session', q.session, 'June')}</div>
      <div>${txt('f-shift', 'Shift', q.shift, '1')}</div>
    </div>
    ${area('f-question', 'Question', q.question, 5, 'For match / chronology, put each list item on its own line')}
    ${LETTERS.map(L => area(`f-opt${L}`, `Option ${L}`, o[L], 2)).join('')}
    <div class="grid2">
      <div><label class="field-label" for="f-format">Answer format</label>${sel('f-format', FORMATS, fmt)}</div>
      <div>${txt('f-answer', 'Correct answer', q.answer == null ? 'A' : q.answer, 'A  or  A;C  or  25')}</div>
    </div>
    <p class="small muted">MCQ = one letter (A). MSQ = one or more letters (A;C). NAT = a number (25); options can stay empty.</p>
    ${txt('f-topics', 'Topic tags (broad → narrow, commas)', (q.topics || []).join(', '), '19th century, Indian, Drama')}
    ${txt('f-writers', 'Writers (commas)', (q.writers || []).join(', '))}
    ${txt('f-works', 'Works (commas, or ; if a title has a comma)', (q.works || []).join(String((q.works || []).join('')).includes(',') ? '; ' : ', '))}
    ${txt('f-source', 'Source label (optional)', q.source, 'Blank = made from exam, session, year, shift')}
    ${area('f-bite', 'Info bite (1–3 lines)', q.infoBite, 3)}
    ${area('f-study', 'Study whole text / lines asked (optional)', q.studyNote, 2)}
    ${txt('f-keywords', 'Extra search keywords (optional)', (q.keywords || []).join(', '))}
    <label class="check-row"><input type="checkbox" id="f-verified" ${q.verified === false ? '' : 'checked'}> Answer verified with the official key</label>
    ${txt('f-note', 'Note if anything is uncertain', q.note)}
    <button class="btn" data-act="saveQ" id="save-q">Save to GitHub</button>
    ${S.edit ? `<button class="btn ghost danger" data-act="deleteQ" data-id="${esc(q.id)}">Delete this question</button>` : ''}
  </section>`;
};
function collectForm() {
  const v = id => ($('#' + id).value || '').trim();
  const exam = v('f-exam');
  let id = v('f-id');
  if (!id) id = `${exam}-${v('f-year') || 'X'}-${Date.now().toString(36).toUpperCase()}`;
  const keep = S.edit || {};
  // Keep any extra fields an existing question already has (for example section or qno).
  const q = Object.assign({}, keep, { id, exam });
  ['year', 'session', 'shift', 'keywords', 'source', 'studyNote', 'note'].forEach(k => { delete q[k]; });
  const year = v('f-year'); if (year) q.year = /^\d+$/.test(year) ? +year : year;
  if (v('f-session')) q.session = v('f-session');
  if (v('f-shift')) q.shift = /^\d+$/.test(v('f-shift')) ? +v('f-shift') : v('f-shift');
  q.type = v('f-type');
  q.format = v('f-format');
  q.question = v('f-question');
  q.options = {}; LETTERS.forEach(L => { q.options[L] = v('f-opt' + L); });
  q.answer = q.format === 'NAT' ? v('f-answer') : letterList(v('f-answer')).join(';');
  q.topics = splitList(v('f-topics'));
  q.writers = splitList(v('f-writers'));
  q.works = splitList(v('f-works'));
  const kw = splitList(v('f-keywords')); if (kw.length) q.keywords = kw;
  if (v('f-source')) q.source = v('f-source');
  q.infoBite = v('f-bite');
  if (v('f-study')) q.studyNote = v('f-study');
  q.verified = $('#f-verified').checked;
  if (v('f-note')) q.note = v('f-note');
  return q;
}

/* ---------- Report modal ---------- */
function openReport(id) {
  const q = byId(id); if (!q) return;
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Report a mistake">
    <h3>Report a mistake</h3>
    <p class="small muted">${esc(q.id)} · ${esc(sourceTag(q))}</p>
    <textarea id="report-note" rows="4" placeholder="What looks wrong? (answer, spelling, tag, info bite…)"></textarea>
    <div class="btn-row">
      <button class="btn" data-act="sendReport" data-via="wa" data-id="${esc(q.id)}">Send on WhatsApp</button>
      <button class="btn ghost" data-act="sendReport" data-via="mail" data-id="${esc(q.id)}">Send by email</button>
    </div>
    <button class="btn text" data-act="closeModal">Cancel</button>
  </div>`;
  m.hidden = false;
}
const closeModal = () => { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; };

/* =========================================================
   ROUTING & EVENTS
   ========================================================= */
const MAIN_TABS = ['home', 'guide', 'stats', 'more'];
const TAB_OF = { quiz: 'home', results: 'home', guideTopic: 'guide', adminList: 'more', adminForm: 'more' };
function render() {
  const v = $('#view');
  if (!S.loaded) {
    v.innerHTML = S.loadError
      ? `<section class="card center"><h3>Couldn't open the question bank</h3><p class="muted">Check your internet connection and try again.</p><button class="btn" data-act="reload">Try again</button></section>`
      : '<section class="card center muted">Opening the library…</section>';
  } else v.innerHTML = (VIEWS[S.screen] || VIEWS.home)();
  S.tab = MAIN_TABS.includes(S.screen) ? S.screen : (TAB_OF[S.screen] || 'home');
  $('#tabs').hidden = S.screen === 'quiz';
  document.querySelectorAll('#tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
}
function go(screen, keepScroll) {
  if (screen !== S.screen) S.prevScreen = S.screen;
  S.screen = screen;
  render();
  if (!keepScroll) window.scrollTo(0, 0);
}
function refreshMatch() {
  const n = filtered().length;
  const mc = $('#match-count'), sb = $('#start-btn'), cq = $('#clear-q');
  if (mc) mc.textContent = matchText(n);
  if (sb) sb.disabled = !n;
  if (cq) cq.hidden = !S.filters.query;
}

const ACT = {
  reload: () => { S.loadError = false; render(); loadData(); },
  tab: d => { if (S.screen === 'quiz') return; go(d.tab); },
  toggleTheme: () => { setTheme(isDark() ? 'light' : 'dark'); if (S.screen === 'more') render(); },

  /* home */
  revise: () => startQuiz(shuffleArr(dueList()), 'Revision'),
  clearQuery: () => { S.filters.query = ''; render(); },
  clearTags: () => { S.filters.tags = null; render(); },
  mode: d => { S.filters.mode = d.v; go('home', true); },
  count: d => { S.filters.count = d.v; go('home', true); },
  pickTopic: d => { S.filters.query = d.v; S.filters.tags = null; go('home', true); toast(`Showing “${d.v}”`); },
  start: () => {
    const f = S.filters;
    let list = filtered();
    list = f.shuffle ? shuffleArr(list) : list.slice();
    if (f.count !== 'all') list = list.slice(0, +f.count);
    const label = MODES.find(m => m[0] === f.mode)[1];
    const what = f.tags ? f.tags.join(' › ') : f.query.trim();
    startQuiz(list, what ? `${what} · ${label}` : label);
  },

  /* quiz */
  answer: d => {
    const z = S.quiz, q = z.list[z.i];
    if (z.answers[q.id]) return;
    if (isMSQ(q)) {                                   // multi-answer: tap to select / unselect
      z.sel = z.sel || {};
      const s = z.sel[q.id] || (z.sel[q.id] = []);
      const i = s.indexOf(d.v);
      if (i >= 0) s.splice(i, 1); else s.push(d.v);
      go('quiz', true);
      return;
    }
    submitAnswer(q, d.v);                             // single answer: locks on first tap
  },
  check: () => {
    const z = S.quiz, q = z.list[z.i];
    if (z.answers[q.id]) return;
    if (isNAT(q)) {
      const val = (($('#nat-input') || {}).value || '').trim();
      if (!val || isNaN(toNum(val))) { toast('Type a number first'); return; }
      submitAnswer(q, val);
    } else {
      const s = (z.sel && z.sel[q.id]) || [];
      if (!s.length) { toast('Select at least one option'); return; }
      submitAnswer(q, letterList(s.join(';')).join(';'));
    }
  },
  next: () => { const z = S.quiz; if (z.i < z.list.length - 1) { z.i++; go('quiz'); } else finishQuiz(); },
  endQuiz: () => {
    const z = S.quiz, answered = Object.keys(z.answers).length;
    if (!answered) { if (confirm('Leave this quiz?')) { S.quiz = null; go('home'); } return; }
    if (confirm('End the quiz now and see your results?')) finishQuiz();
  },
  bookmark: d => {
    const b = S.prog.bookmarks;
    if (b[d.id]) { delete b[d.id]; toast('Bookmark removed'); } else { b[d.id] = Date.now(); toast('Bookmarked ★'); }
    saveProg(); go(S.screen, true);
  },
  report: d => openReport(d.id),
  closeModal,
  sendReport: d => {
    const q = byId(d.id), note = ($('#report-note').value || '').trim();
    const text = `Camp — mistake report\nID: ${q.id}\nSource: ${sourceTag(q)}\nQuestion: ${q.question}\nNote: ${note || '(none)'}`;
    if (d.via === 'wa') {
      const num = String(CONFIG.reportWhatsApp).replace(/\D/g, '');
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, '_blank');
    } else {
      window.location.href = `mailto:${CONFIG.reportEmail}?subject=${encodeURIComponent('Camp mistake: ' + q.id)}&body=${encodeURIComponent(text)}`;
    }
    closeModal();
  },

  /* results */
  retryWrong: () => startQuiz(shuffleArr(S.quiz.wrong), 'Retry wrong ones'),
  bookmarkWrong: () => { S.quiz.wrong.forEach(q => { if (!S.prog.bookmarks[q.id]) S.prog.bookmarks[q.id] = Date.now(); }); saveProg(); toast('All wrong questions bookmarked ★'); go('results', true); },

  /* guide & stats */
  openGuide: d => { S.guideId = d.id; go('guideTopic'); },
  quizTopic: d => {
    const t = guideData().find(x => x.id === d.id); if (!t) return;
    Object.assign(S.filters, { tags: t.tags, query: '', mode: 'mix' });
    go('home'); toast('Topic set — pick PYQs, Probable or Mix, then Start');
  },
  statTopic: d => {
    Object.assign(S.filters, { tags: d.key.split(' › '), query: '', mode: 'mix' });
    go('home'); toast('Topic set — tap Start quiz');
  },

  /* backup */
  export: async () => {
    const data = JSON.stringify({ app: 'Camp', exported: new Date().toISOString(), progress: S.prog });
    const name = `camp-backup-${todayStr()}.json`;
    const file = new File([data], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('Backup saved');
  },
  import: () => $('#import-file').click(),
  resetProg: () => {
    if (!confirm('Clear all mistakes, bookmarks, stats and revision on this device? This cannot be undone.')) return;
    S.prog = blankProg(); saveProg(); toast('Progress cleared'); render();
  },

  /* admin */
  saveToken: async () => {
    const token = ($('#gh-token').value || '').trim();
    if (!token) { toast('Paste your GitHub key first'); return; }
    const g = { owner: $('#gh-owner').value.trim(), repo: $('#gh-repo').value.trim(), branch: $('#gh-branch').value.trim() || 'main', path: CONFIG.github.path };
    const btn = $('#token-btn'); btn.disabled = true; btn.textContent = 'Checking…';
    try {
      await ghFetchMeta(g, token);
      localStorage.setItem(ADMIN_KEY, JSON.stringify({ token, owner: g.owner, repo: g.repo, branch: g.branch }));
      toast('Signed in as admin on this device ✿'); render();
    } catch (e) { toast(e.message, 4500); btn.disabled = false; btn.textContent = 'Check key and sign in'; }
  },
  logout: () => { if (confirm('Remove the GitHub key from this device?')) { localStorage.removeItem(ADMIN_KEY); render(); } },
  adminAdd: () => { S.edit = null; go('adminForm'); },
  adminList: () => go('adminList'),
  editQ: d => { const q = byId(d.id); if (!q) return; S.edit = JSON.parse(JSON.stringify(q)); go('adminForm'); },
  cancelForm: () => { const back = S.prevScreen === 'adminForm' ? 'more' : S.prevScreen; S.edit = null; go(back || 'more'); },
  saveQ: async () => {
    const q = collectForm(), orig = S.edit ? S.edit.id : null;
    if (!q.question) return toast('Please write the question');
    if (q.format === 'NAT') {
      if (isNaN(toNum(q.answer))) return toast('For NAT, the correct answer must be a number');
    } else {
      if (LETTERS.some(L => !q.options[L])) return toast('Please fill all four options');
      const n = ansList(q).length;
      if (q.format === 'MCQ' && n !== 1) return toast('MCQ needs exactly one answer letter (A–D)');
      if (q.format === 'MSQ' && n < 1) return toast('MSQ needs at least one answer letter, like A;C');
    }
    if (!q.topics.length) return toast('Please add at least one topic tag');
    if (!orig && byId(q.id)) return toast('That ID already exists — choose another');
    if (orig && q.id !== orig && byId(q.id)) return toast('That ID already exists — choose another');
    const btn = $('#save-q'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const arr = await ghUpdate(list => {
        if (orig) {
          const i = list.findIndex(x => x.id === orig);
          if (i < 0) throw new Error('This question is no longer on GitHub.');
          list[i] = q;
        } else {
          if (list.some(x => x.id === q.id)) throw new Error('That ID already exists on GitHub.');
          list.push(q);
        }
        return list;
      }, `${orig ? 'Edit' : 'Add'} question ${q.id}`);
      applyBank(arr);
      toast('Saved ✿ Everyone sees it in 1–2 minutes', 4000);
      const back = S.prevScreen === 'quiz' && S.quiz ? 'quiz' : 'adminList';
      S.edit = null; go(back);
    } catch (e) { toast(e.message, 5000); btn.disabled = false; btn.textContent = 'Save to GitHub'; }
  },
  deleteQ: async d => {
    if (!confirm(`Delete question ${d.id} for everyone? This cannot be undone.`)) return;
    toast('Deleting…');
    try {
      const arr = await ghUpdate(list => list.filter(x => x.id !== d.id), `Delete question ${d.id}`);
      applyBank(arr);
      if (S.quiz) { S.quiz = null; }
      S.edit = null; toast('Deleted. Everyone sees the change in 1–2 minutes', 4000); go('adminList');
    } catch (e) { toast(e.message, 5000); }
  }
};

const IN = {
  query: v => { S.filters.query = v; refreshMatch(); },
  guideQuery: v => { S.guideQuery = v; const el = $('#guide-list'); if (el) el.innerHTML = guideListHTML(); },
  adminQuery: v => { S.adminQuery = v; const el = $('#admin-list'); if (el) el.innerHTML = adminListHTML(); }
};
const CH = {
  shuffle: el => { S.filters.shuffle = el.checked; },
  theme: el => setTheme(el.checked ? 'dark' : 'light'),
  importFile: el => {
    const file = el.files && el.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result), p = data.progress || data;
        if (!p || !p.attempts) throw new Error('bad');
        if (!confirm('Replace the progress on this device with this backup?')) return;
        S.prog = Object.assign(blankProg(), p); saveProg(); toast('Backup imported ✿'); render();
      } catch (e) { toast('That file is not a Camp backup'); }
      el.value = '';
    };
    r.readAsText(file);
  }
};

document.addEventListener('click', e => {
  if (e.target.id === 'modal') { closeModal(); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el.dataset, el); }
});
document.addEventListener('input', e => { const el = e.target.closest('[data-in]'); if (el && IN[el.dataset.in]) IN[el.dataset.in](el.value, el); });
document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (el && CH[el.dataset.change]) CH[el.dataset.change](el); });
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'q-search') { e.target.blur(); }
  if (e.key === 'Enter' && e.target.id === 'nat-input') { e.preventDefault(); ACT.check(); }
  if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
});

/* =========================================================
   START
   ========================================================= */
// Small extra styles for multi-answer selection and the number box (kept here so style.css needs no change).
(function addAnswerStyles() {
  const s = document.createElement('style');
  s.textContent = `
    .opt.selected { outline: 2px solid #a98bd6; outline-offset: -2px; background: rgba(169, 139, 214, .18); }
    #nat-input { width: 100%; margin-top: 6px; font-size: 1.1rem; }
    .nat-given { margin-top: 12px; }`;
  document.head.appendChild(s);
})();

async function loadData() {
  try {
    const [qs, guide] = await Promise.all([
      fetch('questions.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch('guide.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { topics: [] }).catch(() => ({ topics: [] }))
    ]);
    applyBank(Array.isArray(qs) ? qs : (qs.questions || []));
    S.guide = guide && guide.topics ? guide : { topics: [] };
    S.loaded = true;
  } catch (e) { S.loadError = true; }
  render();
}

setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', false);
render();
loadData();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('service-worker.js').catch(() => {}); });
}
