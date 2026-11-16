'use strict';
// `npm test` runs this first. Tests create and delete data, so they may ONLY run against a database whose name
// ends in "_test" (never "inspid") and never against Atlas.
const db = process.env.MONGODB_DB_NAME || '';
const uri = process.env.MONGODB_URI || '';
const problems = [];
if (db === 'inspid') problems.push('MONGODB_DB_NAME is "inspid" (the demo database)');
else if (!/_test$/.test(db)) problems.push(`MONGODB_DB_NAME is "${db}"; it must end in "_test" (use inspid_test)`);
if (/mongodb\.net|mongodb\+srv:/i.test(uri)) problems.push('MONGODB_URI points at Atlas; tests must use the local Mongo (compose profile "localdb")');
if (problems.length) {
  console.error('\nRefusing to run the tests:');
  problems.forEach((p) => console.error(`  - ${p}`));
  console.error('Run them with:  docker compose --profile localdb --profile test run --rm backend-test\n');
  process.exit(1);
}
