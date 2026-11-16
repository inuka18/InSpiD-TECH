'use strict';
const router = require('express').Router({ mergeParams: true });
const validate = require('../../middleware/validate');
const { requireRole } = require('../../middleware/auth');
const { projectParams, taskParams, versionParams, createTaskBody, importTasksBody, updateTaskBody, settingsBody, saveVersionBody, leaveBody } = require('./schema');
const c = require('./controller');

router.get('/', validate({ params: projectParams }), c.getSchedule);
router.get('/tasks', validate({ params: projectParams }), c.listTasks);
router.post('/tasks/import', requireRole('PM'), validate({ params: projectParams, body: importTasksBody }), c.importTasks);
router.post('/tasks', requireRole('PM'), validate({ params: projectParams, body: createTaskBody }), c.createTask);
router.patch('/tasks/:taskId', validate({ params: taskParams, body: updateTaskBody }), c.updateTask);
router.delete('/tasks/:taskId', requireRole('PM'), validate({ params: taskParams }), c.deleteTask);

router.get('/settings', validate({ params: projectParams }), c.getSettings);
router.put('/settings', requireRole('PM'), validate({ params: projectParams, body: settingsBody }), c.updateSettings);
router.post('/plan/preview', validate({ params: projectParams }), c.previewPlan);
router.post('/plan/apply', requireRole('PM'), validate({ params: projectParams }), c.applyPlan);

router.post('/leaves/preview', validate({ params: projectParams, body: leaveBody }), c.previewLeave);
router.post('/leaves', requireRole('PM'), validate({ params: projectParams, body: leaveBody }), c.applyLeave);
router.get('/leaves', validate({ params: projectParams }), c.listLeaves);
router.get('/versions', validate({ params: projectParams }), c.listVersions);
router.post('/versions', requireRole('PM'), validate({ params: projectParams, body: saveVersionBody }), c.saveVersion);
router.get('/versions/:versionId', validate({ params: versionParams }), c.getVersion);

module.exports = router;
