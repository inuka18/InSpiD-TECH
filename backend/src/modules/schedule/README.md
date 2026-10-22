# Schedule module

This module stores and plans schedule-specific data in its own collections. It does not change the Projects, Requirements, Team, or integration modules. Requirements are checked/read through the existing integration service, and team membership is checked against the existing User model.

The module is mounted at `/api/v1/projects/:projectId/schedule` and inherits authentication plus project-membership checks from `src/routes.js`.

## Files

- `routes.js`, `controller.js`, `service.js`, `schema.js`: project-scoped HTTP API, validation, and business logic.
- `models/ScheduleTask.js`: task estimates, current and immutable baseline dates, assignees, dependencies, status, and sprint assignment.
- `models/ScheduleSettings.js`: project work calendar and sprint settings.
- `models/ScheduleVersion.js`: saved task and settings snapshots.
- `models/ScheduleLeave.js`: leave entries and applied task changes.

## Endpoints

- `GET /` and `GET /tasks`: read the schedule.
- `POST /tasks`, `POST /tasks/import`, `PATCH /tasks/:taskId`, `DELETE /tasks/:taskId`: manage tasks. Create/import/delete is PM-only. Import is idempotent and does not overwrite existing schedule tasks. Team members may update status/progress only on tasks assigned to them.
- `GET /settings`, `PUT /settings`: read/update the sprint work calendar.
- `POST /plan/preview`, `POST /plan/apply`: preview/apply a task-level plan. Independent tasks can share a sprint; dependencies gate start dates. Done tasks are preserved. Applying a plan saves a pre-change version.
- `POST /leaves/preview`, `POST /leaves`, `GET /leaves`: preview/apply/list leave. Done tasks are excluded. Same-role backups are selected by remaining workload capacity; otherwise open tasks move to the next working day, and unfinished dependents are shifted when needed.
- `GET /versions`, `POST /versions`, `GET /versions/:versionId`: save and inspect schedule snapshots.

The existing read-only `GET /projects/:projectId/schedule-baseline` integration endpoint is not replaced. Schedule task records retain `baselineStart` and `baselineEnd` separately from mutable current dates.
