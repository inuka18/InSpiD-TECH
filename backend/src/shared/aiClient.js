'use strict';
// The ONLY place the backend talks to the ai-service.
const config = require('../config/env');
const AppError = require('./AppError');

async function call(path, body) {
  let res;
  try {
    res = await fetch(`${config.aiServiceUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new AppError(502, 'AI_SERVICE_UNAVAILABLE', `AI service unreachable (${path})`);
  }
  if (!res.ok) throw new AppError(502, 'AI_SERVICE_ERROR', `AI service returned ${res.status} for ${path}`);
  return res.json();
}

module.exports = {
  /** -> { label, confidence, scores, placeholder } */
  classify: (text) => call('/classify', { text }),
  /** -> { embeddings, dim, placeholder } */
  embed: (texts) => call('/embed', { texts }),
  /** -> { score, placeholder } */
  similarity: (textA, textB) => call('/similarity', { text_a: textA, text_b: textB }),
};
