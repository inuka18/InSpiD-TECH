'use strict';
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const AppError = require('../shared/AppError');
const { User } = require('../modules/auth/model');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw new AppError(401, 'UNAUTHENTICATED', 'Missing Bearer token');
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token');
    }
    const user = await User.findById(payload.sub).lean();
    if (!user) throw new AppError(401, 'INVALID_TOKEN', 'User no longer exists');
    req.user = { id: String(user._id), email: user.email, role: user.role, projectIds: user.projectIds || [] };
    next();
  } catch (err) {
    next(err);
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : next(new AppError(403, 'FORBIDDEN', `Requires role: ${roles.join(' or ')}`));

// For every /projects/:projectId/... route.
const requireProjectMember = (req, res, next) =>
  req.user?.projectIds.includes(req.params.projectId)
    ? next()
    : next(new AppError(403, 'NOT_A_PROJECT_MEMBER', 'You do not belong to this project'));

module.exports = { requireAuth, requireRole, requireProjectMember };
