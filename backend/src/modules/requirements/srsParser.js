'use strict';
// Pure SRS parsing (no I/O, no database, no ai-service). Two modes:
//   - TEMPLATE: requirement tables of our SRS template (header row with ID, Title, Requirement statement). Read exactly.
//   - HEURISTIC: rule-based reading of free text (numbered lists under section headings, numbered requirement lines and
//     sentences with shall / must / should / will). NOT a trained model: every candidate carries confidence "medium" or "low",
//     and only "medium" ones are suggested for import.
// Nothing here logs or stores content.

const MAX_CANDIDATES = 300;

// ------------------------------------------------------------------ small helpers
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const normalise = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => clean(s).split(' ').filter(Boolean);

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const cellText = (html) => clean(decode(html.replace(/<\/p>\s*<p[^>]*>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')));

// Placeholders left in a template: <xx>, <x>, <xx:00>, <all weekdays/xxx days per year> ...
const PLACEHOLDER_RE = /<[^<>\n]{1,40}>/;
const hasPlaceholder = (s) => PLACEHOLDER_RE.test(String(s ?? ''));

/** "Must" -> High, "Should" -> Medium, "Could" / "Won't" -> Low. Already High/Medium/Low is kept. Anything else: null. */
function mapPriority(p) {
  const v = clean(p).toLowerCase().replace(/[’']/g, '');
  if (!v) return null;
  if (/^(must|high|critical|p1)\b/.test(v)) return 'High';
  if (/^(should|medium|med|normal|p2)\b/.test(v)) return 'Medium';
  if (/^(could|wont|will not|would|low|p3|nice)\b/.test(v)) return 'Low';
  return null;
}

// Title: the short lead phrase before a colon when it has 8 words or fewer, otherwise the first 8 words.
function buildTitle(statement, maxWords = 8) {
  const s = clean(statement).replace(/^[-•*\d.)\s]+(?=[A-Za-z])/, '');
  const colon = s.indexOf(':');
  if (colon > 0) {
    const lead = s.slice(0, colon).trim();
    if (!/[.;!?]/.test(lead) && words(lead).length <= maxWords && lead.length >= 3) return lead[0].toUpperCase() + lead.slice(1);
  }
  const w = words(s).slice(0, maxWords);
  while (w.length > 1 && /^(and|or|to|of|for|in|on|at|by|with|that|which|a|an|the)$/i.test(w[w.length - 1])) w.pop();
  const t = w.join(' ').replace(/[,;:.\-–]+$/, '');
  return t ? t[0].toUpperCase() + t.slice(1) : 'Requirement';
}

const NFR_RE = /\b(performance|availab\w*|uptime|downtime|security|secure|encrypt\w*|privacy|response times?|within \d+(?:\s*-\s*\d+)?\s*(?:seconds?|ms|milliseconds?|minutes?)|percent|\d+\s*%|compliance|complian\w*|gdpr|iso \d+|wcag|scalab\w*|scaleab\w*|reliab\w*|backup\w*|accessib\w*|usab\w*|maintainab\w*|audit trail|throughput|latency|concurrent|restore|authenticat\w*|ssl|https)\b/i;
const guessType = (text) => (NFR_RE.test(text) ? 'NFR' : 'FR');

// ------------------------------------------------------------------ TEMPLATE mode
const rowsOf = (tableHtml) => [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
  .map((m) => [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => cellText(c[1])));

function typeFromHeading(h) {
  const v = String(h ?? '').toLowerCase();
  if (/non[\s-]*functional/.test(v)) return 'NFR'; // checked first: "non-functional" contains "functional"
  if (/functional/.test(v)) return 'FR';
  return null;
}
const typeFromId = (id) => (/^\s*nfr/i.test(id) ? 'NFR' : /^\s*fr/i.test(id) ? 'FR' : null);

const COLS = [
  ['id', /^id$|^req(uirement)?\.?\s*id$/], ['title', /^title$|^name$|^short title$/],
  ['statement', /^requirement statement$|^statement$|^requirement$|^description$/],
  ['featureArea', /^feature area$|^area$|^category$/], ['priority', /^priority$|^moscow$/], ['verification', /^verification$|^verification method$/],
];
function mapColumns(header) {
  const idx = {};
  header.forEach((h, i) => {
    const key = h.toLowerCase().replace(/[:*]/g, '').trim();
    for (const [name, re] of COLS) if (idx[name] === undefined && re.test(key)) idx[name] = i;
  });
  return idx.id !== undefined && idx.title !== undefined && idx.statement !== undefined ? idx : null;
}

const isPlaceholderRow = (title, statement) => /^\s*\[/.test(statement) || /^\s*the system shall\s*\[/i.test(statement) || /^\s*\[/.test(title);

/**
 * @param {string} html  mammoth.convertToHtml output
 * @returns {{ found: boolean, candidates: object[], warnings: string[] }}  found = at least one requirement table existed
 */
function parseTemplateHtml(html) {
  const tokens = [...String(html ?? '').matchAll(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>|<table[^>]*>([\s\S]*?)<\/table>/gi)];
  const candidates = [];
  const warnings = [];
  let heading = '';
  let found = false;
  let skippedPlaceholders = 0;
  for (const t of tokens) {
    if (t[1]) { heading = cellText(t[2]); continue; }
    const rows = rowsOf(t[3]);
    const cols = rows.length ? mapColumns(rows[0]) : null;
    if (!cols) continue;
    found = true;
    for (const r of rows.slice(1)) {
      const get = (k) => (cols[k] === undefined ? '' : r[cols[k]] ?? '');
      const sourceId = get('id');
      const title = get('title');
      const statement = get('statement');
      if (!sourceId && !title && !statement) continue;
      if (isPlaceholderRow(title, statement)) { skippedPlaceholders += 1; continue; }
      if (!statement) { warnings.push(`${sourceId || 'A row'} has an empty requirement statement and was skipped.`); continue; }
      candidates.push({
        sourceId, title: title || buildTitle(statement), description: statement,
        type: typeFromHeading(heading) ?? typeFromId(sourceId) ?? guessType(statement),
        featureArea: get('featureArea'), priority: get('priority'), verification: get('verification'),
        confidence: null, warnings: [],
      });
    }
  }
  if (skippedPlaceholders) warnings.push(`${skippedPlaceholders} template placeholder row${skippedPlaceholders === 1 ? '' : 's'} (text in [brackets]) skipped.`);
  return { found, candidates, warnings };
}

// ------------------------------------------------------------------ HEURISTIC mode
const MODAL_RE = /\b(shall|must|should|will)\b/i;
const STRONG_MODAL_RE = /\b(shall|must)\b/i;
const FOOTER_RE = /\bPage \d+ of \d+\b/i;
const STANDALONE_NUM = /^(\d{1,3})[.)]$/;
const INLINE_NUM = /^(\d{1,3})[.)]\s+(\S.*)$/;
const DOTTED = /^(\d+(?:\.\d+)+)\.?\s+(\S.*)$/;
const BULLET = /^(?:[•▪◦‣\-*–]|[a-z]\)|\([a-z]\))\s*(\S.*)?$/;
const REQ_ID_LINE = /^((?:[A-Z]{1,6}-?\d{1,4}(?:\.\d+)*)|\d+(?:\.\d+)+)[.:)]?\s+(\S.*)$/;
const NOT_SUBJECT = /\b(this|the)\s+(document|section|chapter|purpose|reader|table|figure|appendix)\b/i;
const TERMINAL = /[.;:!?)]$/;
const isAllCaps = (s) => /[A-Z]/.test(s) && !/[a-z]/.test(s);

const sentencesOf = (text) => clean(text).split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).filter(Boolean);
const stripNote = (text) => sentencesOf(text).filter((s) => !/^note that\b/i.test(s)).join(' ');
const joinWrapped = (lines) => lines.join(' ').replace(/([a-z])- ([a-z])/g, '$1-$2').replace(/\s+/g, ' ').trim();

// Drop page headers / footers: "Page n of m" lines and any long line repeated 3+ times.
function stripRunningLines(lines) {
  const counts = new Map();
  for (const l of lines) if (l.length > 12) counts.set(l, (counts.get(l) ?? 0) + 1);
  return lines.filter((l) => !FOOTER_RE.test(l) && !(counts.get(l) >= 3 && !INLINE_NUM.test(l)));
}

const nextNonEmpty = (lines, i) => { for (let k = i + 1; k < lines.length; k += 1) if (lines[k]) return lines[k]; return null; };
const startsList = (line) => Boolean(line) && (/^1[.)]$/.test(line) || /^1[.)]\s+\S/.test(line));

