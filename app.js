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
  reportEmail: 'pallavijoshii.pj77@gmail.com',
  // Where the question bank lives on GitHub (used only by the admin "Add question" form).
  github: { owner: 'peel-oranges', repo: 'Camp', branch: 'main', path: 'questions.json' },
  // Visitor counter (GoatCounter account name). Leave '' to turn counting off.
  // Visits from a device with the admin key are never counted.
  goatcounter: 'camp-peel'
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
const ADMIN_FILTERS = [['all', 'All'], ['unverified', 'Unverified'], ['pyq', 'PYQ'], ['probable', 'Probable'], ['abrams', 'Abrams']];
const ADMIN_PAGE = 40;

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
function blankProg() { return { v: 1, attempts: {}, mistakes: {}, bookmarks: {}, revision: {}, history: [], syl: {}, sylCustom: [], plan: { days: {} } }; }
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
  questions: [], guide: { categories: [] }, loaded: false, loadError: false,
  prog: loadProg(),
  filters: { mode: 'mix', query: '', tags: null, group: null, count: '10', shuffle: true, fresh: true },
  screen: 'home', tab: 'home', prevScreen: 'home',
  syllabus: null, sylExam: 'both', planView: 'week', planWeek: null, planMonth: null,
  quiz: null, guideId: null, guideMode: 'cats', guideQuery: '',
  adminQuery: '', adminFilter: 'all', adminShow: ADMIN_PAGE, edit: null
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
// Accents are removed first, so "Ngugi" finds "Ngũgĩ" and "Thiong'o" finds "Thiong’o".
const deaccent = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
function words(str) {
  return deaccent(str).toLowerCase().replace(/twenty[\s-]first/g, '21st')
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
const ENDINGS = /^(s|es|ed|er|ers|al|ic|ics|tic|ist|ists|tist|tists|ian|ians|ism|isms|an|ans|ese|ity|ly|ry|tions?|ation|ations)$/;
function tokenMatch(tok, W) {
  // "=name" means a writer's name: match the whole name (so "attia" doesn't find "attic").
  if (tok[0] === '=') { const n = tok.slice(1); return W.some(w => w.startsWith(n)); }
  const stem = tok.length > 4 ? tok.slice(0, Math.max(4, tok.length - 2)) : tok;
  // A word plus a real ending also counts: "dramatists" finds "drama", "novels" finds "novel".
  // (But "wordsworth" must not find "words", nor "postcolonial" find "post".)
  return W.some(w => w.startsWith(stem) || (w.length >= 4 && tok.startsWith(w) && ENDINGS.test(tok.slice(w.length))));
}
const queryTokens = s => words(s).filter(t => !STOP.has(t) && (t.length > 1 || /\d/.test(t)));
// toks can be plain words, or groups of alternatives (from spelling fixes): every group needs one hit.
function matchesQuery(q, toks) {
  const W = indexQ(q);
  return toks.every(t => (Array.isArray(t) ? t : [t]).some(x => tokenMatch(x, W)));
}

/* Spelling help: a word that matches nothing in the bank is swapped for the
   closest real words (1 letter off, or 2 for long words), e.g. "attai" → "attia". */
let VOCAB = null;
function vocab() {
  if (!VOCAB) { const s = new Set(); S.questions.forEach(q => indexQ(q).forEach(w => s.add(w))); VOCAB = [...s]; }
  return VOCAB;
}
function editDist(a, b, max) {             // letters added, removed, changed or swapped
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}
// Words that make up writers' names, e.g. attia, hosain, kamala, dickens.
let NAMES = null;
function nameWords() {
  if (!NAMES) { const s = new Set(); S.questions.forEach(q => (q.writers || []).forEach(w => words(w).forEach(x => { if (x.length >= 4) s.add(x); }))); NAMES = [...s]; }
  return NAMES;
}
let RTMEMO = { key: null, val: null };
function resolveTokens(toks) {
  const key = toks.join(' ');
  if (RTMEMO.key === key && RTMEMO.val) return RTMEMO.val;
  const V = vocab(), N = nameWords();
  // 1) Writer names: an exact name is matched as a whole name; a misspelt name
  //    (not just half-typed) goes to the closest real name, e.g. "attai" → "attia".
  let groups = toks.map(t => {
    if (t.length < 4 || /\d/.test(t)) return [t];
    if (N.includes(t)) return ['=' + t];
    if (V.includes(t) || N.some(n => n.startsWith(t))) return [t];
    const max = t.length >= 8 ? 2 : 1;
    const alts = N.map(n => [n, editDist(t, n, max)]).filter(x => x[1] <= max)
      .sort((x, y) => x[1] - y[1]).map(x => '=' + x[0]).slice(0, 6);
    return alts.length ? alts : [t];
  });
  if (S.questions.some(q => matchesQuery(q, groups))) { RTMEMO = { key, val: groups }; return groups; }
  groups = toks.map(t => [t]);
  // 2) Other words:
  // only when the search as typed finds nothing in the whole bank do we try spelling fixes.
  if (!S.questions.some(q => matchesQuery(q, toks))) {
    groups = toks.map(t => {
      if (t.length < 4 || /\d/.test(t) || V.includes(t)) return [t];     // a real word stays as typed
      const max = t.length >= 8 ? 2 : 1;
      const alts = V.filter(w => w !== t && (w[0] === t[0] || w[1] === t[1])).map(w => [w, editDist(t, w, max)]).filter(x => x[1] <= max)
        .sort((x, y) => x[1] - y[1]).map(x => x[0]).slice(0, 8);
      return alts.concat([t]);                       // closest spellings first, the typed word last
    });
  }
  RTMEMO = { key, val: groups };
  return groups;
}

/* Writer → works: searching a writer also finds questions on that writer's works,
   even when the question itself doesn't name the writer.
   The list is learnt from the bank (questions tagged with one writer) and from guide.json. */
let WCACHE = null;
const normTitle = t => words(t).join(' ');
const TEXT_IDX = new WeakMap();
function writerWorks() {
  if (WCACHE) return WCACHE;
  const m = new Map();
  const add = (w, t) => {
    const k = words(w).join(' '), title = normTitle(t);
    if (!k || !title) return;
    let e = m.get(k);
    if (!e) { e = { name: w, toks: words(w), works: new Set() }; m.set(k, e); }
    e.works.add(title);
  };
  S.questions.forEach(q => { const ws = q.writers || []; if (ws.length === 1) (q.works || []).forEach(t => add(ws[0], t)); });
  (S.guide.categories || []).forEach(c => (c.subtopics || []).forEach(t => (t.works || []).forEach(g => { if (g && g.writer && g.title) add(g.writer, g.title); })));
  WCACHE = [...m.values()];
  return WCACHE;
}
function worksForQuery(groups) {
  const hit = writerWorks().filter(e => groups.every(g => g.some(t => tokenMatch(t, e.toks))));
  const works = new Set();
  hit.forEach(e => e.works.forEach(t => works.add(t)));
  return { works, writers: hit.map(e => e.name) };
}
// Short or one-word titles ("Nature", "Words", "I Am") are only matched by their tag,
// never inside question text, so they don't pull in unrelated questions.
const longTitle = t => t.split(' ').filter(w => w.length >= 3 && !STOP.has(w)).length >= 2;
function aboutWorks(q, works) {
  if ((q.works || []).some(t => works.has(normTitle(t)))) return true;
  let text = TEXT_IDX.get(q);
  if (!text) { text = ` ${words(q.question).join(' ')} `; TEXT_IDX.set(q, text); }
  for (const t of works) if (longTitle(t) && text.includes(` ${t} `)) return true;
  return false;
}

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
  if (f.group) { const g = gNode(f.group.id); const ids = new Set(g ? g.qs.map(q => q.id) : []); list = list.filter(q => ids.has(q.id)); }
  if (f.work) { const ids = new Set(f.work.ids); list = list.filter(q => ids.has(q.id)); }
  const raw = f.query.trim();
  S.searchInfo = null;
  if (raw) {
    const exact = list.filter(q => q.id.toLowerCase() === raw.toLowerCase());
    if (exact.length) return exact;
    const toks = queryTokens(raw);
    if (toks.length) {
      const groups = resolveTokens(toks);
      const direct = list.filter(q => matchesQuery(q, groups));
      const { works, writers } = worksForQuery(groups);
      let extra = [];
      if (works.size) {
        const ids = new Set(direct.map(q => q.id));
        extra = list.filter(q => !ids.has(q.id) && aboutWorks(q, works));
      }
      // For the "Showing results for…" line, pick the spelling in each group that actually found questions.
      const used = groups.map((g, i) => (g.length === 1 ? g[0] : ([toks[i]].concat(g).find(x => direct.some(q => tokenMatch(x, indexQ(q)))) || toks[i])).replace(/^=/, ''));
      const fixed = used.some((u, i) => u !== toks[i]);
      S.searchInfo = { fix: fixed && direct.length ? used.join(' ') : '', extra: extra.length, writers };
      list = direct.concat(extra);
    }
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
  if (!navigator.onLine) throw new Error('You are offline. Connect to the internet, then save again.');
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
  GCACHE = null; WCACHE = null; VOCAB = null; NAMES = null; ECACHE = null; NCACHE = null; RTMEMO = { key: null, val: null };
  S.questions = arr.filter(q => q && q.id && q.question && (hasOptions(q) || q.format === 'NAT'));
  if (S.quiz) S.quiz.list = S.quiz.list.map(q => byId(q.id) || q);
}

/* =========================================================
   VIEWS
   ========================================================= */
const VIEWS = {};

/* ---------- Home ---------- */
const seenQ = q => !!S.prog.attempts[q.id];
function matchText(n) {
  const c = S.filters.count, take = c === 'all' ? n : Math.min(n, +c);
  if (!n) return 'No questions match yet. Try a broader search or another chip.';
  const fresh = filtered().filter(q => !seenQ(q)).length;
  const info = S.searchInfo || {};
  const notes = [];
  if (info.fix) notes.push(`Showing results for “${info.fix}”`);
  if (info.extra) notes.push(`includes ${plural(info.extra, 'question')} on works by ${info.writers.slice(0, 2).join(', ')}${info.writers.length > 2 ? '…' : ''}`);
  return `${notes.length ? notes.join(' · ') + '. ' : ''}${plural(n, 'question')} match (${fresh} new, ${n - fresh} done before) · this quiz will have ${take}`;
}
VIEWS.home = () => {
  const f = S.filters, due = dueList().length, n = filtered().length;
  const browse = buildGuide().cats.filter(c => c.qs.length);
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
    ${f.tags || f.group || f.work ? `<div class="chips" style="margin-top:10px"><button class="chip on" data-act="clearTags">${f.work ? 'Work' : 'Topic'}: ${esc(f.work ? f.work.label : f.group ? f.group.label : f.tags.join(' › '))} ✕</button></div>` : ''}

    <span class="field-label">Questions from</span>
    <div class="chips">${MODES.map(([k, l]) => `<button class="chip ${f.mode === k ? 'on' : ''}" data-act="mode" data-v="${k}">${l} <span class="count">${poolForMode(k).length}</span></button>`).join('')}</div>

    <span class="field-label">How many</span>
    <div class="seg">${['5', '10', '20', '50', 'all'].map(c => `<button class="${f.count === c ? 'on' : ''}" data-act="count" data-v="${c}">${c === 'all' ? 'All' : c}</button>`).join('')}</div>

    <label class="switch-row"><span>Shuffle questions</span><input type="checkbox" class="switch" data-change="shuffle" ${f.shuffle ? 'checked' : ''}></label>
    <label class="switch-row"><span>New questions first<br><span class="small muted" style="font-weight:600">Ones you haven't answered come before repeats</span></span><input type="checkbox" class="switch" data-change="fresh" ${f.fresh ? 'checked' : ''}></label>

    <p class="match muted" id="match-count">${matchText(n)}</p>
    <button class="btn" id="start-btn" data-act="start" ${n ? '' : 'disabled'}>Start quiz</button>
  </section>

  ${browse.length ? `<section class="card"><h3>Browse by section</h3><div class="chips">${browse.map(c => `<button class="chip soft ${f.group && f.group.id === c.id ? 'on' : ''}" data-act="pickSection" data-id="${esc(c.id)}">${esc(c.name)} <span class="count">${c.qs.length}</span></button>`).join('')}</div>
    <p class="small muted" style="margin-top:8px">For smaller topics inside a section, open it in the Guide and tap “Quiz me”.</p></section>` : ''}
  <p class="foot muted small">${plural(S.questions.length, 'question')} in the bank${pyqYearsLine() ? `<br>${esc(pyqYearsLine())}` : ''}</p>`;
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
  const last = z.i >= n - 1;
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
  ${picked
    ? `<button class="btn" data-act="next">${last ? 'See results' : 'Next question'}</button>`
    : `<button class="btn ghost skip-btn" data-act="skip">${last ? 'Skip and see results' : 'Skip this question ›'}</button>`}
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
  // Skipped = every question in this quiz that was not answered (skipped, or not reached if ended early).
  z.skippedList = z.list.filter(q => !z.answers[q.id]);
  if (!z.done.length) { S.quiz = null; go('home'); toast('No questions answered, so there is no score'); return; }
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
  const skipped = (z.skippedList || []).length;
  const missed = new Map();
  z.wrong.forEach(q => { const k = (q.topics || []).join(' › ') || 'Untagged'; missed.set(k, (missed.get(k) || 0) + 1); });
  const missedList = [...missed].sort((a, b) => b[1] - a[1]);
  return `
  <section class="card score">
    <span class="label">${esc(z.title || 'Quiz')} · results</span>
    <div class="big">${z.score} / ${total}</div>
    <div class="meta"><span>${pct}%</span><span>⏱ ${fmtTime(z.ms)}</span>${skipped ? `<span>${skipped} skipped</span>` : ''}</div>
    ${z.mastered ? `<p class="small" style="margin-top:10px">✿ ${plural(z.mastered, 'question')} passed the final revision check</p>` : ''}
  </section>

  ${skipped ? `<button class="btn ghost" data-act="retrySkipped" style="margin-bottom:16px">Answer the ${plural(skipped, 'skipped question')}</button>` : ''}

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
  </section>` : `<section class="card center"><h3>${skipped ? 'No wrong answers ✿' : 'A perfect round ✿'}</h3><p class="muted">Every answer${skipped ? ' you gave was' : ''} correct.</p></section>`}

  <button class="btn ghost" data-act="tab" data-tab="home">Back to quiz home</button>`;
};

/* ---------- Study guide ----------
   guide.json lists categories (British, American, Indian…), each with subtopics.
   Every question is sorted into them automatically by its topic tags, using the
   "match" rules in guide.json, so questions.json never needs re-tagging.
   Rule keys (all optional, every key given must pass):
     any: [tags]  – at least one of these tags is present (any level)
     all: [tags]  – every one of these tags is present
     first: [tags] – the broadest (first) tag is one of these
     none: [tags] – none of these tags is present
     text: "regex" – the question text matches
     exam: [NET, GATE, Probable, Abrams]
     quote: true  – the question is built on a quotation or passage            */
const norm = s => String(s || '').toLowerCase().replace(/[‐-―]/g, '-').replace(/[’‘]/g, "'").trim();
const AIDS = new WeakMap();
function qTagSet(q) {
  let s = AIDS.get(q);
  if (!s) { s = new Set((q.topics || []).map(norm)); AIDS.set(q, s); }
  return s;
}
const QUOTE_TAGS = ['identify the author', 'identify the text', 'identify the poem', 'opening lines', 'quotations', 'quotation', 'lines', 'identify the speaker'];
function quoteSpan(q) {
  const t = String(q.question || '');
  const m = t.match(/[“"‘]([^”"’]{25,})[”"’]/g);
  if (m) return m.sort((a, b) => b.length - a.length)[0].replace(/^[“"‘]|[”"’]$/g, '');
  return '';
}
function isQuoteQ(q) {
  const s = qTagSet(q);
  return QUOTE_TAGS.some(x => s.has(x)) || q.type === 'passage' || !!quoteSpan(q);
}
function ruleOK(q, r) {
  const s = qTagSet(q);
  if (r.any && !r.any.some(x => s.has(norm(x)))) return false;
  if (r.all && !r.all.every(x => s.has(norm(x)))) return false;
  if (r.first && !r.first.map(norm).includes(norm((q.topics || [])[0]))) return false;
  if (r.none && r.none.some(x => s.has(norm(x)))) return false;
  if (r.exam && !r.exam.includes(q.exam)) return false;
  if (r.quote && !isQuoteQ(q)) return false;
  if (r.text) { try { if (!new RegExp(r.text, 'i').test(q.question || '')) return false; } catch (e) { return false; } }
  return true;
}
function matchAny(q, rules, not) {
  if (not && not.some(x => qTagSet(q).has(norm(x)))) return false;
  return (rules || []).some(r => ruleOK(q, r));
}

let GCACHE = null;              // rebuilt whenever the question bank or guide changes
function buildGuide() {
  if (GCACHE) return GCACHE;
  const cats = [], nodes = new Map(), Q = S.questions;
  const counts = qs => {
    const pyq = qs.filter(isPYQ);
    return { qs, pyq, net: pyq.filter(q => q.exam === 'NET').length, gate: pyq.filter(q => q.exam === 'GATE').length, total: pyq.length };
  };
  (S.guide.categories || []).forEach(c => {
    if (c.auto === 'unmatched') return;
    const inCat = Q.filter(q => matchAny(q, c.match, c.not));
    const subs = (c.subtopics || []).map(t => {
      const qs = inCat.filter(q => matchAny(q, t.match, t.not));
      return Object.assign({}, t, counts(qs), { cat: c });
    });
    const used = new Set(); subs.forEach(t => t.qs.forEach(q => used.add(q.id)));
    const left = inCat.filter(q => !used.has(q.id));
    if (left.length && subs.length) subs.push(Object.assign({ id: `${c.id}-other`, name: c.otherName || 'Other / not tagged to a topic', isOther: true, cat: c }, counts(left)));
    const cat = Object.assign({}, c, counts(inCat), { subs });
    cats.push(cat); nodes.set(c.id, cat);
    subs.forEach(t => nodes.set(t.id, t));
  });
  const un = (S.guide.categories || []).find(c => c.auto === 'unmatched');
  if (un) {
    const seen = new Set();
    cats.forEach(c => c.qs.forEach(q => seen.add(q.id)));
    const cat = Object.assign({}, un, counts(Q.filter(q => !seen.has(q.id))), { subs: [] });
    if (cat.qs.length) { cats.push(cat); nodes.set(un.id, cat); }
  }
  const level = list => {
    const ranked = list.slice().sort((a, b) => b.total - a.total);
    const w = ranked.filter(t => t.total > 0).length;
    ranked.forEach((t, i) => { t.level = t.weight || (t.total === 0 ? 'Low' : i < Math.ceil(w / 3) ? 'High' : i < Math.ceil((2 * w) / 3) ? 'Medium' : 'Low'); });
  };
  level(cats);
  const allSubs = cats.flatMap(c => c.subs);
  level(allSubs);
  GCACHE = { cats, nodes, allSubs };
  return GCACHE;
}
const gNode = id => buildGuide().nodes.get(id);
const nodeLabel = t => t.cat ? `${t.cat.name} › ${t.name}` : t.name;
const nodeSub = t => `NET ${t.net} · GATE ${t.gate}${t.qs.length > t.total ? ` · ${t.qs.length - t.total} practice` : ''}`;

function rowHTML(t, rank, showCat) {
  const empty = !t.qs.length;
  return `
    <button class="row ${empty ? 'empty' : ''}" data-act="openGuide" data-id="${esc(t.id)}">
      ${rank ? `<span class="rank">${rank}</span>` : ''}
      <span class="grow">${showCat && t.cat ? `<span class="sub">${esc(t.cat.name)} ›</span><br>` : ''}<span class="name">${esc(t.name)}</span><br>
        <span class="sub">${empty ? 'No PYQs yet' : nodeSub(t)}</span></span>
      ${empty ? '' : `<span class="pill ${esc(t.level)}">${esc(t.level)}</span>`}<span class="chev">›</span>
    </button>`;
}
function guideListHTML() {
  const G = buildGuide(), toks = queryTokens(S.guideQuery);
  if (toks.length) {
    const hit = t => toks.every(tok => tokenMatch(tok, words([t.name, t.cat ? t.cat.name : '', t.about || ''].join(' '))));
    const list = [...G.cats.filter(hit), ...G.allSubs.filter(hit)];
    return list.length ? `<div class="list">${list.map(t => rowHTML(t, 0, true)).join('')}</div>` : '<p class="muted">No guide topics match.</p>';
  }
  if (S.guideMode === 'rank') {
    const list = G.allSubs.filter(t => t.total > 0 && !t.cat.overlay).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return list.length ? `<div class="list">${list.map((t, i) => rowHTML(t, i + 1, true)).join('')}</div>` : '<p class="muted">Rankings appear once PYQs are added.</p>';
  }
  return `<div class="cat-grid">${G.cats.map(c => `
    <button class="cat-card ${c.overlay ? 'overlay' : ''} ${c.qs.length ? '' : 'empty'}" data-act="openGuide" data-id="${esc(c.id)}">
      <span class="cat-icon" aria-hidden="true">${esc(c.icon || '✦')}</span>
      <span class="cat-name">${esc(c.name)}</span>
      <span class="sub">${c.qs.length ? `NET ${c.net} · GATE ${c.gate}` : 'No PYQs yet'}</span>
      ${c.qs.length ? `<span class="pill ${esc(c.level)}">${esc(c.level)}</span>` : ''}
    </button>`).join('')}</div>`;
}
VIEWS.guide = () => `
  <button class="card kx-entry" data-act="openExam">
    <span class="cat-icon" aria-hidden="true">⚖</span>
    <span class="grow"><span class="name">Know your exam</span><br><span class="sub">How NET and GATE ask differently, with real examples</span></span>
    <span class="chev">›</span>
  </button>
  <button class="card kx-entry" data-act="openNotes">
    <span class="cat-icon" aria-hidden="true">✎</span>
    <span class="grow"><span class="name">Short notes</span><br><span class="sub">Must-study works, must-learn facts and the 🎯 GATE radar</span></span>
    <span class="chev">›</span>
  </button>
  <section class="card">
    <h2>Must-learn overview</h2>
    <p class="muted small">Every PYQ is sorted into these sections automatically. Counts and High / Medium / Low update as new papers are added.</p>
    <div class="seg" style="margin-bottom:12px">
      <button class="${S.guideMode !== 'rank' ? 'on' : ''}" data-act="guideMode" data-v="cats">By section</button>
      <button class="${S.guideMode === 'rank' ? 'on' : ''}" data-act="guideMode" data-v="rank">Rank all topics</button>
    </div>
    <div class="search"><input type="search" data-in="guideQuery" value="${esc(S.guideQuery)}" placeholder="Find a topic" autocomplete="off"></div>
  </section>
  <section class="card" id="guide-list">${guideListHTML()}</section>`;

function freqList(qs, field) {
  const m = new Map();
  qs.forEach(q => (q[field] || []).forEach(x => { const k = String(x).trim(); if (k) m.set(k, (m.get(k) || 0) + 1); }));
  return [...m].sort((a, b) => b[1] - a[1]).map(([name, count], i) => ({ name, count, frequent: count >= 3 || (count >= 2 && i < 3) }));
}
function writersHTML(t, limit) {
  const writers = freqList(t.pyq, 'writers').slice(0, limit || 999);
  const extraPink = (t.highlightWriters || []).map(x => x.toLowerCase());
  return writers.length
    ? `<table class="freq">${writers.map(w => `<tr class="${w.frequent || extraPink.includes(w.name.toLowerCase()) ? 'pink' : ''}"><td>${esc(w.name)}</td><td>${w.count}×</td></tr>`).join('')}</table>
       <p class="small muted" style="margin-top:8px">Pink rows = frequently asked.</p>`
    : '<p class="muted small">No PYQs tagged here yet.</p>';
}
// Quotation / award bank: the line or question, with the answer hidden until tapped.
const byNewest = (a, b) => (isPYQ(b) - isPYQ(a)) || (+b.year || 0) - (+a.year || 0);
function bankHTML(qs, kind, limit) {
  const list = qs.slice().sort(byNewest).slice(0, limit || 999);
  if (!list.length) return '<p class="muted small">Nothing recorded yet.</p>';
  return list.map(q => {
    const line = kind === 'quote' ? (quoteSpan(q) || q.question) : q.question;
    const meta = [...(q.writers || []).slice(0, 2), ...(q.works || []).slice(0, 1)].join(' · ');
    return `<div class="bank-item">
      ${kind === 'quote' ? `<blockquote class="clamp">${esc(line)}</blockquote>` : `<div class="q">${esc(line)}</div>`}
      <details><summary>Show answer</summary>
        <p class="ans"><b>${esc(answerText(q))}</b></p>
        ${meta ? `<p class="small muted">${esc(meta)}</p>` : ''}
        ${q.infoBite ? `<p class="small">${esc(q.infoBite)}</p>` : ''}
      </details>
      <span class="tag src">${esc(sourceTag(q))}</span>
    </div>`;
  }).join('') + (qs.length > list.length ? `<p class="small muted">Showing ${list.length} of ${qs.length}. Use “Quiz me” to practise them all.</p>` : '');
}

VIEWS.guideCat = () => {
  const c = gNode(S.guideId);
  if (!c || c.cat) return VIEWS.guide();
  const bank = c.kind === 'quotes' ? 'quote' : c.kind === 'awards' ? 'award' : '';
  return `
  <button class="chip back" data-act="tab" data-tab="guide">‹ All sections</button>
  <section class="card">
    <h2>${esc(c.icon ? c.icon + ' ' : '')}${esc(c.name)}</h2>
    <div class="chips" style="margin-bottom:10px">
      ${c.qs.length ? `<span class="pill ${esc(c.level)}">${esc(c.level)} weightage</span>` : ''}
      <span class="pill Low">NET ${c.net}</span><span class="pill Low">GATE ${c.gate}</span>
      ${c.qs.length > c.total ? `<span class="pill Low">${c.qs.length - c.total} practice</span>` : ''}
    </div>
    ${c.about ? `<p class="muted">${esc(c.about)}</p>` : ''}
    ${c.qs.length ? `<button class="btn" data-act="quizTopic" data-id="${esc(c.id)}">Quiz me on this section</button>` : ''}
  </section>
  ${c.subs.length ? `<section class="card"><h3>Topics</h3><div class="list">${c.subs.map(t => rowHTML(t)).join('')}</div>
    <p class="small muted" style="margin-top:8px">Greyed topics have no PYQs yet — still on the syllabus.</p></section>` : ''}
  ${bank ? `<section class="card"><h3>${bank === 'quote' ? 'Quotation bank' : 'Awards asked'}</h3>
    <p class="small muted">Read each one, guess, then tap “Show answer”.</p>${bankHTML(c.qs, bank)}</section>` : ''}
  ${c.qs.length && !bank ? `<section class="card"><h3>Most-asked writers here</h3>${writersHTML(c, 15)}</section>` : ''}`;
};

VIEWS.guideTopic = () => {
  const t = gNode(S.guideId);
  if (!t || !t.cat) return VIEWS.guide();
  const liveWorks = freqList(t.pyq, 'works');
  const wmap = new Map();
  liveWorks.forEach(w => wmap.set(w.name.toLowerCase(), { title: w.name, count: w.count, frequent: w.frequent }));
  (t.works || []).forEach(g => { const k = g.title.toLowerCase(); wmap.set(k, Object.assign({ count: 0 }, wmap.get(k) || {}, g)); });
  const works = [...wmap.values()].sort((a, b) => (b.count || 0) - (a.count || 0));
  const types = freqList(t.pyq.map(q => ({ t: [q.type || 'MCQ'] })), 't');
  const quoteQs = t.qs.filter(isQuoteQ);
  const kind = t.cat.kind === 'awards' ? 'award' : 'quote';

  return `
  <button class="chip back" data-act="openGuide" data-id="${esc(t.cat.id)}">‹ ${esc(t.cat.name)}</button>
  <section class="card">
    <span class="label">${esc(t.cat.name)}</span>
    <h2>${esc(t.name)}</h2>
    <div class="chips" style="margin-bottom:10px">
      ${t.qs.length ? `<span class="pill ${esc(t.level)}">${esc(t.level)} weightage</span>` : ''}
      <span class="pill Low">NET ${t.net}</span><span class="pill Low">GATE ${t.gate}</span>
    </div>
    ${t.about ? `<p class="muted">${esc(t.about)}</p>` : ''}
    ${t.qs.length ? `<button class="btn" data-act="quizTopic" data-id="${esc(t.id)}">Quiz me on this topic</button>` : '<p class="muted small">No questions here yet. They appear automatically as papers are added.</p>'}
  </section>

  ${t.cat.kind === 'awards' ? `<section class="card"><h3>Awards asked</h3>${bankHTML(t.qs, 'award')}</section>` : `
  <section class="card">
    <h3>Must-read writers</h3>
    ${writersHTML(t)}
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
    ${(t.lines || []).map(l => `<blockquote>${esc(l.text)}<cite>${esc([l.work, l.source].filter(Boolean).join(' · '))}</cite></blockquote>`).join('')}
    ${quoteQs.length ? bankHTML(quoteQs, kind, 30) : (t.lines || []).length ? '' : '<p class="muted small">No quoted lines asked here yet.</p>'}
  </section>`}

  <section class="card">
    <h3>Recurring question patterns</h3>
    ${types.length ? `<div class="chips" style="margin-bottom:10px">${types.map(x => `<span class="chip soft">${esc(x.name)} ×${x.count}</span>`).join('')}</div>` : ''}
    ${(t.patterns || []).length ? `<ul>${t.patterns.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : (types.length ? '' : '<p class="muted small">Patterns appear once PYQs are tagged.</p>')}
  </section>`;
};

/* ---------- Know your exam ----------
   Everything here is counted live from questions.json, so it updates as papers are added.
   GATE's General Aptitude and Reasoning & Comprehension sections are left out, so
   only the English (literature) questions of both exams are compared.               */
const NON_LIT = new Set(['reasoning & comprehension', 'general aptitude', 'ga']);
const qYear = q => { const m = String(q.year || q.session || '').match(/\d{4}/); return m ? +m[0] : 0; };
const isLitQ = q => !NON_LIT.has(norm((q.topics || [])[0]));
const ansKeys = q => isNAT(q) ? [] : ansList(q).map(L => normTitle((q.options || {})[L] || '')).filter(x => x.length > 3);
const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;
let ECACHE = null;
function examStats() {
  if (ECACHE) return ECACHE;
  const net = S.questions.filter(q => q.exam === 'NET' && qYear(q) && isLitQ(q));
  const gate = S.questions.filter(q => q.exam === 'GATE' && qYear(q) && isLitQ(q));
  // When did NET first ask each work, writer and answer?
  const workFirst = new Map(), writerFirst = new Map(), ansFirst = new Map(), workNet = new Map();
  const first = (m, k, y) => { if (k && (!m.has(k) || m.get(k) > y)) m.set(k, y); };
  net.forEach(q => {
    const y = qYear(q);
    (q.works || []).forEach(w => { const k = normTitle(w); if (!k) return; first(workFirst, k, y); if (!workNet.has(k)) workNet.set(k, []); workNet.get(k).push(q); });
    (q.writers || []).forEach(w => first(writerFirst, normTitle(w), y));
    ansKeys(q).forEach(k => first(ansFirst, k, y));
  });
  let work = 0, writer = 0, fresh = 0, same = 0;
  const examples = [];
  gate.forEach(g => {
    const Y = qYear(g);
    const seenWorks = (g.works || []).map(normTitle).filter(k => workFirst.has(k) && workFirst.get(k) < Y);
    const seenWriter = (g.writers || []).map(normTitle).some(k => writerFirst.has(k) && writerFirst.get(k) < Y);
    if (seenWorks.length) work++; else if (seenWriter) writer++; else fresh++;
    const gAns = ansKeys(g);
    if (gAns.some(k => ansFirst.has(k) && ansFirst.get(k) < Y)) same++;
    // Example pairs: same work, earlier NET question, but a different answer (= a new angle).
    if (seenWorks.length && (g.works || []).length <= 2 && String(g.question).length < 600) {
      seenWorks.forEach(k => {
        const n = (workNet.get(k) || []).filter(x => qYear(x) < Y && (x.works || []).length <= 3 && String(x.question).length < 600 && !ansKeys(x).some(a => gAns.includes(a)))
          .sort((a, b) => (a.works || []).length - (b.works || []).length || qYear(b) - qYear(a))[0];
        if (!n) return;
        // Clearer pairs first: the work's title appears in both questions (or their answers).
        const mentions = q => ` ${words(q.question + ' ' + answerText(q)).join(' ')} `.includes(` ${k} `);
        const score = (g.works || []).length + (n.works || []).length - (mentions(n) ? 3 : 0) - (mentions(g) ? 3 : 0);
        examples.push({ work: (g.works || []).find(w => normTitle(w) === k) || k, net: n, gate: g, score });
      });
    }
  });
  const seen = new Set();
  const best = examples.sort((a, b) => a.score - b.score || qYear(b.gate) - qYear(a.gate))
    .filter(e => { const k = normTitle(e.work); if (seen.has(k) || seen.has(e.gate.id)) return false; seen.add(k); seen.add(e.gate.id); return true; });
  // Mix GATE years: take the best pair from each year in turn, newest year first.
  const byYear = new Map();
  best.forEach(e => { const y = qYear(e.gate); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(e); });
  const queues = [...byYear.keys()].sort((a, b) => b - a).map(y => byYear.get(y));
  const ex = [];
  while (queues.some(q => q.length)) queues.forEach(q => { if (q.length) ex.push(q.shift()); });
  const profile = list => {
    const n = list.length, c = f => list.filter(f).length;
    return {
      n,
      msq: pct(c(isMSQ), n),
      passage: pct(c(q => q.type === 'passage' || isQuoteQ(q)), n),
      match: pct(c(q => q.type === 'match'), n),
      chron: pct(c(q => q.type === 'chronology'), n),
      ar: pct(c(q => q.type === 'assertion-reason'), n),
      single: pct(c(q => !isMSQ(q) && !isNAT(q) && (q.type || 'MCQ') === 'MCQ' && !isQuoteQ(q)), n)
    };
  };
  const G = buildGuide();
  const areas = G.cats.filter(c => !c.overlay && c.auto !== 'unmatched').map(c => {
    const ids = new Set(c.qs.map(q => q.id));
    return { name: c.name, net: pct(net.filter(q => ids.has(q.id)).length, net.length), gate: pct(gate.filter(q => ids.has(q.id)).length, gate.length) };
  }).filter(a => a.net >= 2 || a.gate >= 2).sort((a, b) => b.gate - a.gate || b.net - a.net);
  const years = list => { const y = list.map(qYear); return y.length ? `${Math.min(...y)}–${Math.max(...y)}` : ''; };

  // Deep dive 1: the more often NET asked a work, the likelier GATE picks it up.
  const picked = new Map();                     // work → how many earlier NET questions it had when GATE used it
  gate.forEach(g => (g.works || []).forEach(w => {
    const k = normTitle(w), p = (workNet.get(k) || []).filter(q => qYear(q) < qYear(g)).length;
    if (p) picked.set(k, Math.max(picked.get(k) || 0, p));
  }));
  const BANDS = [['once', 1, 1], ['2–3 times', 2, 3], ['4–6 times', 4, 6], ['7 or more times', 7, 1e9]];
  const pickup = BANDS.map(([label, lo, hi]) => {
    const ws = [...workNet.entries()].filter(([, v]) => v.length >= lo && v.length <= hi);
    const hit = ws.filter(([k]) => picked.has(k)).length;
    return { label, works: ws.length, hit, rate: ws.length ? Math.round((hit / ws.length) * 1000) / 10 : 0 };
  });
  const titleOf = new Map();
  gate.forEach(g => (g.works || []).forEach(w => { const k = normTitle(w); if (!titleOf.has(k)) titleOf.set(k, w); }));
  const borrowed = [...picked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => ({ title: titleOf.get(k) || k, n }));

  // Deep dive 2: writer fame (NET's 25 most-asked writers) in each exam.
  const wc = new Map(), wName = new Map();
  net.forEach(q => (q.writers || []).forEach(w => { const k = normTitle(w); if (k) { wc.set(k, (wc.get(k) || 0) + 1); if (!wName.has(k)) wName.set(k, w); } }));
  const top25 = new Set([...wc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(e => e[0]));
  const famous = list => pct(list.filter(q => (q.writers || []).some(w => top25.has(normTitle(w)))).length, list.length);

  // Deep dive 3: question angle.
  const ANGLES = ['Group texts or writers by a feature', 'Which statements are true', 'Term or definition', 'Passage or quotation', 'Odd one out (NOT / except)', 'Match the following', 'Who wrote it', 'Character, plot or date', 'Chronology', 'Assertion–reason'];
  const angleOf = q => {
    const raw = String(q.question || ''), t = deaccent(raw).toLowerCase().replace(/\s+/g, ' ');
    if (q.type === 'match') return 'Match the following';
    if (q.type === 'chronology') return 'Chronology';
    if (q.type === 'assertion-reason') return 'Assertion–reason';
    if (q.type === 'passage' || /[“"‘][^”"’]{40,}/.test(raw)) return 'Passage or quotation';
    if (/\b(not|except|does not|do not|odd)\b/.test(t) && /which|identify/.test(t)) return 'Odd one out (NOT / except)';
    if (/statements?\(?s?\)? (is|are)|is\/are (true|correct)|(true|correct) (of|about)|proposes|advocated|argues|according to/.test(t)) return 'Which statements are true';
    if (/(what is common|which of the following|which among the following|which one of the following)[^?]*?\b(novels?|poems?|plays?|works?|texts?|writers?|poets?|critics?|thinkers?|theorists?|dramatists?|novelists?|narratives?|essays?)\b/.test(t) && !/who wrote|author of|written by/.test(t)) return 'Group texts or writers by a feature';
    if (/\b(who (wrote|is the author|authored)|author of|written by|which (writer|poet|novelist|dramatist|critic)\b)/.test(t)) return 'Who wrote it';
    if (/(_{3,}|example of|is called|is known as|\bterm\b|refers to|defin)/.test(t)) return 'Term or definition';
    if (/\b(character|narrator|protagonist|hero|heroine|speaker|published|first performed|edition)\b/.test(t)) return 'Character, plot or date';
    return null;
  };
  const angleShare = list => { const c = {}; list.forEach(q => { const a = angleOf(q); if (a) c[a] = (c[a] || 0) + 1; }); return c; };
  const aN = angleShare(net), aG = angleShare(gate);
  const angles = ANGLES.map(a => ({ name: a, net: pct(aN[a] || 0, net.length), gate: pct(aG[a] || 0, gate.length) }))
    .sort((x, y) => (y.gate - y.net) - (x.gate - x.net));

  // Deep dive 4: "soft launch" (answer was a wrong option in an earlier NET paper), GATE vs NET itself.
  const wrongFirst = new Map();
  net.forEach(q => {
    const right = new Set(ansKeys(q)), y = qYear(q);
    Object.values(q.options || {}).map(normTitle).filter(k => k.length > 3 && !right.has(k)).forEach(k => first(wrongFirst, k, y));
  });
  const softRate = list => pct(list.filter(q => ansKeys(q).some(k => wrongFirst.has(k) && wrongFirst.get(k) < qYear(q))).length, list.length);
  const netRecent = net.filter(q => qYear(q) >= 2022);

  // Deep dive 5: GATE re-asking a work from an earlier GATE paper.
  const gateFirst = new Map();
  gate.forEach(g => (g.works || []).forEach(w => first(gateFirst, normTitle(w), qYear(g))));
  const gateRepeat = pct(gate.filter(g => (g.works || []).some(w => gateFirst.get(normTitle(w)) < qYear(g))).length, gate.length);

  ECACHE = {
    net: profile(net), gate: profile(gate), gN: gate.length, nN: net.length, work, writer, fresh, same, ex, areas, gYears: years(gate), nYears: years(net),
    pickup, borrowed, famousNet: famous(net), famousGate: famous(gate), top25: [...top25].slice(0, 6).map(k => wName.get(k) || k), angles,
    softGate: softRate(gate), softNet: softRate(netRecent), gateRepeat
  };
  return ECACHE;
}
function exampleHTML(e) {
  const side = (q, label) => `
    <div class="ex-side">
      <div class="tags"><span class="tag src">${esc(label)} · ${esc(sourceTag(q))}</span></div>
      <div class="q">${esc(q.question)}</div>
      <div class="ans">Answer: <b>${esc(answerText(q))}</b></div>
    </div>`;
  return `<div class="ex-pair">
    <div class="ex-work">✦ ${esc(e.work)}</div>
    ${side(e.net, 'First in NET')}
    <div class="ex-arrow">↓ asked again, differently</div>
    ${side(e.gate, 'Then in GATE')}
  </div>`;
}
VIEWS.exam = () => {
  const E = examStats();
  if (!E.gN || !E.nN) return `<button class="chip back" data-act="tab" data-tab="guide">‹ Guide</button>
    <section class="card"><h2>Know your exam</h2><p class="muted">This fills in once both NET and GATE papers are in the bank.</p></section>`;
  const bar = (label, v) => `<div class="kx-row"><span>${label}</span><b>${v}%</b></div><div class="bar"><div style="width:${v}%"></div></div>`;
  const cmp = (label, a, b) => `<tr><td>${label}</td><td>${a}%</td><td>${b}%</td></tr>`;
  const shown = S.examShow || 3;
  return `
  <button class="chip back" data-act="tab" data-tab="guide">‹ Guide</button>
  <section class="card">
    <h2>Know your exam</h2>
    <p class="muted small">How NET and GATE English papers differ, counted from the ${plural(E.nN, 'NET question')} (${esc(E.nYears)}) and ${plural(E.gN, 'GATE question')} (${esc(E.gYears)}) in the bank. GATE's aptitude and reasoning sections are left out. These numbers update as papers are added.</p>
  </section>

  <section class="card">
    <h3>How GATE uses NET</h3>
    <p class="small muted">For each GATE question: had NET already asked about it in an earlier year?</p>
    ${bar('Same <i>work</i> NET had asked', pct(E.work, E.gN))}
    ${bar('Same <i>writer</i> NET had asked (different work)', pct(E.writer, E.gN))}
    ${bar('Completely new ground', pct(E.fresh, E.gN))}
    <p class="kx-key">But only <b>${pct(E.same, E.gN)}%</b> had the <b>same answer</b> as an earlier NET question. GATE reuses NET's texts and writers, then asks them from a new angle.</p>
  </section>

  <section class="card">
    <h3>Which NET works GATE picks</h3>
    <p class="small muted">The more often NET has asked a work, the likelier GATE asks it too. This is the strongest pattern in the bank.</p>
    <table class="kx-table">
      <tr><th style="text-align:left">NET asked the work</th><th>Works</th><th>GATE asked</th></tr>
      ${E.pickup.map(b => `<tr class="${b.rate >= 25 ? 'gate-more' : ''}"><td>${b.label}</td><td>${b.works}</td><td>${b.rate}%</td></tr>`).join('')}
    </table>
    ${E.borrowed.length ? `<span class="field-label">Most-asked NET works GATE has used</span>
    <div class="chips">${E.borrowed.map(b => `<button class="chip soft" data-act="pickTopic" data-v="${esc(b.title)}">${esc(b.title)} <span class="count">${b.n}× NET</span></button>`).join('')}</div>
    <p class="small muted" style="margin-top:8px">Tap a work to quiz on it.</p>` : ''}
    <p class="kx-key">Writer fame matters less than the work: NET's 25 most-asked writers (${esc(E.top25.join(', '))}…) appear in <b>${E.famousGate}%</b> of GATE questions and <b>${E.famousNet}%</b> of NET questions.</p>
  </section>

  <section class="card">
    <h3>How GATE changes the angle</h3>
    <p class="small muted">Same texts, different question styles. Sorted by how much more GATE uses each style.</p>
    <table class="kx-table">
      <tr><th></th><th>NET</th><th>GATE</th></tr>
      ${E.angles.map(a => `<tr class="${a.gate - a.net >= 4 ? 'gate-more' : a.net - a.gate >= 4 ? 'net-more' : ''}"><td>${esc(a.name)}</td><td>${a.net}%</td><td>${a.gate}%</td></tr>`).join('')}
    </table>
    <p class="small muted" style="margin-top:8px">“Group by a feature” means questions like “Which of these are epistolary novels?” or “…are set in Bombay?”. Sorting is automatic, so some questions fit no style and are left out.</p>
  </section>

  <section class="card">
    <h3>Preparing for GATE’s style</h3>
    <div class="kx-tip"><b>Learn texts by their features.</b> For each text, note its form (epistolary, verse novel, mock-epic), setting (Bombay, Calcutta, Wessex), technique (interior monologue, story within a story, unreliable narrator) and movement. GATE groups texts this way and asks “which of these are…”.</div>
    <div class="kx-tip"><b>Theory: understand, don’t memorise.</b> Know what each critic or theorist argues well enough to judge whether a statement about them is true. GATE asks “which statements are correct” far more than “who wrote it”.</div>
    <button class="btn ghost" data-act="openNotes" style="margin-top:12px">Open Short notes ›</button>
  </section>

  <section class="card">
    <h3>Repeats and “soft launch”</h3>
    ${bar('GATE re-asks a work from an earlier GATE paper', E.gateRepeat)}
    ${bar('GATE answer was a wrong option in an earlier NET paper', E.softGate)}
    ${bar('NET answer (2022 on) was a wrong option in an earlier NET paper', E.softNet)}
    <p class="kx-key">Soft launch (wrong options coming back as answers) is mainly a <b>NET</b> habit. For GATE, the better guide is how often NET has asked a work. Old GATE papers are worth revising too.</p>
  </section>

  <section class="card">
    <h3>How each exam asks</h3>
    <table class="kx-table">
      <tr><th></th><th>NET</th><th>GATE</th></tr>
      ${cmp('Multi-answer (MSQ)', E.net.msq, E.gate.msq)}
      ${cmp('Passage or quotation based', E.net.passage, E.gate.passage)}
      ${cmp('Match the following', E.net.match, E.gate.match)}
      ${cmp('Chronology', E.net.chron, E.gate.chron)}
      ${cmp('Assertion–reason', E.net.ar, E.gate.ar)}
      ${cmp('Plain single-answer MCQ', E.net.single, E.gate.single)}
    </table>
    <p class="small muted" style="margin-top:8px">A question can count in more than one row (for example, a passage-based MSQ).</p>
  </section>

  <section class="card">
    <h3>What each exam favours</h3>
    <p class="small muted">Share of each exam's questions, by Guide section.</p>
    <table class="kx-table">
      <tr><th></th><th>NET</th><th>GATE</th></tr>
      ${E.areas.map(a => `<tr class="${a.gate - a.net >= 5 ? 'gate-more' : a.net - a.gate >= 5 ? 'net-more' : ''}"><td>${esc(a.name)}</td><td>${a.net}%</td><td>${a.gate}%</td></tr>`).join('')}
    </table>
    <p class="small muted" style="margin-top:8px"><span class="kx-dot gate-more"></span> GATE asks this noticeably more · <span class="kx-dot net-more"></span> NET asks it more</p>
  </section>

  <section class="card">
    <h3>Same text, new angle</h3>
    <p class="small muted">Real pairs from the bank: NET asked about a work first, then GATE asked about the same work in a different way.</p>
    ${E.ex.length ? E.ex.slice(0, shown).map(exampleHTML).join('') : '<p class="muted small">Examples appear as more papers are added.</p>'}
    ${E.ex.length > shown ? `<button class="btn ghost" data-act="moreExamples">Show more examples (${E.ex.length - shown} left)</button>` : ''}
  </section>`;
};


/* ---------- Short notes ----------
   Lists are counted live from questions.json:
   • Study whole = works NET has asked 7+ times (hand-written notes live in guide.json → shortNotes)
   • Must-learn facts = works NET has asked 4–6 times (fact lines taken from the bank's own info bites)
   • 🎯 GATE radar = one of these works that GATE hasn't asked yet                                   */
let NCACHE = null;
function factClauses(qs, k, max) {
  const out = [], seen = new Set();
  qs.forEach(q => String(q.infoBite || '').split(/;\s+|\.\s+(?=[A-Z'‘“(])|\s+→\s+/).forEach(c => {
    c = c.trim().replace(/[.;]+$/, '');
    if (c.length < 30 || c.length > 230) return;
    if (/\b(was|were) (also )?asked\b|\basked (again|in)\b|\bre-exam\b|\bshift \d|\b(so|hence) [A-D]\b|\b[A-D] is (wrong|right|correct|true|false)\b|\boptions?\b/i.test(c)) return;   // notes about papers, not facts
    const n = ` ${words(c).join(' ')} `;
    if (!n.includes(` ${k} `) || seen.has(n)) return;
    // the clause must say more than just the title and a date
    const extra = words(c).filter(w => !k.split(' ').includes(w) && !/^\d+$/.test(w) && !STOP.has(w));
    if (extra.length < 3) return;
    seen.add(n); out.push({ c, score: (/\b1[0-9]{3}\b|\b20[0-2][0-9]\b/.test(c) ? 2 : 0) + Math.min(extra.length, 10) / 4 - Math.abs(c.length - 120) / 120 });
  }));
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max).map(x => x.c);
}
function notesData() {
  if (NCACHE) return NCACHE;
  const curated = (S.guide && S.guide.shortNotes) || {};
  const alias = new Map();                         // other title → main title key
  Object.entries(curated).forEach(([t, v]) => { alias.set(normTitle(t), normTitle(t)); (v.aka || []).forEach(a => alias.set(normTitle(a), normTitle(t))); });
  const noteOf = new Map(Object.entries(curated).map(([t, v]) => [normTitle(t), Object.assign({ title: t }, v)]));
  const fixes = new Map(Object.entries((S.guide && S.guide.writerFixes) || {}).map(([t, w]) => [normTitle(t), w]));   // hand corrections
  const W = new Map();
  const entry = k => { if (!W.has(k)) W.set(k, { k, titles: new Map(), qs: [], net: new Set(), gate: new Set(), writers: new Map() }); return W.get(k); };
  S.questions.forEach(q => {
    if (!isLitQ(q)) return;
    const ks = new Set((q.works || []).map(w => alias.get(normTitle(w)) || normTitle(w)).filter(Boolean));
    (q.works || []).forEach(w => { const k = alias.get(normTitle(w)) || normTitle(w); if (!k) return; const e = entry(k); e.titles.set(w, (e.titles.get(w) || 0) + 1); });
    ks.forEach(k => {
      const e = entry(k);
      e.qs.push(q);
      if (q.exam === 'NET') e.net.add(q.id);
      if (q.exam === 'GATE') e.gate.add(q.id);
      // a writer counts only when the question is about this one work and names one writer
      if ((q.writers || []).length === 1 && (q.works || []).length === 1) { const w = q.writers[0]; e.writers.set(w, (e.writers.get(w) || 0) + 1); }
      (q.writers || []).forEach(w => { e.cands = e.cands || new Map(); e.cands.set(w, (e.cands.get(w) || 0) + 1); });
    });
  });
  const top = m => [...m.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || '';
  // No single-writer question? Look for "Shelley's Adonais" or "Untouchable by Anand" in the bank's own text.
  const findWriter = e => {
    if (e.writers.size) return top(e.writers);
    // otherwise only accept a writer the bank itself pairs with the title (blank is better than wrong)
    const text = ' ' + e.qs.map(q => words(q.question + ' ' + (q.infoBite || '')).join(' ')).join(' | ') + ' ';
    let best = '', bestN = 0;
    (e.cands ? [...e.cands.keys()] : []).forEach(w => {
      const sur = words(w).filter(x => x.length > 2).pop(); if (!sur) return;
      const n = text.split(` ${sur} s ${e.k} `).length - 1 + text.split(` ${e.k} by ${sur} `).length - 1 + text.split(` ${e.k} by ${words(w).join(' ')} `).length - 1;
      if (n > bestN) { best = w; bestN = n; }
    });
    return best;
  };
  const all = [...W.values()].map(e => {
    const c = noteOf.get(e.k);
    return {
      k: e.k, title: c ? c.title : top(e.titles), writer: c ? c.writer : (fixes.get(e.k) || findWriter(e)), note: c ? c.note : '',
      rcOnly: e.qs.every(q => (q.topics || []).some(t => /comprehension/i.test(t))),
      net: e.net.size, gate: e.gate.size, radar: e.gate.size === 0, ids: e.qs.map(q => q.id), qs: e.qs
    };
  });
  const byNet = (a, b) => b.net - a.net || a.title.localeCompare(b.title);
  const whole = all.filter(x => x.net >= 7).sort(byNet);
  whole.forEach(x => { x.asked = factClauses(x.qs, x.k, 3); });
  // unseen comprehension poems with no named poet are not study material
  const facts = all.filter(x => x.net >= 4 && x.net <= 6 && !(x.rcOnly && !x.writer)).sort(byNet);
  facts.forEach(x => { x.fact = factClauses(x.qs, x.k, 1)[0] || ''; });
  NCACHE = { whole, facts };
  return NCACHE;
}
const radarTag = x => x.radar ? '<span class="pill nr-radar">🎯 Not yet in GATE</span>' : '';
const countTags = x => `<span class="pill Low">NET ${x.net}×</span><span class="pill Low">GATE ${x.gate}×</span>`;
VIEWS.notes = () => {
  const N = notesData(), only = !!S.notesRadar, tab = S.notesTab === 'facts' ? 'facts' : 'whole';
  const whole = N.whole.filter(x => !only || x.radar), facts = N.facts.filter(x => !only || x.radar);
  return `
  <button class="chip back" data-act="tab" data-tab="guide">‹ Guide</button>
  <section class="card">
    <h2>Short notes</h2>
    <p class="muted small">Built from the papers in the bank, so the lists update as new papers are added. Patterns from past papers show what to study first; they are not guarantees.</p>
    <div class="chips" style="margin-top:10px">
      <button class="chip ${only ? '' : 'on'}" data-act="notesFilter" data-v="all">All works</button>
      <button class="chip ${only ? 'on' : ''}" data-act="notesFilter" data-v="radar">🎯 GATE radar only</button>
    </div>
    <p class="small muted" style="margin-top:8px">🎯 GATE radar = asked often in NET, not yet in GATE. Works NET asked 7+ times were later picked by GATE about half the time.</p>
    <div class="seg" style="margin-top:12px">
      <button class="${tab === 'whole' ? 'on' : ''}" data-act="notesTab" data-v="whole">Study whole · ${whole.length}</button>
      <button class="${tab === 'facts' ? 'on' : ''}" data-act="notesTab" data-v="facts">Must-learn facts · ${facts.length}</button>
    </div>
  </section>
  ${tab === 'whole' ? `
  <section class="card">
    <h3>Study whole <span class="muted small">· NET asked 7+ times · ${whole.length}</span></h3>
    <p class="small muted">Read these properly: story or argument, characters, key lines, and the ideas critics attach to them.</p>
  </section>
  ${whole.map(x => `
  <article class="card nr-card">
    <div class="nr-title">${esc(x.title)}</div>
    ${x.writer ? `<div class="nr-writer">${esc(x.writer)}</div>` : ''}
    <div class="chips nr-tags">${countTags(x)}${radarTag(x)}</div>
    ${x.note ? `<p class="nr-note">${esc(x.note)}</p>` : ''}
    ${x.asked && x.asked.length ? `<details class="nr-asked"><summary>What NET/GATE asked</summary><ul>${x.asked.map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>` : ''}
    <button class="chip" data-act="quizWork" data-k="${esc(x.k)}">Quiz me on this · ${x.ids.length}</button>
  </article>`).join('') || '<section class="card"><p class="muted small">Nothing here yet.</p></section>'}` : `

  <section class="card">
    <h3>Must-learn facts <span class="muted small">· NET asked 4–6 times · ${facts.length}</span></h3>
    <p class="small muted">Know the author, date, form and movement, plus the fact below (taken from what was actually asked). Tap a row to quiz on it.</p>
    <div class="list">${facts.map(x => `
      <button class="row nr-fact" data-act="quizWork" data-k="${esc(x.k)}">
        <span class="grow">
          <span class="name">${esc(x.title)}</span>${x.writer ? ` <span class="sub">— ${esc(x.writer)}</span>` : ''}<br>
          ${x.fact ? `<span class="nr-fact-line">${esc(x.fact)}</span><br>` : ''}
          <span class="sub">NET ${x.net}× · GATE ${x.gate}×</span>${x.radar ? ' <span class="nr-radar-dot">🎯</span>' : ''}
        </span><span class="chev">›</span>
      </button>`).join('') || '<p class="muted small">Nothing here yet.</p>'}</div>
  </section>`}`;
};

/* ---------- Stats ---------- */
function groupStat(t) {
  let a = 0, c = 0, seen = 0;
  t.qs.forEach(q => { const x = S.prog.attempts[q.id]; if (x) { a += x.a; c += x.c; seen++; } });
  return { t, a, c, seen, acc: a ? c / a : 0 };
}
const byWeakest = (x, y) => x.acc - y.acc || y.a - x.a;
function statRow(s, showCat) {
  const t = s.t;
  return `<button class="row" data-act="statTopic" data-id="${esc(t.id)}">
    <span class="grow">
      ${showCat && t.cat ? `<span class="sub">${esc(t.cat.name)} ›</span><br>` : ''}
      <span class="name">${esc(t.name)}</span>
      <div class="bar"><div style="width:${Math.round(s.acc * 100)}%"></div></div>
      <span class="sub">${Math.round(s.acc * 100)}% · ${s.a} attempted · ${s.c} ✓ · ${s.a - s.c} ✕</span><br>
      <span class="sub">Done ${s.seen} of ${t.qs.length} questions</span>
    </span><span class="chev">›</span></button>`;
}
VIEWS.stats = () => {
  let a = 0, c = 0;
  Object.values(S.prog.attempts).forEach(x => { a += x.a; c += x.c; });
  const G = buildGuide(), hist = S.prog.history.slice(0, 6);
  const secs = G.cats.map(groupStat).filter(s => s.a).sort(byWeakest);
  const subs = G.allSubs.map(groupStat).filter(s => s.a).sort(byWeakest);
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
    <h3>By section — weakest first</h3>
    ${secs.length ? `<div class="list">${secs.map(s => statRow(s)).join('')}</div>` : '<p class="muted small">Answer a few questions and your section stats appear here.</p>'}
  </section>
  ${subs.length ? `<section class="card">
    <h3>By topic — weakest first</h3>
    <div class="list">${subs.map(s => statRow(s, true)).join('')}</div>
    <p class="small muted" style="margin-top:8px">Tap any row to quiz that topic.</p>
  </section>` : ''}
  ${hist.length ? `<section class="card"><h3>Recent quizzes</h3><div class="list">${hist.map(h => `
    <div class="row"><span class="grow"><span class="name">${esc(h.title || 'Quiz')}</span><br><span class="sub">${new Date(h.date).toLocaleDateString()} · ${fmtTime(h.ms)}</span></span><span class="pill Medium">${h.score}/${h.total}</span></div>`).join('')}</div></section>` : ''}`;
};

/* ---------- More ---------- */
VIEWS.more = () => {
  const g = ghSettings(), admin = isAdmin();
  const unver = S.questions.filter(q => q.verified === false).length;
  return `
  <section class="card">
    <h2>Appearance</h2>
    <label class="switch-row"><span>Night mode</span><input type="checkbox" class="switch" data-change="theme" ${isDark() ? 'checked' : ''}></label>
  </section>

  <section class="card">
    <h2>Backup</h2>
    <p class="muted small">Your mistakes, bookmarks, stats, revision schedule, syllabus ticks and plan are saved only on this device. Export a backup now and then, and import it on a new phone.</p>
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
      <label class="field-label" for="report-email">Mistake reports go to</label>
      <div class="pl-target-row"><input type="email" id="report-email" value="${esc(reportEmail())}" autocomplete="email" inputmode="email"><button class="btn" data-act="saveReportEmail" id="report-email-btn" style="width:auto;padding:0 18px">Save</button></div>
      <p class="small muted">Changes it for everyone's app, within 1–2 minutes.</p>
      <div class="btn-row">
        <button class="btn" data-act="adminList">Manage questions</button>
        <button class="btn ghost" data-act="adminAdd">Add question</button>
        <button class="btn ghost" data-act="adminBulk">Paste a whole paper</button>
      </div>
      ${unver ? `<p class="small" style="margin-top:10px"><button class="chip" data-act="adminUnverified">⚠ ${plural(unver, 'question')} still unverified ›</button></p>` : ''}
      ${CONFIG.goatcounter ? `<p class="small muted" style="margin-top:10px">Visitors: <a href="https://${esc(CONFIG.goatcounter)}.goatcounter.com" target="_blank" rel="noopener">${esc(CONFIG.goatcounter)}.goatcounter.com</a> · your own visits on this device are not counted.</p>` : ''}
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

/* ---------- Admin: Manage questions ---------- */
function adminPool(key) {
  const Q = S.questions;
  switch (key) {
    case 'unverified': return Q.filter(q => q.verified === false);
    case 'pyq': return Q.filter(isPYQ);
    case 'probable': return Q.filter(q => q.exam === 'Probable');
    case 'abrams': return Q.filter(isAbrams);
    default: return Q;
  }
}
function adminListHTML() {
  const toks = queryTokens(S.adminQuery), raw = S.adminQuery.trim().toLowerCase();
  let list = adminPool(S.adminFilter);
  if (raw) list = list.filter(q => q.id.toLowerCase().includes(raw) || (toks.length && matchesQuery(q, toks)));
  const shown = list.slice().reverse().slice(0, S.adminShow);
  if (!shown.length) return `<p class="muted">${S.adminFilter === 'unverified' && !raw ? 'No unverified questions left ✿' : 'No questions match.'}</p>`;
  return `<p class="small muted">Showing ${shown.length} of ${list.length} (newest first)</p>` + shown.map(q => `
    <div class="wrong-item">
      <div class="tags">
        <span class="tag src">${esc(sourceTag(q))}</span><span class="tag">${esc(q.id)}</span>
        ${q.verified === false ? '<span class="tag warn">Unverified</span>' : ''}
      </div>
      <div class="q">${esc(q.question)}</div>
      <div class="ans">Answer: <b>${esc(answerText(q))}</b></div>
      ${q.note ? `<p class="small ${q.verified === false ? 'warn-text' : 'muted'}" style="margin:6px 0 0">Note: ${esc(q.note)}</p>` : ''}
      <div class="btn-row" style="margin-top:8px">
        <button class="chip" data-act="editQ" data-id="${esc(q.id)}">✎ Edit</button>
        ${q.verified === false
          ? `<button class="chip" data-act="verifyQ" data-id="${esc(q.id)}">✓ Mark verified</button>`
          : '<span class="small muted" style="align-self:center">✓ Verified</span>'}
      </div>
    </div>`).join('') + (list.length > shown.length
    ? `<button class="btn ghost" data-act="adminMore" style="margin-top:12px">Show ${Math.min(ADMIN_PAGE, list.length - shown.length)} more</button>` : '');
}
VIEWS.adminList = () => `
  <button class="chip back" data-act="tab" data-tab="more">‹ Back</button>
  <section class="card">
    <h2>Manage questions</h2>
    <div class="search"><input type="search" data-in="adminQuery" value="${esc(S.adminQuery)}" placeholder="ID, words, writer, work or source (GATE 2023)…" autocomplete="off"></div>
    <div class="chips" style="margin-top:12px">${ADMIN_FILTERS.map(([k, l]) => `<button class="chip ${S.adminFilter === k ? 'on' : ''}" data-act="adminFilter" data-v="${k}">${l} <span class="count">${adminPool(k).length}</span></button>`).join('')}</div>
    <p class="small muted" style="margin-top:10px">Delete is inside ✎ Edit, at the bottom of the form.</p>
    <div class="btn-row"><button class="btn ghost" data-act="adminAdd">Add a new question</button><button class="btn ghost" data-act="adminBulk">Paste a whole paper</button></div>
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
    ${txt('f-topics', 'Topic tags (broad → narrow, commas)', (q.topics || []).join(', '), 'British, Victorian, Novel  (start with the section)')}
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
      <button class="btn" data-act="sendReport" data-via="mail" data-id="${esc(q.id)}">Send by email</button>
    </div>
    <button class="btn text" data-act="closeModal">Cancel</button>
  </div>`;
  m.hidden = false;
}
const closeModal = () => { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; };

/* ---------- Mark verified modal (admin) ---------- */
function openVerify(id) {
  const q = byId(id); if (!q) return;
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Mark verified">
    <h3>Mark as verified</h3>
    <p class="small muted">${esc(q.id)} · ${esc(sourceTag(q))}</p>
    <p class="small">Answer: <b>${esc(answerText(q))}</b></p>
    <label class="field-label" for="verify-note">Note (optional — edit or clear the old one)</label>
    <textarea id="verify-note" rows="3" placeholder="e.g. Checked with NTA final key">${esc(q.note || '')}</textarea>
    <p class="small muted">If the answer itself is wrong, cancel and use ✎ Edit instead.</p>
    <div class="btn-row">
      <button class="btn" data-act="confirmVerify" data-id="${esc(q.id)}" id="verify-btn">✓ Mark verified</button>
      <button class="btn ghost" data-act="closeModal">Cancel</button>
    </div>
  </div>`;
  m.hidden = false;
}

/* =========================================================
   SYLLABUS TRACKER & MY PLAN  (data: syllabus.json)
   Every topic is listed once and linked to the GATE and NET sections
   it belongs to, so ticking it once fills in both exams.
   "Learnt" is what counts as done. "Quizzed" is only for your own awareness.
   Weightage is estimated from the PYQs in questions.json.
   Everything is saved on this device, inside the normal backup.
   ========================================================= */
const parseDay = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const dayDiff = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);      // b − a, in days
const shiftDay = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return todayStr(d); };
const fmtDay = (s, opt) => parseDay(s).toLocaleDateString(undefined, opt || { day: 'numeric', month: 'short', year: 'numeric' });
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const mondayOf = s => shiftDay(s, -((parseDay(s).getDay() + 6) % 7));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const EXAMS = [['gate', 'GATE'], ['net', 'NET']];
const EXAM_KEY = { gate: 'GATE', net: 'NET' };
const shortName = t => t.name.split(':')[0].trim();
const topicDesc = t => t.name.includes(':') ? t.name.slice(t.name.indexOf(':') + 1).trim() : '';

