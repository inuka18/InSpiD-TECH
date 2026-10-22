'use strict';
// Pure new-requirement detector (no database, no network). It sits on top of the classifier: the classifier's label and
// confidence and the matcher's similarities go in, "is this possibly a requirement nobody has written down yet?" comes out.
//
// A signal is a CANDIDATE only if ALL hold:
//   - label is Expectation and confidence >= NEW_REQ_MIN_CONFIDENCE
//   - it is not a seeded signal (seeded rows are dataset text whose effect is already in the data)
//   - novelty: (a) top similarity < NEW_REQ_SIM_LOW, or
//              (b) top similarity < NEW_REQ_SIM_HIGH and the text has a NOVEL token
//     A novel token is a content word (4+ letters, lowercase, not a stopword) that appears in no requirement text and in at
//     most NEW_REQ_NOVEL_MAX_SIGNALS earlier signals of the project.
// Grouping (which pending candidate it joins, or whether a rejected one suppresses it) is chooseGroup(), also pure.
const C = require('./newRequirementConstants');

// Function words plus generic request words ("would like to implement ... as well"): they carry no topic, so they are never novel.
const STOPWORDS = new Set((
  'would could should shall might must will have has had having been being were was are is not no yes the and but for nor yet so ' +
  'that this these those with from into onto over under about above below after before again then than them they their there ' +
  'where which while when what who whom whose why how your yours ours mine his her hers its our out off any all both each few ' +
  'more most other some such only own same very just also too well even still much many ones one two three ' +
  'like likes liked want wants wanted need needs needed hope hopes hoping hoped ask asks asked asking request requests requested ' +
  'please thanks thank implement implements implementing implemented add adds adding added support supports supporting supported ' +
  'option options feature features include includes including included make makes making made get gets getting give gives ' +
  'let lets use uses using used able allow allows allowing provide provides providing have take takes ' +
  'think thought maybe perhaps really actually basically currently soon later today tomorrow week team update standup meeting ' +
  'know knows said says say tell told mention mentioned want ensure ' +
  'does done doing come comes came going goes gone see seen look looks looking'
).split(/\s+/).filter(Boolean));

const WORD = /[a-z]+/g;

// Content words of a text: lowercase, 4+ letters, not a stopword. A Set, so a word counts once per text.
function tokenize(text) {
  const out = new Set();
  for (const w of String(text ?? '').toLowerCase().match(WORD) ?? []) {
    if (w.length >= C.NEW_REQ_TOKEN_MIN_LENGTH && !STOPWORDS.has(w)) out.add(w);
  }
  return out;
}

/**
 * Token document frequencies of a project: requirementTokens = every content word of any requirement text;
 * signalCounts = token -> number of signals containing it. `add` registers one more signal (used while a document is
 * processed item by item, so an earlier item counts as an "earlier signal" for the later ones).
 */
function buildTokenStats(requirementTexts = [], signalTexts = []) {
  const requirementTokens = new Set();
  for (const t of requirementTexts) for (const w of tokenize(t)) requirementTokens.add(w);
  const signalCounts = new Map();
  const stats = {
    requirementTokens,
    signalCounts,
    add(text) { for (const w of tokenize(text)) signalCounts.set(w, (signalCounts.get(w) ?? 0) + 1); },
  };
  for (const t of signalTexts) stats.add(t);
  return stats;
}

// Novel tokens of a text, in order of appearance.
function novelTokens(text, stats) {
  const out = [];
  for (const w of tokenize(text)) {
    if (!stats.requirementTokens.has(w) && (stats.signalCounts.get(w) ?? 0) <= C.NEW_REQ_NOVEL_MAX_SIGNALS) out.push(w);
  }
  return out;
}

const NOT = (extra = {}) => ({ isCandidate: false, reason: null, rule: null, closestRequirementId: null, similarity: null, novelTokens: [], ...extra });

/**
 * @param {object} p
 * @param {string} p.label  classifier label
 * @param {number} p.confidence  0-100
 * @param {string} p.text
 * @param {Array<{requirementId:string, similarity:number}>} p.matches  ranked, best first (the matcher's alternatives)
 * @param {object} p.tokenStats  from buildTokenStats (requirement texts + the project's signals)
 * @param {boolean} [p.seeded]
 * @param {boolean} [p.manualMatch]  a person chose the requirement explicitly: nothing to detect
 * @param {boolean} [p.useNovelTokens=true]  false = only rule (a) (used by the evaluation to report the effect of rule (b))
 * @param {object} [p.opts]  threshold overrides (tests, evaluation)
 * @returns {{ isCandidate:boolean, reason:string|null, rule:'low-similarity'|'novel-terms'|null, closestRequirementId:string|null, similarity:number|null, novelTokens:string[] }}
 */
function detectNewRequirement({ label, confidence, text, matches = [], tokenStats, seeded = false, manualMatch = false, useNovelTokens = true, opts = {} }) {
  const minConfidence = opts.minConfidence ?? C.NEW_REQ_MIN_CONFIDENCE;
  const low = opts.simLow ?? C.NEW_REQ_SIM_LOW;
  const high = opts.simHigh ?? C.NEW_REQ_SIM_HIGH;
  const top = matches[0] ?? null;
  const base = { closestRequirementId: top?.requirementId ?? null, similarity: top ? top.similarity : null };

  if (seeded || manualMatch || label !== 'Expectation' || !(confidence >= minConfidence)) return NOT(base);

  const simTop = top ? top.similarity : 0; // a project with no requirements: nothing covers it
  const novel = tokenStats ? novelTokens(text, tokenStats) : [];
  if (simTop < low) return { ...base, isCandidate: true, rule: 'low-similarity', reason: 'no close requirement', novelTokens: novel };
  if (useNovelTokens && simTop < high && novel.length) {
    return { ...base, isCandidate: true, rule: 'novel-terms', reason: `new terms: ${novel.join(', ')}`, novelTokens: novel };
  }
  return NOT({ ...base, novelTokens: novel });
}

