'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const mammoth = require('mammoth');
const P = require('../../src/modules/requirements/srsParser');

const fixture = (n) => path.join(__dirname, '../fixtures', n);
const tableParse = async (n) => P.parseTemplateHtml((await mammoth.convertToHtml({ path: fixture(n) })).value);
const count = (r, type) => r.candidates.filter((c) => c.type === type).length;

describe('template mode (real files)', () => {
  it('Online Retail sample: 24 functional + 7 non-functional, read exactly', async () => {
    const r = await tableParse('SRS_Online_Retail_Platform_Sample.docx');
    assert.equal(r.found, true);
    assert.equal(r.candidates.length, 31);
    assert.equal(count(r, 'FR'), 24);
    assert.equal(count(r, 'NFR'), 7);
    const first = r.candidates[0];
    assert.equal(first.sourceId, 'FR-001');
    assert.equal(first.title, 'Product search with filters');
    assert.equal(first.featureArea, 'Catalogue');
    assert.equal(first.priority, 'Must');
    assert.equal(first.verification, 'Test');
    assert.match(first.description, /^The system shall allow customers to search/);
  });

  it('Hospital sample: 20 functional + 6 non-functional', async () => {
    const r = await tableParse('SRS_Hospital_Management_System_Sample.docx');
    assert.equal(r.candidates.length, 26);
    assert.equal(count(r, 'FR'), 20);
    assert.equal(count(r, 'NFR'), 6);
  });

  it('the empty template: its placeholder rows are skipped, so nothing is imported', async () => {
    const r = await tableParse('SRS_Template.docx');
    assert.equal(r.found, true);
    assert.equal(r.candidates.length, 0);
    assert.match(r.warnings.join(' '), /4 template placeholder rows/);
  });

  it('a document without requirement tables is not template mode', () => {
    assert.equal(P.parseTemplateHtml('<h1>Intro</h1><p>The system shall x</p><table><tr><td>A</td><td>B</td></tr></table>').found, false);
  });

  it('heading decides FR / NFR ("non-functional" is checked first), the id prefix is the fallback', () => {
    const t = (h, id) => `<h2>${h}</h2><table><tr><th>ID</th><th>Title</th><th>Requirement statement</th></tr><tr><td>${id}</td><td>T title</td><td>The system shall do it.</td></tr></table>`;
    assert.equal(P.parseTemplateHtml(t('3.2 Non-functional requirements', 'FR-9')).candidates[0].type, 'NFR');
    assert.equal(P.parseTemplateHtml(t('3.1 Functional requirements', 'NFR-9')).candidates[0].type, 'FR');
    assert.equal(P.parseTemplateHtml(t('Other table', 'NFR-9')).candidates[0].type, 'NFR');
    assert.equal(P.parseTemplateHtml(t('Other table', 'REQ-9')).candidates[0].type, 'FR');
  });

  it('empty statements are skipped with a warning; header matching is case-insensitive', () => {
    const html = '<table><tr><th>id</th><th>TITLE</th><th>Requirement Statement</th></tr><tr><td>FR-1</td><td>Ok</td><td>The system shall work.</td></tr><tr><td>FR-2</td><td>Empty</td><td></td></tr></table>';
    const r = P.parseTemplateHtml(html);
    assert.equal(r.candidates.length, 1);
    assert.match(r.warnings[0], /FR-2 has an empty requirement statement/);
  });
});

describe('MoSCoW priority', () => {
  it('Must -> High, Should -> Medium, Could / Wont -> Low, empty -> null', () => {
    assert.equal(P.mapPriority('Must'), 'High');
    assert.equal(P.mapPriority('Should'), 'Medium');
    assert.equal(P.mapPriority('Could'), 'Low');
    assert.equal(P.mapPriority("Won't"), 'Low');
    assert.equal(P.mapPriority('Won’t'), 'Low');
    assert.equal(P.mapPriority('High'), 'High');
    assert.equal(P.mapPriority(''), null);
    assert.equal(P.mapPriority('whatever'), null);
  });
});

