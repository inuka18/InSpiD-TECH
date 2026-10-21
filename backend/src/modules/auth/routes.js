'use strict';
const router = require('express').Router();
const validate = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const { registerBody, loginBody } = require('./schema');
const c = require('./controller');

router.post('/register', validate({ body: registerBody }), c.register);
router.post('/login', validate({ body: loginBody }), c.login);
router.get('/me', requireAuth, c.me);

module.exports = router;