function sylP() {
  const p = S.prog;
  if (!p.syl) p.syl = {};
  if (!p.sylCustom) p.sylCustom = [];
  if (!p.plan) p.plan = {};
  if (!p.plan.days) p.plan.days = {};
  if (!p.plan.months) p.plan.months = {};
  if (!p.plan.start) p.plan.start = todayStr();          // pace is counted from the first day you open the tracker
  if (!p.sylUI) p.sylUI = { progress: true, weight: true, sort: false };
  return p;
}
const sylExams = () => (S.syllabus && S.syllabus.exams) || {};
function sylTopics() {
  const base = (S.syllabus && S.syllabus.topics) || [];
  return base.concat(sylP().sylCustom.map(c => Object.assign({ group: 'My own topics', custom: true }, c)));
}
const topicById = id => sylTopics().find(t => t.id === id);
const sylSections = ex => (sylExams()[ex] ? sylExams()[ex].parts : []).flatMap(p => p.sections.map(s => Object.assign({ part: p, exam: ex }, s)));
const sectionById = id => { for (const [ex] of EXAMS) { const s = sylSections(ex).find(x => x.id === id); if (s) return s; } return null; };
const manualLearnt = t => !!(sylP().syl[t.id] && sylP().syl[t.id].l);
// A topic also counts as done (without ticking Learnt) once every one of its questions has been attempted.
let QDCACHE = { key: '', map: new Map() };
function quizDone(t) {
  const key = `${S.questions.length}:${Object.keys(S.prog.attempts).length}`;
  if (QDCACHE.key !== key) QDCACHE = { key, map: new Map() };
  if (QDCACHE.map.has(t.id)) return QDCACHE.map.get(t.id);
  const qs = topicQs(t);
  let res = null;
  if (qs.length && qs.every(q => S.prog.attempts[q.id])) res = qs.reduce((m, q) => { const d = S.prog.attempts[q.id].last || ''; return d > m ? d : m; }, '') || todayStr();
  QDCACHE.map.set(t.id, res);
  return res;
}
const learnt = t => manualLearnt(t) || !!quizDone(t);
// The day a topic became done: the Learnt tick's day, otherwise the day its last question was attempted.
const doneDate = t => { const r = sylP().syl[t.id]; return (r && r.l) || quizDone(t) || ''; };
const quizzed = t => !!(sylP().syl[t.id] && sylP().syl[t.id].q);
const topicsIn = sid => sylTopics().filter(t => (t.gate || []).includes(sid) || (t.net || []).includes(sid));
const examTopics = ex => sylTopics().filter(t => (t[ex] || []).length);
function scopeTopics(scope) {
  if (scope === 'gate' || scope === 'net') return examTopics(scope);
  return sylTopics().filter(t => (t.gate || []).length || (t.net || []).length);
}
// How much of a topic is covered: 100% once done, otherwise the share of its questions attempted.
function topicFrac(t) {
  if (learnt(t)) return 1;
  const qs = topicQs(t); if (!qs.length) return 0;
  // A question counts in full once attempted; otherwise by the share of its writers (or works) you have covered.
  const C = covIndex(), W = topicWriters(t);
  const wOn = w => { const g = W.byVariant.get(norm(w)); return g ? g.names.some(n => C.writers.has(norm(n))) : C.writers.has(norm(w)); };
  return qs.reduce((sum, q) => {
    if (S.prog.attempts[q.id]) return sum + 1;
    const ws = q.writers || [], wk = q.works || [];
    const a = ws.length ? ws.filter(wOn).length / ws.length : 0;
    const b = wk.length ? wk.filter(x => C.works.has(norm(x))).length / wk.length : 0;
    return sum + Math.max(a, b);
  }, 0) / qs.length;
}
// Writers and works you have covered (Quick log or the writer ticks in Syllabus), in any topic.
const COV_EMPTY = {};
let COVC = { ref: null, ver: -1 }, COVVER = 0;
function covIndex() {
  const c = S.prog.covered || COV_EMPTY;
  if (COVC.ref === c && COVC.ver === COVVER) return COVC;
  const writers = new Set(), works = new Set();
  Object.values(c).forEach(l => (l || []).forEach(x => { if (x.k === 'writer') writers.add(norm(x.n)); else if (x.k === 'work') works.add(norm(x.n)); }));
  COVC = { ref: c, ver: COVVER, writers, works };
  return COVC;
}
// The writers asked in a topic's PYQs, most asked first. The same person spelt with and
// without initials ("Edward Said", "Edward W. Said") is listed once.
let TWCACHE = { key: '', map: new Map() };
function topicWriters(t) {
  const key = `${S.questions.length}:${S.syllabus ? S.syllabus.updated : ''}`;
  if (TWCACHE.key !== key) TWCACHE = { key, map: new Map() };
  if (TWCACHE.map.has(t.id)) return TWCACHE.map.get(t.id);
  const raw = new Map();
  const H = writerHomes(), wk = n => words(n).filter(x => x.length > 1).join(' ');
  const only = new Set((t.onlyWriters || []).map(wk)), except = new Set((t.exceptWriters || []).map(wk));
  const okW = n => (!only.size || only.has(wk(n))) && !except.has(wk(n));
  // Only writers whose home is this topic: a writer merely mentioned here (a wrong option,
  // a chronology across ages) is listed under their own topic instead.
  topicQs(t).filter(isPYQ).forEach(q => [...new Set(q.writers || [])].forEach(w => { const n = String(w).trim(); if (n && (H.get(norm(n)) || new Set()).has(t.id) && okW(n)) raw.set(n, (raw.get(n) || 0) + 1); }));
  const groups = [];
  [...raw.entries()].sort((a, b) => b[1] - a[1]).forEach(([n, c]) => {
    const full = words(n), key2 = full.filter(x => x.length > 1).join(' ');
    const g = groups.find(x => x.key === key2 && x.names.some(m => { const f = words(m); return f.every(y => full.includes(y)) || full.every(y => f.includes(y)); }));
    if (g) { g.names.push(n); g.n += c; } else groups.push({ key: key2, name: n, names: [n], n: c });
  });
  groups.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const byVariant = new Map(); groups.forEach(g => g.names.forEach(n => byVariant.set(norm(n), g)));
  const res = { groups, byVariant };
  TWCACHE.map.set(t.id, res);
  return res;
}
// Each writer's home topic(s):
// • a writer the syllabus names in a topic ("Romantic poetry: Wordsworth, Coleridge…", "Shakespeare: …")
//   lives in the topic(s) that name them;
// • anyone else lives where most of their PYQs sit, plus any topic with at least half as many.
// A writer merely mentioned in another topic's question (a wrong option, a chronology) is not listed there.
let WHCACHE = { key: '', map: null };
function writerHomes() {
  const key = `${S.questions.length}:${S.syllabus ? S.syllabus.updated : ''}:${sylTopics().length}`;
  if (WHCACHE.key === key) return WHCACHE.map;
  const per = new Map(), total = new Map();
  sylTopics().forEach(t => {
    topicQs(t).filter(isPYQ).forEach(q => [...new Set(q.writers || [])].forEach(w => {
      const k = norm(w); if (!per.has(k)) per.set(k, new Map());
      const m = per.get(k); m.set(t.id, (m.get(t.id) || 0) + 1);
    }));
  });
  S.questions.filter(isPYQ).forEach(q => (q.writers || []).forEach(w => { const k = norm(w); total.set(k, (total.get(k) || 0) + 1); }));
  // For a surname listed alone ("Shelley", "Eliot"), the most-asked writer with that surname.
  const bestBy = new Map();
  [...total.entries()].sort((x, y) => y[1] - x[1]).forEach(([k]) => words(k).forEach(x => { if (x.length > 1 && !bestBy.has(x)) bestBy.set(x, k); }));
  const fits = (ws, k) => {
    const kw = words(k);
    if (ws.length === 1) {
      const x = ws[0];
      if (kw.includes(x)) return bestBy.get(x) === k;
      return x.length > 3 && x.endsWith('s') && kw.includes(x.slice(0, -1));     // "the Brontës" = all the Brontës
    }
    return ws.every(x => kw.includes(x));
  };
  const lists = sylTopics().map(t => ({ id: t.id, items: [shortName(t), topicDesc(t)].join(',').split(/,|&|\band\b|:/)
    .map(x => words(x).filter(y => y.length > 1 && !STOP.has(y))).filter(x => x.length && x.length <= 3),
    only: (t.onlyWriters || []).map(norm), except: new Set((t.exceptWriters || []).map(norm)) }));
  const map = new Map();
  per.forEach((m, k) => {
    const named = lists.filter(L => m.has(L.id) && !L.except.has(k) && L.items.some(ws => fits(ws, k))).map(L => L.id);
    let home;
    if (named.length) home = new Set(named);
    else {
      const max = Math.max(...m.values());
      home = new Set([...m.entries()].filter(([, c]) => c === max || (c >= 0.5 * max && c >= 3)).map(([id]) => id));
    }
    map.set(k, home);
  });
  WHCACHE = { key, map };
  return map;
}
const writerOn = g => { const C = covIndex(); return g.names.some(n => C.writers.has(norm(n))); };
function writersHTMLFor(t) {
  const W = topicWriters(t); if (!W.groups.length) return '';
  const tiers = [['often', 'Asked often · 3+ PYQs', g => g.n >= 3], ['twice', 'Asked twice', g => g.n === 2], ['once', 'Asked once', g => g.n === 1]];
  const done = W.groups.filter(writerOn).length;
  return `<div class="sy-writers">
    <div class="sy-w-head">Writers asked · ${done} of ${W.groups.length} covered</div>
    ${tiers.map(([cls, label, f]) => { const gs = W.groups.filter(f); return gs.length ? `<div class="sy-w-line ${cls}"><span class="sy-w-lbl">${label}</span>
      ${gs.map(g => { const on = writerOn(g); return `<button class="sy-w ${cls} ${on ? 'on' : ''}" data-act="sylWriter" data-id="${esc(t.id)}" data-n="${esc(g.name)}" aria-pressed="${on}">${on ? '✓ ' : ''}${esc(g.name)} <span>${g.n}</span></button>`; }).join('')}</div>` : ''; }).join('')}
    <p class="small muted sy-w-note">Tap a writer once you've covered them. The bar fills by their share of this topic's PYQs.</p>
  </div>`;
}
function progOf(list) {
  const n = list.length, l = list.filter(learnt).length, q = list.filter(quizzed).length;
  const cov = n ? list.reduce((s, t) => s + topicFrac(t), 0) / n : 0;
  const pct = Math.round(cov * 100);
  return { n, l, q, pct: pct === 100 && l < n ? 99 : pct === 0 && cov > 0 ? 1 : pct };
}
const examDate = ex => { const pl = sylP().plan; return isDay(pl[ex + 'Date']) ? pl[ex + 'Date'] : ((sylExams()[ex] || {}).date || ''); };
const daysTo = d => isDay(d) ? dayDiff(todayStr(), d) : null;
function setLearnt(id, on) {
  const p = sylP(), r = p.syl[id] || (p.syl[id] = {});
  if (on) r.l = r.l || todayStr(); else { delete r.l; delete r.pre; }
  if (!r.l && !r.q) delete p.syl[id];
}
function setQuizzed(id, on) {
  const p = sylP(), r = p.syl[id] || (p.syl[id] = {});
  if (on) r.q = r.q || todayStr(); else delete r.q;
  if (!r.l && !r.q) delete p.syl[id];
}