describe('titles', () => {
  it('the lead phrase before a colon when it has 8 words or fewer, otherwise the first 8 words', () => {
    assert.equal(P.buildTitle('Minimizing navigation effort: The number of navigation steps should be minimized.'), 'Minimizing navigation effort');
    assert.equal(P.buildTitle('The System must keep an unalterable audit trail capable of automatically capturing information'), 'The System must keep an unalterable audit trail');
    assert.equal(P.buildTitle('This is a very long lead phrase that goes on and on: then the rest'), 'This is a very long lead phrase');
  });
});

describe('heuristic mode', () => {
  it('free text: keeps shall / must / should / will sentences with a subject, ignores the rest', () => {
    const text = [
      'Introduction', 'This document will describe the shop. Nothing here is a requirement.',
      'The system shall let customers pay by card. The warehouse is in Colombo.',
      'Pages must load within 2 seconds for 95 percent of requests.',
      'Users will be able to reset their password.',
      'Note that this explanation is ignored. Shall we go?',
    ].join('\n');
    const r = P.parseHeuristic(text);
    assert.deepEqual(r.candidates.map((c) => c.description), [
      'The system shall let customers pay by card.', 'Pages must load within 2 seconds for 95 percent of requests.', 'Users will be able to reset their password.',
    ]);
    assert.deepEqual(r.candidates.map((c) => c.type), ['FR', 'NFR', 'FR']);
    assert.deepEqual(r.candidates.map((c) => c.confidence), ['medium', 'medium', 'low']);
  });

  it('numbered requirement lines with an id keep the id', () => {
    const r = P.parseHeuristic('FR-012 The system shall export reports as PDF.\nREQ-3: The application must log every login attempt.');
    assert.deepEqual(r.candidates.map((c) => c.sourceId), ['FR-012', 'REQ-3']);
    assert.equal(r.candidates[0].description, 'The system shall export reports as PDF.');
  });

  it('numbered lists under section headings: wrapped lines and bullets stay with their parent, footers are dropped', () => {
    const text = [
      '4. NON-FUNCTIONAL REQUIREMENTS', 'The non-functional requirements specify the qualitative attributes.',
      'Audit Module',
      '1.', 'The System must keep an unalterable audit trail capturing:', '• All the actions taken;', '• The date and time of the event.',
      'Ministry of Home Affairs Draft Core Scope Document Page 7 of 19',
      'The word “unalterable” is to mean that the data cannot be modified.',
      '2. Once the audit trail is activated, the System must track events', 'without manual intervention.',
      'Help Module',
      '1. The solution should provide context-sensitive help.',
      '2. The help should be accessible offline and online',
    ].join('\n');
    const r = P.parseHeuristic(text);
    assert.equal(r.candidates.length, 4);
    assert.equal(r.candidates[0].featureArea, 'Audit Module');
    assert.match(r.candidates[0].description, /audit trail capturing: All the actions taken; The date and time of the event\. The word/);
    assert.equal(r.candidates[1].description, 'Once the audit trail is activated, the System must track events without manual intervention.');
    assert.equal(r.candidates[2].featureArea, 'Help Module');
    assert.equal(r.candidates[3].description, 'The help should be accessible offline and online');
    assert.ok(r.candidates.every((c) => c.type === 'NFR')); // from the nearest heading "NON-FUNCTIONAL REQUIREMENTS"
    assert.ok(r.candidates.every((c) => c.confidence === 'medium'));
  });

  it('the heading decides FR / NFR first, keywords are only the fallback', () => {
    const fr = P.parseHeuristic('3. FUNCTIONAL REQUIREMENTS\nSearch\n1. The system must respond within 2 seconds to every search.');
    assert.equal(fr.candidates[0].type, 'FR'); // keyword rules alone would say NFR
    const fb = P.parseHeuristic('5. ARCHITECTURE\nGuidelines\n1) The system should support SSL encrypted connections');
    assert.equal(fb.candidates[0].type, 'NFR'); // no type heading: keyword fallback
  });

  it('a wrapped item whose first line appears BEFORE its standalone number is put back together', () => {
    const text = ['Support Module', '1. The solution should provide an interface to log defects.', 'The solution should enable the user to track the', '2.', 'submitted request and its status.'].join('\n');
    const r = P.parseHeuristic(text);
    assert.equal(r.candidates.length, 2);
    assert.equal(r.candidates[0].description, 'The solution should provide an interface to log defects.');
    assert.equal(r.candidates[1].description, 'The solution should enable the user to track the submitted request and its status.');
  });

  it('template placeholders (<xx>) are flagged', () => {
    const r = P.parseHeuristic('System Availability\n1. The System must be available from <xx:00> to <xx:00>;\n2. The planned downtime must not exceed <xx> hours.');
    assert.equal(r.candidates.length, 2);
    assert.ok(r.candidates.every((c) => c.placeholders && /placeholders/.test(c.warnings.join(' '))));
  });

  it('list items without a modal are kept as low confidence under a list heading; a "Note that" sentence is dropped', () => {
    const r = P.parseHeuristic('Usability\n1. Individualization can be useful. Note that it is optional.\n2. The interfaces should be intuitive.');
    assert.equal(r.candidates[0].confidence, 'low');
    assert.equal(r.candidates[0].description, 'Individualization can be useful.');
    assert.equal(r.candidates[1].confidence, 'medium');
  });

  it('page headers repeated on every page are not requirements', () => {
    const header = 'E-Governance Mission Mode Project: the System must run';
    const r = P.parseHeuristic([header, 'The system shall work.', header, 'The system shall scale.', header].join('\n'));
    assert.deepEqual(r.candidates.map((c) => c.description), ['The system shall work.', 'The system shall scale.']);
  });
});

