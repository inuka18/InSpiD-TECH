'use strict';
// All API routes under /api/v1. To add a module: create its router, then add ONE line below.
const express = require('express');
const { requireAuth, requireProjectMember } = require('./middleware/auth');

const v1 = express.Router();

v1.use('/auth', require('./modules/auth/routes'));
v1.use('/projects', requireAuth, require('./modules/projects/routes'));

// Project-scoped modules: must be logged in AND belong to :projectId.
const scoped = (path, router) => v1.use(`/projects/:projectId/${path}`, requireAuth, requireProjectMember, router);
scoped('team', require('./modules/team/routes'));
scoped('requirements', require('./modules/requirements/routes'));
scoped('signals', require('./modules/signals/routes'));
scoped('feedback', require('./modules/feedback/routes'));
scoped('ledger', require('./modules/ledger/routes'));
scoped('network', require('./modules/network/routes'));
// scoped('gap-detection', require('./modules/gap-detection/routes'));      // TODO: Component 2 owner
// scoped('schedule', require('./modules/schedule/routes'));                // TODO: Component 3 owner
// scoped('retrospectives', require('./modules/retrospectives/routes'));    // TODO: Component 4 owner

// Read-only contract for the other components: live-state, network, ledger, schedule-baseline.
v1.use('/projects/:projectId', requireAuth, requireProjectMember, require('./modules/integration/routes'));

module.exports = v1;
