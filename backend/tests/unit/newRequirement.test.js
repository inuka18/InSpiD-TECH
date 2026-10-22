'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const nr = require('../../src/modules/signals/newRequirement');

const stats = (reqTexts = ['Card payment checkout. Customers pay by card.'], sigTexts = []) => nr.buildTokenStats(reqTexts, sigTexts);
const detect = (over = {}) => nr.detectNewRequirement({
  label: 'Expectation', confidence: 90, text: 'We want a loyalty programme.', matches: [{ requirementId: 'R1', similarity: 0.2 }], tokenStats: stats(), ...over,
});

describe('tokenize / novel tokens', () => {
  it('keeps lowercase content words of 4+ letters and drops stopwords and short words', () => {
    assert.deepEqual([...nr.tokenize('We would like to add the Koko payment option, please!')], ['koko', 'payment']);
  });

  it('the stopword list includes the generic request words', () => {
    for (const w of ['would', 'like', 'implement', 'add', 'support', 'option', 'feature', 'include', 'also', 'please', 'need', 'want', 'hope', 'ask']) {
      assert.ok(nr.STOPWORDS.has(w), w);
    }
  });

});

describe('novel token boundary', () => {
  it('2 earlier signals still novel, 3 not; a requirement word never', () => {
    const s = stats(['Card payment checkout'], ['wallet one', 'wallet two', 'koko one', 'koko two', 'koko three']);
    assert.deepEqual(nr.novelTokens('wallet koko payment', s), ['wallet']);
  });
});

describe('detectNewRequirement', () => {
  it('rule (a): low similarity -> candidate "no close requirement"', () => {
    const d = detect({ matches: [{ requirementId: 'R1', similarity: 0.34 }] });
    assert.equal(d.isCandidate, true);
    assert.equal(d.rule, 'low-similarity');
    assert.equal(d.reason, 'no close requirement');
    assert.equal(d.closestRequirementId, 'R1');
  });

  it('similarity exactly at SIM_LOW is not rule (a)', () => {
    const d = detect({ text: 'Payment by card.', matches: [{ requirementId: 'R1', similarity: 0.35 }] });
    assert.equal(d.isCandidate, false);
  });

  it('borderline band: needs a novel token (rule b), and returns the tokens as the reason', () => {
    const withToken = detect({ text: 'would like to implement the koko payment option as well', matches: [{ requirementId: 'R1', similarity: 0.45 }] });
    assert.equal(withToken.isCandidate, true);
    assert.equal(withToken.rule, 'novel-terms');
    assert.equal(withToken.reason, 'new terms: koko');
    assert.deepEqual(withToken.novelTokens, ['koko']);
    const without = detect({ text: 'Payment by card please.', matches: [{ requirementId: 'R1', similarity: 0.45 }] });
    assert.equal(without.isCandidate, false);
  });

  it('at or above SIM_HIGH a novel word does not matter', () => {
    assert.equal(detect({ text: 'koko koko', matches: [{ requirementId: 'R1', similarity: 0.5 }] }).isCandidate, false);
    assert.equal(detect({ text: 'koko koko', matches: [{ requirementId: 'R1', similarity: 0.8 }] }).isCandidate, false);
  });

  it('a word seen in 3 earlier signals is not novel, so the borderline signal is not a candidate', () => {
    const tokenStats = stats(['Card payment'], ['koko a', 'koko b', 'koko c']);
    assert.equal(detect({ text: 'the koko option', matches: [{ requirementId: 'R1', similarity: 0.42 }], tokenStats }).isCandidate, false);
  });

  it('useNovelTokens=false keeps only rule (a)', () => {
    const p = { text: 'the koko option', matches: [{ requirementId: 'R1', similarity: 0.42 }] };
    assert.equal(detect(p).isCandidate, true);
    assert.equal(detect({ ...p, useNovelTokens: false }).isCandidate, false);
  });

  it('never for a non-Expectation label', () => {
    for (const label of ['Constraint', 'Completion', 'Conflict', 'None', null]) assert.equal(detect({ label }).isCandidate, false, String(label));
  });

  it('never below the confidence floor (70 is enough, 69 is not)', () => {
    assert.equal(detect({ confidence: 70 }).isCandidate, true);
    assert.equal(detect({ confidence: 69 }).isCandidate, false);
  });

  it('never for a seeded signal or a manually chosen requirement', () => {
    assert.equal(detect({ seeded: true }).isCandidate, false);
    assert.equal(detect({ manualMatch: true }).isCandidate, false);
  });

  it('a project without requirements: every confident Expectation is a candidate', () => {
    assert.equal(detect({ matches: [], tokenStats: stats([]) }).isCandidate, true);
  });

  it('thresholds can be overridden (tests / evaluation)', () => {
    assert.equal(detect({ matches: [{ requirementId: 'R1', similarity: 0.3 }], opts: { simLow: 0.25, simHigh: 0.25 } }).isCandidate, false);
  });
});