describe('duplicates and the preview', () => {
  const existing = [{ reqId: 'X-R01', title: 'Order tracking page', description: 'The system shall show delivery status.', sourceDocument: { name: 'a.docx', sourceId: 'FR-005' } }];
  it('matches by source id or by normalised text', () => {
    const d = P.findDuplicates([
      { sourceId: 'fr-005', title: 'Something else', description: 'different' },
      { sourceId: 'FR-099', title: 'Other', description: 'The system  SHALL show delivery status' },
      { sourceId: 'FR-100', title: 'New', description: 'Brand new' },
    ], existing);
    assert.equal(d.get(0).reason, 'same source id');
    assert.equal(d.get(1).reason, 'same text');
    assert.equal(d.has(2), false);
  });

  it('buildPreview: template rows are selected, duplicates and placeholder rows are not; low confidence is not', () => {
    const parsed = { warnings: [], candidates: [
      { sourceId: 'A', title: 'A item', description: 'The system shall a.', type: 'FR', confidence: 'medium', warnings: [], placeholders: false },
      { sourceId: 'B', title: 'B item', description: 'The system shall b.', type: 'FR', confidence: 'low', warnings: [], placeholders: false },
      { sourceId: 'C', title: 'C item', description: 'The system shall c <xx>.', type: 'FR', confidence: 'medium', warnings: [], placeholders: true },
      { sourceId: 'FR-005', title: 'D item', description: 'dup', type: 'FR', confidence: 'medium', warnings: [], placeholders: false },
    ] };
    const h = P.buildPreview({ documentName: 'x.txt', documentId: 'id', method: 'heuristic', parsed, existing });
    assert.deepEqual(h.candidates.map((c) => c.selected), [true, false, false, false]);
    assert.equal(h.duplicates.length, 1);
    assert.equal(h.existingRequirements, 1);
    assert.match(h.methodNote, /not a trained model/);
    const t = P.buildPreview({ documentName: 'x.docx', documentId: 'id', method: 'template', parsed: { warnings: [], candidates: parsed.candidates.slice(0, 2).map((c) => ({ ...c, confidence: null })) }, existing: [] });
    assert.deepEqual(t.candidates.map((c) => c.selected), [true, true]);
  });

  it('buildPreview warns about repeated ids in template mode and caps at 300 rows', () => {
    const many = Array.from({ length: 305 }, (_, i) => ({ sourceId: i < 2 ? 'FR-1' : `FR-${i}`, title: `T ${i}`, description: `Statement ${i}`, type: 'FR', warnings: [] }));
    const r = P.buildPreview({ documentName: 'x', documentId: 'id', method: 'template', parsed: { warnings: [], candidates: many }, existing: [] });
    assert.equal(r.candidates.length, 300);
    assert.match(r.warnings.join(' '), /Duplicate ids in the document: FR-1/);
    assert.match(r.warnings.join(' '), /only the first 300/);
    assert.equal(r.candidates[1].selected, false);
  });
});
