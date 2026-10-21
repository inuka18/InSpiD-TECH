'use strict';
const config = require('./config/env'); // exits with a clear message if .env is not ready
const { connectDb } = require('./config/db');
const app = require('./app');

(async () => {
  await connectDb(); // exits with a clear message if MongoDB is unreachable
  app.listen(config.port, () => {
    console.log(`InSPiD-TECH backend listening on :${config.port}`);
    console.log(`  API  /api/v1   Docs /api/docs   Health /health`);
  });
})();
