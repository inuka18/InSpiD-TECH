'use strict';
// Every number the new-requirement detector uses lives here (all optional env vars, NOT required in .env).
//
// IMPORTANT: these values are A-PRIORI choices. The classifier is not retrained or changed; the detector sits on top of its
// label, its confidence and the matcher's similarity. They may be tuned ONLY on the `dev` rows of
// data/scenario/new_requirement_test.csv, never on the `test` rows, and every change must be recorded below and in
// docs/new_requirement_detection.md.
//
// TUNING LOG (dev rows only):
//   (none yet: all values are the original a-priori defaults)

const envNumber = (name, fallback) => {
  const v = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== '' && Number.isFinite(v) ? v : fallback;
};

module.exports = {
  // ---- who can be a candidate: an Expectation the classifier is confident about (confidence is 0-100)
  NEW_REQ_MIN_CONFIDENCE: envNumber('NEW_REQ_MIN_CONFIDENCE', 70),

  // ---- novelty, from the top matcher similarity to the project's requirements
  //      (a) top similarity < LOW                           -> novel ("no close requirement")
  //      (b) LOW <= top similarity < HIGH and a NOVEL TOKEN -> novel ("new terms: ...")
  NEW_REQ_SIM_LOW: envNumber('NEW_REQ_SIM_LOW', 0.35),
  NEW_REQ_SIM_HIGH: envNumber('NEW_REQ_SIM_HIGH', 0.50),

  // ---- novel token: in no requirement text and in at most this many earlier signals of the project
  NEW_REQ_NOVEL_MAX_SIGNALS: 2,
  NEW_REQ_TOKEN_MIN_LENGTH: 4,

  // ---- grouping with other signals (cosine of MiniLM embeddings; the candidate centroid is the mean of its evidence)
  NEW_REQ_GROUP_SIM: envNumber('NEW_REQ_GROUP_SIM', 0.60), // >= this to a PENDING candidate: attach as more evidence
  NEW_REQ_SUPPRESS_SIM: envNumber('NEW_REQ_SUPPRESS_SIM', 0.80), // >= this to a REJECTED candidate: store, do not create or attach
};
