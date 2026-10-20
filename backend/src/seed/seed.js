'use strict';
// npm run seed  -  loads the four scenario systems from data/scenario/*.csv.
// Safe to run twice: every record is upserted by its natural key (project_id, req_id, signal_id...).
// Does NOT use the frontend mock data.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const { parse } = require('csv-parse/sync');
const config = require('../config/env');
const { connectDb } = require('../config/db');
const { User } = require('../modules/auth/model');
const { Project } = require('../modules/projects/model');
const { Requirement, StatusHistory } = require('../modules/requirements/model');
const { Signal } = require('../modules/signals/model');
const { RequirementLink, NetworkGroundTruth } = require('../modules/network/model');
const { LedgerEntry } = require('../modules/ledger/model');
const { sha, rechainSeedEntries, verifyChain } = require('../modules/ledger/service');

const PENDING_PER_PROJECT = 3; // most recent requirement-linked signals left "pending" for the Accept/Reject demo
const MEMBERS_PER_PROJECT = 4;
const EMAIL_DOMAIN = 'inspid.test';
// Two PMs manage two projects each (everyone else keeps just their own). Keyed by email; the first project is the
// user's primary one (users.projectId) and never changes. pm.hms and pm.ulp keep only their own project.
const EXTRA_PROJECTS = {
  [`pm.ret@${EMAIL_DOMAIN}`]: ['SYS-HMS'],
  [`pm.mba@${EMAIL_DOMAIN}`]: ['SYS-ULP'],
};

// cast is off, so every value stays a string and the label "None" stays text.
const readCsv = (file) =>
  parse(fs.readFileSync(path.join(config.scenarioDir, file)), { columns: true, skip_empty_lines: true, bom: true });
const blankToNull = (v) => (v === '' || v === undefined ? null : v);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const code = (projectId) => projectId.replace(/^SYS-/, '').toLowerCase();

async function bulkUpsert(Model, ops, label) {
  let inserted = 0;
  let matched = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const res = await Model.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    inserted += res.upsertedCount;
    matched += res.matchedCount;
  }
  console.log(`  ${label.padEnd(18)} ${String(ops.length).padStart(5)} rows  (${inserted} new, ${matched} already there)`);
}

const upsert = (filter, set, setOnInsert) => ({
  updateOne: { filter, update: { $set: set, ...(setOnInsert ? { $setOnInsert: setOnInsert } : {}) }, upsert: true },
});

function mostFrequent(counts) {
  // Highest count wins; ties go to the alphabetically first role so re-runs are deterministic.
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'Unassigned';
}

