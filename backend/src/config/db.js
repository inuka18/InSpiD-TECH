'use strict';
const mongoose = require('mongoose');
const config = require('./env');

// Strip any user:password@ from text before it can reach a log.
const redact = (s) => String(s).replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1<redacted>@');

async function connectDb() {
  try {
    // The URI has no database name, so dbName is passed explicitly.
    await mongoose.connect(config.mongoUri, {
      dbName: config.mongoDbName,
      serverSelectionTimeoutMS: 10000,
    });
  } catch (err) {
    console.error('\nCannot connect to MongoDB. Check:');
    console.error('  - the username/password in MONGODB_URI');
    console.error('  - that your IP address is allowed in Atlas (Network Access)');
    console.error('  - that the cluster is running (or use: docker compose --profile localdb up)');
    console.error(`Reason: ${err.name}: ${redact(err.message)}\n`);
    process.exit(1);
  }
}

const isDbConnected = () => mongoose.connection.readyState === 1;

module.exports = { connectDb, isDbConnected, redact };