describe('chooseGroup', () => {
  const v = (x, y) => [x, y];
  it('attaches to a pending candidate at >= 0.60 and creates a new one below', () => {
    const pending = [{ candidateId: 'RC-0001', centroid: v(1, 0) }];
    assert.equal(nr.chooseGroup({ embedding: v(0.7, 0.714), pending }).action, 'attach'); // cos ~ 0.70
    assert.equal(nr.chooseGroup({ embedding: v(0.5, 0.866), pending }).action, 'create'); // cos = 0.5
  });

  it('works on a centroid that is not normalised', () => {
    assert.equal(nr.chooseGroup({ embedding: v(1, 0), pending: [{ candidateId: 'RC-0001', centroid: v(5, 0.1) }] }).action, 'attach');
  });

  it('suppresses when >= 0.80 similar to a rejected candidate', () => {
    const r = nr.chooseGroup({ embedding: v(1, 0.2), rejected: [{ candidateId: 'RC-0002', centroid: v(1, 0) }] });
    assert.equal(r.action, 'suppress');
    assert.equal(r.candidateId, 'RC-0002');
  });

  it('a rejected candidate between 0.60 and 0.80 does not suppress', () => {
    assert.equal(nr.chooseGroup({ embedding: v(0.7, 0.714), rejected: [{ candidateId: 'RC-0002', centroid: v(1, 0) }] }).action, 'create');
  });

  it('a closer pending candidate wins over a rejected one', () => {
    const r = nr.chooseGroup({ embedding: v(1, 0), pending: [{ candidateId: 'RC-0001', centroid: v(1, 0) }], rejected: [{ candidateId: 'RC-0002', centroid: v(1, 0.5) }] });
    assert.equal(r.action, 'attach');
  });

  it('no candidates -> create', () => {
    assert.equal(nr.chooseGroup({ embedding: v(1, 0) }).action, 'create');
  });

  it('updateCentroid keeps the exact running mean', () => {
    assert.deepEqual(nr.updateCentroid([1, 0], 1, [0, 1]), [0.5, 0.5]);
    assert.deepEqual(nr.updateCentroid([0.5, 0.5], 2, [0, 0]), [1 / 3, 1 / 3]);
  });
});

describe('suggested title and type', () => {
  it('strips lead-in phrases, articles and trailing filler; capitalises; max 8 words', () => {
    assert.equal(nr.suggestTitle('We would like to implement the koko payment option as well.'), 'Koko payment option');
    assert.equal(nr.suggestTitle('For standup: The business wants a loyalty points programme where customers earn points on every order.'),
      'Loyalty points programme where customers earn points');
    assert.equal(nr.suggestTitle('Students are asking for a peer tutoring marketplace.'), 'Peer tutoring marketplace');
    assert.ok(nr.suggestTitle('We need one two three four five six seven eight nine ten').split(' ').length <= 8);
  });

  it('falls back when nothing is left', () => {
    assert.equal(nr.suggestTitle(''), 'New requirement');
  });

  it('guesses NFR from keywords and FR otherwise', () => {
    assert.equal(nr.guessType('Pages must load in under 2 seconds'), 'NFR');
    assert.equal(nr.guessType('Data must be encrypted at rest'), 'NFR');
    assert.equal(nr.guessType('A loyalty points programme'), 'FR');
  });
});
