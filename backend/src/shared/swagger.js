'use strict';
// OpenAPI document served at /api/docs. To document a new route, add one line to `paths`
// using op(tag, summary, options).

const envelope = (data) => ({
  type: 'object',
  properties: { success: { type: 'boolean' }, data, error: { type: 'object', nullable: true } },
});

const projectIdParam = { name: 'projectId', in: 'path', required: true, schema: { type: 'string', example: 'SYS-RET' } };
const param = (name, example) => ({ name, in: 'path', required: true, schema: { type: 'string', example } });

function op(tag, summary, { scoped = true, roles, body, params = [], query = [], data, description } = {}) {
  return {
    tags: [tag],
    summary: roles ? `${summary} (${roles} only)` : summary,
    ...(description ? { description } : {}),
    ...(scoped === 'public' ? {} : { security: [{ bearerAuth: [] }] }),
    parameters: [...(scoped === true ? [projectIdParam] : []), ...params, ...query],
    ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: body } } } } : {}),
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: envelope(data || { type: 'object' }) } } },
      400: { description: 'Validation error' }, 401: { description: 'Not logged in' }, 403: { description: 'Forbidden' },
    },
  };
}

const str = { type: 'string' };
const credentials = { type: 'object', required: ['email', 'password'], properties: { email: str, password: str } };
const statusEnum = { type: 'string', enum: ['Confirmed', 'At Risk', 'Modified', 'Dropped'] };
const granularityEnum = { type: 'string', enum: ['Daily Task', 'Weekly Workload', 'Sprint Commitment'] };
const arr = (items) => ({ type: 'array', items });