/* ---------- Questions behind each topic (for counts, weightage and quizzes) ---------- */
let TQCACHE = { key: '', map: new Map() };
function topicQs(t) {
  const key = `${S.questions.length}`;
  if (TQCACHE.key !== key) TQCACHE = { key, map: new Map() };
  if (TQCACHE.map.has(t.id)) return TQCACHE.map.get(t.id);
  let qs = [];
  if (t.guide) { const g = gNode(t.guide); if (g) qs = g.qs; }
  if (!qs.length && t.q) { const toks = queryTokens(t.q); if (toks.length) qs = S.questions.filter(q => matchesQuery(q, toks)); }
  // A topic with only a writer list takes every question on those writers.
  if (!qs.length && !t.guide && !t.q && (t.onlyWriters || []).length) { const set = new Set(t.onlyWriters.map(n => words(n).filter(x => x.length > 1).join(' '))); qs = S.questions.filter(q => (q.writers || []).some(w => set.has(words(w).filter(x => x.length > 1).join(' ')))); }
  // e.g. "Indian English novel after 1980" keeps only questions on post-1980 novelists,
  // and "to 1980" drops questions that are only about them.
  const wkey = n => words(n).filter(x => x.length > 1).join(' ');
  const hasW = (q, set) => (q.writers || []).filter(w => set.has(wkey(w)));
  if ((t.onlyWriters || []).length) { const set = new Set(t.onlyWriters.map(wkey)); qs = qs.filter(q => hasW(q, set).length); }
  if ((t.exceptWriters || []).length) { const set = new Set(t.exceptWriters.map(wkey)); qs = qs.filter(q => !(q.writers || []).length || hasW(q, set).length < q.writers.length); }
  // …and by work: a question tagged with works is kept only if one of them is on the topic's list.
  if ((t.onlyWorks || []).length) {
    const list = t.onlyWorks.map(normTitle).filter(Boolean);
    const fits = w => { const k = normTitle(w); return list.some(x => k === x || k.startsWith(x + ' ') || x.startsWith(k + ' ') || k.endsWith(' ' + x)); };
    qs = qs.filter(q => !(q.works || []).length || q.works.some(fits));
  }
  TQCACHE.map.set(t.id, qs);
  return qs;
}
const topicExamCount = (t, ex) => topicQs(t).filter(q => q.exam === EXAM_KEY[ex]).length;
// Estimated marks: each PYQ of the exam is shared equally among the sections its topics belong to,
// then each part's official marks are split in proportion.
let WTCACHE = {};
function examWeights(ex) {
  const key = `${ex}:${S.questions.length}:${sylP().sylCustom.length}`;
  if (WTCACHE[key]) return WTCACHE[key];
  const E = sylExams()[ex], res = {}; let used = 0;
  (E ? E.parts : []).forEach(p => {
    const qSecs = new Map();
    p.sections.forEach(s => topicsIn(s.id).forEach(t => topicQs(t).forEach(q => {
      if (q.exam !== EXAM_KEY[ex]) return;
      if (!qSecs.has(q.id)) qSecs.set(q.id, new Set());
      qSecs.get(q.id).add(s.id);
    })));
    const total = qSecs.size, share = {};
    used += total;
    qSecs.forEach(set => set.forEach(sid => { share[sid] = (share[sid] || 0) + 1 / set.size; }));
    p.sections.forEach(s => {
      const n = [...qSecs.values()].filter(x => x.has(s.id)).length;
      res[s.id] = { n, marks: total && n ? ((share[s.id] || 0) / total) * p.marks : null };
    });
  });
  WTCACHE = { [key]: Object.assign(res, { _used: used }) };
  return WTCACHE[key];
}
const fmtMarks = m => m == null ? null : (m >= 10 ? Math.round(m) : Math.round(m * 10) / 10);
function sectionIds(s) { const ids = new Set(); topicsIn(s.id).forEach(t => topicQs(t).forEach(q => ids.add(q.id))); return [...ids]; }

