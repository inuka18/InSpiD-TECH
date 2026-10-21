'use strict';
// The ONLY place the backend talks to the ai-service.
const config = require('../config/env');
const AppError = require('./AppError');

async function call(path, body, timeoutMs = 15000) {
  let res;
  try {
    res = await fetch(`${config.aiServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new AppError(502, 'AI_SERVICE_UNAVAILABLE', `AI service unreachable (${path})`);
  }
  if (!res.ok) throw new AppError(502, 'AI_SERVICE_ERROR', `AI service returned ${res.status} for ${path}`);
  return res.json();
}

module.exports = {
  /** -> { label, confidence (0-1), scores, model_version } */
  classify: (text) => call('/classify', { text }),
  /** -> { vectors, model } */
  embed: (texts) => call('/embed', { texts }),
  /** -> { similarity } */
  similarity: (a, b) => call('/similarity', { a, b }),
  /** candidates: [{ id, text }] -> [{ id, similarity }] ranked, best first */
  match: (text, candidates, topK = 5) => call('/match', { text, candidates, top_k: topK }),
  /** many texts at once (max 300) -> [{ label, confidence, scores, model_version }] in the same order */
  classifyBatch: (texts) => call('/classify/batch', { texts }, 90000),
  /** candidates are sent once -> one ranked [{ id, similarity }] list per text */
  matchBatch: (texts, candidates, topK = 3) => call('/match/batch', { texts, candidates, top_k: topK }, 90000),
};
