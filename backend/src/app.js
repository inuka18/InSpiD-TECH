'use strict';
const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const config = require('./config/env');
const { isDbConnected } = require('./config/db');
const { ok, fail } = require('./shared/response');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const openapi = require('./shared/swagger');

const app = express();
app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()) }));
app.use(express.json({ limit: '1mb' }));

const health = (req, res) => {
  const mongo = isDbConnected();
  const data = { status: mongo ? 'ok' : 'degraded', service: 'backend', uptimeSeconds: Math.round(process.uptime()), mongo: { connected: mongo } };
  return mongo ? ok(res, data) : fail(res, 503, 'DB_DOWN', 'MongoDB is not connected', data);
};
app.get('/health', health);
app.get('/api/v1/health', health);

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));
app.get('/api/docs.json', (req, res) => res.json(openapi));
app.use('/api/v1', require('./routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