const requirement = {
  type: 'object',
  properties: {
    id: { type: 'string', example: 'RET-R01' }, projectId: str, title: str, description: str, liveStatus: statusEnum,
    resourceRole: str, granularity: granularityEnum,
    cluster: { type: 'string', nullable: true, description: 'COMPUTED cluster id (cluster-1, ...); null until the network has been computed. Never the CSV group_id.' },
    clusterLabel: { type: 'string', nullable: true, example: 'Cluster 2 (payments, wallet)' },
    type: { type: 'string', enum: ['FR', 'NFR'] },
    relatedIds: { ...arr(str), description: 'Requirements linked to this one in the computed (Pathfinder) network' },
    statusHistory: arr({ type: 'object', properties: { status: statusEnum, timestamp: str, signal: str, signalId: str } }),
  },
};
const ledgerEntry = {
  type: 'object',
  description: 'PLACEHOLDER ledger entry (onChain: false): not a real blockchain transaction yet. txHash = sha256 of a canonical JSON of the entry fields plus previousBlockHash, so the chain can be checked with GET /ledger/verify.',
  properties: {
    txHash: str,
    eventType: { type: 'string', description: 'Display string kept for the frontend: Status Change, Requirement Created, Manual Link Added, Manual Link Removed, Network Updated or Baseline Created' },
    eventCode: { type: 'string', enum: ['STATUS_CHANGE', 'REQUIREMENT_CREATED', 'MANUAL_LINK', 'NETWORK_UPDATE', 'BASELINE_CREATED'] },
    details: { type: 'object', description: 'NETWORK_UPDATE (display "Network Updated"): { added, removed } link ids. BASELINE_CREATED (display "Baseline Created"): { baselineId, name }. A NETWORK_UPDATE caused by an applied signal has that signal in triggeringSignalId.', properties: { added: arr(str), removed: arr(str), baselineId: str, name: str } },
    requirementId: str, requirementTitle: str, relatedRequirementId: str,
    previousStatus: str, newStatus: str, triggeringSignal: { type: 'string', description: 'The signal text (or the reason for a manual link)' },
    triggeringSignalId: { type: 'string', nullable: true }, actor: str, timestamp: str,
    blockNumber: { type: 'integer', description: 'Sequential per project, starting at 1' }, previousBlockHash: str,
    onChain: { type: 'boolean', example: false }, isPlaceholder: { type: 'boolean' },
  },
};
const networkGraph = {
  type: 'object',
  properties: {
    projectId: str,
    nodes: arr({ type: 'object', properties: { id: str, title: str, liveStatus: statusEnum, cluster: { type: 'string', nullable: true, description: 'Computed cluster id, e.g. cluster-2 (k clusters per project, numbered by size)' }, clusterLabel: { type: 'string', nullable: true }, type: str, resourceRole: str } }),
    links: arr({
      type: 'object',
      properties: {
        id: { type: 'string', example: 'RET-R04~RET-R14~semantic' }, source: str, target: str,
        kind: { type: 'string', enum: ['pathfinder', 'manual'] }, relationType: { type: 'string', example: 'semantic', description: 'semantic for pathfinder links' },
        weight: { type: 'number', description: 'Combined similarity of the pair (pathfinder links only): (1 - w) * text + w * signal profile + evidence boost, capped at 1. With no applied signals it is the text cosine similarity' },
        evidenceCount: { type: 'integer', description: 'Pathfinder links: number of signal-evidence rows (id mentions + co-references) for this pair' },
        contributions: { type: 'object', description: 'Pathfinder links: where the weight comes from; the three parts add up to weight', properties: { text: { type: 'number' }, profile: { type: 'number' }, boost: { type: 'number' } } },
        reason: { type: 'string', description: 'manual links only' },
      },
    }),
    clusters: arr({ type: 'object', properties: { id: str, label: str, size: { type: 'integer' } } }),
    warning: { type: 'string', description: 'Present when the ai-service was unavailable: the stored links (possibly none or out of date) are returned instead' },
  },
};
const labelEnum = { type: 'string', enum: ['Constraint', 'Expectation', 'Completion', 'Conflict', 'None'] };
const signal = {
  type: 'object',
  properties: {
    id: str, projectId: str, reviewStatus: { type: 'string', enum: ['pending', 'accepted', 'rejected'] }, source: str,
    author: { type: 'string', description: 'The sender role (the dataset has no names)' }, timestamp: str, text: str,
    classification: { ...labelEnum, nullable: true, description: 'null = never classified (the AI service was down)' },
    confidence: { type: 'integer', nullable: true, description: 'Model confidence 0-100 (null for seeded signals)' },
    mappedRequirementId: { type: 'string', nullable: true },
    seeded: { type: 'boolean', description: 'Loaded by the seed; its effect is already in the data' },
    modelVersion: { type: 'string', nullable: true },
    autoAcceptThreshold: { type: 'integer', nullable: true, description: 'Threshold (0-100) in force when the signal was ingested' },
    autoApplyMinSimilarity: { type: 'number', nullable: true }, matchSimilarity: { type: 'number', nullable: true }, proposedStatus: { ...statusEnum, nullable: true },
    applied: { type: 'boolean', description: 'The status rule was run and committed for this signal' },
    reviewAction: { type: 'string', nullable: true, enum: ['accept', 'reject', 'correct'] },
    statusNotReversed: { type: 'boolean', description: 'A PM rejected/corrected this signal AFTER its status change was applied. The status change and ledger entry were NOT reversed.' },
    sourceDocument: { type: 'object', nullable: true, description: 'The uploaded document this signal came from (the file itself is not stored)', properties: { id: { type: 'string', description: 'sha256 of the document text' }, name: str } },
  },
};
const matchResult = {
  type: 'object', nullable: true,
  properties: {
    requirementId: { type: 'string', nullable: true, description: 'null when the best similarity is below MATCH_MIN_SIMILARITY (unmapped)' },
    similarity: { type: 'number', nullable: true }, method: { type: 'string', enum: ['auto', 'manual'] },
    alternatives: arr({ type: 'object', properties: { requirementId: str, similarity: { type: 'number' } } }),
  },
};
const ingestResult = {
  type: 'object',
  properties: {
    signal: { ...signal, nullable: true },
    classification: { type: 'object', properties: { label: { ...labelEnum, nullable: true }, confidence: { type: 'integer', nullable: true }, modelVersion: { type: 'string', nullable: true } } },
    match: matchResult, proposedStatus: { ...statusEnum, nullable: true }, applied: { type: 'boolean' }, reviewStatus: { type: 'string', enum: ['pending', 'accepted'] },
    reviewReason: { type: 'string', enum: ['confident-and-mapped', 'none-confident', 'low-confidence', 'unmapped', 'low-similarity', 'proposes-drop', 'unclassified', 'concurrent-update'] },
    autoAcceptThreshold: { type: 'integer' }, matchMinSimilarity: { type: 'number', description: 'Below this no requirement is proposed (unmapped)' },
    autoApplyMinSimilarity: { type: 'number', description: 'A similarity-matched signal below this stays pending, with the proposed requirement shown' },
    statusChange: { type: 'object', nullable: true, properties: { from: statusEnum, to: statusEnum } }, ledgerEntry: { ...ledgerEntry, nullable: true },
    message: { type: 'string', nullable: true }, preview: { type: 'boolean' }, degraded: { type: 'boolean' },
  },
};
const ingestBody = {
  type: 'object', required: ['source', 'text'],
  properties: {
    source: { type: 'string', enum: ['Standup', 'Slack', 'Email', 'Teams', 'Jira Comment'] }, text: str,
    authorRole: { type: 'string', description: "Default: the logged-in user's job title" }, timestamp: { type: 'string', description: 'Default: now' },
    requirementId: { type: 'string', description: 'Skip automatic matching and use this requirement' },
  },
};