async function main() {
  const projects = readCsv('scenario_projects.csv');
  const requirements = readCsv('scenario_requirements.csv');
  const signals = readCsv('scenario_signals.csv');
  const history = readCsv('scenario_status_history.csv');
  const pairs = readCsv('scenario_related_pairs.csv');

  await connectDb();
  await Promise.all([User, Project, Requirement, StatusHistory, Signal, RequirementLink, NetworkGroundTruth, LedgerEntry].map((m) => m.init()));
  console.log(`Seeding database "${config.mongoDbName}" from ${config.scenarioDir}`);

  // ---- projects
  await bulkUpsert(Project, projects.map((p) =>
    upsert({ projectId: p.project_id }, { name: p.name, domain: p.domain, description: p.description })), 'projects');

  // ---- requirements (resourceRole = most frequent author_role among the requirement's signals)
  const roleCounts = new Map(); // `${projectId}|${reqId}` -> Map(role -> n)
  for (const s of signals) {
    if (!s.req_id) continue;
    const k = `${s.project_id}|${s.req_id}`;
    if (!roleCounts.has(k)) roleCounts.set(k, new Map());
    roleCounts.get(k).set(s.author_role, (roleCounts.get(k).get(s.author_role) || 0) + 1);
  }
  await bulkUpsert(Requirement, requirements.map((r) =>
    upsert({ projectId: r.project_id, reqId: r.req_id }, {
      title: r.title, description: r.description, type: r.type, groupId: r.group_id, granularity: r.granularity,
      initialStatus: r.initial_status, finalStatus: r.final_status, liveStatus: r.final_status, split: r.split,
      resourceRole: roleCounts.has(`${r.project_id}|${r.req_id}`) ? mostFrequent(roleCounts.get(`${r.project_id}|${r.req_id}`)) : 'Unassigned',
    })), 'requirements');

  // ---- signals (reviewStatus is only set on first insert, so a re-seed never undoes a PM's decision)
  const pending = new Set();
  for (const p of projects) {
    signals
      .filter((s) => s.project_id === p.project_id && s.req_id)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, PENDING_PER_PROJECT)
      .forEach((s) => pending.add(s.signal_id));
  }
  await bulkUpsert(Signal, signals.map((s) =>
    upsert({ projectId: s.project_id, signalId: s.signal_id }, {
      source: s.source, authorRole: s.author_role, timestamp: new Date(s.timestamp), text: s.text, label: s.label,
      reqId: blankToNull(s.req_id), resultingStatus: blankToNull(s.resulting_status), split: s.split, batch: s.batch,
      seeded: true, // its effect is already in the requirement/status data; the review flow only updates reviewStatus
    }, { reviewStatus: pending.has(s.signal_id) ? 'pending' : 'accepted', confidence: null })), 'signals');

  // ---- status_history (resourceRole = author role, granularity = the requirement's)
  const granularityOf = new Map(requirements.map((r) => [`${r.project_id}|${r.req_id}`, r.granularity]));
  await bulkUpsert(StatusHistory, history.map((h) =>
    upsert({ projectId: h.project_id, historyId: h.history_id }, {
      reqId: h.req_id, signalId: h.signal_id, timestamp: new Date(h.timestamp), label: h.label,
      fromStatus: h.from_status, toStatus: h.to_status, statusChanged: h.status_changed === '1', source: h.source, authorRole: h.author_role,
      resourceRole: h.author_role, granularity: granularityOf.get(`${h.project_id}|${h.req_id}`) ?? null,
    })), 'status_history');

  // ---- network_ground_truth: scenario_related_pairs.csv is the ANSWER KEY for evaluating the network, not the network.
  // (The network itself is computed from the requirement texts: npm run network:build.)
  await bulkUpsert(NetworkGroundTruth, pairs.map((p) =>
    upsert({ projectId: p.project_id, reqA: p.req_a, reqB: p.req_b, relationType: p.relation_type }, {})), 'network_ground_truth');
  // Older seeds stored those pairs as requirement_links (rows without a `kind`). They are now in network_ground_truth.
  const legacy = await RequirementLink.deleteMany({ kind: { $exists: false } });
  if (legacy.deletedCount) console.log(`  removed ${legacy.deletedCount} legacy CSV-pair rows from requirement_links (now in network_ground_truth)`);

  // ---- ledger_entries: PLACEHOLDERS built from the status changes (NOT blockchain transactions).
  // Chain fields are only written when an entry is first inserted, so re-seeding never breaks an existing chain.
  // On a FRESH ledger (no entries yet) the chain is built right after with rechainSeedEntries().
  const freshLedger = (await LedgerEntry.countDocuments()) === 0;
  const titleOf = new Map(requirements.map((r) => [`${r.project_id}|${r.req_id}`, r.title]));
  const textOf = new Map(signals.map((s) => [s.signal_id, s.text]));
  const ledgerOps = [];
  for (const p of projects) {
    const changes = history
      .filter((h) => h.project_id === p.project_id && h.status_changed === '1')
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp) || a.history_id.localeCompare(b.history_id));
    changes.forEach((h, i) => {
      ledgerOps.push(upsert({ projectId: h.project_id, historyId: h.history_id }, {
        reqId: h.req_id, requirementTitle: titleOf.get(`${h.project_id}|${h.req_id}`),
        previousStatus: h.from_status, newStatus: h.to_status, triggeringSignal: textOf.get(h.signal_id) ?? null,
        triggeringSignalId: h.signal_id, actor: h.author_role, timestamp: new Date(h.timestamp),
      }, {
        eventType: 'STATUS_CHANGE', txHash: sha(`seed|${h.project_id}|${h.history_id}`), blockNumber: i + 1,
        previousBlockHash: '', onChain: false, isPlaceholder: true, createdVia: 'seed',
      }));
    });
  }
  await bulkUpsert(LedgerEntry, ledgerOps, 'ledger_entries');
  if (freshLedger) {
    const r = await rechainSeedEntries();
    const bad = [];
    for (const p of projects) if (!(await verifyChain(p.project_id)).valid) bad.push(p.project_id);
    console.log(`  ledger chain built for ${r.projects} projects (${r.entries} entries); verify: ${bad.length ? 'FAILED for ' + bad.join(', ') : 'valid'}`);
  } else {
    console.log('  ledger already had entries, so the chain was left as it is (run `npm run rechain` only if it does not verify).');
  }

  // ---- users: 1 PM + a few TeamMembers per project, from the author_role column
  const users = [];
  for (const p of projects) {
    const c = code(p.project_id);
    users.push({ email: `pm.${c}@${EMAIL_DOMAIN}`, role: 'PM', jobTitle: 'Project Manager', projectId: p.project_id });
    const counts = new Map();
    signals.filter((s) => s.project_id === p.project_id && s.author_role !== 'Project Manager')
      .forEach((s) => counts.set(s.author_role, (counts.get(s.author_role) || 0) + 1));
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MEMBERS_PER_PROJECT)
      .forEach(([role]) => users.push({ email: `${slug(role)}.${c}@${EMAIL_DOMAIN}`, role: 'TeamMember', jobTitle: role, projectId: p.project_id }));
  }
  // Extra projects (only those that exist in the CSV); $addToSet makes re-running safe.
  const known = new Set(projects.map((p) => p.project_id));
  for (const u of users) {
    const extras = (EXTRA_PROJECTS[u.email] || []).filter((id) => {
      if (!known.has(id)) console.warn(`  warning: ${u.email} should also manage ${id}, which is not in scenario_projects.csv (skipped)`);
      return known.has(id);
    });
    u.allProjects = [u.projectId, ...extras];
  }
  const labelOf = (u) => `${u.jobTitle} (${u.allProjects.map((id) => code(id).toUpperCase()).join(', ')})`;
  const pmHash = await bcrypt.hash(config.seed.pmPassword, 10);
  const memberHash = await bcrypt.hash(config.seed.memberPassword, 10);
  await User.bulkWrite(users.map((u) => ({
    updateOne: {
      filter: { email: u.email },
      update: {
        $set: { name: labelOf(u), role: u.role, jobTitle: u.jobTitle, projectId: u.projectId, passwordHash: u.role === 'PM' ? pmHash : memberHash },
        $addToSet: { projectIds: { $each: u.allProjects } },
      },
      upsert: true,
    },
  })));
  console.log(`  ${'users'.padEnd(18)} ${String(users.length).padStart(5)} rows`);

  console.log('\nDemo logins (passwords are SEED_PM_PASSWORD / SEED_MEMBER_PASSWORD from .env):');
  for (const u of users) console.log(`  ${u.role.padEnd(10)} ${u.email.padEnd(40)} ${u.allProjects.join(', ')}`);
  console.log(`\nNext: npm run network:build  (computes the requirement network and clusters; needs the ai-service)\nPending signals left for the Accept/Reject demo: ${pending.size}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
