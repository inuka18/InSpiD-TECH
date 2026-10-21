# InSPiD-TECH

Final-year research project, four components sharing one backend.

| Component | What it does |
|---|---|
| 1. Living Requirements Engine | Classifies messages, keeps requirement status live, network map, ledger |
| 2. Gap Detection | `backend/src/modules/gap-detection` (owner adds their name in its README) |
| 3. Adaptive Schedule Re-Optimization | `backend/src/modules/schedule` |
| 4. Retrospective Intelligence | `backend/src/modules/retrospectives` |

## Folder map

```
Frontend/        React prototype (mock data in src/data, service layer in src/services)
backend/         Node 20 + Express + Mongoose API  (/api/v1, docs at /api/docs)
ai-service/      FastAPI (placeholder /classify /embed /similarity)
contracts/       Hardhat project (Solidity ledger comes later)
data/            DATA_README.md describes it; data/scenario/*.csv feeds the seed; data/raw is git-ignored
docker-compose.yml   neo4j, hardhat, ai-service, backend  (+ optional local mongo)
.env             REAL config, git-ignored       .env.example   template, safe to commit
```

## 1. Configure `.env` (once)

`.env` already exists at the repo root with working defaults. Replace only:

- `MONGODB_URI`: the `<db_username>` and `<db_password>` parts (keep the rest)
- `JWT_SECRET`, `NEO4J_PASSWORD`, `SEED_PM_PASSWORD`, `SEED_MEMBER_PASSWORD`: anything starting with `REPLACE_`

The backend refuses to start (and names the variable) if a value is missing or still contains
`REPLACE_` or `<db_`. Never commit `.env`.

## 2. Pick a database

**A. MongoDB Atlas (default).** Put your Atlas credentials in `MONGODB_URI`. The URI has no database name,
so the backend passes `MONGODB_DB_NAME` (default `inspid`) to Mongoose. Make sure your IP is allowed in
Atlas > Network Access.

**B. Local MongoDB (no Atlas).** Set `MONGODB_URI=mongodb://mongo:27017/` (inside Docker) or
`mongodb://localhost:27017/` (backend outside Docker), then add the `localdb` profile:

```
docker compose --profile localdb up --build
```

## 3. Run

Everything in Docker:

```
docker compose up --build                       # Atlas
docker compose --profile localdb up --build     # local Mongo
docker compose exec backend npm run seed        # load the four systems (safe to run twice)
```

The backend starts after neo4j, hardhat and ai-service report healthy.

Backend outside Docker (needs Node 20+): in `.env` switch the three Docker URLs to their localhost form
(see the comments above them), start the others with `docker compose up neo4j hardhat ai-service`, then:

```
cd backend
npm install
npm run seed
npm run dev
```

## 4. Check it works

- `http://localhost:5000/health` : `mongo.connected: true`
- `http://localhost:8000/health` : ai-service
- `http://localhost:5000/api/docs` : Swagger. `POST /auth/login`, then **Authorize** with the token
- `http://localhost:7474` : Neo4j browser, `http://localhost:8545` : Hardhat node (JSON-RPC)

Seed users (`@inspid.test`): `pm.ret@`, `pm.hms@`, `pm.mba@`, `pm.ulp@` (PM, password `SEED_PM_PASSWORD`) and
TeamMembers such as `developer.ret@` (password `SEED_MEMBER_PASSWORD`). The seed prints the full list.

## API conventions

- Everything under `/api/v1`. Responses are always `{ success, data, error }`.
- Roles: `PM`, `TeamMember`. Middleware: `requireAuth`, `requireRole("PM")`, `requireProjectMember`.
- Project data is always `/projects/:projectId/...` and only for members of that project.
- Every body is validated with zod (`schema.js`). One central error handler.
- Collections: users, projects, requirements, signals, status_history, ledger_entries, manual_links,
  requirement_links. Every document carries `projectId` (users also have `projectIds`, all projects they belong to).
- Stored documents keep the CSV extras (`split`, `batch`, `type`, `group_id` as `groupId`, `finalStatus`).
- Signal `author` is the sender role (the dataset has no names). `confidence` is `null` until the classifier exists.
- `resourceRole` of a requirement = most frequent `author_role` among its signals.
- The seed leaves the 3 newest requirement-linked signals of each system `pending` (12 total) for the Accept/Reject demo.

### Integration contract (for the other components)

Read Component 1's data **only** through these read-only endpoints, never straight from Mongo:

```
GET /api/v1/projects/:projectId/live-state          requirements with status, role, granularity
GET /api/v1/projects/:projectId/network             nodes and links
GET /api/v1/projects/:projectId/ledger              ledger entries
GET /api/v1/projects/:projectId/schedule-baseline
```

They live in `backend/src/modules/integration` and call the other modules' services.

## PLACEHOLDER ledger (read this)

The `ledger_entries` are **placeholders, not blockchain transactions**. Hashes are sha256 values derived
locally and chained per project; every entry has `isPlaceholder: true`. The seed builds them from the status
changes in `scenario_status_history.csv`, and the app adds more when a requirement is created or a manual link
is added/removed. A later step replaces them with real Hardhat transactions (`BLOCKCHAIN_RPC_URL`) and drops the flag.

## Still TODO (stubs are marked in code)

Signal classification (ai-service returns `None`/`0.0`), the status engine (`requirements/service.js`),
network clustering (`network/service.js`), real schedule baseline, blockchain writes, Neo4j usage.

## How a teammate adds a module

1. Copy the layout of an existing module into `backend/src/modules/<name>/`:
   `routes.js`, `controller.js`, `service.js`, `model.js`, `schema.js`.
2. `schema.js`: zod schemas. `model.js`: Mongoose model with an explicit `collection` name and a `projectId` field.
   `service.js`: logic (talk to the AI service only via `src/shared/aiClient.js`). `controller.js`: wrap handlers
   with `wrap` and answer with `ok(res, data)`. `routes.js`: `validate({ body })` + `requireRole(...)` where needed.
3. Register it with one line in `backend/src/routes.js`: `scoped('<name>', require('./modules/<name>/routes'))`.
   That gives login + project-membership checks for free.
4. Document each route in `backend/src/shared/swagger.js`.
5. Need other components' data? Use the integration endpoints above.