/* ---------- Syllabus tab ---------- */
const segBar = (list, cls) => `<span class="sy-seg ${cls || ''}">${list.map(t => `<i style="--f:${Math.round(topicFrac(t) * 100)}%"></i>`).join('')}</span>`;
function nodeHTML(t, ex) {
  const L = learnt(t), M = manualLearnt(t), QD = quizDone(t), Q = quizzed(t), r = sylP().syl[t.id] || {}, desc = topicDesc(t);
  const cnt = topicExamCount(t, ex), qs = topicQs(t);
  let stat = null;
  if (qs.length) { let a = 0, c = 0, seen = 0; qs.forEach(q => { const x = S.prog.attempts[q.id]; if (x) { a += x.a; c += x.c; seen++; } }); if (a) stat = { acc: Math.round((c / a) * 100), seen, n: qs.length }; }
  const FR = topicFrac(t);
  const status = M ? (r.pre ? 'Learnt before today (Quick log)' : `Learnt ${esc(fmtDay(r.l, { day: 'numeric', month: 'short' }))}`) : QD ? `Done: every question attempted (${esc(fmtDay(QD, { day: 'numeric', month: 'short' }))})` : stat || FR > 0 ? `In progress · ${Math.round(FR * 100)}%` : 'Not started';
  return `<li class="sy-node ${L ? 'is-learnt' : ''}" id="t-${esc(t.id)}">
    <div class="sy-node-name">${esc(shortName(t))} <span class="cnt" title="${EXAM_KEY[ex]} PYQs">(${cnt} ${EXAM_KEY[ex]})</span></div>
    ${desc ? `<div class="sy-node-desc clamp">${esc(desc)}</div>${desc.length > 46 ? '<button class="sy-more" data-act="sylMore">Show more</button>' : ''}` : ''}
    ${(() => { const TW = topicWriters(t), cv = ((sylP().covered || {})[t.id] || []).filter(x => x.k !== 'topic' && !(x.k === 'writer' && TW.byVariant.has(norm(x.n)))); return cv.length ? `<div class="sy-node-cov">✓ Covered: ${esc(cv.map(x => x.n).join(', '))}</div>` : ''; })()}
    <div class="sy-node-status">
      <span class="sy-mini"><i style="width:${Math.round(topicFrac(t) * 100)}%"></i></span>
      <span class="st">${status}${Q ? ' · quizzed' : ''}${stat && !QD ? ` · ${stat.seen} of ${stat.n} questions attempted, ${stat.acc}% right` : stat ? ` · ${stat.acc}% right` : ''}</span>
      ${qs.length ? `<button class="sy-link-u" data-act="sylQuiz" data-id="${esc(t.id)}">Quiz</button>` : ''}
    </div>
    <div class="sy-node-ticks">
      <button class="sy-tick ${M ? 'on' : ''}" data-act="sylLearnt" data-id="${esc(t.id)}" aria-pressed="${M}"><span class="box">${M ? '✓' : ''}</span>Learnt</button>
      <button class="sy-tick q ${Q ? 'on' : ''}" data-act="sylQuizzed" data-id="${esc(t.id)}" aria-pressed="${Q}"><span class="box">${Q ? '✓' : ''}</span>Quizzed</button>
      <button class="sy-link-u" data-act="planTopic" data-id="${esc(t.id)}">＋ Plan</button>
      ${t.custom ? `<button class="sy-link-u" data-act="sylDelCustom" data-id="${esc(t.id)}">Delete</button>` : ''}
    </div>
    ${writersHTMLFor(t)}
  </li>`;
}
function sectionCard(s, ui, W) {
  const ts = topicsIn(s.id), pr = progOf(ts), w = W[s.id] || {}, marks = fmtMarks(w.marks);
  const outOf = s.exam === 'gate' ? 100 : s.part.marks, open = !!(S.sylOpen && S.sylOpen[s.id]);
  return `<article class="sy-card ${open ? 'open' : ''}" id="sec-${esc(s.id)}">
    <button class="sy-card-head" data-act="sylToggle" data-id="${esc(s.id)}" aria-expanded="${open}">
      <span class="sy-card-part">${esc(s.part.name)}</span>
      <span class="sy-card-title">${esc(s.name)}</span>
      <span class="sy-chev" aria-hidden="true">${open ? '▴' : '▾'}</span>
    </button>
    <div class="sy-card-pills">
      ${ui.weight ? (marks != null ? `<span class="sy-marks">~${marks} / ${outOf} marks</span>` : `<span class="sy-marks soft">No PYQs yet</span>`) : ''}
      ${w.n ? `<button class="sy-outline" data-act="sylQuizSec" data-id="${esc(s.id)}">Quiz section →</button>` : ''}
    </div>
    ${ui.progress ? `<div class="sy-card-prog"><span class="sy-fill"><i style="width:${pr.pct}%"></i></span><span>${pr.pct}% covered · ${pr.l}/${pr.n} done</span></div>` : ''}
    ${open ? `${s.about ? `<p class="sy-about clamp">${esc(s.about)}</p><button class="sy-more" data-act="sylMore">Show more</button>` : ''}
    <ul class="sy-tree">${ts.map(t => nodeHTML(t, s.exam)).join('') || '<li class="sy-node"><span class="muted small">No topics yet</span></li>'}</ul>`
    : `<button class="sy-expand" data-act="sylToggle" data-id="${esc(s.id)}">Show ${plural(ts.length, 'subtopic')} ▾</button>`}
  </article>`;
}
function examHead(ex, ui, compact) {
  const E = sylExams()[ex]; if (!E) return '';
  const W = examWeights(ex), all = progOf(examTopics(ex)), d = daysTo(examDate(ex));
  return `<div class="sy-col-head ${ex}">
      <div class="sy-col-name">${esc(E.name)}</div>
      ${ui.progress ? `<span class="sy-fill"><i style="width:${all.pct}%"></i></span>` : ''}
      <div class="small">${all.pct}% covered · ${all.l}/${all.n} done${d != null && d >= 0 ? ` · ${d} days left` : ''}</div>
      ${ui.weight ? `<div class="small muted">${compact ? `Weightage from ${plural(W._used, 'PYQ')}` : `Weightage estimated from ${plural(W._used, 'PYQ')} in your bank${E.note ? '. ' + esc(E.note) : ''}`}</div>` : ''}
    </div>`;
}
function examSecs(ex, ui) {
  const W = examWeights(ex); let secs = sylSections(ex);
  if (ui.sort) secs = secs.slice().sort((a, b) => ((W[b.id] || {}).marks || 0) - ((W[a.id] || {}).marks || 0));
  return { W, secs };
}
// One exam: a single column. Both: GATE on the left, NET on the right, even on a phone;
// an opened section stretches across both columns so its subtopics have room.
function boardHTML(ex, ui) {
  if (ex !== 'both') { const { W, secs } = examSecs(ex, ui); return `<div class="sy-board">${examHead(ex, ui)}${secs.map(s => sectionCard(s, ui, W)).join('')}</div>`; }
  const G = examSecs('gate', ui), N = examSecs('net', ui), rows = Math.max(G.secs.length, N.secs.length);
  let cells = `<div class="sy-cell c1">${examHead('gate', ui, true)}</div><div class="sy-cell c2">${examHead('net', ui, true)}</div>`;
  for (let i = 0; i < rows; i++) {
    [[G, 'c1'], [N, 'c2']].forEach(([X, c]) => {
      const s = X.secs[i]; if (!s) return;
      const open = !!(S.sylOpen && S.sylOpen[s.id]);
      cells += `<div class="sy-cell ${open ? 'wide' : c}">${sectionCard(s, ui, X.W)}</div>`;
    });
  }
  return `<div class="sy-pair">${cells}</div>`;
}
VIEWS.syllabus = () => {
  if (!S.syllabus) return `<section class="card center"><h3>Syllabus not loaded</h3><p class="muted">syllabus.json is missing from the app, or you're offline on the first visit.</p></section>`;
  const ui = sylP().sylUI, ex = S.sylExam || 'both';
  const shown = ex === 'both' ? scopeTopics('both') : examTopics(ex), all = progOf(shown);
  return `
  <section class="card sy-top">
    <h2>Syllabus</h2>
    <div class="seg" style="margin-bottom:14px">${[['both', 'Both'], ['gate', 'GATE'], ['net', 'NET']].map(([k, l]) => `<button class="${ex === k ? 'on' : ''}" data-act="sylExam" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="sy-controls">
      <div class="sy-ctl">
        <label class="check-row sy-check"><input type="checkbox" data-change="sylUI" data-k="progress" ${ui.progress ? 'checked' : ''}> Show my progress</label>
        ${ui.progress ? `<div class="sy-progress"><span class="lbl">Progress</span><span class="sy-fill dark"><i style="width:${all.pct}%"></i></span><b class="pct">${all.pct}%</b></div>
        <p class="small muted"><b>${all.pct}% covered</b> · ${all.l} of ${all.n} topics done. Each bar fills as you attempt a topic's questions or tick the writers you've covered, and is full once you tick Learnt or attempt them all. The Quizzed tick is only a reminder for you.</p>` : ''}
      </div>
      <div class="sy-ctl">
        <label class="check-row sy-check"><input type="checkbox" data-change="sylUI" data-k="weight" ${ui.weight ? 'checked' : ''}> Show weightage</label>
        <button class="sy-sort ${ui.sort ? 'on' : ''}" data-act="sylSort">${ui.sort ? 'Sorted by weightage ✓' : 'Sort by weightage'}</button>
        <p class="small muted">Estimated marks per section, worked out from the PYQs in your bank.</p>
      </div>
    </div>
  </section>
  ${boardHTML(ex, ui)}
  <section class="card">
    <h3>Add your own topic</h3>
    <p class="small muted">For anything not in the list, for example one text you want to track. Pick the sections it belongs to.</p>
    <button class="btn ghost" data-act="sylAddCustom">＋ Add a topic</button>
  </section>
  ${isAdmin() ? `<section class="card"><h3>Keep the syllabus up to date</h3><p class="small muted">Change the exam year, dates, sections or topics for everyone. Only this device sees this, because it has your GitHub key.</p><button class="btn ghost" data-act="sylAdminOpen">✎ Edit syllabus</button></section>` : ''}
  <p class="small muted center">Updated ${esc((S.syllabus && S.syllabus.updated) || '')} · Sources: ${esc(sylExams().gate ? sylExams().gate.source : '')} · ${esc(sylExams().net ? sylExams().net.source : '')}</p>`;
};

function openCustomTopic() {
  const box = ex => sylSections(ex).map(s => `<label class="check-row sy-check"><input type="checkbox" class="cust-sec" value="${esc(s.id)}"> ${esc(s.name)}</label>`).join('');
  const m = $('#modal');
  m.innerHTML = `<div class="sheet sy-sheet" role="dialog" aria-modal="true" aria-label="Add your own topic">
    <h3>Add your own topic</h3>
    <label class="field-label" for="cust-name">Topic name</label>
    <input type="text" id="cust-name" placeholder="e.g. Partition novels: Train to Pakistan, Ice-Candy-Man">
    <p class="small muted">Tip: write "Title: details" and the details show under the title.</p>
    <details open><summary class="field-label">GATE sections</summary>${box('gate')}</details>
    <details><summary class="field-label">NET units</summary>${box('net')}</details>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn" data-act="sylSaveCustom">Add topic</button>
      <button class="btn ghost" data-act="closeModal">Cancel</button>
    </div>
  </div>`;
  m.hidden = false;
}

/* ---------- Plan tab ---------- */
const planDays = () => sylP().plan.days;
const dayItems = d => planDays()[d] || [];
const monthItems = m => sylP().plan.months[m] || [];
function pruneDay(d) { if (planDays()[d] && !planDays()[d].length) delete planDays()[d]; }
function overdueItems() {
  const t = todayStr(), out = [];
  Object.keys(planDays()).filter(d => d < t).sort().forEach(d => dayItems(d).forEach(it => { if (!it.done) out.push({ d, it }); }));
  return out;
}
const mainExam = () => { const sc = sylP().plan.scope || 'both'; if (sc !== 'both') return sc; return 'gate'; };
function paceInfo() {
  const pl = sylP().plan, scope = pl.scope || 'both', t = todayStr();
  const list = scopeTopics(scope), left = list.filter(x => !learnt(x));
  const target = isDay(pl.target) ? pl.target : (scope === 'net' ? examDate('net') : scope === 'gate' ? examDate('gate') : [examDate('gate'), examDate('net')].filter(isDay).sort()[0]);
  const start = pl.start;
  // Pace counts only topics learnt AFTER the start day, so ticking old work doesn't inflate it.
  const recent = list.filter(x => { const d = doneDate(x); return d && d > start; });
  const since = Math.max(0, dayDiff(start, t));
  const win = Math.min(14, since);
  const inWin = win ? recent.filter(x => dayDiff(doneDate(x), t) < win).length : 0;
  const rate = win >= 3 ? inWin / win : null;
  const daysLeft = isDay(target) ? dayDiff(t, target) : null;
  const need = daysLeft != null && daysLeft > 0 ? left.length / daysLeft : null;
  const finish = rate ? shiftDay(t, Math.ceil(left.length / rate)) : null;
  const planned = new Set();
  Object.entries(planDays()).forEach(([d, items]) => { if (d >= t && (!isDay(target) || d <= target)) items.forEach(it => { if (it.topic && !it.done) planned.add(it.topic); }); });
  const plannedLeft = left.filter(x => planned.has(x.id)).length;
  return { scope, list, left, target, start, rate, need, daysLeft, finish, plannedLeft };
}
function topicSelect(id, selected) {
  const groups = new Map();
  sylTopics().forEach(t => { if (!groups.has(t.group)) groups.set(t.group, []); groups.get(t.group).push(t); });
  return `<select id="${id}"><option value="">No linked topic</option>${[...groups].map(([g, ts]) => `<optgroup label="${esc(g)}">${ts.map(t => `<option value="${esc(t.id)}" ${selected === t.id ? 'selected' : ''}>${learnt(t) ? '✓ ' : ''}${esc(t.name)}</option>`).join('')}</optgroup>`).join('')}</select>`;
}
// The next thing to do: an overdue to-do, then today's, then the rest of the week, else a suggestion.
function doThisNow() {
  const t = todayStr(), over = overdueItems();
  if (over.length) return { d: over[0].d, it: over[0].it, note: `Left over from ${fmtDay(over[0].d, { weekday: 'short', day: 'numeric', month: 'short' })}` };
  const todayIt = dayItems(t).find(x => !x.done);
  if (todayIt) return { d: t, it: todayIt, note: 'On today’s list' };
  for (let i = 1; i <= 7; i++) { const d = shiftDay(t, i), it = dayItems(d).find(x => !x.done); if (it) return { d, it, note: `Planned for ${fmtDay(d, { weekday: 'long' })}` }; }
  const ex = mainExam(), W = examWeights(ex);
  const best = sylSections(ex).slice().sort((a, b) => ((W[b.id] || {}).marks || 0) - ((W[a.id] || {}).marks || 0))
    .flatMap(s => topicsIn(s.id).filter(x => !learnt(x)).map(x => ({ x, s })))[0];
  return best ? { topic: best.x, sec: best.s, note: `Suggested: highest-weightage section of ${EXAM_KEY[ex]}` } : null;
}
function itemHTML(d, it) {
  const tp = it.topic && topicById(it.topic);
  return `<div class="pl-item ${it.done ? 'done' : ''}">
    <button class="pl-check ${it.done ? 'on' : ''}" data-act="planToggle" data-d="${esc(d)}" data-id="${esc(it.id)}" aria-label="${it.done ? 'Mark not done' : 'Mark done'}">${it.done ? '✓' : ''}</button>
    <button class="pl-text" data-act="planItemMenu" data-d="${esc(d)}" data-id="${esc(it.id)}">${esc(it.t)}${tp && !it.t.includes(shortName(tp)) ? `<span class="pl-tp">${esc(shortName(tp))}</span>` : ''}</button>
  </div>`;
}
const STRIPS = ['blue', 'pink', 'lilac'];
function dayCard(d, i) {
  const items = dayItems(d), done = items.filter(x => x.done).length, t = todayStr();
  const names = [...new Set(items.map(it => { const tp = it.topic && topicById(it.topic); return tp ? shortName(tp) : null; }).filter(Boolean))];
  const head = names.length ? names.slice(0, 3).join(' / ') + (names.length > 3 ? ' …' : '') : (items.length ? 'Own tasks' : 'Nothing planned');
  return `<article class="pl-dcard strip-${STRIPS[i % 3]} ${d === t ? 'today' : ''} ${d < t ? 'past' : ''}">
    <span class="pl-dcount">${done} of ${items.length} done${d === t ? ' · today' : ''}</span>
    <h4 class="pl-dtitle">${esc(fmtDay(d, { weekday: 'short' }))} ${parseDay(d).getDate()} · ${esc(head)}</h4>
    <div class="pl-items">${items.map(it => itemHTML(d, it)).join('')}</div>
    <button class="pl-addline" data-act="planAddOpen" data-d="${esc(d)}">＋ Add</button>
  </article>`;
}
function paceHTML(P) {
  const wk = x => x == null ? '–' : (Math.round(x * 7 * 10) / 10).toString();
  let verdict = '', cls = '';
  if (!P.left.length) { verdict = 'Every topic in this scope is learnt ✿ Time to revise and quiz.'; cls = 'ok'; }
  else if (P.daysLeft == null) verdict = 'Set a finish date in My target to see whether you are on time.';
  else if (P.daysLeft <= 0) { verdict = `Your finish-by date has passed with ${plural(P.left.length, 'topic')} left. Choose a new date in My target.`; cls = 'bad'; }
  else if (!P.rate) verdict = `To finish by ${fmtDay(P.target)}, learn about ${wk(P.need)} topics a week. Your own pace shows here after 3 days of ticking.`;
  else if (P.finish <= P.target) { verdict = `On track ✿ At your pace you finish around ${fmtDay(P.finish)}, ${plural(dayDiff(P.finish, P.target), 'day')} early.`; cls = 'ok'; }
  else { verdict = `Behind: at your pace you finish around ${fmtDay(P.finish)}, ${plural(dayDiff(P.target, P.finish), 'day')} late. Aim for ${wk(P.need)} topics a week.`; cls = 'bad'; }
  return `<section class="card">
    <h3>Will I finish in time?</h3>
    <div class="stat-grid">
      <div><div class="n">${P.left.length}</div><div class="l">Topics left</div></div>
      <div><div class="n">${P.daysLeft == null ? '–' : Math.max(0, P.daysLeft)}</div><div class="l">Days left</div></div>
      <div><div class="n">${wk(P.need)}</div><div class="l">Needed a week</div></div>
      <div><div class="n">${wk(P.rate)}</div><div class="l">Your pace a week</div></div>
    </div>
    <p class="pl-verdict ${cls}">${esc(verdict)}</p>
    ${P.left.length ? `<p class="small muted">${plural(P.plannedLeft, 'topic')} of the ${P.left.length} left already have a day in your plan. ${P.left.length - P.plannedLeft ? `${P.left.length - P.plannedLeft} still need a day.` : 'Everything left is planned ✿'}</p>` : ''}
    <p class="small muted">Pace counts topics ticked Learnt after ${esc(fmtDay(P.start))}, so earlier work doesn't inflate it.</p>
  </section>`;
}
function planWeekView() {
  const t = todayStr(), mon = isDay(S.planWeek) ? S.planWeek : mondayOf(t);
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => shiftDay(mon, i));
  const all = days.flatMap(dayItems), done = all.filter(x => x.done).length;
  const now = doThisNow(), over = overdueItems();
  const cur = mon === mondayOf(t);
  let nowCard = '';
  if (now) {
    const tp = now.it ? (now.it.topic && topicById(now.it.topic)) : now.topic;
    const sec = now.sec || (tp ? sectionById([...(tp.gate || []), ...(tp.net || [])][0]) : null);
    const title = now.it ? now.it.t : `Learn: ${shortName(now.topic)}`;
    const sub = [sec ? sec.name : '', tp ? (learnt(tp) ? 'Done already' : 'Not started yet') : '', now.note].filter(Boolean).join('. ');
    nowCard = `<article class="pl-now">
      <span class="pl-now-k">Do this now</span>
      <h3 class="pl-now-t">${esc(title)}</h3>
      <p class="pl-now-s">${esc(sub)}.${tp ? ' Read your notes, then quiz yourself.' : ''}</p>
      <div class="pl-now-b">
        ${tp && topicQs(tp).length ? `<button class="btn pl-start" data-act="sylQuiz" data-id="${esc(tp.id)}">Start →</button>` : tp ? `<button class="btn pl-start" data-act="planOpenTopic" data-id="${esc(tp.id)}">Open topic →</button>` : ''}
        ${now.it ? `<button class="sy-link-u" data-act="planToggle" data-d="${esc(now.d)}" data-id="${esc(now.it.id)}">Mark done</button>` : `<button class="sy-link-u" data-act="sylLearnt" data-id="${esc(tp.id)}">Mark learnt</button><button class="sy-link-u" data-act="planTopic" data-id="${esc(tp.id)}">Plan it</button>`}
      </div>
    </article>`;
  }
  return `
  <div class="pl-weekbar"><span>${done} of ${all.length} done ${cur ? 'this week' : 'that week'}</span><div class="bar"><div style="width:${all.length ? (done / all.length) * 100 : 0}%"></div></div></div>
  <div class="pl-nav">
    <button class="icon-btn" data-act="planWeekGo" data-v="${shiftDay(mon, -7)}" aria-label="Previous week">‹</button>
    <div class="pl-nav-mid"><div class="pl-nav-day">${cur ? 'This week' : esc(fmtDay(mon, { day: 'numeric', month: 'short' }) + ' week')}</div>
      <div class="small muted">${esc(fmtDay(mon, { day: 'numeric', month: 'short' }))} – ${esc(fmtDay(days[6], { day: 'numeric', month: 'short' }))}</div>
      ${cur ? '' : '<button class="btn text" data-act="planWeekGo" data-v="now" style="min-height:30px;padding:0">Back to this week</button>'}</div>
    <button class="icon-btn" data-act="planWeekGo" data-v="${shiftDay(mon, 7)}" aria-label="Next week">›</button>
  </div>
  ${over.length ? `<div class="pl-over"><span>${plural(over.length, 'unfinished to-do')} from earlier days</span><button class="sy-link-u" data-act="planCarry">Move all to today</button></div>` : ''}
  ${quickLogCard()}
  <div class="pl-board">
    ${nowCard}
    <div class="pl-days">${days.map(dayCard).join('')}</div>
  </div>`;
}
function planMonthView() {
  const t = todayStr(), m = /^\d{4}-\d{2}$/.test(S.planMonth || '') ? S.planMonth : t.slice(0, 7);
  const first = m + '-01', d0 = parseDay(first), daysIn = new Date(d0.getFullYear(), d0.getMonth() + 1, 0).getDate();
  const days = Array.from({ length: daysIn }, (_, i) => shiftDay(first, i));
  const all = days.flatMap(dayItems), done = all.filter(x => x.done).length;
  const goals = monthItems(m), gdone = goals.filter(x => x.done).length;
  const prevM = shiftDay(first, -1).slice(0, 7), nextM = shiftDay(first, daysIn).slice(0, 7);
  const lead = (d0.getDay() + 6) % 7;
  const topics = [...new Set(all.map(it => it.topic).filter(Boolean))].map(topicById).filter(Boolean);
  return `
  <div class="pl-weekbar"><span>${done} of ${all.length} daily to-dos done this month</span><div class="bar"><div style="width:${all.length ? (done / all.length) * 100 : 0}%"></div></div></div>
  <div class="pl-nav">
    <button class="icon-btn" data-act="planMonthGo" data-v="${prevM}" aria-label="Previous month">‹</button>
    <div class="pl-nav-mid"><div class="pl-nav-day">${esc(d0.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</div></div>
    <button class="icon-btn" data-act="planMonthGo" data-v="${nextM}" aria-label="Next month">›</button>
  </div>
  <div class="pl-board">
    <article class="pl-dcard strip-pink">
      <span class="pl-dcount">${gdone} of ${goals.length} done</span>
      <h4 class="pl-dtitle">What to finish this month</h4>
      <div class="pl-items">${goals.map(it => itemHTML('M' + m, it)).join('') || '<p class="small muted">Write your goals for the month, for example “Finish Victorian novel”.</p>'}</div>
      <button class="pl-addline" data-act="planAddOpen" data-d="M${m}">＋ Add a month goal</button>
    </article>
    <article class="pl-dcard strip-blue">
      <h4 class="pl-dtitle">Month at a glance</h4>
      <div class="pl-cal">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<span class="h">${x}</span>`).join('')}${'<span></span>'.repeat(lead)}${days.map(d => {
        const it = dayItems(d), dn = it.filter(x => x.done).length;
        return `<button class="pl-cday ${d === t ? 'today' : ''} ${it.length && dn === it.length ? 'all' : ''}" data-act="planWeekGo" data-v="${mondayOf(d)}" data-view="week"><b>${parseDay(d).getDate()}</b><span>${it.length ? `${dn}/${it.length}` : ''}</span></button>`;
      }).join('')}</div>
      <p class="small muted">Tap a day to open its week.</p>
    </article>
    ${topics.length ? `<article class="pl-dcard strip-lilac"><h4 class="pl-dtitle">Topics planned this month · ${topics.filter(learnt).length}/${topics.length} learnt</h4>
      ${topics.map(tp => `<div class="pl-item"><span class="pl-check static ${learnt(tp) ? 'on' : ''}">${learnt(tp) ? '✓' : ''}</span><button class="pl-text" data-act="planOpenTopic" data-id="${esc(tp.id)}">${esc(shortName(tp))}</button></div>`).join('')}</article>` : ''}
  </div>`;
}
// Your own finish date, and how many topics a day and a week it takes to get there.
function targetCard() {
  const pl = sylP().plan, P = paceInfo(), sc = P.scope, own = isDay(pl.target);
  const fmtN = x => x == null ? '–' : x >= 10 ? String(Math.round(x)) : String(Math.round(x * 10) / 10);
  const perDay = P.need, perWeek = P.need != null ? P.need * 7 : null;
  let line;
  if (!P.left.length) line = 'Every topic is done ✿ Use the time left to revise.';
  else if (P.daysLeft == null) line = 'Pick a finish date to see your daily and weekly target.';
  else if (P.daysLeft <= 0) line = `That date has passed with ${plural(P.left.length, 'topic')} left. Choose a new date.`;
  else line = `To finish the ${plural(P.left.length, 'topic')} left by ${fmtDay(P.target)}, cover <b>${fmtN(perDay)} a day</b>${perDay < 1 ? ` (about one every ${Math.round(1 / perDay)} days)` : ''}, which is <b>${fmtN(perWeek)} a week</b>.`;
  return `<section class="card pl-target">
    <h3>My target</h3>
    <div class="seg" style="margin-bottom:12px">${[['both', 'Both'], ['gate', 'GATE'], ['net', 'NET']].map(([k, l]) => `<button class="${sc === k ? 'on' : ''}" data-act="planScope" data-v="${k}">${l}</button>`).join('')}</div>
    <label class="field-label" for="pl-target-main">Finish my syllabus by</label>
    <div class="pl-target-row">
      <input type="date" id="pl-target-main" data-change="planDate" data-k="target" value="${esc(own ? pl.target : '')}">
      ${own ? '<button class="btn text" data-act="planClearTarget" style="width:auto;min-height:44px;padding:0 8px">Clear</button>' : ''}
    </div>
    <p class="small muted">${own ? 'Your own target date.' : `No date set, so this uses the ${sc === 'net' ? 'NET' : sc === 'gate' ? 'GATE' : 'earlier exam'} date (${esc(isDay(P.target) ? fmtDay(P.target) : '–')}). Setting a date a few weeks before leaves time to revise.`}</p>
    <div class="stat-grid" style="margin-top:10px">
      <div><div class="n">${P.left.length}</div><div class="l">Topics left</div></div>
      <div><div class="n">${P.daysLeft == null ? '–' : Math.max(0, P.daysLeft)}</div><div class="l">Days left</div></div>
      <div><div class="n">${fmtN(perDay)}</div><div class="l">A day</div></div>
      <div><div class="n">${fmtN(perWeek)}</div><div class="l">A week</div></div>
    </div>
    <p class="pl-verdict">${line}</p>
  </section>`;
}
function planFinalView() {
  const P = paceInfo(), t = todayStr(), sc = P.scope;
  const end = isDay(P.target) ? P.target : shiftDay(t, 120);
  const weeks = [];
  for (let w = mondayOf(t); w <= end && weeks.length < 26; w = shiftDay(w, 7)) weeks.push(w);
  const exs = sc === 'both' ? ['gate', 'net'] : [sc];
  const secRows = exs.flatMap(ex => { const W = examWeights(ex); return sylSections(ex).map(s => ({ s, w: (W[s.id] || {}).marks, left: topicsIn(s.id).filter(x => !learnt(x)).length, n: topicsIn(s.id).length })); })
    .filter(r => r.left).sort((a, b) => (b.w || 0) - (a.w || 0));
  return `
  ${paceHTML(P)}
  <section class="card">
    <h3>The road to ${sc === 'both' ? 'your exams' : EXAM_KEY[sc]}</h3>
    <div class="pl-road">${weeks.map(w => {
      const its = [0, 1, 2, 3, 4, 5, 6].flatMap(i => dayItems(shiftDay(w, i))), dn = its.filter(x => x.done).length;
      const tps = new Set(its.map(x => x.topic).filter(Boolean)).size;
      const marks = EXAMS.filter(([ex]) => exs.includes(ex) && examDate(ex) >= w && examDate(ex) <= shiftDay(w, 6)).map(([, n]) => n);
      return `<button class="pl-rw ${w === mondayOf(t) ? 'now' : ''}" data-act="planWeekGo" data-v="${w}" data-view="week">
        <span class="d">${esc(fmtDay(w, { day: 'numeric', month: 'short' }))}</span>
        <span class="b"><i style="width:${its.length ? (dn / its.length) * 100 : 0}%"></i></span>
        <span class="c">${its.length ? `${dn}/${its.length} · ${plural(tps, 'topic')}` : 'empty'}${marks.length ? ` · <b>${marks.join(' & ')} exam</b>` : ''}</span>
      </button>`;
    }).join('')}</div>
    <p class="small muted">Weeks up to your finish-by date. Tap a week to open it.</p>
  </section>
  <section class="card">
    <h3>Still to learn, biggest sections first</h3>
    ${secRows.length ? `<div class="list">${secRows.map(r => `<div class="row"><span class="grow"><span class="name">${esc(r.s.name)}</span><br><span class="sub">${EXAM_KEY[r.s.exam]} · ${r.left} of ${r.n} topics left</span></span>${r.w != null ? `<span class="pill Medium">~${fmtMarks(r.w)} marks</span>` : ''}</div>`).join('')}</div>` : '<p class="muted small">Nothing left ✿</p>'}
  </section>`;
}
VIEWS.plan = () => {
  if (!S.syllabus) return VIEWS.syllabus();
  const v = ['week', 'month', 'final'].includes(S.planView) ? S.planView : 'week';
  const ex = mainExam(), d = daysTo(examDate(ex)), other = ex === 'gate' ? 'net' : 'gate', d2 = daysTo(examDate(other));
  const finalName = (sylP().plan.scope || 'both') === 'both' ? 'the exams' : EXAM_KEY[ex];
  return `
  <section class="card pl-headcard">
    <div class="pl-head"><h2 class="pl-title">My plan</h2><button class="chip" data-act="planMore">More</button></div>
    <p class="muted">${d != null ? `${d} days to ${esc(sylExams()[ex].name)}` : ''}${d2 != null && d2 >= 0 ? ` · ${d2} days to ${esc(sylExams()[other].name)}` : ''}. Three views: this week, this month, and the road to ${esc(finalName)}.</p>
    <div class="pl-views">
      <button class="pl-view ${v === 'week' ? 'on' : ''}" data-act="planView" data-v="week"><b>Weekly</b><span>What to do today</span></button>
      <button class="pl-view ${v === 'month' ? 'on' : ''}" data-act="planView" data-v="month"><b>Monthly</b><span>What to finish this month</span></button>
      <button class="pl-view ${v === 'final' ? 'on' : ''}" data-act="planView" data-v="final"><b>Final</b><span>The road to ${esc(finalName === 'the exams' ? 'the exams' : finalName)}</span></button>
    </div>
  </section>
  ${targetCard()}
  ${v === 'week' ? planWeekView() : v === 'month' ? planMonthView() : planFinalView()}`;
};

/* ---------- Plan sheets ---------- */
function listFor(key) {
  if (key[0] === 'M') { const m = key.slice(1), ms = sylP().plan.months; return ms[m] || (ms[m] = []); }
  return planDays()[key] || (planDays()[key] = []);
}
function pruneKey(key) {
  if (key[0] === 'M') { const ms = sylP().plan.months, m = key.slice(1); if (ms[m] && !ms[m].length) delete ms[m]; }
  else pruneDay(key);
}
function findItem(key, id) { const l = key[0] === 'M' ? monthItems(key.slice(1)) : dayItems(key); return l.find(x => x.id === id); }
function openAddSheet(key, preTopic) {
  const isMonth = key[0] === 'M', m = $('#modal');
  m.innerHTML = `<div class="sheet sy-sheet" role="dialog" aria-modal="true" aria-label="Add">
    <h3>${isMonth ? 'Add a month goal' : 'Add a to-do'}</h3>
    <label class="field-label" for="pl-text">What will you do?</label>
    <input type="text" id="pl-text" placeholder="${isMonth ? 'e.g. Finish the Victorian novel' : 'e.g. Read The Waste Land, sections I–III'}" autocomplete="off">
    ${isMonth ? `<input type="hidden" id="pl-day" value="${esc(key)}">` : `<label class="field-label" for="pl-day">Day</label><input type="date" id="pl-day" value="${esc(key)}">`}
    <label class="field-label" for="pl-topic">Syllabus topic (optional)</label>
    ${topicSelect('pl-topic', preTopic || '')}
    <p class="small muted">If you link a topic, ticking this off marks the topic Learnt.</p>
    <div class="btn-row" style="margin-top:12px"><button class="btn" data-act="planAdd">Add</button><button class="btn ghost" data-act="closeModal">Cancel</button></div>
  </div>`;
  m.hidden = false;
  setTimeout(() => { const el = $('#pl-text'); if (el) el.focus(); }, 50);
}
function openItemMenu(key, id) {
  const it = findItem(key, id); if (!it) return;
  const tp = it.topic && topicById(it.topic), isMonth = key[0] === 'M', m = $('#modal');
  m.innerHTML = `<div class="sheet sy-sheet" role="dialog" aria-modal="true" aria-label="Edit to-do">
    <h3>Edit</h3>
    <label class="field-label" for="ed-text">Text</label>
    <input type="text" id="ed-text" value="${esc(it.t)}">
    ${isMonth ? '' : `<label class="field-label" for="ed-day">Day</label><input type="date" id="ed-day" value="${esc(key)}">`}
    <label class="field-label" for="ed-topic">Syllabus topic</label>
    ${topicSelect('ed-topic', it.topic || '')}
    <div class="btn-row" style="margin-top:12px">
      <button class="btn" data-act="planSaveItem" data-d="${esc(key)}" data-id="${esc(id)}">Save</button>
      ${tp ? `<button class="btn ghost" data-act="planOpenTopic" data-id="${esc(tp.id)}">Open topic</button>` : ''}
    </div>
    <button class="btn text danger" data-act="planDel" data-d="${esc(key)}" data-id="${esc(id)}">Delete</button>
  </div>`;
  m.hidden = false;
}
function openPlanMore() {
  const pl = sylP().plan, m = $('#modal');
  m.innerHTML = `<div class="sheet sy-sheet" role="dialog" aria-modal="true" aria-label="Plan settings">
    <h3>Exam dates</h3>
    <div class="grid2">
      <div><label class="field-label" for="pl-gate">GATE date</label><input type="date" id="pl-gate" value="${esc(examDate('gate'))}"></div>
      <div><label class="field-label" for="pl-net">NET date</label><input type="date" id="pl-net" value="${esc(examDate('net'))}"></div>
    </div>
    <p class="small muted">${esc((sylExams().gate || {}).dateNote || '')} ${esc((sylExams().net || {}).dateNote || '')}</p>
    <div class="btn-row" style="margin-top:14px"><button class="btn" data-act="planSaveMore">Save</button><button class="btn ghost" data-act="closeModal">Cancel</button></div>
    <button class="btn text" data-act="planRestart">Count my pace from today</button>
  </div>`;
  m.hidden = false;
}
function openPlanDay(title, onPick, def) {
  S.planPick = onPick;
  const m = $('#modal');
  m.innerHTML = `<div class="sheet sy-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h3>${esc(title)}</h3>
    <label class="field-label" for="pick-day">Day</label>
    <input type="date" id="pick-day" value="${esc(def || todayStr())}">
    <div class="chips" style="margin-top:10px">
      <button class="chip" data-act="pickQuick" data-v="0">Today</button><button class="chip" data-act="pickQuick" data-v="1">Tomorrow</button><button class="chip" data-act="pickQuick" data-v="7">In a week</button>
    </div>
    <div class="btn-row" style="margin-top:14px"><button class="btn" data-act="pickConfirm">Save</button><button class="btn ghost" data-act="closeModal">Cancel</button></div>
  </div>`;
  m.hidden = false;
}
function moveItem(from, id, to) {
  const list = dayItems(from), i = list.findIndex(x => x.id === id);
  if (i < 0 || from === to) return;
  const [it] = list.splice(i, 1);
  (planDays()[to] || (planDays()[to] = [])).push(it);
  pruneDay(from);
}
function jumpToTopic(id) {
  const t = topicById(id); if (!t) return;
  S.sylExam = (t.gate || []).length ? (S.sylExam === 'net' && (t.net || []).length ? 'net' : S.sylExam || 'both') : 'net';
  S.sylOpen = S.sylOpen || {};
  [...(t.gate || []), ...(t.net || [])].forEach(s => { S.sylOpen[s] = true; });
  go('syllabus');
  setTimeout(() => { const el = document.getElementById('t-' + id); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); } }, 60);
}

