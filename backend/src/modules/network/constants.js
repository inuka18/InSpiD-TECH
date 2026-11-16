'use strict';
// Every number the signal-informed network uses lives here, so there is one place to read and review them.
//
// IMPORTANT: these values are A-PRIORI choices (round numbers, weighted by how strong each kind of evidence is). They were
// NOT tuned on the CSV group_id / scenario_related_pairs answer key, and they must not be changed after looking at the
// evaluation or the demo results to make a number look better.

const envNumber = (name, fallback) => {
  const v = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== '' && Number.isFinite(v) ? v : fallback;
};

module.exports = {
  // ---- signal profile: exponential moving average of the embeddings of the signals applied to a requirement
  //      profile = normalize(PROFILE_KEEP * profile + PROFILE_NEW * embedding). A null profile starts from the embedding.
  PROFILE_KEEP: 0.85,
  PROFILE_NEW: 0.15,

  // ---- combined similarity of a pair (i, j)
  //      sim = (1 - w) * textSim + w * profileSim + boost, capped at 1
  //      w = PROFILE_MAX_WEIGHT * min(1, min(count_i, count_j) / PROFILE_FULL_COUNT); 0 when either has no profile.
  //      The profile only counts as much as the thinner of the two profiles is backed by signals.
  PROFILE_MAX_WEIGHT: 0.35,
  PROFILE_FULL_COUNT: 10,

  // ---- evidence boost. An explicit requirement-id mention ("RET-R04 is blocked by RET-R07") is stronger evidence than an
  //      inferred co-reference (the matcher found two requirements about equally similar), so it is worth more per row.
  //      Both kinds are summed and then capped in total. Chosen by evidence strength, not tuned on group_id.
  IDMENTION_BOOST_PER_ROW: 0.15,
  IDMENTION_BOOST_CAP: 0.30,
  COREF_BOOST_PER_ROW: 0.06,
  COREF_BOOST_CAP: 0.20,
  BOOST_TOTAL_CAP: 0.35,

  // ---- co-reference evidence: the top two match candidates are both at least this similar (optional env override)
  //      and no further apart than COREF_MAX_GAP.
  COREF_MIN_SIMILARITY: envNumber('COREF_MIN_SIMILARITY', 0.40),
  COREF_MAX_GAP: 0.10,

  // ---- alignment
  BAND_STRONG_MIN: 80, // >= 80  "Strong Alignment"
  BAND_MODERATE_MIN: 60, // 60-79  "Moderate Drift"; below 60 "Significant Drift"
  HISTORY_MAX_DAYS: 90,
  DRIVER_MIN_CHANGED: 2, // a day only names a driver signal when at least this many connections changed
  EVIDENCE_LIST_LIMIT: 20, // supporting signals returned for one link
  DAY_OFFSET_MINUTES: 330, // Asia/Colombo is UTC+5:30 all year (no daylight saving): history days are Colombo days
};
