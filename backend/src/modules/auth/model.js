'use strict';
const mongoose = require('mongoose');

const ROLES = ['PM', 'TeamMember'];

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true },
    // Job title taken from the author_role column (e.g. "QA Engineer"); no real names in the dataset.
    jobTitle: { type: String, default: '' },
    // projectIds = every project the user belongs to. projectId = their home project (kept so
    // every document in the database carries a projectId).
    projectId: { type: String, index: true },
    projectIds: { type: [String], default: [], index: true },
  },
  { timestamps: true, collection: 'users' }
);

module.exports = { User: mongoose.models.User || mongoose.model('User', userSchema), ROLES };