const SYL_ACT = {
  sylExam: d => { S.sylExam = d.v; go('syllabus', true); },
  sylToggle: d => {
    S.sylOpen = S.sylOpen || {};
    S.sylOpen[d.id] = !S.sylOpen[d.id];
    go('syllabus', true);
    if (S.sylOpen[d.id]) { const el = document.getElementById('sec-' + d.id); if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' }); }
  },
  sylSort: () => { const ui = sylP().sylUI; ui.sort = !ui.sort; saveProg(); go('syllabus', true); },
  sylMore: (d, el) => { const c = el.previousElementSibling; if (!c) return; const open = c.classList.toggle('open'); el.textContent = open ? 'Show less' : 'Show more'; },
  sylLearnt: d => { const t = topicById(d.id); if (!t) return; setLearnt(t.id, !manualLearnt(t)); saveProg(); go(S.screen, true); },
  sylQuizzed: d => { const t = topicById(d.id); if (!t) return; setQuizzed(t.id, !quizzed(t)); saveProg(); go(S.screen, true); },
  sylQuiz: d => {
    const t = topicById(d.id), qs = t ? topicQs(t) : []; if (!qs.length) return toast('No questions for this topic yet');
    Object.assign(S.filters, { work: { label: shortName(t), ids: qs.map(q => q.id) }, group: null, tags: null, query: '', mode: 'mix' });
    closeModal(); go('home'); toast('Topic set — pick PYQs or Mix, then Start quiz');
  },
  sylQuizSec: d => {
    const s = sectionById(d.id); if (!s) return;
    const ids = sectionIds(s); if (!ids.length) return;
    Object.assign(S.filters, { work: { label: s.name, ids }, group: null, tags: null, query: '', mode: 'mix' });
    go('home'); toast('Section set — tap Start quiz');
  },
  sylAddCustom: () => openCustomTopic(),
  sylSaveCustom: () => {
    const name = (($('#cust-name') || {}).value || '').trim();
    const secs = [...document.querySelectorAll('.cust-sec:checked')].map(x => x.value);
    if (!name) return toast('Give the topic a name');
    if (!secs.length) return toast('Pick at least one section');
    const g = sylSections('gate').map(s => s.id);
    sylP().sylCustom.push({ id: 'my-' + uid(), name, gate: secs.filter(s => g.includes(s)), net: secs.filter(s => !g.includes(s)) });
    saveProg(); closeModal(); toast('Topic added ✿'); go(S.screen, true);
  },
  sylDelCustom: d => {
    if (!confirm('Delete this topic of your own?')) return;
    const p = sylP(); p.sylCustom = p.sylCustom.filter(c => c.id !== d.id); delete p.syl[d.id];
    saveProg(); go(S.screen, true);
  },
  planTopic: d => {
    const t = topicById(d.id); if (!t) return;
    openPlanDay(`Plan: ${shortName(t)}`, day => {
      (planDays()[day] || (planDays()[day] = [])).push({ id: uid(), t: `Learn ${shortName(t)}`, topic: t.id, done: false });
      saveProg(); toast(`Added to ${fmtDay(day, { weekday: 'short', day: 'numeric', month: 'short' })}`);
    });
  },
  pickQuick: d => { const el = $('#pick-day'); if (el) el.value = shiftDay(todayStr(), +d.v); },
  pickConfirm: () => {
    const v = (($('#pick-day') || {}).value || '');
    if (!isDay(v)) return toast('Choose a day');
    const fn = S.planPick; S.planPick = null; closeModal();
    if (fn) fn(v);
    go(S.screen, true);
  },
  planView: d => { S.planView = d.v; go('plan', true); },
  planWeekGo: (d, el) => { S.planWeek = d.v === 'now' ? mondayOf(todayStr()) : d.v; if (el && el.dataset.view) S.planView = 'week'; go('plan', true); },
  planMonthGo: d => { S.planMonth = d.v; go('plan', true); },
  planScope: (d, el) => {
    sylP().plan.scope = d.v; saveProg();
    if (el && el.dataset.keep) { el.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); return; }
    go('plan', true);
  },
  planMore: () => openPlanMore(),
  planClearTarget: () => { delete sylP().plan.target; saveProg(); go('plan', true); },
  planSaveMore: () => {
    const pl = sylP().plan;
    [['pl-gate', 'gateDate'], ['pl-net', 'netDate']].forEach(([id, k]) => { const v = ($('#' + id) || {}).value; if (isDay(v)) pl[k] = v; else delete pl[k]; });
    saveProg(); closeModal(); go('plan', true);
  },
  planAddOpen: d => openAddSheet(d.d),
  planAdd: () => {
    const text = (($('#pl-text') || {}).value || '').trim(), topic = (($('#pl-topic') || {}).value || ''), key = (($('#pl-day') || {}).value || '');
    const tp = topic && topicById(topic);
    if (!text && !tp) return toast('Write a to-do first');
    if (key[0] !== 'M' && !isDay(key)) return toast('Choose a day');
    listFor(key).push({ id: uid(), t: text || `Learn ${shortName(tp)}`, topic: tp ? tp.id : '', done: false });
    saveProg(); closeModal(); go('plan', true);
  },
  planItemMenu: d => openItemMenu(d.d, d.id),
  planSaveItem: d => {
    const it = findItem(d.d, d.id); if (!it) return;
    const text = (($('#ed-text') || {}).value || '').trim(), topic = (($('#ed-topic') || {}).value || ''), day = (($('#ed-day') || {}).value || '');
    if (text) it.t = text;
    it.topic = topic;
    if (d.d[0] !== 'M' && isDay(day) && day !== d.d) moveItem(d.d, d.id, day);
    saveProg(); closeModal(); go('plan', true);
  },
  planToggle: d => {
    const it = findItem(d.d, d.id); if (!it) return;
    it.done = !it.done;
    if (it.done && it.topic) { const tp = topicById(it.topic); if (tp && !manualLearnt(tp)) { setLearnt(tp.id, true); toast(`“${shortName(tp)}” marked Learnt ✿`, 3500); } }
    saveProg(); go('plan', true);
  },
  planDel: d => {
    const l = d.d[0] === 'M' ? monthItems(d.d.slice(1)) : dayItems(d.d), i = l.findIndex(x => x.id === d.id); if (i < 0) return;
    l.splice(i, 1); pruneKey(d.d); saveProg(); closeModal(); go('plan', true);
  },
  planCarry: () => { overdueItems().forEach(({ d, it }) => moveItem(d, it.id, todayStr())); saveProg(); closeModal(); S.planWeek = mondayOf(todayStr()); toast('Moved to today'); go('plan', true); },
  planOpenTopic: d => { closeModal(); jumpToTopic(d.id); },
  planRestart: () => { if (!confirm('Count your pace from today? Topics learnt before today will not count towards it.')) return; sylP().plan.start = todayStr(); saveProg(); closeModal(); go('plan', true); }
};
const SYL_IN = {};
const SYL_CH = {
  planDate: el => { const k = el.dataset.k; if (isDay(el.value)) sylP().plan[k] = el.value; else delete sylP().plan[k]; saveProg(); go('plan', true); },
  sylUI: el => { sylP().sylUI[el.dataset.k] = el.checked; saveProg(); go('syllabus', true); }
};