// ------------------------------------------------------------------ grouping with other signals
function cosine(a, b) {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Mean of the evidence vectors after adding one more (exact running mean; the centroid is stored as the mean, not normalised). */
function updateCentroid(centroid, count, vector) {
  if (!centroid?.length || count <= 0) return [...vector];
  return centroid.map((x, i) => (x * count + vector[i]) / (count + 1));
}

/**
 * Where does a candidate signal go? `pending` / `rejected`: [{ candidateId, centroid }].
 * attach  = cosine to the best PENDING centroid >= NEW_REQ_GROUP_SIM
 * suppress = cosine to the best REJECTED centroid >= NEW_REQ_SUPPRESS_SIM (and not beaten by a pending candidate it would attach to)
 * create  = otherwise
 * @returns {{ action:'attach'|'suppress'|'create', candidateId:string|null, similarity:number|null }}
 */
function chooseGroup({ embedding, pending = [], rejected = [], opts = {} }) {
  const groupSim = opts.groupSim ?? C.NEW_REQ_GROUP_SIM;
  const suppressSim = opts.suppressSim ?? C.NEW_REQ_SUPPRESS_SIM;
  const best = (list) => list.reduce((b, c) => {
    const s = c.centroid?.length ? cosine(embedding, c.centroid) : -1;
    return s > b.similarity ? { candidateId: c.candidateId, similarity: s } : b;
  }, { candidateId: null, similarity: -1 });
  const p = best(pending);
  const r = best(rejected);
  const attach = p.candidateId && p.similarity >= groupSim;
  const suppress = r.candidateId && r.similarity >= suppressSim;
  if (suppress && (!attach || r.similarity > p.similarity)) return { action: 'suppress', candidateId: r.candidateId, similarity: r.similarity };
  if (attach) return { action: 'attach', candidateId: p.candidateId, similarity: p.similarity };
  return { action: 'create', candidateId: null, similarity: p.similarity >= 0 ? p.similarity : null };
}

// ------------------------------------------------------------------ suggested title and type
// "We would like to implement the koko payment option as well" -> "Koko payment option"
const LEAD_LABEL = /^(?:(?:for|from)\s+[\w ]{1,20}:|update from me:|fyi:?|hi (?:all|team),?|hello (?:all|team),?|quick note:?)\s*/i;
const TRIGGER = /\b(?:(?:would|'d)\s+(?:like|love)(?:\s+to)?|(?:are|is)\s+(?:hoping|asking|looking|requesting)(?:\s+for|\s+to)?|hoping(?:\s+for|\s+to)?|asking\s+for|looking\s+for|(?:really\s+)?(?:wants?|needs?)(?:\s+to)?|would\s+(?:be\s+great|help)(?:\s+(?:to|if\s+we\s+could))?|should\s+(?:also\s+)?(?:have|support|offer|allow))\s+/i;
const LEAD_VERB = /^(?:implement|add|support|include|provide|build|create|offer|introduce|have|get|see|allow)\s+/i;
const LEAD_ARTICLE = /^(?:an?|the|some|more|our|their)\s+/i;
const TRAILING = /\s+(?:as well|too|also|please|asap|soon|for us|if possible)$/i;

function suggestTitle(text, maxWords = 8) {
  let s = String(text ?? '').replace(/\s+/g, ' ').trim();
  s = s.replace(LEAD_LABEL, '');
  s = s.split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, '');
  const m = TRIGGER.exec(s);
  if (m && m.index <= 40) s = s.slice(m.index + m[0].length);
  s = s.replace(LEAD_VERB, '').replace(LEAD_ARTICLE, '').replace(TRAILING, '').replace(LEAD_VERB, '').replace(LEAD_ARTICLE, '');
  const words = s.split(' ').filter(Boolean).slice(0, maxWords);
  while (words.length > 1 && /^(?:and|or|to|of|for|in|on|at|by|with|that|which|where|a|an|the)$/i.test(words[words.length - 1])) words.pop();
  const title = words.join(' ').replace(/[,;:\-–]+$/, '');
  return title ? title[0].toUpperCase() + title.slice(1) : 'New requirement';
}

const NFR_WORDS = /\b(?:performance|fast|faster|speed|latency|response time|secur\w*|encrypt\w*|privacy|gdpr|complian\w*|availab\w*|uptime|scal\w*|reliab\w*|backup\w*|accessib\w*|usab\w*|audit\w*|concurren\w*|throughput|maintain\w*|logging|resilien\w*|recover\w*|load times?|loading times?|seconds?|milliseconds?)\b/i;

/** FR or NFR guess by keywords (a suggestion the PM can change). */
const guessType = (text) => (NFR_WORDS.test(String(text ?? '')) ? 'NFR' : 'FR');

module.exports = {
  STOPWORDS, tokenize, buildTokenStats, novelTokens, detectNewRequirement, cosine, updateCentroid, chooseGroup, suggestTitle, guessType,
};