/**
 * @param {string} text  plain text (txt, md, pdf or docx text)
 * @returns {{ candidates: object[], warnings: string[] }}
 */
function parseHeuristic(text) {
  const raw = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  const lines = stripRunningLines(raw);
  const out = [];
  let heading = ''; // nearest heading (feature area)
  let typeCtx = null; // FR / NFR from the nearest heading that says so
  let list = null; // { n, segs: [{ kind, text }], explicitId? } the numbered item being collected
  let listContext = false; // a heading was followed by a numbered list
  let para = []; // lines of the current free paragraph
  const seen = new Set();

  const push = (c) => {
    const key = normalise(c.description);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  const build = (id, desc, listItem, hasModal, strong) => {
    const description = stripNote(desc);
    const confidence = listItem ? (hasModal ? 'medium' : 'low') : (strong ? 'medium' : 'low');
    const warnings = [];
    if (hasPlaceholder(description)) warnings.push('Contains template placeholders such as <xx>. Fill them in before importing.');
    if (confidence === 'low') warnings.push('Low confidence: no clear "shall" / "must" statement. Check that this is a requirement.');
    return {
      sourceId: id, title: buildTitle(description), description, type: typeCtx ?? guessType(description), featureArea: heading || '', priority: '',
      verification: '', confidence, warnings, placeholders: hasPlaceholder(description),
    };
  };

  const flushList = () => {
    if (!list) return;
    const parts = [];
    let bullets = [];
    const endBullets = () => { if (bullets.length) { parts.push(bullets.join('; ')); bullets = []; } };
    for (const s of list.segs) {
      if (s.kind === 'bullet') bullets.push(s.text.replace(/[;,]+$/, '')); else { endBullets(); parts.push(s.text); }
    }
    endBullets();
    const desc = joinWrapped(parts);
    const modal = MODAL_RE.test(desc);
    if (desc.length >= 15 && (modal || listContext)) {
      const id = list.explicitId || `${heading || 'List'} #${list.n}`;
      push(build(id, desc, true, modal, STRONG_MODAL_RE.test(desc)));
    }
    list = null;
  };
  const flushPara = () => {
    if (!para.length) return;
    const textBlock = joinWrapped(para);
    para = [];
    for (const s of sentencesOf(textBlock)) {
      const m = REQ_ID_LINE.exec(s);
      const body = m && MODAL_RE.test(m[2]) ? m[2] : s;
      const mm = MODAL_RE.exec(body);
      if (!mm || body.length < 20 || body.length > 600 || NOT_SUBJECT.test(body) || /^note that\b/i.test(body) || /\?$/.test(body)) continue;
      if (clean(body.slice(0, mm.index)).length < 3) continue; // needs a subject before the modal verb
      push(build(m && body === m[2] ? m[1] : '', body, false, true, STRONG_MODAL_RE.test(body)));
    }
  };
  const setHeading = (text, major) => {
    flushList();
    flushPara();
    heading = clean(text);
    // the nearest heading that says so decides FR / NFR; a new major heading that says nothing clears it (keyword rules take over)
    if (/non[\s-]*functional/i.test(heading)) typeCtx = 'NFR';
    else if (/functional requirements?/i.test(heading)) typeCtx = 'FR';
    else if (major) typeCtx = null;
    listContext = false;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) { if (!list) flushPara(); continue; }

    // markdown headings
    const md = /^(#{1,6})\s+(\S.*)$/.exec(line);
    if (md) { setHeading(md[2], md[1].length <= 2); continue; }

    // numbered all-caps heading: "4. NON-FUNCTIONAL REQUIREMENTS"
    const inline = INLINE_NUM.exec(line);
    if (inline && isAllCaps(inline[2]) && inline[2].length >= 4) { setHeading(inline[2], true); continue; }
    if (isAllCaps(line) && words(line).length <= 10 && line.length >= 4 && !STANDALONE_NUM.test(line) && !/^[A-Z]\d\b/.test(line)) { setHeading(line, true); continue; }
    // dotted heading: "3.1 Functional requirements" (short, no verb)
    const dotted = DOTTED.exec(line);
    if (dotted && words(dotted[2]).length <= 8 && !TERMINAL.test(dotted[2]) && !MODAL_RE.test(dotted[2])) { setHeading(dotted[2], false); continue; }

    // a heading of a numbered list: short, no terminal punctuation, directly followed by "1."
    if (!inline && !STANDALONE_NUM.test(line) && !BULLET.test(line) && words(line).length <= 8 && /^[A-Z]/.test(line) && !TERMINAL.test(line) && startsList(nextNonEmpty(lines, i))) {
      setHeading(line, false);
      listContext = true;
      continue;
    }

    // start of a numbered item (sequence check: n is the next number, or 1)
    const standalone = STANDALONE_NUM.exec(line);
    const numMatch = standalone || inline;
    if (numMatch) {
      const n = Number(numMatch[1]);
      const expected = list ? list.n + 1 : (listContext ? 1 : null);
      if (n === 1 || n === expected || (!list && expected === null && n <= 99 && inline && MODAL_RE.test(inline[2]))) {
        let orphan = null;
        if (standalone && list && list.segs.length >= 2) {
          // The first line of this item can appear BEFORE its standalone number in extracted PDF text:
          // an unfinished last line (capital start, no end punctuation) after a line that ended a sentence.
          const last = list.segs[list.segs.length - 1];
          const before = list.segs[list.segs.length - 2];
          if (last.kind === 'text' && /^[A-Z]/.test(last.text) && !TERMINAL.test(last.text) && TERMINAL.test(before.text)) { orphan = last; list.segs.pop(); }
        }
        flushList();
        flushPara();
        list = { n, segs: [], explicitId: '' };
        if (orphan) list.segs.push(orphan);
        if (inline) list.segs.push({ kind: 'text', text: inline[2] });
        continue;
      }
    }

    // inside a numbered item: bullets and wrapped lines stay with their parent
    if (list) {
      const b = BULLET.exec(line);
      if (b && b[1]) list.segs.push({ kind: 'bullet', text: b[1] });
      else list.segs.push({ kind: 'text', text: line });
      continue;
    }
    para.push(line);
  }
  flushList();
  flushPara();

  const warnings = [];
  if (out.length > MAX_CANDIDATES) warnings.push(`Found ${out.length} candidates; only the first ${MAX_CANDIDATES} are returned. Split the document.`);
  return { candidates: out.slice(0, MAX_CANDIDATES), warnings };
}

// ------------------------------------------------------------------ duplicates and the response shape
/** existing: [{ reqId, title, description, sourceDocument? }] -> Map candidate index -> { requirementId, reason } */
function findDuplicates(candidates, existing) {
  const bySource = new Map();
  const byText = new Map();
  for (const r of existing) {
    if (r.sourceDocument?.sourceId) bySource.set(normalise(r.sourceDocument.sourceId), r.reqId);
    if (r.title) byText.set(normalise(r.title), r.reqId);
    if (r.description) byText.set(normalise(r.description), r.reqId);
  }
  const out = new Map();
  candidates.forEach((c, i) => {
    const s = c.sourceId ? bySource.get(normalise(c.sourceId)) : null;
    if (s) { out.set(i, { requirementId: s, reason: 'same source id' }); return; }
    const t = byText.get(normalise(c.description)) ?? byText.get(normalise(c.title));
    if (t) out.set(i, { requirementId: t, reason: 'same text' });
  });
  return out;
}

/** Assemble the preview answer from a parse result. existing = lean requirement docs of the project. */
function buildPreview({ documentName, documentId, method, parsed, existing }) {
  const warnings = [...parsed.warnings];
  let candidates = parsed.candidates;
  if (candidates.length > MAX_CANDIDATES) {
    warnings.push(`The document has ${candidates.length} requirement rows; only the first ${MAX_CANDIDATES} are returned.`);
    candidates = candidates.slice(0, MAX_CANDIDATES);
  }
  const dupIds = new Map();
  candidates.forEach((c) => { if (c.sourceId) dupIds.set(c.sourceId, (dupIds.get(c.sourceId) ?? 0) + 1); });
  const repeated = [...dupIds].filter(([, n]) => n > 1).map(([id]) => id);
  if (method === 'template' && repeated.length) warnings.push(`Duplicate ids in the document: ${repeated.join(', ')}.`);
  const dupMap = findDuplicates(candidates, existing);
  const seenIds = new Set();
  const out = candidates.map((c, i) => {
    const w = [...(c.warnings ?? [])];
    const dup = dupMap.get(i) ?? null;
    if (dup) w.push(`Looks like ${dup.requirementId} (${dup.reason}); not selected.`);
    const repeatedId = method === 'template' && c.sourceId && repeated.includes(c.sourceId) && seenIds.has(c.sourceId);
    if (repeatedId) w.push('Repeats an id that appears earlier in the document.');
    seenIds.add(c.sourceId);
    const placeholders = Boolean(c.placeholders);
    const selected = !dup && !repeatedId && !placeholders && (method === 'template' || c.confidence === 'medium');
    return {
      sourceId: c.sourceId, title: c.title, description: c.description, type: c.type, featureArea: c.featureArea ?? '', priority: c.priority ?? '',
      verification: c.verification ?? '', confidence: c.confidence, warnings: w, placeholders, duplicateOf: dup?.requirementId ?? null, selected,
    };
  });
  return {
    documentName, documentId, method,
    methodNote: method === 'template'
      ? 'Template: the requirement tables were read exactly as written.'
      : 'Rule-based detection (not a trained model): sentences and numbered items were picked by simple rules. Review every row carefully.',
    candidates: out, warnings, existingRequirements: existing.length,
    duplicates: out.map((c, i) => (c.duplicateOf ? { index: i, sourceId: c.sourceId, requirementId: c.duplicateOf } : null)).filter(Boolean),
  };
}

module.exports = {
  MAX_CANDIDATES, parseTemplateHtml, parseHeuristic, mapPriority, buildTitle, normalise, findDuplicates, buildPreview, hasPlaceholder, guessType, typeFromHeading,
};
