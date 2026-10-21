'use strict';
// Loads the ROOT .env (works from any cwd; in Docker the vars come from compose env_file
// and the file simply does not exist) and refuses to run if a required value is unusable.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const REQUIRED = [
  'PORT',
  'MONGODB_URI',
  'MONGODB_DB_NAME',
  'JWT_SECRET',
  'JWT_EXPIRES_IN',
  'NEO4J_URI',
  'NEO4J_USER',
  'NEO4J_PASSWORD',
  'AI_SERVICE_URL',
  'BLOCKCHAIN_RPC_URL',
  'SEED_PM_PASSWORD',
  'SEED_MEMBER_PASSWORD',
];

const problems = [];
for (const key of REQUIRED) {
  const value = process.env[key];
  if (value === undefined || value.trim() === '') problems.push(`${key} is missing`);
  else if (value.includes('REPLACE_')) problems.push(`${key} still contains the placeholder "REPLACE_..."; set a real value`);
  else if (value.includes('<db_')) problems.push(`${key} still contains the placeholder "<db_...>"; put your MongoDB Atlas username/password in`);
}
// Optional tuning values: NOT in REQUIRED, so an existing .env keeps working. Invalid values stop startup.
function optionalNumber(key, fallback, min, max) {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    problems.push(`${key} must be a number between ${min} and ${max} (or leave it unset)`);
    return fallback;
  }
  return n;
}
const autoAcceptConfidence = optionalNumber('AUTO_ACCEPT_CONFIDENCE', 90, 0, 100); // 0-100, signals at/above are auto-accepted
const matchMinSimilarity = optionalNumber('MATCH_MIN_SIMILARITY', 0.3, -1, 1); // below this no requirement is proposed (unmapped)
const autoApplyMinSimilarity = optionalNumber('AUTO_APPLY_MIN_SIMILARITY', 0.4, -1, 1); // a similarity-matched signal below this stays pending

if (problems.length) {
  // Only variable names are printed, never values.
  console.error('\nCannot start: the root .env file is not ready.');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('Fix these in .env (see .env.example) and start again.\n');
  process.exit(1);
}

module.exports = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  mongoUri: process.env.MONGODB_URI,
  mongoDbName: process.env.MONGODB_DB_NAME,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN,
  neo4j: { uri: process.env.NEO4J_URI, user: process.env.NEO4J_USER, password: process.env.NEO4J_PASSWORD },
  aiServiceUrl: process.env.AI_SERVICE_URL.replace(/\/$/, ''),
  blockchainRpcUrl: process.env.BLOCKCHAIN_RPC_URL,
  autoAcceptConfidence,
  matchMinSimilarity,
  autoApplyMinSimilarity,
  seed: { pmPassword: process.env.SEED_PM_PASSWORD, memberPassword: process.env.SEED_MEMBER_PASSWORD },
  scenarioDir: process.env.SCENARIO_DIR || path.resolve(__dirname, '../../../data/scenario'),
});
