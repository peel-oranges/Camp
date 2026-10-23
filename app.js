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
  questions: [], guide: { categories: [] }, loaded: false, loadError: false,
  prog: loadProg(),
  filters: { mode: 'mix', query: '', tags: null, group: null, count: '10', shuffle: true, fresh: true },
  screen: 'home', tab: 'home', prevScreen: 'home',
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
        <button class="btn" data-act="adminList">Manage questions</button>
        <button class="btn ghost" data-act="adminAdd">Add question</button>
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
    <button class="btn ghost" data-act="adminAdd">Add a new question</button>
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
      <button class="btn" data-act="sendReport" data-via="wa" data-id="${esc(q.id)}">Send on WhatsApp</button>
      <button class="btn ghost" data-act="sendReport" data-via="mail" data-id="${esc(q.id)}">Send by email</button>
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
   ROUTING & EVENTS
   ========================================================= */
const MAIN_TABS = ['home', 'guide', 'stats', 'more'];
const TAB_OF = { quiz: 'home', results: 'home', guideTopic: 'guide', guideCat: 'guide', exam: 'guide', notes: 'guide', adminList: 'more', adminForm: 'more' };
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
      window.location.href = `mailto:${CONFIG.reportEmail}?subject=${encodeURIComponent('Camp mistake: ' + q.id)}&body=${encodeURIComponent(text)}`;
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

const IN = {
  query: v => { S.filters.query = v; refreshMatch(); },
  guideQuery: v => { S.guideQuery = v; const el = $('#guide-list'); if (el) el.innerHTML = guideListHTML(); },
  adminQuery: v => { S.adminQuery = v; S.adminShow = ADMIN_PAGE; const el = $('#admin-list'); if (el) el.innerHTML = adminListHTML(); }
};
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
    const [qs, guide] = await Promise.all([
      fetch('questions.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch('guide.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : { topics: [] }).catch(() => ({ topics: [] }))
    ]);
    applyBank(Array.isArray(qs) ? qs : (qs.questions || []));
    S.guide = guide && guide.categories ? guide : { categories: [] };
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
