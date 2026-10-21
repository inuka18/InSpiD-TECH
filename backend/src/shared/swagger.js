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
    resourceRole: str, granularity: granularityEnum, cluster: str, type: { type: 'string', enum: ['FR', 'NFR'] },
    relatedIds: arr(str),
    statusHistory: arr({ type: 'object', properties: { status: statusEnum, timestamp: str, signal: str, signalId: str } }),
  },
};
const ledgerEntry = {
  type: 'object',
  description: 'PLACEHOLDER ledger entry (isPlaceholder: true): not a real blockchain transaction yet.',
  properties: {
    txHash: str, eventType: str, requirementId: str, requirementTitle: str, relatedRequirementId: str,
    previousStatus: str, newStatus: str, triggeringSignal: str, actor: str, timestamp: str,
    blockNumber: { type: 'integer' }, previousBlockHash: str, isPlaceholder: { type: 'boolean' },
  },
};
const networkGraph = {
  type: 'object',
  properties: {
    projectId: str,
    nodes: arr({ type: 'object', properties: { id: str, title: str, liveStatus: statusEnum, cluster: str, type: str, resourceRole: str } }),
    links: arr({ type: 'object', properties: { id: str, source: str, target: str, kind: { type: 'string', enum: ['auto', 'manual'] }, relationType: str, reason: str } }),
  },
};
const signal = {
  type: 'object',
  properties: {
    id: str, projectId: str, reviewStatus: { type: 'string', enum: ['pending', 'accepted', 'rejected'] }, source: str,
    author: { type: 'string', description: 'The sender role (the dataset has no names)' }, timestamp: str, text: str,
    classification: { type: 'string', enum: ['Constraint', 'Expectation', 'Completion', 'Conflict', 'None'] },
    confidence: { type: 'number', nullable: true }, mappedRequirementId: { type: 'string', nullable: true },
  },
};

const INTEGRATION_NOTE = 'CONTRACT for other components: read Component 1 data only through this endpoint. Read-only.';

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'InSPiD-TECH API',
    version: '0.1.0',
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
      post: op('signals', 'Ingest a signal (classified through the AI service, lands as pending)', { body: { type: 'object', required: ['source', 'authorRole', 'text'], properties: { source: { type: 'string', enum: ['Standup', 'Slack', 'Email', 'Teams', 'Jira Comment'] }, authorRole: str, text: str, timestamp: str } }, data: signal }),
    },
    '/projects/{projectId}/signals/{signalId}': { get: op('signals', 'One signal', { params: [param('signalId', 'SC-0001')], data: signal }) },
    '/projects/{projectId}/signals/{signalId}/review': {
      post: op('signals', 'Accept or reject a pending signal', { roles: 'PM', params: [param('signalId', 'SC-0001')], body: { type: 'object', required: ['decision'], properties: { decision: { type: 'string', enum: ['accept', 'reject'] } } } }),
    },

    '/projects/{projectId}/ledger/requirements/{reqId}': { get: op('ledger', 'Ledger entries for one requirement', { params: [param('reqId', 'RET-R01')], data: arr(ledgerEntry) }) },

    '/projects/{projectId}/network/manual-links': {
      get: op('network', 'PM-authored links'),
      post: op('network', 'Add a manual link (writes a placeholder ledger entry)', { roles: 'PM', body: { type: 'object', required: ['sourceId', 'targetId', 'reason'], properties: { sourceId: str, targetId: str, reason: str } } }),
    },
    '/projects/{projectId}/network/manual-links/{linkId}': { delete: op('network', 'Remove a manual link (writes a placeholder ledger entry)', { roles: 'PM', params: [param('linkId', 'manual-link-...')] }) },

    '/projects/{projectId}/live-state': { get: op('integration', 'Current requirements with status, role, granularity', { description: INTEGRATION_NOTE }) },
    '/projects/{projectId}/network': { get: op('integration', 'Network nodes and links', { description: INTEGRATION_NOTE, data: networkGraph }) },
    '/projects/{projectId}/ledger': { get: op('integration', 'Ledger entries (placeholders for now)', { description: INTEGRATION_NOTE, data: arr(ledgerEntry) }) },
    '/projects/{projectId}/schedule-baseline': { get: op('integration', 'Schedule baseline', { description: `${INTEGRATION_NOTE} TODO: real baseline from the schedule component.` }) },
  },
};
