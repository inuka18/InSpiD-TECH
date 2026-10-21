'use strict';
// Pure: the signal profile of a requirement = exponential moving average of the embeddings of the signals applied to it.
const K = require('./constants');

const normalize = (v) => {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n ? v.map((x) => x / n) : v.slice();
};

/** @returns {{ vector: number[], count: number }}  profile = normalize(0.85 * profile + 0.15 * embedding); null starts from the embedding */
function updateProfile(profile, embedding) {
  const e = normalize(embedding);
  if (!profile?.vector?.length) return { vector: e, count: 1 };
  if (profile.vector.length !== e.length) throw new Error('profile and embedding have different sizes');
  return { vector: normalize(profile.vector.map((x, k) => K.PROFILE_KEEP * x + K.PROFILE_NEW * e[k])), count: (profile.count || 0) + 1 };
}

module.exports = { updateProfile, normalize };