(function addTrackerStyles() {
  const s = document.createElement('style');
  s.textContent = `
    .tabs { grid-template-columns: repeat(6, 1fr); padding-left: 6px; padding-right: 6px; }
    .tabs button { font-size: 11px; padding: 0 2px; min-width: 0; }
    .clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .clamp.open { display: block; -webkit-line-clamp: unset; }
    .sy-more { border: 0; background: none; padding: 2px 0; font: inherit; font-size: 13px; font-weight: 700; color: var(--accent-ink); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
    .sy-link-u { border: 0; background: none; padding: 6px 2px; min-height: 36px; font: inherit; font-size: 12.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--accent-ink); text-decoration: underline; text-underline-offset: 4px; cursor: pointer; }
    .sy-controls { display: grid; grid-template-columns: 1fr; gap: 6px; }
    .sy-controls > div { min-width: 0; }
    .sy-ctl + .sy-ctl { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border); }
    .sy-card-head { display: block; width: 100%; position: relative; padding: 0 30px 0 0; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
    .sy-card-head .sy-card-part { display: block; }
    .sy-card-head .sy-card-title { display: block; }
    .sy-chev { position: absolute; right: 0; top: 18px; font-size: 18px; color: var(--muted); }
    .sy-expand { width: 100%; min-height: 44px; margin: 4px 0 10px; border: 1.5px dashed var(--border); border-radius: 14px; background: none; font: inherit; font-size: 14px; font-weight: 800; color: var(--accent-ink); cursor: pointer; }
    .sy-card { padding-bottom: 10px; }
    .sy-check { min-height: 42px; font-weight: 600; font-size: 14.5px; }
    .sy-progress { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 999px; background: #3b3150; color: #fdf6fb; }
    :root[data-theme="dark"] .sy-progress { background: #1b1529; border: 1px solid var(--border); }
    .sy-progress .lbl { font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; opacity: .8; }
    .sy-seg { display: flex; flex: 1; gap: 2px; min-width: 0; height: 12px; }
    .sy-seg i { flex: 1; border-radius: 2px; min-width: 1px; background: linear-gradient(to top, var(--pink-strong) var(--f, 0%), rgba(255,255,255,.18) var(--f, 0%)); }
    .sy-seg.small { flex: 0 1 auto; height: 10px; gap: 2px; overflow: hidden; }
    .sy-seg.small i { flex: 0 1 7px; width: 7px; background: linear-gradient(to top, var(--purple) var(--f, 0%), var(--border) var(--f, 0%)); }
    .sy-card-prog span:last-child { white-space: nowrap; }
    .sy-sort { min-height: 44px; padding: 0 18px; border-radius: 12px; border: 1.5px solid var(--ink); background: transparent; color: var(--ink); font: inherit; font-size: 13px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; cursor: pointer; }
    .sy-sort.on { background: var(--lilac-soft); border-color: var(--lilac); color: var(--accent-ink); }
    .sy-board { display: grid; grid-template-columns: 1fr; gap: 16px; }
    @media (min-width: 760px) { .sy-board.two { grid-template-columns: 1fr 1fr; } }
    .sy-col { min-width: 0; }
    .sy-col-head { border-radius: 20px; padding: 14px 16px; margin-bottom: 12px; border: 1px solid var(--border); }
    .sy-col-head.gate { background: var(--blue-soft); } .sy-col-head.net { background: var(--pinkrow); }
    .sy-col-name { font-family: "Cormorant Garamond", Georgia, serif; font-size: 1.6rem; font-weight: 700; line-height: 1.1; margin-bottom: 4px; }
    .sy-card { background: var(--card); border: 1px solid var(--border); border-radius: 22px; padding: 18px 18px 8px; margin-bottom: 14px; box-shadow: 0 6px 22px var(--shadow); }
    .sy-card-part { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
    .sy-card-title { font-family: "Cormorant Garamond", Georgia, serif; font-size: 1.55rem; font-weight: 700; line-height: 1.15; margin: 4px 0 10px; }
    .sy-card-pills { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .sy-marks { display: inline-flex; align-items: center; min-height: 34px; padding: 0 14px; border-radius: 999px; background: var(--ink); color: var(--card-2); font-weight: 800; font-size: 13.5px; }
    .sy-marks.soft { background: var(--chip); color: var(--muted); border: 1.5px solid var(--border); }
    .sy-outline { min-height: 34px; padding: 0 14px; border-radius: 999px; border: 1.5px solid var(--ink); background: transparent; color: var(--ink); font: inherit; font-size: 13.5px; font-weight: 700; cursor: pointer; }
    .sy-card-prog { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--muted); margin-bottom: 8px; }
    .sy-about { font-size: 13.5px; color: var(--muted); line-height: 1.5; margin: 4px 0 0; }
    .sy-tree { list-style: none; margin: 12px 0 0 8px; padding: 0 0 0 0; border-left: 2px solid var(--ink); }
    .sy-node { position: relative; padding: 10px 0 14px 26px; }
    .sy-node::before { content: ""; position: absolute; left: -2px; top: 0; width: 18px; height: 24px; border-left: 2px solid var(--ink); border-bottom: 2px solid var(--ink); border-bottom-left-radius: 12px; }
    .sy-tree .sy-node:last-child { background: var(--card); margin-left: -2px; padding-left: 28px; }
    .sy-tree .sy-node:last-child::before { left: 0; }
    .sy-node-name { font-family: "Lora", Georgia, serif; font-size: 1.02rem; line-height: 1.35; }
    .sy-node-name .cnt { font-family: "Nunito", sans-serif; font-size: 12.5px; color: var(--muted); }
    .sy-node.is-learnt .sy-node-name { color: var(--ok); }
    .sy-node-desc { font-size: 13.5px; color: var(--muted); line-height: 1.5; margin-top: 3px; }
    .sy-node-status { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 6px; font-size: 13px; color: var(--muted); }
    .sy-mini { width: 54px; height: 6px; border-radius: 999px; background: var(--border); overflow: hidden; }
    .sy-mini i { display: block; height: 100%; background: var(--ok); }
    .sy-node-ticks { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
    .sy-tick { display: inline-flex; align-items: center; gap: 7px; min-height: 38px; padding: 0 12px 0 7px; border-radius: 999px; border: 1.5px solid var(--border); background: var(--chip); font: inherit; font-weight: 800; font-size: 13px; color: var(--ink); cursor: pointer; }
    .sy-tick .box { width: 22px; height: 22px; border-radius: 7px; border: 2px solid var(--lilac); display: inline-flex; align-items: center; justify-content: center; font-size: 13px; }
    .sy-tick.on { background: var(--ok-bg); border-color: var(--ok); color: var(--ok); }
    .sy-tick.on .box { background: var(--ok); border-color: var(--ok); color: var(--card-2); }
    .sy-tick.q.on { background: var(--lilac-soft); border-color: var(--lilac); color: var(--accent-ink); }
    .sy-tick.q.on .box { background: var(--purple); border-color: var(--purple); }
    .sy-node.flash { animation: syflash 1.6s ease; }
    @keyframes syflash { 0%, 60% { background: var(--lilac-soft); } 100% { background: transparent; } }
    .sy-sheet { max-height: 85vh; overflow-y: auto; }
    .pl-target-row { display: flex; gap: 8px; align-items: center; }
    .pl-target .pl-verdict b { color: var(--accent-ink); }
    .pl-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .pl-title { font-family: "Cormorant Garamond", Georgia, serif; font-size: 2.1rem; letter-spacing: .02em; margin: 0; }
    .pl-views { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 6px; }
    .pl-view { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 12px; border-radius: 18px; border: 1.5px solid var(--border); background: var(--chip); font: inherit; color: var(--ink); text-align: left; cursor: pointer; min-width: 0; }
    .pl-view b { font-size: 15px; }
    .pl-view span { font-size: 11.5px; color: var(--muted); line-height: 1.25; }
    .pl-view.on { background: var(--ink); border-color: var(--ink); color: var(--card-2); }
    .pl-view.on span { color: var(--card-2); opacity: .8; }
    .pl-weekbar { display: flex; align-items: center; gap: 12px; margin: 4px 4px 14px; font-size: 14px; color: var(--muted); font-weight: 600; }
    .pl-weekbar span { white-space: nowrap; }
    .pl-weekbar .bar { flex: 1; margin: 0; }
    .pl-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
    .pl-nav-mid { text-align: center; }
    .pl-nav-day { font-family: "Cormorant Garamond", Georgia, serif; font-size: 1.5rem; font-weight: 700; }
    .pl-over { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; padding: 8px 14px; margin-bottom: 12px; border-radius: 16px; background: var(--warn-bg); color: var(--warn); font-weight: 700; font-size: 14px; }
    .pl-board { border-radius: 24px; padding: 16px 12px; margin-bottom: 16px; border: 1px solid var(--border);
      background-color: var(--lilac-soft);
      background-image: linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px);
      background-size: 22px 22px; }
    .pl-now { background: var(--card-2); border-radius: 18px; padding: 18px; margin-bottom: 16px; border-top: 6px solid var(--pink); box-shadow: 0 8px 24px var(--shadow); }
    .pl-now-k { font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); }
    .pl-now-t { font-family: "Cormorant Garamond", Georgia, serif; font-size: 1.9rem; line-height: 1.15; margin: 8px 0; }
    .pl-now-s { color: var(--muted); line-height: 1.5; margin: 0 0 14px; }
    .pl-now-b { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
    .pl-start { width: auto; padding: 0 22px; }
    .pl-days { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 380px) { .pl-days { grid-template-columns: 1fr; } }
    .pl-dcard { background: var(--card-2); border-radius: 16px; padding: 14px 12px 6px; border-top: 6px solid var(--blue); box-shadow: 0 6px 18px var(--shadow); min-width: 0; margin-bottom: 0; }
    .pl-board > .pl-dcard { margin-bottom: 12px; }
    .pl-dcard.strip-pink { border-top-color: var(--pink-strong); } .pl-dcard.strip-lilac { border-top-color: var(--lilac); } .pl-dcard.strip-blue { border-top-color: var(--blue); }
    .pl-dcard.today { outline: 2px solid var(--purple); outline-offset: 2px; }
    .pl-dcard.past { opacity: .85; }
    .pl-dcount { font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
    .pl-dtitle { font-family: "Cormorant Garamond", Georgia, serif; font-size: 1.3rem; font-weight: 700; line-height: 1.2; margin: 6px 0 8px; overflow-wrap: anywhere; }
    .pl-items { display: flex; flex-direction: column; }
    .pl-item { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; }
    .pl-check { flex: none; width: 26px; height: 26px; margin-top: 2px; border-radius: 7px; border: 2px solid var(--lilac); background: var(--input); font-weight: 800; font-size: 14px; color: var(--card-2); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
    .pl-check.on { background: var(--ok); border-color: var(--ok); }
    .pl-check.static { cursor: default; }
    .pl-text { flex: 1; min-width: 0; border: 0; background: none; padding: 3px 0; font: inherit; font-size: 14px; line-height: 1.4; color: var(--ink); text-align: left; cursor: pointer; overflow-wrap: anywhere; }
    .pl-item.done .pl-text { text-decoration: line-through; color: var(--muted); }
    .pl-tp { display: block; font-size: 12px; color: var(--accent-ink); font-weight: 700; }
    .pl-addline { width: 100%; min-height: 40px; margin-top: 4px; border: 1.5px dashed var(--border); border-radius: 12px; background: none; font: inherit; font-size: 13.5px; font-weight: 800; color: var(--accent-ink); cursor: pointer; }
    .pl-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
    .pl-cal .h { text-align: center; font-size: 11px; font-weight: 800; color: var(--muted); }
    .pl-cday { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 46px; border-radius: 10px; border: 1px solid var(--border); background: var(--input); font: inherit; color: var(--ink); cursor: pointer; padding: 0; }
    .pl-cday b { font-size: 14px; } .pl-cday span { font-size: 10px; color: var(--muted); }
    .pl-cday.today { border: 2px solid var(--purple); }
    .pl-cday.all { background: var(--ok-bg); } .pl-cday.all span { color: var(--ok); font-weight: 800; }
    .pl-verdict { margin: 14px 0 8px; padding: 12px 14px; border-radius: 14px; background: var(--lilac-soft); line-height: 1.5; font-weight: 600; }
    .pl-verdict.ok { background: var(--ok-bg); color: var(--ok); }
    .pl-verdict.bad { background: var(--bad-bg); color: var(--bad); }
    .pl-road { display: flex; flex-direction: column; gap: 6px; }
    .pl-rw { display: grid; grid-template-columns: 62px 1fr; grid-template-rows: auto auto; gap: 2px 10px; align-items: center; padding: 8px 10px; border-radius: 12px; border: 1px solid var(--border); background: var(--input); font: inherit; color: var(--ink); text-align: left; cursor: pointer; }
    .pl-rw.now { border-color: var(--purple); background: var(--lilac-soft); }
    .pl-rw .d { grid-row: span 2; font-weight: 800; font-size: 13.5px; }
    .pl-rw .b { height: 7px; border-radius: 999px; background: var(--border); overflow: hidden; }
    .pl-rw .b i { display: block; height: 100%; background: linear-gradient(90deg, var(--pink-strong), var(--purple)); }
    .pl-rw .c { font-size: 12.5px; color: var(--muted); }
    .sy-fill { display: block; flex: 1; min-width: 0; height: 10px; border-radius: 999px; background: var(--border); overflow: hidden; margin: 6px 0 4px; }
    .sy-fill i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--pink-strong), var(--purple)); }
    .sy-fill.dark { margin: 0; background: rgba(255,255,255,.16); }
    .sy-progress .pct { font-size: 13px; }
    .sy-progress { min-width: 0; overflow: hidden; }
    .sy-card-prog { min-width: 0; overflow: hidden; }
    .sy-seg.small { min-width: 0; }
    .sy-pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-auto-flow: row dense; gap: 10px; align-items: start; }
    .sy-cell { min-width: 0; }
    .sy-cell.c1 { grid-column: 1; } .sy-cell.c2 { grid-column: 2; } .sy-cell.wide { grid-column: 1 / -1; }
    .sy-cell .sy-col-head { margin-bottom: 0; height: 100%; }
    .sy-cell .sy-card { margin-bottom: 0; }
    @media (max-width: 640px) {
      .sy-pair .sy-col-head { padding: 12px; }
      .sy-pair .sy-col-name { font-size: 1.3rem; }
      .sy-pair .sy-cell.c1 .sy-card, .sy-pair .sy-cell.c2 .sy-card { padding: 12px 12px 6px; border-radius: 18px; }
      .sy-pair .sy-cell.c1 .sy-card-title, .sy-pair .sy-cell.c2 .sy-card-title { font-size: 1.12rem; }
      .sy-pair .sy-cell.c1 .sy-card-part, .sy-pair .sy-cell.c2 .sy-card-part { font-size: 9.5px; }
      .sy-pair .sy-cell.c1 .sy-marks, .sy-pair .sy-cell.c2 .sy-marks, .sy-pair .sy-cell.c1 .sy-outline, .sy-pair .sy-cell.c2 .sy-outline { min-height: 28px; padding: 0 9px; font-size: 11.5px; }
      .sy-pair .sy-cell.c1 .sy-card-prog, .sy-pair .sy-cell.c2 .sy-card-prog { flex-direction: column; align-items: flex-start; gap: 4px; font-size: 11.5px; }
      .sy-pair .sy-cell.c1 .sy-card-prog .sy-fill, .sy-pair .sy-cell.c2 .sy-card-prog .sy-fill { flex: none; width: 100%; margin: 0; }
      .sy-pair .sy-cell.c1 .sy-expand, .sy-pair .sy-cell.c2 .sy-expand { font-size: 12px; min-height: 38px; }
      .sy-pair .sy-cell.c1 .sy-chev, .sy-pair .sy-cell.c2 .sy-chev { top: 12px; }
      .sy-pair .sy-cell.c1 .sy-card-head, .sy-pair .sy-cell.c2 .sy-card-head { padding-right: 18px; }
    }
    .sa-part { margin-top: 18px; padding-top: 6px; border-top: 1px solid var(--border); }
    .sa-sec { margin: 8px 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--card-2); }
    .sa-sec summary { font-weight: 700; cursor: pointer; }
    .sa-save { position: sticky; bottom: calc(env(safe-area-inset-bottom) + 84px); z-index: 5; display: flex; gap: 10px; padding: 10px; border-radius: 20px; background: var(--tabs-bg); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); border: 1px solid var(--border); margin-bottom: 16px; }
    .sa-save .btn { flex: 1; }
    .bulk-ex { white-space: pre-wrap; font-size: 12.5px; line-height: 1.45; background: var(--input); border: 1px solid var(--border); border-radius: 12px; padding: 10px; overflow-x: auto; }
    .wrong-item.bulk-bad { border-left: 4px solid var(--bad); padding-left: 10px; }
    #bulk-text { font-size: 14px; line-height: 1.45; }
    input[type="email"] { width: 100%; min-height: 48px; border: 1.5px solid var(--border); border-radius: 14px; padding: 0 12px; background: var(--input); color: var(--ink); font-size: 16px; }
    input[type="date"] { width: 100%; min-height: 48px; border: 1.5px solid var(--border); border-radius: 14px; padding: 0 12px; background: var(--input); color: var(--ink); }`;
  document.head.appendChild(s);
})();

/* ---------- Edit syllabus (only on the device with the GitHub key) ----------
   Changes are made on a copy, then saved to syllabus.json on GitHub, so every
   friend's app picks them up. Personal ticks are kept by topic id.            */
async function ghSaveJSON(path, build, message) {
  const g = Object.assign({}, ghSettings(), { path });
  if (!g.token) throw new Error('Admin key not set on this device.');
  if (!navigator.onLine) throw new Error('You are offline. Connect to the internet, then save again.');
  for (let attempt = 0; attempt < 2; attempt++) {
    const { api, H, meta } = await ghFetchMeta(g, g.token);
    let cur = null;
    try { if (meta.content && meta.encoding === 'base64') cur = JSON.parse(b64ToUtf8(meta.content)); } catch (e) { cur = null; }
    const obj = build(cur);
    const put = await fetch(api, {
      method: 'PUT',
      headers: Object.assign({ Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, H),
      body: JSON.stringify({ message, content: utf8ToB64(JSON.stringify(obj, null, 1) + '\n'), sha: meta.sha, branch: g.branch })
    });
    if (put.status === 409 && attempt === 0) continue;
    if (!put.ok) throw new Error(ghErr(put.status).replace('questions.json', path));
    return obj;
  }
  throw new Error(ghErr(409));
}
const sedit = () => S.sylEdit || (S.sylEdit = JSON.parse(JSON.stringify(S.syllabus)));
function setPath(obj, path, v) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[/^\d+$/.test(keys[i]) ? +keys[i] : keys[i]];
  o[keys[keys.length - 1]] = v;
}
const editSections = (E, ex) => E.exams[ex].parts.flatMap(p => p.sections);
const fld = (label, path, v, type = 'text', ph = '') => `<label class="field-label">${label}</label>${type === 'area'
  ? `<textarea rows="3" data-change="sylEdit" data-path="${esc(path)}" placeholder="${esc(ph)}">${esc(v || '')}</textarea>`
  : `<input type="${type}" data-change="sylEdit" data-path="${esc(path)}" ${type === 'number' ? 'data-num="1"' : ''} value="${esc(v == null ? '' : v)}" placeholder="${esc(ph)}">`}`;
