'use strict';
const AppError = require('../../shared/AppError');
const { User } = require('../auth/model');
const { Project } = require('./model');

const toApi = (p) => ({
  id: p.projectId,
  projectId: p.projectId,
  name: p.name,
  domain: p.domain,
  description: p.description,
});

async function listForUser(user) {
  const projects = await Project.find({ projectId: { $in: user.projectIds } }).sort({ projectId: 1 }).lean();
  return projects.map(toApi);
}

async function getById(projectId) {
  const project = await Project.findOne({ projectId }).lean();
  if (!project) throw new AppError(404, 'NOT_FOUND', `Project ${projectId} not found`);
  return toApi(project);
}

// PM-only. The creator becomes a member of the new project.
async function create(user, body) {
  if (await Project.exists({ projectId: body.projectId })) throw new AppError(409, 'DUPLICATE', 'projectId already exists');
  const project = await Project.create(body);
  await User.updateOne({ _id: user.id }, { $addToSet: { projectIds: project.projectId } });
  return toApi(project);
}

module.exports = { listForUser, getById, create };
