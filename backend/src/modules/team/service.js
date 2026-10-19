'use strict';
const AppError = require('../../shared/AppError');
const { User } = require('./model');

// Shape follows the frontend mockTeam rows (appRole: "pm" | "member").
const toApi = (u, projectId) => ({
  id: String(u._id),
  projectId,
  name: u.name,
  email: u.email,
  jobTitle: u.jobTitle,
  appRole: u.role === 'PM' ? 'pm' : 'member',
  // TODO (schedule component): workloadPercent and assignedTasksCount come from the schedule module.
});

async function list(projectId) {
  const users = await User.find({ projectIds: projectId }).sort({ role: -1, jobTitle: 1 }).lean();
  return users.map((u) => toApi(u, projectId));
}

async function addMember(projectId, email) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'No registered user with that email');
  await User.updateOne({ _id: user._id }, { $addToSet: { projectIds: projectId } });
  return toApi(user, projectId);
}

async function removeMember(projectId, userId, actorId) {
  if (userId === actorId) throw new AppError(400, 'BAD_REQUEST', 'You cannot remove yourself');
  const res = await User.updateOne({ _id: userId, projectIds: projectId }, { $pull: { projectIds: projectId } });
  if (!res.matchedCount) throw new AppError(404, 'NOT_FOUND', 'That user is not on this project');
  return { removed: userId };
}

module.exports = { list, addMember, removeMember };