VIEWS.sylAdmin = () => {
  if (!isAdmin() || !S.syllabus) return VIEWS.syllabus();
  const E = sedit(), q = queryTokens(S.sylAdminQuery || '');
  const examCard = ex => {
    const X = E.exams[ex];
    return `<section class="card form">
      <h3>${esc(X.name)}</h3>
      ${fld('Short name (shown on cards, e.g. GATE 2028)', `exams.${ex}.name`, X.name)}
      ${fld('Full name', `exams.${ex}.full`, X.full)}
      ${fld('Exam date (first day)', `exams.${ex}.date`, X.date, 'date')}
      ${fld('Date note', `exams.${ex}.dateNote`, X.dateNote, 'area')}
      ${fld('Source of the syllabus', `exams.${ex}.source`, X.source)}
      ${fld('Note shown under the exam', `exams.${ex}.note`, X.note, 'area')}
      ${X.parts.map((p, pi) => `
        <div class="sa-part">
          <div class="grid2"><div>${fld('Part', `exams.${ex}.parts.${pi}.name`, p.name)}</div><div>${fld('Marks', `exams.${ex}.parts.${pi}.marks`, p.marks, 'number')}</div></div>
          ${p.sections.map((s, si) => `<details class="sa-sec"><summary>${esc(s.name)} <span class="muted small">· ${topicCountIn(E, s.id)} topics</span></summary>
            ${fld('Section name', `exams.${ex}.parts.${pi}.sections.${si}.name`, s.name)}
            ${fld('Official description', `exams.${ex}.parts.${pi}.sections.${si}.about`, s.about, 'area')}
            <button class="btn text danger" data-act="saDelSec" data-ex="${ex}" data-pi="${pi}" data-si="${si}">Delete this section</button>
          </details>`).join('')}
          <button class="pl-addline" data-act="saAddSec" data-ex="${ex}" data-pi="${pi}">＋ Add a section to this part</button>
        </div>`).join('')}
    </section>`;
  };
  let topics = E.topics.map((t, i) => ({ t, i }));
  if (q.length) topics = topics.filter(({ t }) => q.every(tok => tokenMatch(tok, words(t.name + ' ' + t.group))));
  return `
  <button class="chip back" data-act="tab" data-tab="syllabus">‹ Syllabus</button>
  <section class="card">
    <h2>Edit syllabus</h2>
    <p class="small muted">Only this device can do this, because it has your GitHub key. Change the year, dates, sections or topics, then tap <b>Save to GitHub</b>. Everyone sees the change in 1–2 minutes. Ticks people have made are kept.</p>
  </section>
  ${examCard('gate')}${examCard('net')}
  <section class="card">
    <h3>Topics <span class="small muted">· ${E.topics.length}</span></h3>
    <div class="search"><input type="search" data-in="sylAdminQuery" value="${esc(S.sylAdminQuery || '')}" placeholder="Find a topic" autocomplete="off"></div>
    <button class="btn ghost" data-act="saTopic" data-i="new" style="margin-top:12px">＋ Add a topic</button>
    <div class="list" id="sa-topics" style="margin-top:8px">${saTopicsHTML(topics)}</div>
  </section>
  <div class="sa-save">
    <button class="btn" data-act="saSave" id="sa-save-btn">Save to GitHub</button>
    <button class="btn ghost" data-act="saDiscard">Discard changes</button>
  </div>`;
};
function topicCountIn(E, sid) { return E.topics.filter(t => (t.gate || []).includes(sid) || (t.net || []).includes(sid)).length; }
function saTopicsHTML(list) {
  return list.map(({ t, i }) => `<button class="row" data-act="saTopic" data-i="${i}">
    <span class="grow"><span class="name">${esc(t.name)}</span><br><span class="sub">${esc(t.group)} · GATE ${(t.gate || []).length} · NET ${(t.net || []).length}</span></span><span class="chev">›</span></button>`).join('') || '<p class="muted small">No topics match.</p>';
}
function openTopicEditor(i) {
  const E = sedit(), isNew = i === 'new', t = isNew ? { name: '', group: '', gate: [], net: [] } : E.topics[+i];
  const groups = [...new Set(E.topics.map(x => x.group))];
  const box = ex => editSections(E, ex).map(s => `<label class="check-row sy-check"><input type="checkbox" class="sa-sec" value="${esc(s.id)}" ${(t[ex] || []).includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('');
  const G = buildGuide(), guideOpts = G.cats.flatMap(c => [[c.id, c.name], ...c.subs.filter(s => !s.isOther).map(s => [s.id, `${c.name} › ${s.name}`])]);
  const m = $('#modal');
  m.innerHTML = `<div class="sheet sy-sheet" role="dialog" aria-modal="true" aria-label="Edit topic">
    <h3>${isNew ? 'Add a topic' : 'Edit topic'}</h3>
    <label class="field-label" for="sa-name">Topic (write "Title: details")</label>
    <input type="text" id="sa-name" value="${esc(t.name)}" placeholder="e.g. Partition novels: Train to Pakistan, Ice-Candy-Man">
    <label class="field-label" for="sa-group">Group</label>
    <input type="text" id="sa-group" list="sa-groups" value="${esc(t.group)}" placeholder="e.g. Indian Literature">
    <datalist id="sa-groups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    <details open><summary class="field-label">GATE sections</summary>${box('gate')}</details>
    <details><summary class="field-label">NET units</summary>${box('net')}</details>
    <label class="field-label" for="sa-guide">Questions come from this Guide topic</label>
    <select id="sa-guide"><option value="">None</option>${guideOpts.map(([id, n]) => `<option value="${esc(id)}" ${t.guide === id ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <label class="field-label" for="sa-q">…or from a search (used when no Guide topic is chosen)</label>
    <input type="text" id="sa-q" value="${esc(t.q || '')}" placeholder="e.g. Partition">
    <div class="btn-row" style="margin-top:12px"><button class="btn" data-act="saTopicSave" data-i="${esc(String(i))}">Done</button><button class="btn ghost" data-act="closeModal">Cancel</button></div>
    ${isNew ? '' : `<button class="btn text danger" data-act="saTopicDel" data-i="${esc(String(i))}">Delete this topic</button>`}
  </div>`;
  m.hidden = false;
}
const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
const SA_ACT = {
  sylAdminOpen: () => { S.sylEdit = null; go('sylAdmin'); },
  saAddSec: d => {
    const E = sedit(), p = E.exams[d.ex].parts[+d.pi];
    p.sections.push({ id: `${d.ex}-${uid()}`, name: 'New section', about: '' });
    go('sylAdmin', true); toast('Section added — open it to rename');
  },
  saDelSec: d => {
    const E = sedit(), p = E.exams[d.ex].parts[+d.pi], s = p.sections[+d.si];
    if (!confirm(`Delete “${s.name}”? Topics linked to it lose that link.`)) return;
    p.sections.splice(+d.si, 1);
    E.topics.forEach(t => { t.gate = (t.gate || []).filter(x => x !== s.id); t.net = (t.net || []).filter(x => x !== s.id); });
    go('sylAdmin', true);
  },
  saTopic: d => openTopicEditor(d.i),
  saTopicSave: d => {
    const E = sedit(), name = (($('#sa-name') || {}).value || '').trim(), group = (($('#sa-group') || {}).value || '').trim();
    if (!name) return toast('Write the topic name');
    if (!group) return toast('Write a group, e.g. Indian Literature');
    const secs = [...document.querySelectorAll('.sa-sec:checked')].map(x => x.value);
    const gIds = editSections(E, 'gate').map(s => s.id);
    const t = d.i === 'new' ? { id: `${slug(name.split(':')[0])}-${uid().slice(-4)}` } : E.topics[+d.i];
    Object.assign(t, { name, group, gate: secs.filter(s => gIds.includes(s)), net: secs.filter(s => !gIds.includes(s)) });
    const guide = ($('#sa-guide') || {}).value, q = (($('#sa-q') || {}).value || '').trim();
    if (guide) t.guide = guide; else delete t.guide;
    if (q) t.q = q; else delete t.q;
    if (d.i === 'new') E.topics.push(t);
    closeModal(); go('sylAdmin', true); toast('Topic updated — remember to Save to GitHub');
  },
  saTopicDel: d => {
    const E = sedit(); if (!confirm('Delete this topic for everyone?')) return;
    E.topics.splice(+d.i, 1); closeModal(); go('sylAdmin', true);
  },
  saDiscard: () => { if (!confirm('Discard your unsaved changes?')) return; S.sylEdit = null; go('syllabus'); },
  saSave: async () => {
    const E = sedit(), btn = $('#sa-save-btn');
    E.updated = todayStr();
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      await ghSaveJSON('syllabus.json', cur => { if (cur && cur.settings) E.settings = cur.settings; return E; }, 'Update syllabus');
      S.syllabus = JSON.parse(JSON.stringify(E)); S.sylEdit = null;
      TQCACHE = { key: '', map: new Map() }; WTCACHE = {}; QDCACHE = { key: '', map: new Map() };
      toast('Syllabus saved ✿ Everyone sees it in 1–2 minutes', 4500);
      go('syllabus');
    } catch (e) { toast(e.message, 5000); if (btn) { btn.disabled = false; btn.textContent = 'Save to GitHub'; } }
  }
};
const SA_CH = {
  sylEdit: el => { const v = el.dataset.num ? (parseFloat(el.value) || 0) : el.value.trim(); setPath(sedit(), el.dataset.path, v); }
};
const SA_IN = {
  sylAdminQuery: v => {
    S.sylAdminQuery = v; const E = sedit(), q = queryTokens(v);
    let list = E.topics.map((t, i) => ({ t, i }));
    if (q.length) list = list.filter(({ t }) => q.every(tok => tokenMatch(tok, words(t.name + ' ' + t.group))));
    const el = $('#sa-topics'); if (el) el.innerHTML = saTopicsHTML(list);
  }
};

Object.assign(SYL_ACT, SA_ACT); Object.assign(SYL_CH, SA_CH); Object.assign(SYL_IN, SA_IN);

/* =========================================================
   QUICK LOG  (Plan → Weekly, below "This week")
   Type what you covered before today: topics, writers, works or theories.
   The app finds each one in the syllabus (and in the question bank),
   shows a list to check, and logs it after you tap "Log these".
   • A whole topic logged here is ticked Learnt, but it does not count
     towards "Your pace", because it was done before today.
   • A writer, work or theory is noted under its topic ("Covered: …")
     without ticking the whole topic, unless you choose to.
   Everything is saved on this device (progress.covered), inside the backup.
   ========================================================= */
const QL_SYN = { poets: 'poetry', poet: 'poetry', poems: 'poetry', poem: 'poetry', novelists: 'novel', novelist: 'novel', novels: 'novel',
  dramatists: 'drama', dramatist: 'drama', playwrights: 'drama', playwright: 'drama', plays: 'drama', critics: 'criticism', critic: 'criticism',
  theorists: 'theory', theories: 'theory', essayists: 'prose', essays: 'prose', essay: 'prose' };
const QL_GENERIC = new Set('writers writer authors author works work texts text done finished finish completed complete covered cover read studied study all whole full basics basic part parts some intro introduction chapter chapters notes revision revised literature literatures lit etc'.split(' '));
const QL_CTX = new Set('writers writer authors author poets poet poetry novelists novelist novel novels fiction dramatists drama plays playwrights critics criticism theory theories theorists literature lit prose essayists thinkers'.split(' '));
const qlRaw = s => words(s).filter(w => !STOP.has(w) && !QL_GENERIC.has(w) && (w.length > 1 || /\d/.test(w)));
const qlTopical = s => [...new Set(qlRaw(s).map(w => QL_SYN[w] || w))];
// How well a typed word a fits a real word b: 3 exact, 2 half-typed or plural, 1 small spelling slip, 0 no.
function qlTok(a, b, strict) {
  if (a === b) return 3;
  if (a.length >= 4 && b.length > a.length && b.startsWith(a)) return 2;
  if (b.length >= 3 && (a === b + 's' || a === b + 'es' || b === a + 's' || b === a + 'es')) return 2;
  if (strict || /\d/.test(a) || /\d/.test(b)) return 0;
  const max = a.length >= 7 ? 2 : a.length >= 4 ? 1 : 0;
  if (max && b.length >= 4 && editDist(a, b, max) <= max) return 1;
  return 0;
}
// Every typed word must fit a word of the target. s = average fit, cov = share of the target's words used.
function qlFit(toks, W, strict) {
  if (!toks.length || !W.length) return null;
  let s = 0; const hit = new Set();
  for (const a of toks) {
    let best = 0, bw = null;
    for (const w of W) { const v = qlTok(a, w, strict); if (v > best) { best = v; bw = w; } if (best === 3) break; }
    if (!best) return null;
    s += best; hit.add(bw);
  }
  return { s: s / toks.length, cov: hit.size / W.length };
}

let QLIDX = null;
function qlIndex() {
  const ts = sylTopics(), key = `${S.questions.length}:${ts.length}`;
  if (QLIDX && QLIDX.key === key) return QLIDX;
  const topics = ts.map(t => ({ t, all: qlTopical(shortName(t) + ' ' + t.group + ' ' + topicDesc(t)), head: qlTopical(shortName(t) + ' ' + t.group), short: qlTopical(shortName(t)) }));
  const names = new Map();
  const add = (kind, name, tid, w) => {
    const ws = [...new Set(words(name).filter(x => !STOP.has(x) && (x.length > 1 || /\d/.test(x))))];
    if (!ws.length) return null;
    const k = kind + ':' + words(name).join(' ');          // initials kept here, so F. R. and Q. D. Leavis stay apart
    let e = names.get(k);
    if (!e) { e = { kind, name: String(name).trim(), words: ws, topics: new Map(), qn: 0 }; names.set(k, e); }
    if (tid) e.topics.set(tid, (e.topics.get(tid) || 0) + w);
    return e;
  };
  const qTopics = new Map();
  ts.forEach(t => {
    const g = t.guide && gNode(t.guide), wt = g && g.qs.length ? 1 : 0.25;     // topics found by a word search are a looser fit
    topicQs(t).forEach(q => { if (!qTopics.has(q.id)) qTopics.set(q.id, []); qTopics.get(q.id).push([t.id, wt]); });
  });
  S.questions.forEach(q => {
    const tids = qTopics.get(q.id) || [];
    (q.writers || []).forEach(w => { const e = add('writer', w, null, 0); if (!e) return; e.qn++; tids.forEach(([id, wt]) => add('writer', w, id, wt)); });
    (q.works || []).forEach(w => { const e = add('work', w, null, 0); if (!e) return; e.qn++; tids.forEach(([id, wt]) => add('work', w, id, wt)); });
  });
  // Names and terms listed in a topic itself, e.g. "Romantic poetry: Wordsworth, Coleridge…" or "…stream of consciousness…".
  const writers = [...names.values()].filter(e => e.kind === 'writer');
  // (for a title that is itself a list, like "Eliot, Richards, Leavis & New Criticism", the names after the first)
  const listOf = t => topicDesc(t) || (t.name.includes(',') ? t.name.split(',').slice(1).join(',') : '');
  ts.forEach(t => listOf(t).split(/,|&|\band\b/).map(x => x.trim()).filter(x => x && x.length < 45 && !/\b(etc|other|others)\b/i.test(x)).forEach(n => {
    const ws = words(n).filter(x => !STOP.has(x) && x.length > 1);
    const same = ws.length && ws.length <= 2 ? writers.filter(e => ws.every(x => e.words.some(y => qlTok(x, y, true) >= 2))) : [];
    if (same.length) same.forEach(e => e.topics.set(t.id, (e.topics.get(t.id) || 0) + 1000));     // listed in the syllabus = its home topic
    else add('named', n, t.id, 1000);
  }));
  QLIDX = { key, topics, names: [...names.values()], byId: new Map(topics.map(x => [x.t.id, x])) };
  return QLIDX;
}
const qlHintFits = (X, H) => !H.length || H.every(h => X.head.some(w => qlTok(h, w) >= 2));
function qlBestTopic(e, H) {
  const I = qlIndex();
  const list = [...e.topics.entries()].map(([id, w]) => {
    const X = I.byId.get(id);
    return { id, w: w * (H.length && X && qlHintFits(X, H) ? 4 : 1) };
  }).sort((a, b) => b.w - a.w);
  return list.length ? list[0].id : '';
}

// One typed entry → rows to show. Returns [] when nothing fits.
// Exact spellings are tried first; small spelling slips only if nothing fits exactly.
function qlEntry(raw, hint) {
  const T = qlTopical(raw), R = qlRaw(raw), H = qlTopical(hint || '');
  if (!T.length && !R.length) return [];
  return qlStage(raw, T, R, H, true) || qlStage(raw, T, R, H, false) || [];
}
function qlStage(raw, T, R, H, strict) {
  const I = qlIndex();
  // Topics: every typed word is in the topic's title, group or list of contents
  let cands = T.length ? I.topics.map(X => {
    const f = qlFit(T, X.all, strict); if (!f) return null;
    const cov = X.short.length ? X.short.filter(w => T.some(a => qlTok(a, w, strict))).length / X.short.length : 0;
    return { X, s: f.s, cov };
  }).filter(Boolean) : [];
  if (H.length && cands.length > 1) { const h = cands.filter(c => qlHintFits(c.X, H)); if (h.length) cands = h; }
  // Only names from a topic's list ("Keats and Shelley") don't make it the whole topic.
  const headCands = cands.filter(c => T.some(a => c.X.head.some(w => qlTok(a, w, strict))));
  const topicRows = (list, on) => list.map(c => ({ kind: 'topic', name: shortName(c.X.t), topic: c.X.t.id, on }));
  // 1) The typed words are a topic's whole title, e.g. "Romantic poetry", "Shakespeare"
  const full = cands.filter(c => c.cov === 1 && qlFit(T, c.X.head, strict));
  if (full.length) return topicRows(full.slice(0, 4), true);
  // 2) Writers, works, and names or terms listed inside a topic
  let ns = R.length ? I.names.map(e => {
    const f = qlFit(R, e.words, strict); if (!f) return null;
    if (e.kind === 'work' && !(f.cov >= 0.6 || (R.length >= 2 && f.cov >= 0.5))) return null;
    if (e.kind === 'named' && f.cov < 0.5) return null;
    const bonus = e.kind === 'writer' ? 0.05 : e.kind === 'work' ? -0.35 : 0;     // a name on its own usually means the writer
    return { e, f, score: f.s * (0.6 + 0.4 * f.cov) + bonus };
  }).filter(Boolean).sort((a, b) => b.score - a.score || b.e.qn - a.e.qn) : [];
  // The same person spelt with and without initials ("Edward Said", "Edward W. Said") counts once.
  ns = ns.filter((x, i) => !ns.some((y, j) => j !== i && y.e.kind === x.e.kind && y.e.words.join(' ') === x.e.words.join(' ')
    && (y.e.qn > x.e.qn || (y.e.qn === x.e.qn && j < i)) && (() => { const a = words(x.e.name), b = words(y.e.name); return a.every(w => b.includes(w)) || b.every(w => a.includes(w)); })()));
  // A title that is only a writer's name ("Milton", "To Wordsworth") gives way to the writer.
  const wr = ns.filter(x => x.e.kind === 'writer');
  if (wr.length) ns = ns.filter(x => x.e.kind !== 'work' || !x.e.words.every(w => wr.some(y => y.e.words.includes(w))));
  const bestTopic = headCands.reduce((m, c) => Math.max(m, c.s), 0);
  const bestName = ns.length ? ns[0] : null;
  const topicWins = headCands.length && (!bestName || bestTopic > bestName.f.s || (bestTopic === bestName.f.s && bestName.e.kind === 'work' && bestName.f.cov < 1));
  if (bestName && !topicWins) {
    const top = ns[0], second = ns[1];
    const clear = !second || top.score - second.score >= 0.15 || (top.e.qn >= 3 * Math.max(1, second.e.qn) && top.score >= second.score - 0.01);
    const sure = clear && (top.f.s >= 2 || R.length >= 2);
    ns = ns.filter(x => x.score >= top.score - 0.6).slice(0, 4);
    const rows = ns.map((x, i) => ({ kind: x.e.kind === 'work' ? 'work' : x.e.kind === 'named' ? 'part' : 'writer', name: x.e.name, topic: qlBestTopic(x.e, H), on: i === 0 && sure }));
    if (!rows.some(r => r.on) && rows.length > 1) rows.unshift({ kind: 'head', name: `“${raw}” fits more than one. Tick the one you mean:` });
    return rows;
  }
  // 3) Topics that contain the typed words, but not as their full title
  if (headCands.length === 1) return topicRows(headCands, true);
  if (headCands.length > 1) {
    const list = headCands.sort((a, b) => b.cov - a.cov || b.s - a.s).slice(0, 12);
    return [{ kind: 'head', name: `“${raw}” fits ${plural(headCands.length, 'topic')}. Tick the ones you finished:` }].concat(topicRows(list, false));
  }
  return null;
}
// Split what was typed into entries. "Indian writers - Attia Hosain, Chetan Bhagat":
// the part before the dash is a hint for which topic the names belong to.
function qlParse(text) {
  const items = [];
  String(text || '').split(/\n+/).forEach(line => {
    line = line.trim(); if (!line) return;
    let hint = '';
    const head = line.split(/[,;]/)[0], re = /\s*(?::|–|—|-)\s*/g;
    let m;
    while ((m = re.exec(head))) {
      const left = head.slice(0, m.index).trim();
      if (left.length < 2) continue;
      const lw = words(left);
      const isCtx = lw.some(w => QL_CTX.has(w)) || (qlTopical(left).length && qlIndex().topics.some(X => qlFit(qlTopical(left), X.head, true)) && !qlIndex().names.some(e => e.kind !== 'named' && qlFit(qlRaw(left), e.words) && qlFit(qlRaw(left), e.words).cov === 1));
      if (isCtx) { hint = left; line = line.slice(m.index + m[0].length); break; }
    }
    line.split(/[,;]+/).forEach(p => {
      p = p.trim().replace(/^(?:and|&)\s+/i, '').replace(/[.\s]+$/, '');
      if (p) items.push({ raw: p, hint });
    });
  });
  return items;
}
function qlFind(text) {
  const rows = [], seen = new Set();
  const push = r => { const k = `${r.kind}|${norm(r.name)}|${r.topic || ''}`; if (r.kind !== 'head' && seen.has(k)) return; seen.add(k); rows.push(r); };
  qlParse(text).forEach(({ raw, hint }) => {
    let got = qlEntry(raw, hint);
    if (!got.length) {
      // Try the pieces: "Hard Times by Dickens", "Hard Times – Dickens", "Keats and Shelley"
      for (const sep of [/\s+by\s+/i, /\s+[-–—]\s+|[–—]/, /\s+(?:and|&)\s+/i]) {
        const parts = raw.split(sep).map(x => x.trim()).filter(Boolean);
        if (parts.length < 2) continue;
        const sub = parts.map(p => qlEntry(p, hint));
        if (sub.every(x => x.length)) { got = sub.flat(); break; }
      }
    }
    if (!got.length) {
      // Not found anywhere: keep it as a note, filed under the hint's topic when the hint points to just one.
      const H = qlTopical(hint), fits = H.length ? qlIndex().topics.filter(X => qlFit(H, X.head, true)) : [];
      got = [{ kind: 'note', name: raw, topic: fits.length === 1 ? fits[0].t.id : '', on: true }];
    }
    got.forEach(push);
  });
  return rows;
}

const qlP = () => { const p = sylP(); if (!p.covered) p.covered = {}; return p; };
function qlAdd(tid, item) {
  const c = qlP().covered, list = c[tid] || (c[tid] = []);
  if (!list.some(x => x.k === item.k && norm(x.n) === norm(item.n))) list.push(item);
}
// Learnt, dated the day before you started tracking, so it doesn't count towards "Your pace".
function qlLearnOld(id) {
  const t = topicById(id); if (!t || manualLearnt(t)) return false;
  const p = qlP(), r = p.syl[id] || (p.syl[id] = {}), t0 = todayStr();
  r.l = shiftDay(p.plan.start && p.plan.start < t0 ? p.plan.start : t0, -1);
  r.pre = 1;
  return true;
}
const QL_KIND = { topic: 'whole topic', writer: 'writer', work: 'work', part: 'part of a topic', note: 'not found' };
function qlWholeList() {
  const Q = S.ql, seen = new Set(), out = [];
  Q.rows.forEach(r => {
    if (!r.on || r.kind === 'topic' || r.kind === 'head' || !r.topic || seen.has(r.topic)) return;
    const t = topicById(r.topic); if (!t || learnt(t)) return;
    if (Q.rows.some(x => x.kind === 'topic' && x.on && x.topic === r.topic)) return;
    seen.add(r.topic); out.push(t);
  });
  return out;
}
function qlSheet() {
  const Q = S.ql, m = $('#modal');
  const found = Q.rows.filter(r => r.kind !== 'head').length;
  const wholes = qlWholeList();
  m.innerHTML = `<div class="sheet sy-sheet" role="dialog" aria-modal="true" aria-label="Quick log">
    <h3>Is this right?</h3>
    <p class="small muted">${found} ${found === 1 ? 'match' : 'matches'} found. Untick anything wrong, change the topic if needed, then tap Log these.</p>
    <div class="ql-list">${Q.rows.map((r, i) => {
      if (r.kind === 'head') return `<p class="ql-head">${esc(r.name)}</p>`;
      const t = r.topic && topicById(r.topic);
      const box = `<label class="ql-box"><input type="checkbox" class="ql-on" data-i="${i}" ${r.on ? 'checked' : ''} aria-label="Log ${esc(r.name)}"></label>`;
      if (r.kind === 'topic') return `<div class="ql-row">${box}<div class="grow"><b>${esc(r.name)}</b> <span class="ql-kind">${QL_KIND.topic}</span><br>
        <span class="sub">${esc(t ? (topicDesc(t) || t.group) : '')}${t && learnt(t) ? ' · already done ✓' : ' · ticks it Learnt'}</span></div></div>`;
      return `<div class="ql-row ${r.kind === 'note' ? 'note' : ''}">${box}<div class="grow"><b>${esc(r.name)}</b> <span class="ql-kind">${QL_KIND[r.kind]}</span>
        ${r.kind === 'note' ? '<br><span class="sub">Not in the syllabus or the question bank. Pick a topic to file it under, or keep it as a note.</span>' : ''}
        <div class="ql-sel">${topicSelect('ql-t-' + i, r.topic || '').replace('<select ', `<select data-change="qlTopic" data-i="${i}" aria-label="Topic for ${esc(r.name)}" `)}</div></div></div>`;
    }).join('')}</div>
    ${wholes.length ? `<div class="ql-whole-box"><p class="small"><b>Finished the whole topic?</b> Tick it to mark it Learnt too.</p>
      ${wholes.map(t => `<label class="check-row sy-check"><input type="checkbox" class="ql-whole" value="${esc(t.id)}" ${Q.wholeOn.has(t.id) ? 'checked' : ''}> ${esc(shortName(t))}</label>`).join('')}</div>` : ''}
    <div class="btn-row" style="margin-top:14px"><button class="btn" data-act="qlSave">Log these</button><button class="btn ghost" data-act="closeModal">Cancel</button></div>
  </div>`;
  m.hidden = false;
}
// Read the ticks and topic choices from the open list back into memory.
function qlCapture() {
  const Q = S.ql; if (!Q) return;
  Q.rows.forEach((r, i) => {
    const c = document.querySelector(`.ql-on[data-i="${i}"]`); if (c) r.on = c.checked;
    const s = document.getElementById('ql-t-' + i); if (s) r.topic = s.value;
  });
  document.querySelectorAll('.ql-whole').forEach(b => { if (b.checked) Q.wholeOn.add(b.value); else Q.wholeOn.delete(b.value); });
}
function quickLogCard() {
  if (!S.syllabus) return '';
  const cov = qlP().covered, order = new Map(sylTopics().map((t, i) => [t.id, i]));
  const keys = Object.keys(cov).filter(k => (cov[k] || []).length).sort((a, b) => (a === '_') - (b === '_') || (order.get(a) || 0) - (order.get(b) || 0));
  const total = keys.reduce((s, k) => s + cov[k].length, 0);
  return `<section class="card ql-card">
    <h3>Quick log</h3>
    <p class="small muted">Quickly add the areas you covered before today: topics, writers, works or theories. Separate them with commas. Use a new line to start a new group.</p>
    <textarea id="ql-text" data-in="qlText" rows="4" placeholder="e.g. Romantic poetry, Hard Times, Marxism&#10;Indian writers - Attia Hosain, Chetan Bhagat">${esc(S.qlText || '')}</textarea>
    <button class="btn" data-act="qlFind" style="margin-top:10px">Find in syllabus</button>
    ${total ? `<details class="ql-done" ${S.qlOpen ? 'open' : ''}><summary>Logged so far · ${total}</summary>
      ${keys.map(k => { const t = k !== '_' && topicById(k); return `<div class="ql-group"><div class="ql-gname">${esc(t ? shortName(t) : k === '_' ? 'Not linked to a topic' : 'Removed topic')}</div>
        <div class="ql-chips">${cov[k].map((x, i) => `<span class="ql-chip">${esc(x.k === 'topic' ? 'Whole topic ✓' : x.n)}<button data-act="qlDel" data-t="${esc(k)}" data-i="${i}" aria-label="Remove ${esc(x.n)}">✕</button></span>`).join('')}</div></div>`; }).join('')}
      <p class="small muted">Writers and works also show under their topic in Syllabus. ✕ removes one.</p></details>` : ''}
  </section>`;
}
const QL_ACT = {
  qlFind: () => {
    S.qlText = (($('#ql-text') || {}).value || '');
    if (!S.qlText.trim()) return toast('Type what you covered, separated by commas');
    const rows = qlFind(S.qlText);
    S.ql = { rows, wholeOn: new Set() };
    qlSheet();
  },
  qlSave: () => {
    qlCapture();
    const Q = S.ql; if (!Q) return;
    let n = 0;
    Q.rows.forEach(r => {
      if (!r.on || r.kind === 'head') return;
      if (r.kind === 'topic') { const t = topicById(r.topic); if (!t) return; qlLearnOld(t.id); qlAdd(t.id, { n: shortName(t), k: 'topic' }); n++; return; }
      qlAdd(r.topic || '_', { n: r.name, k: r.kind }); n++;
    });
    Q.wholeOn.forEach(id => { const t = topicById(id); if (!t) return; qlLearnOld(id); qlAdd(id, { n: shortName(t), k: 'topic' }); });
    if (!n && !Q.wholeOn.size) return toast('Nothing is ticked');
    COVVER++; saveProg(); closeModal(); S.ql = null; S.qlText = ''; S.qlOpen = true;
    toast(`Logged ${plural(n + Q.wholeOn.size, 'item')} ✿`);
    go('plan', true);
  },
  qlDel: d => {
    const p = qlP(), list = p.covered[d.t] || [], it = list[+d.i]; if (!it) return;
    if (it.k === 'topic') {
      if (!confirm(`Remove “${it.n}” from Quick log? It will no longer be ticked Learnt.`)) return;
      const r = p.syl[d.t]; if (r && r.pre) setLearnt(d.t, false);
    }
    list.splice(+d.i, 1); if (!list.length) delete p.covered[d.t];
    COVVER++; S.qlOpen = true; saveProg(); go(S.screen, true);
  }
};
QL_ACT.sylWriter = d => {
  const t = topicById(d.id); if (!t) return;
  const g = topicWriters(t).groups.find(x => x.name === d.n); if (!g) return;
  const p = qlP(), keys = new Set(g.names.map(norm));
  if (writerOn(g)) {
    Object.keys(p.covered).forEach(k => { p.covered[k] = p.covered[k].filter(x => !(x.k === 'writer' && keys.has(norm(x.n)))); if (!p.covered[k].length) delete p.covered[k]; });
  } else qlAdd(t.id, { n: g.name, k: 'writer' });
  COVVER++; saveProg(); go(S.screen, true);
};
const QL_CH = { qlTopic: () => { qlCapture(); qlSheet(); } };
const QL_IN = { qlText: v => { S.qlText = v; } };
Object.assign(SYL_ACT, QL_ACT); Object.assign(SYL_CH, QL_CH); Object.assign(SYL_IN, QL_IN);

(function addQuickLogStyles() {
  const s = document.createElement('style');
  s.textContent = `
    .ql-card textarea { width: 100%; font-size: 16px; line-height: 1.45; }
    .ql-list { margin-top: 6px; }
    .ql-head { margin: 14px 0 2px; font-weight: 700; font-size: 14px; color: var(--accent-ink); }
    .ql-row { display: flex; align-items: flex-start; gap: 10px; padding: 12px 0; border-top: 1px solid var(--border); }
    .ql-row .grow { flex: 1; min-width: 0; line-height: 1.4; }
    .ql-row .sub { font-size: 13px; color: var(--muted); }
    .ql-row.note b { color: var(--warn); }
    .ql-box { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; margin: -6px 0 0 -6px; cursor: pointer; }
    .ql-box input { width: 22px; height: 22px; accent-color: var(--purple); cursor: pointer; }
    .ql-kind { display: inline-block; padding: 1px 8px; border-radius: 999px; background: var(--lilac-soft); color: var(--accent-ink); font-size: 11px; font-weight: 800; letter-spacing: .04em; vertical-align: 2px; }
    .ql-sel { margin-top: 8px; }
    .ql-sel select { width: 100%; min-height: 42px; font-size: 14px; }
    .ql-whole-box { margin-top: 10px; padding: 10px 14px; border-radius: 16px; background: var(--lilac-soft); }
    .ql-done { margin-top: 14px; }
    .ql-done summary { cursor: pointer; font-weight: 700; color: var(--accent-ink); min-height: 40px; display: flex; align-items: center; }
    .ql-group { margin-top: 10px; }
    .ql-gname { font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
    .ql-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .ql-chip { display: inline-flex; align-items: center; gap: 2px; padding: 2px 2px 2px 12px; border-radius: 999px; background: var(--chip); border: 1.5px solid var(--border); font-size: 13.5px; font-weight: 600; }
    .ql-chip button { border: 0; background: none; width: 34px; height: 34px; border-radius: 999px; font-size: 13px; color: var(--muted); cursor: pointer; }
    .sy-writers { margin-top: 10px; padding: 10px 12px; border-radius: 14px; background: var(--card-2); border: 1px solid var(--border); }
    .sy-w-head { font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
    .sy-w-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 0; }
    .sy-w-line + .sy-w-line { border-top: 1px dashed var(--border); }
    .sy-w-lbl { flex-basis: 100%; font-size: 11.5px; font-weight: 800; color: var(--accent-ink); }
    .sy-w { display: inline-flex; align-items: center; gap: 5px; min-height: 36px; padding: 0 11px; border-radius: 999px; border: 1.5px solid var(--border); background: var(--chip); color: var(--ink); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .sy-w span { font-size: 11px; font-weight: 800; color: var(--muted); }
    .sy-w.often { background: var(--pinkrow); border-color: var(--pink); font-weight: 800; }
    .sy-w.once { font-size: 12.5px; min-height: 32px; }
    .sy-w.on { background: var(--ok-bg); border-color: var(--ok); color: var(--ok); }
    .sy-w.on span { color: var(--ok); }
    .sy-w-note { margin: 4px 0 0; }
    .sy-node-cov { margin-top: 5px; font-size: 13px; line-height: 1.45; color: var(--ok); }`;
  document.head.appendChild(s);
})();

/* ---------- PYQ years line (home screen footer) ---------- */
function pyqYearsLine() {
  const span = ex => { const ys = S.questions.filter(q => q.exam === ex).map(qYear).filter(Boolean); return ys.length ? (Math.min(...ys) === Math.max(...ys) ? `${Math.max(...ys)}` : `${Math.max(...ys)}–${Math.min(...ys)}`) : ''; };
  const parts = [['NET', span('NET')], ['GATE', span('GATE')]].filter(x => x[1]).map(([e, s]) => `${e} PYQs ${s}`);
  return parts.length ? parts.join(' · ') : '';
}

/* ---------- Admin: paste a whole paper ----------
   Paste the paper as plain text (as it looks in a Word file), or paste the JSON
   batch Claude gives you. The app reads every question, shows a preview, and
   saves all of them to GitHub in one go.                                     */
const BULK_EXAMPLE = `Exam: NET
Year: 2024
Session: June
Shift: 1
Topics: British, Romantic Age, Poetry

1. Who wrote "Tintern Abbey"?
A) S. T. Coleridge
B) William Wordsworth
C) John Keats
D) P. B. Shelley
Answer: B
Writers: William Wordsworth
Works: Tintern Abbey
Info: Published in Lyrical Ballads (1798), the volume's closing poem.

2. Match List I with List II
List I
A. Beowulf
B. The Prelude
List II
I. Old English
II. Romantic
(1) A-I, B-II
(2) A-II, B-I
(3) A-I, B-I
(4) A-II, B-II
Answer: 1
Topics: British, Chronology`;
const BH_RE = /^\s*(exam|year|session|shift|topics?|writers?|works?|source|verified|section)\s*[:=]\s*(.*)$/i;
const BQ_RE = /^\s*(?:Q(?:uestion)?\s*\.?\s*)?(\d{1,3})\s*[.):]\s+(.*)$/i;
const BF_RE = /^\s*(answer|ans|correct(?: answer)?|key|topics?|writers?|works?|info(?: ?bite)?|note|type|id|study(?: note)?|keywords?)\s*[:=]\s*(.*)$/i;
const BO_RE = /^\s*[\(\[]?([A-Da-d1-4])[\)\].]\s+(.+)$/;
function parseBulk(text) {
  const raw = String(text || '').trim();
  if (!raw) return { qs: [], errs: [] };
  if (raw[0] === '[' || raw[0] === '{') {
    try {
      let arr = JSON.parse(raw); if (!Array.isArray(arr)) arr = arr.questions || [arr];
      return { qs: arr.map((q, i) => ({ q, no: i + 1, errs: bulkCheck(q) })), json: true };
    } catch (e) { return { qs: [], fatal: 'This looks like JSON but has a typing error: ' + e.message }; }
  }
  const head = {}, blocks = [];
  let cur = null;
  raw.replace(/\r/g, '').split('\n').forEach(line => {
    const qm = line.match(BQ_RE);
    if (qm && !(cur && BO_RE.test(line) && /^\s*[\(\[]/.test(line))) { cur = { no: +qm[1], lines: [qm[2]] }; blocks.push(cur); return; }
    if (!cur) { const hm = line.match(BH_RE); if (hm) head[hm[1].toLowerCase().replace(/s$/, '')] = hm[2].trim(); return; }
    cur.lines.push(line);
  });
  const sess = String(head.session || '').trim(), yr = String(head.year || '').trim(), sh = String(head.shift || '').trim();
  const exam = /gate/i.test(head.exam || '') ? 'GATE' : /prob/i.test(head.exam || '') ? 'Probable' : /abrams/i.test(head.exam || '') ? 'Abrams' : 'NET';
  const qs = blocks.map(b => {
    const fields = {}, body = [];
    b.lines.forEach(l => { const fm = l.match(BF_RE); if (fm) fields[fm[1].toLowerCase()] = fm[2].trim(); else body.push(l); });
    // Options = the LAST run of four lines marked A–D (or 1–4), so lists inside the question stay in the question.
    let optStart = -1, kind = '';
    for (let i = body.length - 1; i >= 0; i--) {
      const m = body[i].match(BO_RE); if (!m) continue;
      const k = m[1].toUpperCase();
      if (k === 'A' || k === '1') {
        const run = []; let j = i;
        while (j < body.length && run.length < 4) { const mm = body[j].match(BO_RE); if (mm) run.push(mm[1].toUpperCase()); else if (body[j].trim()) break; j++; }
        if (run.join('') === 'ABCD' || run.join('') === '1234') { optStart = i; kind = run[0]; break; }
      }
    }
    const options = {};
    let qLines = body;
    if (optStart >= 0) {
      qLines = body.slice(0, optStart);
      let n = 0;
      body.slice(optStart).forEach(l => { const m = l.match(BO_RE); if (m && n < 4) { options[LETTERS[n]] = m[2].trim(); n++; } else if (l.trim() && n) options[LETTERS[n - 1]] += ' ' + l.trim(); });
    }
    const question = qLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    let ans = fields.answer || fields.ans || fields['correct answer'] || fields.correct || fields.key || '';
    ans = ans.replace(/[()\[\]]/g, '').trim();
    const nat = !Object.keys(options).length;
    let answer = nat ? ans : ans.toUpperCase().split(/[^A-D1-4]+/).filter(Boolean).map(x => /\d/.test(x) ? LETTERS[+x - 1] : x).filter(Boolean);
    if (!nat) answer = [...new Set(answer)].sort().join(';');
    const tl = (fields.type || '').toLowerCase();
    const type = tl || (/list\s*-?\s*i\b|match/i.test(question) ? 'match' : /assertion/i.test(question) ? 'assertion-reason' : /chronolog|sequence|correct order|earliest to|order of (their )?(publication|appearance)/i.test(question) ? 'chronology' : /passage|read the (following )?(extract|lines|poem)/i.test(question) ? 'passage' : nat ? 'numerical' : 'MCQ');
    const id = fields.id || (exam === 'GATE' ? `GATE-${yr || 'X'}-Q${b.no}` : exam === 'NET' ? `NET-${yr || 'X'}-${(sess || 'X').slice(0, 3).toUpperCase()}${sh ? '-S' + sh : ''}-Q${b.no}` : `${exam.toUpperCase()}-${yr || 'X'}-Q${b.no}`);
    const q = { id, exam, question, options: nat ? {} : options, answer, type, format: nat ? 'NAT' : answer.includes(';') ? 'MSQ' : 'MCQ',
      topics: splitList(fields.topics || fields.topic || head.topic || ''), writers: splitList(fields.writers || fields.writer || head.writer || ''), works: splitList(fields.works || fields.work || head.work || ''),
      infoBite: fields.info || fields['info bite'] || fields.infobite || '', verified: !/^(no|false|n)$/i.test(head.verified || 'yes') };
    if (yr) q.year = /^\d+$/.test(yr) ? +yr : yr;
    if (sess) q.session = sess;
    if (sh) q.shift = /^\d+$/.test(sh) ? +sh : sh;
    if (head.source) q.source = head.source;
    if (head.section) q.topics = q.topics.length ? q.topics : splitList(head.section);
    if (fields.note) q.note = fields.note;
    if (fields.study || fields['study note']) q.studyNote = fields.study || fields['study note'];
    if (fields.keywords || fields.keyword) q.keywords = splitList(fields.keywords || fields.keyword);
    const errs = bulkCheck(q); if (!yr && (exam === 'NET' || exam === 'GATE')) errs.push('Add a “Year:” line at the top');
    return { q, no: b.no, errs, warn: !q.topics.length ? 'No topic tags, so it lands in “Mixed” in the Guide' : '' };
  });
  return { qs, head };
}
function bulkCheck(q) {
  const e = [];
  if (!q || !q.question) e.push('No question text');
  if (q && !q.id) e.push('No ID');
  if (q && q.format !== 'NAT' && hasOptions(q) && LETTERS.some(L => !(q.options || {})[L])) e.push('Needs four options A–D');
  if (q && (q.answer == null || q.answer === '')) e.push('No answer (add a line “Answer: B”)');
  else if (q && q.format !== 'NAT' && hasOptions(q) && !ansList(q).length) e.push('Answer must be A–D or 1–4');
  if (q && byId(q.id)) e.push('This ID is already in the bank');
  return e;
}
VIEWS.adminBulk = () => {
  if (!isAdmin()) return VIEWS.more();
  const P = S.bulk || { qs: [] }, ok = (P.qs || []).filter(x => !x.errs.length), bad = (P.qs || []).filter(x => x.errs.length);
  const ids = new Map(); (P.qs || []).forEach(x => { if (x.q && x.q.id) ids.set(x.q.id, (ids.get(x.q.id) || 0) + 1); });
  return `
  <button class="chip back" data-act="tab" data-tab="more">‹ Back</button>
  <section class="card form">
    <h2>Paste a whole paper</h2>
    <p class="small muted">Copy the paper from your Word file and paste it below. Put the paper details at the top, then each question with its number, four options and an <b>Answer:</b> line. You can also paste the JSON batch I give you.</p>
    <details class="sa-sec"><summary>See the format (with an example)</summary>
      <pre class="bulk-ex">${esc(BULK_EXAMPLE)}</pre>
      <ul class="small">
        <li>Number each question: <b>1.</b> or <b>Q1.</b> at the start of a line. Word's automatic numbering often disappears when you copy, so type the numbers if they vanish.</li>
        <li>Options: <b>A)</b> … <b>D)</b>, or <b>(A)</b>, or <b>(1)</b> … <b>(4)</b>. Lists inside a match question can stay as they are.</li>
        <li><b>Answer:</b> a letter or number (B or 2); for more than one, <b>A, C</b>; for a number answer with no options, just the number.</li>
        <li>Optional lines under any question: <b>Topics:</b>, <b>Writers:</b>, <b>Works:</b>, <b>Info:</b>, <b>Note:</b>. A <b>Topics:</b> line at the top applies to every question that has none.</li>
        <li>Add <b>Verified: no</b> at the top if the answers are not from the final official key yet.</li>
      </ul>
      <button class="btn ghost" data-act="bulkExample">Fill in the example</button>
    </details>
    <label class="field-label" for="bulk-text">Paper</label>
    <textarea id="bulk-text" rows="14" placeholder="Exam: NET&#10;Year: 2024&#10;Session: June&#10;Shift: 1&#10;&#10;1. Question…&#10;A) …&#10;B) …&#10;C) …&#10;D) …&#10;Answer: B">${esc(S.bulkText || '')}</textarea>
    <button class="btn" data-act="bulkRead">Read questions</button>
  </section>
  ${P.fatal ? `<section class="card"><p class="warn-text">${esc(P.fatal)}</p></section>` : ''}
  ${(P.qs || []).length ? `
  <section class="card">
    <h3>Preview</h3>
    <p class="small"><b>${plural(ok.length, 'question')}</b> ready${bad.length ? ` · <span class="warn-text">${bad.length} need fixing</span> (they won't be saved)` : ''}.</p>
    ${(P.qs || []).map(x => {
      const q = x.q || {}, dup = ids.get(q.id) > 1;
      const errs = x.errs.concat(dup ? ['Same ID twice in this paste'] : []);
      return `<div class="wrong-item ${errs.length ? 'bulk-bad' : ''}">
        <div class="tags"><span class="tag src">${esc(q.id || '#' + x.no)}</span>${q.type && q.type !== 'MCQ' ? `<span class="tag">${esc(q.type)}</span>` : ''}${q.verified === false ? '<span class="tag warn">Unverified</span>' : ''}</div>
        <div class="q" style="white-space:pre-line">${esc(q.question || '')}</div>
        ${hasOptions(q) ? `<div class="small" style="margin-top:6px">${LETTERS.map(L => `<div>${L}. ${esc((q.options || {})[L] || '—')}</div>`).join('')}</div>` : ''}
        <div class="ans">Answer: <b>${esc(q.answer ? answerText(q) : '—')}</b></div>
        ${(q.topics || []).length ? `<p class="small muted" style="margin:4px 0 0">${esc(q.topics.join(' › '))}</p>` : ''}
        ${errs.length ? `<p class="small warn-text" style="margin:6px 0 0">⚠ ${esc(errs.join(' · '))}</p>` : x.warn ? `<p class="small muted" style="margin:6px 0 0">${esc(x.warn)}</p>` : ''}
      </div>`;
    }).join('')}
    <button class="btn" data-act="bulkSave" id="bulk-save" ${ok.length ? '' : 'disabled'}>Save ${plural(ok.length, 'question')} to GitHub</button>
  </section>` : ''}`;
};
const BULK_ACT = {
  adminBulk: () => { S.bulk = null; go('adminBulk'); },
  bulkExample: () => { S.bulkText = BULK_EXAMPLE; S.bulk = null; go('adminBulk', true); },
  bulkRead: () => {
    S.bulkText = ($('#bulk-text') || {}).value || '';
    S.bulk = parseBulk(S.bulkText);
    if (!S.bulk.fatal && !S.bulk.qs.length) toast('No numbered questions found. Start each with 1. or Q1.', 4500);
    go('adminBulk', true);
    const el = document.querySelector('.bulk-bad') || $('#bulk-save'); if (el && S.bulk.qs.length) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },
  bulkSave: async () => {
    const P = S.bulk; if (!P) return;
    const seen = new Map(); P.qs.forEach(x => { if (x.q && x.q.id) seen.set(x.q.id, (seen.get(x.q.id) || 0) + 1); });
    const ok = P.qs.filter(x => !x.errs.length && seen.get(x.q.id) === 1).map(x => x.q);
    if (!ok.length) return;
    if (!confirm(`Add ${plural(ok.length, 'question')} to the bank for everyone?`)) return;
    const btn = $('#bulk-save'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      let added = 0;
      const arr = await ghUpdate(list => { const have = new Set(list.map(x => x.id)); ok.forEach(q => { if (!have.has(q.id)) { list.push(q); added++; } }); return list; }, `Add ${ok.length} questions (paste)`);
      applyBank(arr);
      S.bulk = null; S.bulkText = '';
      toast(`Saved ${plural(added, 'question')} ✿ Everyone sees them in 1–2 minutes`, 4500);
      go('adminList');
    } catch (e) { toast(e.message, 5000); if (btn) { btn.disabled = false; btn.textContent = 'Try saving again'; } }
  }
};

/* ---------- Where "Report a mistake" emails go (shared, saved in syllabus.json → settings) ---------- */
const reportEmail = () => (S.syllabus && S.syllabus.settings && S.syllabus.settings.reportEmail) || CONFIG.reportEmail;
const EMAIL_ACT = {
  saveReportEmail: async () => {
    const v = (($('#report-email') || {}).value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return toast('That doesn’t look like an email address');
    if (v === reportEmail()) return toast('That is already the address');
    const btn = $('#report-email-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const saved = await ghSaveJSON('syllabus.json', cur => {
        const base = cur || JSON.parse(JSON.stringify(S.syllabus || {}));
        base.settings = Object.assign({}, base.settings, { reportEmail: v });
        return base;
      }, 'Change report email');
      S.syllabus = saved; TQCACHE = { key: '', map: new Map() }; WTCACHE = {};
      toast('Saved ✿ Reports now go to ' + v, 4000);
      render();
    } catch (e) { toast(e.message, 5000); if (btn) { btn.disabled = false; btn.textContent = 'Save'; } }
  }
};

/* =========================================================
   ROUTING & EVENTS
   ========================================================= */
const MAIN_TABS = ['home', 'guide', 'syllabus', 'plan', 'stats', 'more'];
const TAB_OF = { quiz: 'home', results: 'home', guideTopic: 'guide', guideCat: 'guide', exam: 'guide', notes: 'guide', adminList: 'more', adminForm: 'more', adminBulk: 'more', sylAdmin: 'syllabus' };
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
  clearTags: () => { S.filters.tags = null; S.filters.group = null; S.filters.work = null; render(); },
  mode: d => { S.filters.mode = d.v; go('home', true); },
  count: d => { S.filters.count = d.v; go('home', true); },
  pickSection: d => {
    const f = S.filters;
    if (f.group && f.group.id === d.id) f.group = null;
    else { const c = gNode(d.id); if (!c) return; Object.assign(f, { group: { id: c.id, label: c.name }, tags: null, query: '', work: null }); }
    go('home', true);
  },
  pickTopic: d => { S.filters.query = d.v; S.filters.tags = null; S.filters.group = null; S.filters.work = null; go('home', true); toast(`Showing “${d.v}”`); },
  start: () => {
    const f = S.filters;
    let list = filtered();
    const order = l => f.shuffle ? shuffleArr(l) : l.slice();
    if (f.fresh) {
      // unanswered first; then repeats, the ones answered longest ago first
      const unseen = list.filter(q => !seenQ(q));
      const seen = order(list.filter(seenQ)).sort((a, b) => String(S.prog.attempts[a.id].last || '').localeCompare(String(S.prog.attempts[b.id].last || '')));
      list = order(unseen).concat(seen);
    } else list = order(list);
    if (f.count !== 'all') list = list.slice(0, +f.count);
    const label = MODES.find(m => m[0] === f.mode)[1];
    const what = f.work ? f.work.label : f.group ? f.group.label : f.tags ? f.tags.join(' › ') : f.query.trim();
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
  // Skip: moves on without answering. Nothing is recorded — not wrong, not a mistake, no change to revision.
  skip: () => {
    const z = S.quiz, q = z.list[z.i];
    if (z.answers[q.id]) return;
    if (z.sel) delete z.sel[q.id];
    if (z.i < z.list.length - 1) { z.i++; go('quiz'); toast('Skipped — you can answer it from the results'); }
    else finishQuiz();
  },
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
      window.location.href = `mailto:${reportEmail()}?subject=${encodeURIComponent('Camp mistake: ' + q.id)}&body=${encodeURIComponent(text)}`;
    }
    closeModal();
  },

  /* results */
  retryWrong: () => startQuiz(shuffleArr(S.quiz.wrong), 'Retry wrong ones'),
  retrySkipped: () => startQuiz((S.quiz.skippedList || []).slice(), 'Skipped questions'),
  bookmarkWrong: () => { S.quiz.wrong.forEach(q => { if (!S.prog.bookmarks[q.id]) S.prog.bookmarks[q.id] = Date.now(); }); saveProg(); toast('All wrong questions bookmarked ★'); go('results', true); },

  /* guide & stats */
  openGuide: d => { const t = gNode(d.id); if (!t) return; S.guideId = d.id; go(t.cat ? 'guideTopic' : 'guideCat'); },
  openExam: () => { S.examShow = 3; go('exam'); },
  openNotes: () => go('notes'),
  notesFilter: d => { S.notesRadar = d.v === 'radar'; go('notes', true); },
  notesTab: d => { S.notesTab = d.v; go('notes', true); },
  quizWork: d => {
    const x = [...notesData().whole, ...notesData().facts].find(w => w.k === d.k); if (!x) return;
    Object.assign(S.filters, { work: { label: x.title, ids: x.ids }, group: null, tags: null, query: '', mode: 'mix' });
    go('home'); toast('Work set — tap Start quiz');
  },
  moreExamples: () => { S.examShow = (S.examShow || 3) + 3; go('exam', true); },
  guideMode: d => { S.guideMode = d.v; S.guideQuery = ''; go('guide', true); },
  quizTopic: d => {
    const t = gNode(d.id); if (!t) return;
    Object.assign(S.filters, { group: { id: t.id, label: nodeLabel(t) }, tags: null, query: '', mode: 'mix', work: null });
    go('home'); toast('Topic set — pick PYQs, Probable or Mix, then Start');
  },
  statTopic: d => {
    const t = gNode(d.id); if (!t) return;
    Object.assign(S.filters, { group: { id: t.id, label: nodeLabel(t) }, tags: null, query: '', mode: 'mix', work: null });
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
    if (!confirm('Clear all mistakes, bookmarks, stats, revision, syllabus ticks and your plan on this device? This cannot be undone.')) return;
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
      try { localStorage.setItem('skipgc', 't'); } catch (e) { /* ignore */ }
      toast('Signed in as admin on this device ✿'); render();
    } catch (e) { toast(e.message, 4500); btn.disabled = false; btn.textContent = 'Check key and sign in'; }
  },
  logout: () => {
    if (!confirm('Remove the GitHub key from this device?')) return;
    localStorage.removeItem(ADMIN_KEY);
    try { localStorage.removeItem('skipgc'); } catch (e) { /* ignore */ }
    render();
  },
  adminAdd: () => { S.edit = null; go('adminForm'); },
  adminList: () => { S.adminShow = ADMIN_PAGE; go('adminList'); },
  adminUnverified: () => { S.adminFilter = 'unverified'; S.adminQuery = ''; S.adminShow = ADMIN_PAGE; go('adminList'); },
  adminFilter: d => { S.adminFilter = d.v; S.adminShow = ADMIN_PAGE; go('adminList', true); },
  adminMore: () => { S.adminShow += ADMIN_PAGE; const el = $('#admin-list'); if (el) el.innerHTML = adminListHTML(); },
  editQ: d => { const q = byId(d.id); if (!q) return; S.edit = JSON.parse(JSON.stringify(q)); go('adminForm'); },
  cancelForm: () => { const back = S.prevScreen === 'adminForm' ? 'more' : S.prevScreen; S.edit = null; go(back || 'more'); },
  verifyQ: d => openVerify(d.id),
  confirmVerify: async d => {
    const note = (($('#verify-note') || {}).value || '').trim();
    const btn = $('#verify-btn'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const arr = await ghUpdate(list => {
        const i = list.findIndex(x => x.id === d.id);
        if (i < 0) throw new Error('This question is no longer on GitHub.');
        const q = Object.assign({}, list[i], { verified: true });
        if (note) q.note = note; else delete q.note;
        list[i] = q;
        return list;
      }, `Verify question ${d.id}`);
      applyBank(arr);
      closeModal();
      toast('Marked verified ✓ Everyone sees it in 1–2 minutes', 4000);
      go(S.screen, true);
    } catch (e) { toast(e.message, 5000); if (btn) { btn.disabled = false; btn.textContent = '✓ Mark verified'; } }
  },
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

