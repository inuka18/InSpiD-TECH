'use strict';
const mongoose = require('mongoose');
const config = require('./env');
const { ScheduleTask } = require('../modules/schedule/models/ScheduleTask');
const { ScheduleSettings } = require('../modules/schedule/models/ScheduleSettings');
const { ScheduleVersion } = require('../modules/schedule/models/ScheduleVersion');
const { ScheduleLeave } = require('../modules/schedule/models/ScheduleLeave');
const { Project } = require('../modules/projects/model');

const SCHEDULE_MODELS = [ScheduleTask, ScheduleSettings, ScheduleVersion, ScheduleLeave];

// Strip any user:password@ from text before it can reach a log.
const redact = (s) => String(s).replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, '$1<redacted>@');

async function connectDb() {
  try {
    // The URI has no database name, so dbName is passed explicitly.
    await mongoose.connect(config.mongoUri, {
      dbName: config.mongoDbName,
      serverSelectionTimeoutMS: 10000,
    });
    // Mongoose creates a collection on its first insert. Register the
    // schedule collections at startup as well, so they are visible in
    // MongoDB Compass before the first task, leave, or version is saved.
    const existing = new Set((await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name));
    for (const model of SCHEDULE_MODELS) {
      if (!existing.has(model.collection.collectionName)) {
        await model.createCollection();
      }
      await model.createIndexes();
    }
    // Give existing projects a persisted default planner configuration.
    // $setOnInsert keeps user-configured settings intact on later restarts.
    const projects = await Project.find({}, { projectId: 1 }).lean();
    if (projects.length) {
      await ScheduleSettings.bulkWrite(projects.map(({ projectId }) => ({
        updateOne: {
          filter: { projectId },
          update: { $setOnInsert: { projectId, workdays: [1, 2, 3, 4, 5], hoursPerDay: 8, startHour: 9, sprintDays: 10, firstSprintNumber: 1 } },
          upsert: true,
        },
      })));
    }
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
