'use strict';
// Pure document segmentation: turns meeting notes, standup notes, an email or retrospective notes into candidate
// statements, one per line / bullet / sentence. No I/O, no dependencies.
//
// Rules:
//  - ignore email header lines (From:, To:, Subject:, Date:, Cc: ...), quoted replies (> ...), greetings, sign-offs
//    (and the signature block after one), empty lines, lead-ins ending in ":" and segments under 25 characters
//  - strip list markers (-, *, bullets, 1., 1), [ ], [x]), markdown heading marks, **bold**, and a leading time ([09:12])
//  - strip a leading speaker prefix ("Developer:", "Sam Perera:") from the text, and keep it as `speakerLabel` (display only)
//  - join hard-wrapped lines of one paragraph; split a long line (over 200 characters) into sentences
//  - remove duplicates (case / whitespace insensitive); keep order and the ORIGINAL line number (1-based)

const MIN_LENGTH = 25;
const MAX_SEGMENTS = 300;
const LONG_LINE = 200;

const HEADER_RE = /^\s*(from|to|cc|bcc|subject|date|sent|reply-to|importance|attachments?|message-id)\s*:/i;
const QUOTED_RE = /^\s*>/;
const SEPARATOR_RE = /^\s*(-{2,}|_{2,}|={2,}|\*{3,})\s*(.*?)\s*(-{2,}|_{2,}|={2,}|\*{3,})?\s*$/;
const GREETING_RE = /^(hi|hello|hey|dear|greetings|good\s+(morning|afternoon|evening))\b[^.!?\n]{0,60}[,:!.]?\s*$/i;
const SIGNOFF_RE = /^(thanks|thank you|many thanks|thanks again|regards|best regards|kind regards|warm regards|best wishes|best|cheers|sincerely|yours (sincerely|faithfully)|thanks and regards|talk soon|speak soon)[\s,.!-]*$/i;
const BULLET_RE = /^\s*(?:[-*+•–—▪◦‣]+|\d{1,3}[.)]|[a-zA-Z][.)](?=\s)|\[[ xX]?\])\s+/;
const TIME_RE = /^\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*(?:[-–—]\s*)?/;
const SPEAKER_RE = /^([A-Z][A-Za-z0-9_.'’()\- ]{0,38}?):\s+(\S.*)$/;
// A label that is part of the sentence, not a person ("Blocker: the vendor has not delivered ...").
const NOT_A_SPEAKER = new Set([
  'note', 'notes', 'action', 'actions', 'decision', 'decisions', 'summary', 'agenda', 'attendees', 'topic', 'todo', 'update',
  'updates', 'fyi', 're', 'ps', 'blocker', 'blockers', 'risk', 'risks', 'question', 'questions', 'issue', 'issues', 'next steps',
]);
const ABBREVIATION_END_RE = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|no|fig|approx|inc|ltd|st)\.$/i;

class SegmentLimitError extends Error {
  constructor(count, max) {
    super(`The document has ${count} segments; the limit is ${max}. Split the document into smaller parts and upload them separately.`);
    this.name = 'SegmentLimitError';
    this.count = count;
    this.max = max;
  }
}

const normalizeKey = (t) => t.toLowerCase().replace(/\s+/g, ' ').replace(/[\s.,;:!?]+$/g, '').trim();

// Splits one long line into sentences without breaking after common abbreviations.
function splitSentences(text) {
  const parts = text.split(/(?<=[.!?])["')\]]?\s+(?=[A-Z0-9"'(\[])/);
  const merged = [];
  for (const p of parts) {
    if (merged.length && ABBREVIATION_END_RE.test(merged[merged.length - 1])) merged[merged.length - 1] += ` ${p}`;
    else merged.push(p);
  }
  return merged;
}

// Pass 1: logical lines = original lines, with hard-wrapped continuation lines of one paragraph joined.
function logicalLines(rawLines) {
  const out = [];
  let cur = null;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  rawLines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/g, '');
    if (!line.trim()) {
      flush();
      out.push({ line: i + 1, text: '', blank: true });
      return;
    }
    const startsNewUnit = BULLET_RE.test(line) || HEADER_RE.test(line) || QUOTED_RE.test(line) || /^\s*#/.test(line) ||
      SEPARATOR_RE.test(line) || TIME_RE.test(line.trim()) || SPEAKER_RE.test(line.trim());
    const continuation = cur && !startsNewUnit && /^[a-z]/.test(line.trim()) && cur.text.length >= 50 && !/[.!?:;"”)]$/.test(cur.text);
    if (continuation) {
      cur.text += ` ${line.trim()}`;
    } else {
      flush();
      cur = { line: i + 1, text: line.trim() };
    }
  });
  flush();
  return out;
}

/**
 * @param {string} text the document text
 * @returns {Array<{ index: number, line: number, text: string, speakerLabel: string|null }>}
 * @throws {SegmentLimitError} when more than `maxSegments` segments remain after de-duplication
 */
function segmentDocument(text, { minLength = MIN_LENGTH, maxSegments = MAX_SEGMENTS } = {}) {
  const rawLines = String(text ?? '').replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const seen = new Set();
  const segments = [];
  let inSignature = false;

  for (const unit of logicalLines(rawLines)) {
    if (unit.blank) {
      inSignature = false; // a signature block ends at the next blank line
      continue;
    }
    if (inSignature) continue;
    let line = unit.text;

    if (HEADER_RE.test(line) || QUOTED_RE.test(line)) continue;
    const sep = line.match(SEPARATOR_RE);
    if (sep && /^(-{2,}|_{2,}|={2,}|\*{3,})$/.test(line.trim()) ) continue; // "--", "-----", "=====" lines
    if (sep && /original message|forwarded message/i.test(line)) continue;

    line = line.replace(/^\s*#{1,6}\s*/, '').replace(/\*\*|__/g, ''); // markdown heading marks and bold
    line = line.replace(BULLET_RE, '').replace(TIME_RE, '').trim();
    if (!line) continue;
    if (SIGNOFF_RE.test(line)) {
      inSignature = true;
      continue;
    }
    if (GREETING_RE.test(line)) continue;
    if (/:$/.test(line)) continue; // "Action items:" is a lead-in, not a statement

    // sentences for long lines, otherwise the line as it is
    const pieces = line.length > LONG_LINE ? splitSentences(line) : [line];
    for (const piece of pieces) {
      let body = piece.trim();
      let speakerLabel = null;
      const m = body.match(SPEAKER_RE);
      if (m && m[1].trim().split(/\s+/).length <= 4 && !NOT_A_SPEAKER.has(m[1].trim().toLowerCase())) {
        speakerLabel = m[1].trim();
        body = m[2].trim();
      }
      if (body.length < minLength) continue;
      if (SIGNOFF_RE.test(body) || GREETING_RE.test(body)) continue;
      const key = normalizeKey(body);
      if (seen.has(key)) continue;
      seen.add(key);
      segments.push({ index: segments.length, line: unit.line, text: body, speakerLabel });
    }
  }
  if (segments.length > maxSegments) throw new SegmentLimitError(segments.length, maxSegments);
  return segments;
}

module.exports = { segmentDocument, SegmentLimitError, MIN_LENGTH, MAX_SEGMENTS };
