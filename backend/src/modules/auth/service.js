'use strict';
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const config = require('../../config/env');
const AppError = require('../../shared/AppError');
const { User } = require('./model');

const publicUser = (u) => ({
  id: String(u._id),
  email: u.email,
  name: u.name,
  role: u.role,
  jobTitle: u.jobTitle,
  projectIds: u.projectIds || [],
});

const signToken = (u) => jwt.sign({ sub: String(u._id), role: u.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

async function register({ email, password, name, jobTitle }) {
  if (await User.exists({ email: email.toLowerCase() })) throw new AppError(409, 'EMAIL_TAKEN', 'Email already registered');
  const user = await User.create({
    email, name, jobTitle: jobTitle || '', role: 'TeamMember', projectIds: [],
    passwordHash: await bcrypt.hash(password, 10),
  });
  return { token: signToken(user), user: publicUser(user) };
}

async function login({ email, password }) {
  const user = await User.findOne({ email: email.toLowerCase() });
  // Same message for unknown email and wrong password.
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError(401, 'BAD_CREDENTIALS', 'Incorrect email or password');
  }
  return { token: signToken(user), user: publicUser(user) };
}

async function me(userId) {
  const user = await User.findById(userId);
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  return publicUser(user);
}

module.exports = { register, login, me, publicUser };