const INTEGRATION_NOTE = 'CONTRACT for other components: read Component 1 data only through this endpoint. Read-only.';

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'InSPiD-TECH API',
    version: '0.2.0',
    description: 'Shared backend. Responses are always { success, data, error }. Log in at POST /auth/login, then click Authorize and paste the token.',
  },
  servers: [{ url: '/api/v1' }],
  components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  paths: {
    '/auth/register': { post: op('auth', 'Register a TeamMember account', { scoped: 'public', body: { ...credentials, required: ['email', 'password', 'name'], properties: { ...credentials.properties, name: str, jobTitle: str } } }) },
    '/auth/login': { post: op('auth', 'Log in, returns a JWT', { scoped: 'public', body: credentials }) },
    '/auth/me': { get: op('auth', 'Current user', { scoped: false }) },

    '/projects': {
      get: op('projects', 'Projects the user belongs to', { scoped: false }),
      post: op('projects', 'Create a project', { scoped: false, roles: 'PM', body: { type: 'object', required: ['projectId', 'name'], properties: { projectId: { type: 'string', example: 'SYS-NEW' }, name: str, domain: str, description: str } } }),
    },
    '/projects/{projectId}': { get: op('projects', 'One project') },

    '/projects/{projectId}/team': {
      get: op('team', 'Team members of the project'),
      post: op('team', 'Add an existing user to the project', { roles: 'PM', body: { type: 'object', required: ['email'], properties: { email: str } } }),
    },
    '/projects/{projectId}/team/{userId}': { delete: op('team', 'Remove a member', { roles: 'PM', params: [param('userId', '665f1c2a9b1e8a0012345678')] }) },

    '/projects/{projectId}/requirements': {
      get: op('requirements', 'List requirements with relatedIds and statusHistory', { data: arr(requirement) }),
      post: op('requirements', 'Create a requirement', { roles: 'PM', body: { type: 'object', required: ['title'], properties: { title: str, description: str, type: str, cluster: str, granularity: granularityEnum, resourceRole: str } } }),
    },
    '/projects/{projectId}/requirements/clusters': { get: op('requirements', 'Distinct theme groups') },
    '/projects/{projectId}/requirements/{reqId}': {
      get: op('requirements', 'One requirement', { params: [param('reqId', 'RET-R01')], data: requirement }),
      patch: op('requirements', 'Edit title/description/cluster/granularity/resourceRole (not status)', { roles: 'PM', params: [param('reqId', 'RET-R01')], body: { type: 'object', properties: { title: str, description: str, cluster: str, granularity: granularityEnum, resourceRole: str } } }),
    },

    '/projects/{projectId}/signals': {
      get: op('signals', 'Signal feed, newest first', { data: arr(signal), query: [{ name: 'reviewStatus', in: 'query', schema: { type: 'string', enum: ['pending', 'accepted', 'rejected'] } }, { name: 'requirementId', in: 'query', schema: str }] }),
      post: op('signals', 'Ingest a signal: classify, map to a requirement, apply the status rule if safe, log to the ledger', {
        body: ingestBody, data: ingestResult,
        description: 'Any project member. Flow: /classify -> (None: stop) -> map to a requirement (requirementId, else /match; below MATCH_MIN_SIMILARITY = unmapped) -> status engine -> review policy. '
          + 'Auto-accepted ONLY if confidence >= AUTO_ACCEPT_CONFIDENCE (default 90), the label is not None, a requirement was matched (if matched by similarity rather than an explicit requirementId, similarity >= AUTO_APPLY_MIN_SIMILARITY, default 0.40) and the proposed status is not a move into Dropped; a None signal at/above the threshold is accepted with no effect. '
          + 'Everything else is pending and changes nothing until a PM accepts it. Returns 201, or 202 (stored as unclassified/unmapped + pending, nothing applied) when the AI service is unavailable. '
          + 'MATCH_MIN_SIMILARITY (0.30) decides whether a requirement is proposed at all; all three thresholds are optional env vars (NOT required in .env). '
          + 'An APPLIED signal (auto-accepted, or accepted/corrected by a PM; label not None; never rejected, pending or seeded ones) also feeds the requirement network: it can store evidence rows (an explicit requirement-id mention, or two near-equal match candidates), updates the signal profile of the matched requirement, and the network is refreshed incrementally. Only if a link was added or removed ONE NETWORK_UPDATE ledger entry is written (triggeringSignalId = this signal). If the AI service is down the signal still succeeds and the network is marked stale.',
      }),
    },
    '/projects/{projectId}/signals/preview': {
      post: op('signals', 'Preview the answer for a signal: nothing is saved or applied', {
        body: ingestBody, data: ingestResult,
        description: 'Same classification, match, proposed status and review decision as POST /signals, but nothing is written. signal is null, applied is false, wouldApply says whether it would be auto-applied and statusChange is the change it would make. Returns 502 if the AI service is down.',
      }),
    },
    '/projects/{projectId}/signals/extract': {
      post: op('signals', 'Find signals in a document (meeting notes, standup notes, an email, retrospective notes). Saves nothing.', {
        data: {
          type: 'object',
          properties: {
            documentId: { type: 'string', description: 'sha256 of the extracted text; send it back to /signals/bulk' }, name: str, source: str,
            alreadySubmitted: { type: 'boolean', description: 'This document was already submitted to this project (bulk needs force: true)' },
            modelVersion: { type: 'string', nullable: true }, autoAcceptThreshold: { type: 'integer' }, matchMinSimilarity: { type: 'number' }, autoApplyMinSimilarity: { type: 'number' },
            counts: { type: 'object', properties: { total: { type: 'integer' }, signals: { type: 'integer' }, none: { type: 'integer' } } },
            segments: arr({
              type: 'object',
              properties: {
                index: { type: 'integer' }, line: { type: 'integer', description: 'original line number (1-based)' }, text: str,
                speakerLabel: { type: 'string', nullable: true, description: 'a stripped leading "Name:" prefix, display only' },
                label: labelEnum, confidence: { type: 'integer' }, match: matchResult, proposedStatus: { ...statusEnum, nullable: true },
                wouldAutoApply: { type: 'boolean' }, reviewReason: str,
              },
            }),
          },
        },
        body: { type: 'object', description: 'JSON { text, name?, source? } for pasted text, OR multipart/form-data with the file in the field "file" plus optional text fields source, authorRole, documentDate', properties: { text: str, name: str, source: { type: 'string', enum: ['Standup', 'Slack', 'Email', 'Teams', 'Jira Comment'], default: 'Standup' }, authorRole: str, documentDate: str } },
        description: 'Any project member. Accepts .txt, .md, .docx and .pdf (a PDF is 415 if text extraction is unavailable), up to 2 MB; the file is processed in memory, never stored and never logged. '
          + 'The text is split into lines, bullets and sentences (email headers, greetings, sign-offs, empty lines and segments under 25 characters are ignored; a leading "Name:" prefix is removed and returned as speakerLabel; duplicates are removed). '
          + 'All segments are classified in one batch call and the non-None ones matched to requirements in one call, with the SAME decision rules as POST /signals/preview. More than 300 segments is a 413. 502 if the AI service is unavailable.',
      }),
    },
    '/projects/{projectId}/signals/bulk': {
      post: op('signals', 'Save the approved segments of a document through the normal signal flow', {
        body: {
          type: 'object', required: ['documentId', 'name', 'items'],
          properties: {
            documentId: { type: 'string', description: 'the documentId returned by /signals/extract' }, name: str,
            source: { type: 'string', enum: ['Standup', 'Slack', 'Email', 'Teams', 'Jira Comment'], default: 'Standup' }, authorRole: str, timestamp: { type: 'string', description: 'Default: now' },
            force: { type: 'boolean', description: 'Submit a document that was already submitted to this project' },
            items: { type: 'array', maxItems: 100, items: { type: 'object', required: ['text'], properties: { text: str, requirementId: { type: 'string', description: 'Use this requirement instead of matching (counts as the user\'s choice)' } } } },
          },
        },
        data: {
          type: 'object',
          properties: {
            documentId: str, name: str,
            summary: { type: 'object', properties: { applied: { type: 'integer' }, pending: { type: 'integer' }, noChange: { type: 'integer' }, failed: { type: 'integer' } } },
            results: arr({ type: 'object', properties: { index: { type: 'integer' }, text: str, status: { type: 'string', enum: ['applied', 'pending', 'noChange', 'failed'] }, signalId: str, label: labelEnum, confidence: { type: 'integer' }, requirementId: { type: 'string', nullable: true }, reviewStatus: str, reviewReason: str, statusChange: { type: 'object', nullable: true }, error: str } }),
          },
        },
        description: 'Any project member, max 100 items. Items are classified and matched as a batch first (502 and NOTHING saved if the AI service is down), then each item is decided and saved in order through the same flow as POST /signals '
          + '(review policy, status engine, status history, ledger), so an item sees the status earlier items left behind. Each created signal stores sourceDocument { id, name }. '
          + 'summary: applied = auto-applied and changed a status; pending = waits for a PM; noChange = accepted with nothing to change (including None); failed = could not be saved (reason in results). '
          + '409 DOCUMENT_ALREADY_SUBMITTED if this documentId was already submitted to the project, unless force is true.',
      }),
    },
    '/projects/{projectId}/signals/{signalId}': { get: op('signals', 'One signal', { params: [param('signalId', 'SC-0001')], data: signal }) },
    '/projects/{projectId}/signals/{signalId}/review': {
      post: op('signals', 'PM review: accept, reject or correct a signal (writes a feedback document)', {
        roles: 'PM', params: [param('signalId', 'SC-0001')],
        data: { type: 'object', properties: { signal, action: str, statusChange: { type: 'object', nullable: true }, ledgerEntry: { ...ledgerEntry, nullable: true }, statusNotReversed: { type: 'boolean' }, message: str } },
        body: { type: 'object', required: ['action'], properties: { action: { type: 'string', enum: ['accept', 'reject', 'correct'] }, correctedLabel: labelEnum, correctedRequirementId: str, note: str, decision: { type: 'string', description: 'Old alias of action (accept|reject)' } } },
        description: 'accept: applies the pending status change and ledger entry (seeded signals only get reviewStatus updated). reject: no status effect. correct: re-runs the status rule with the corrected label and/or requirement. '
          + 'IMPORTANT - signals that were already AUTO-ACCEPTED can still be rejected or corrected, but ONLY AS FEEDBACK: the status change and ledger entry they caused are NOT reversed. The response then has statusNotReversed: true and says so in message. A compensating correction ledger entry is the planned proper fix. '
          + '409 if the signal was already reviewed by a PM.',
      }),
    },

    '/projects/{projectId}/feedback/export': {
      get: op('signals', 'Export PM feedback as training data (CSV: text,label,source,role)', {
        roles: 'PM',
        description: 'Returns text/csv in the format `python -m training.train --extra-data` expects. Only accept and correct actions, de-duplicated by text (the latest decision wins). Signals loaded by the seed are left out.',
      }),
    },

    '/projects/{projectId}/ledger/verify': {
      get: op('ledger', 'Recompute the ledger hash chain', {
        data: { type: 'object', properties: { valid: { type: 'boolean' }, entries: { type: 'integer' }, brokenAt: { type: 'integer', nullable: true, description: 'blockNumber of the first bad entry' }, reason: { type: 'string', nullable: true } } },
      }),
    },
    '/projects/{projectId}/ledger/requirements/{reqId}': { get: op('ledger', 'Ledger entries for one requirement', { params: [param('reqId', 'RET-R01')], data: arr(ledgerEntry) }) },

    '/projects/{projectId}/network/recompute': {
      post: op('network', 'Full recompute of the requirement network', {
        roles: 'PM',
        data: { type: 'object', properties: { projectId: str, requirements: { type: 'integer' }, links: { type: 'integer' }, clusters: { type: 'integer' }, added: arr(str), removed: arr(str), reweighted: { type: 'integer' }, ledgerEntry: { ...ledgerEntry, nullable: true } } },
        description: 'Re-embeds every requirement (title + description) with the ai-service, rebuilds the Pathfinder network and the k clusters, and stores only the DIFFERENCE (links added/removed). If any link was added or removed ONE NETWORK_UPDATE ledger entry lists them; if nothing changed there is no ledger entry. Manual links are never changed. 502 if the ai-service is unavailable.',
      }),
    },
    '/projects/{projectId}/network/links/{linkId}/evidence': {
      get: op('network', 'Where a computed link comes from: contributions and the supporting signals', {
        params: [param('linkId', 'RET-R04~RET-R14~semantic')],
        data: {
          type: 'object',
          properties: {
            linkId: str, source: str, target: str, weight: { type: 'number' },
            contributions: { type: 'object', properties: { text: { type: 'number' }, profile: { type: 'number' }, boost: { type: 'number' } } },
            evidenceCount: { type: 'integer' }, evidenceByKind: { type: 'object', properties: { idmention: { type: 'integer' }, coref: { type: 'integer' } } },
            signals: arr({ type: 'object', description: 'Up to 20, newest first', properties: { signalId: str, text: str, source: str, authorRole: str, timestamp: str, label: str, kind: { type: 'string', enum: ['idmention', 'coref'] }, similarityA: { type: 'number', nullable: true }, similarityB: { type: 'number', nullable: true } } }),
          },
        },
        description: 'The signals that gave evidence for this pair: an explicit requirement-id mention (stronger) or a co-reference (the matcher found two requirements about equally similar). 404 if the link does not exist. The signal-profile part is not tied to single signals, so it has no entries in the list.',
      }),
    },
    '/projects/{projectId}/network/manual-links': {
      get: op('network', 'PM-authored links'),
      post: op('network', 'Add a manual link (appends a MANUAL_LINK ledger entry)', { roles: 'PM', body: { type: 'object', required: ['sourceId', 'targetId', 'reason'], properties: { sourceId: str, targetId: str, reason: str } } }),
    },
    '/projects/{projectId}/network/manual-links/{linkId}': { delete: op('network', 'Remove a manual link (writes a placeholder ledger entry)', { roles: 'PM', params: [param('linkId', 'manual-link-...')] }) },

    '/projects/{projectId}/baselines': {
      get: op('network', 'List the baselines of a project (oldest first)', {
        data: arr({ type: 'object', properties: { id: str, name: str, createdAt: str, createdBy: str, initial: { type: 'boolean' }, linkCount: { type: 'integer' }, requirementCount: { type: 'integer' } } }),
      }),
      post: op('network', 'Freeze the CURRENT network and requirement states as a new baseline', {
        roles: 'PM', body: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 80, example: 'Sprint 3 freeze' } } },
        description: 'Appends a BASELINE_CREATED ledger entry (an API-created entry, so npm run rechain refuses once it exists). The "Initial baseline" is created automatically, from the TEXT-ONLY network (no signal evidence or profiles), by network:build and by the first GET /network.',
      }),
    },
    '/projects/{projectId}/baselines/{baselineId}': {
      get: op('network', 'One baseline with its frozen requirements and links', {
        params: [param('baselineId', 'BL-1a2b3c4d')],
        data: { type: 'object', properties: { id: str, name: str, createdAt: str, createdBy: str, initial: { type: 'boolean' }, requirements: arr({ type: 'object', properties: { id: str, title: str, description: str, type: str, status: str, granularity: str, resourceRole: str } }), links: arr({ type: 'object', properties: { source: str, target: str, weight: { type: 'number' } } }) } },
      }),
    },
    '/projects/{projectId}/baselines/{baselineId}/diff': {
      get: op('network', 'What changed since a baseline', {
        params: [param('baselineId', 'BL-1a2b3c4d')],
        data: { type: 'object', properties: { baseline: { type: 'object', properties: { id: str, name: str, createdAt: str } }, requirements: { type: 'object', properties: { changed: arr({ type: 'object', properties: { id: str, title: str, from: statusEnum, to: statusEnum } }), added: arr(str), removed: arr(str) } }, links: { type: 'object', properties: { added: arr(str), removed: arr(str) } } } },
        description: 'Requirements whose status differs from the baseline, and computed links added / removed against the CURRENT network (link ids like RET-R04~RET-R14~semantic).',
      }),
    },
    '/projects/{projectId}/alignment': {
      get: op('network', 'Alignment: how far the current network has drifted from a baseline', {
        query: [{ name: 'baselineId', in: 'query', required: false, schema: { type: 'string' }, description: 'Default: the latest baseline' }],
        data: {
          type: 'object',
          properties: {
            baseline: { type: 'object', properties: { id: str, name: str, createdAt: str } },
            current: { type: 'object', properties: { score: { type: 'integer', description: '0-100' }, band: { type: 'string', enum: ['Strong Alignment', 'Moderate Drift', 'Significant Drift'] }, connectionsAdded: { type: 'integer' }, connectionsRemoved: { type: 'integer' }, changedConnections: { type: 'integer' } } },
            history: arr({ type: 'object', properties: { date: { type: 'string', example: '2026-10-21', description: 'Asia/Colombo day' }, alignmentScore: { type: 'integer' }, connectionsAdded: { type: 'integer' }, connectionsRemoved: { type: 'integer' }, changedConnections: { type: 'integer' }, driverSignalId: { type: 'string', nullable: true } } }),
          },
        },
        description: 'score = round(100 * |B and C| / |B or C|) over the undirected COMPUTED link sets of the baseline (B) and the current network (C); manual links are excluded; two empty sets score 100. Bands: >= 80 Strong Alignment, 60-79 Moderate Drift, below 60 Significant Drift. history is daily (Asia/Colombo days) from the baseline day to the last change (max 90 days), rebuilt by replaying the NETWORK_UPDATE ledger entries after the baseline; quiet days carry the score forward. driverSignalId is the signal behind the day\'s largest change when at least 2 connections changed. 404 when the project has no baseline.',
      }),
    },

    '/projects/{projectId}/live-state': { get: op('integration', 'Current requirements with status, role, granularity', { description: INTEGRATION_NOTE }) },
    '/projects/{projectId}/network': {
      get: op('integration', 'Requirements network: nodes, computed links and clusters', {
        data: networkGraph,
        description: `${INTEGRATION_NOTE} Links are computed from the requirement texts: MiniLM embeddings of title + description, cosine distance, Pathfinder PFNET(r=infinity, q=n-1). Clusters are average-linkage agglomerative clusters on the same distances, cut to k = clamp(round(sqrt(n)), 3, 8) clusters per project (chosen for usability, not tuned; never group_id). If no links are computed yet they are computed first; if the ai-service is down the stored links (possibly empty) are returned with a warning. Manual links are appended unchanged. Applied signals refine the network incrementally (evidence, signal profiles; see POST /signals); if such an update could not run because the ai-service was down, the network is marked stale and the next GET /network or POST /network/recompute catches up.`,
      }),
    },
    '/projects/{projectId}/ledger': { get: op('integration', 'Ledger entries (placeholders for now)', { description: INTEGRATION_NOTE, data: arr(ledgerEntry) }) },
    '/projects/{projectId}/schedule-baseline': { get: op('integration', 'Schedule baseline', { description: `${INTEGRATION_NOTE} TODO: real baseline from the schedule component.` }) },
  },
};
