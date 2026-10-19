'use strict';
const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    // projectId is the project's own key (e.g. "SYS-RET"), used in every /projects/:projectId URL.
    projectId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    domain: { type: String, default: '' },
    description: { type: String, default: '' },
  },
  { timestamps: true, collection: 'projects' }
);

module.exports = { Project: mongoose.models.Project || mongoose.model('Project', projectSchema) };