Object.assign(ACT, SYL_ACT, BULK_ACT, EMAIL_ACT);

const IN = {
  query: v => { S.filters.query = v; refreshMatch(); },
  guideQuery: v => { S.guideQuery = v; const el = $('#guide-list'); if (el) el.innerHTML = guideListHTML(); },
  adminQuery: v => { S.adminQuery = v; S.adminShow = ADMIN_PAGE; const el = $('#admin-list'); if (el) el.innerHTML = adminListHTML(); }
};
Object.assign(IN, SYL_IN);
const CH = {
  shuffle: el => { S.filters.shuffle = el.checked; },
  fresh: el => { S.filters.fresh = el.checked; },
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

Object.assign(CH, SYL_CH);

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
// Small extra styles for multi-answer selection, the number box and the Skip button
// (kept here so style.css needs no change).
(function addAnswerStyles() {
  const s = document.createElement('style');
  s.textContent = `
    .opt.selected { outline: 2px solid #a98bd6; outline-offset: -2px; background: rgba(169, 139, 214, .18); }
    #nat-input { width: 100%; margin-top: 6px; font-size: 1.1rem; }
    .nat-given { margin-top: 12px; }
    #verify-note { width: 100%; }
    .btn + .skip-btn { margin-top: 10px; }
    .kx-entry { display: flex; align-items: center; gap: 14px; width: 100%; text-align: left; cursor: pointer; font: inherit; color: inherit; }
    .kx-entry .name { font-weight: 700; font-size: 1.05rem; }
    .kx-entry .sub { color: var(--muted); font-size: .88rem; }
    .kx-row { display: flex; justify-content: space-between; gap: 12px; margin-top: 12px; font-size: .95rem; }
    .kx-key { margin: 16px 0 0; padding: 12px 14px; border-radius: 14px; background: var(--lilac-soft); }
    .kx-table { width: 100%; border-collapse: collapse; font-size: .93rem; }
    .kx-table th { text-align: right; color: var(--muted); font-weight: 700; padding: 6px 4px; font-size: .8rem; letter-spacing: .04em; }
    .kx-table td { padding: 9px 4px; border-top: 1px solid var(--border); }
    .kx-table td:not(:first-child) { text-align: right; white-space: nowrap; width: 3.6em; font-weight: 700; }
    .kx-table tr.gate-more td { background: var(--blue-soft); }
    .kx-table tr.net-more td { background: var(--pinkrow); }
    .kx-dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; vertical-align: middle; }
    .kx-dot.gate-more { background: var(--blue); } .kx-dot.net-more { background: var(--pink); }
    .ex-pair { border: 1px solid var(--border); border-radius: 16px; padding: 14px; margin-top: 14px; background: var(--card-2); }
    .ex-work { font-weight: 700; color: var(--accent-ink); margin-bottom: 8px; }
    .ex-side .q { white-space: pre-line; margin: 6px 0; }
    .ex-side .ans { font-size: .9rem; }
    .ex-arrow { text-align: center; color: var(--muted); font-size: .85rem; margin: 10px 0; }
    .kx-tip { margin-top: 12px; padding: 12px 14px; border-radius: 14px; background: var(--blue-soft); line-height: 1.5; }
    .nr-card { padding-top: 18px; }
    .nr-title { font-family: "Cormorant Garamond", Georgia, serif; font-size: 1.4rem; font-weight: 700; line-height: 1.25; }
    .nr-writer { color: var(--accent-ink); font-weight: 600; margin-top: 2px; }
    .nr-tags { margin: 10px 0 4px; }
    .nr-note { margin: 10px 0; padding: 12px 14px; border-radius: 14px; background: var(--pinkrow); line-height: 1.55; }
    .pill.nr-radar { background: var(--blue); color: var(--ink); }
    .nr-asked { margin: 6px 0 12px; font-size: .92rem; }
    .nr-asked summary { cursor: pointer; color: var(--accent-ink); font-weight: 600; }
    .nr-asked ul { margin: 8px 0 0; padding-left: 18px; }
    .nr-asked li { margin-bottom: 6px; }
    .nr-fact .name { font-weight: 700; }
    .nr-fact-line { display: inline-block; margin: 4px 0; font-size: .9rem; line-height: 1.45; }`;
  document.head.appendChild(s);
})();

// Visitor counter (GoatCounter). Counts only when online; never counts the admin's own device.
(function addVisitorCounter() {
  if (!CONFIG.goatcounter || isAdmin()) return;
  if (!/github\.io$/.test(location.hostname)) return;   // don't count test copies opened elsewhere
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${CONFIG.goatcounter}.goatcounter.com/count`;
  document.head.appendChild(s);
})();

async function loadData() {
  try {
    const [qs, guide, syllabus] = await Promise.all([
      fetch('questions.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch('guide.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { topics: [] }).catch(() => ({ topics: [] })),
      fetch('syllabus.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null)
    ]);
    applyBank(Array.isArray(qs) ? qs : (qs.questions || []));
    S.guide = guide && guide.categories ? guide : { categories: [] };
    S.syllabus = syllabus && syllabus.exams && syllabus.topics ? syllabus : null;
    GCACHE = null; WCACHE = null; ECACHE = null; NCACHE = null;
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
