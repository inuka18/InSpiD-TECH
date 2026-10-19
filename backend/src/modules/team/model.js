'use strict';
// Team membership lives on the user document (users.projectIds), so this module has no
// collection of its own. Re-exported here so every module has the same file layout.
const { User } = require('../auth/model');

module.exports = { User };
