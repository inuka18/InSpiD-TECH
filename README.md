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
ai-service/      FastAPI: /classify (trained model), /embed, /similarity, /match (MiniLM); training in ai-service/training
contracts/       Hardhat project (Solidity ledger comes later)
data/            DATA_README.md describes it; data/scenario/*.csv feeds the seed; data/raw is git-ignored
docker-compose.yml   neo4j, hardhat, ai-service, backend  (+ optional local mongo, profiles: localdb, test, train)
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

Seed users (`@inspid.test`): `pm.ret@`, `pm.hms@`, `pm.mba@`, `pm.ulp@` (PM, password `SEED_PM_PASSWORD`). Two of the PMs manage two
projects: `pm.ret@` manages SYS-RET and SYS-HMS, `pm.mba@` manages SYS-MBA and SYS-ULP (re-running the seed adds the second project;
`pm.hms@` and `pm.ulp@` keep only their own). TeamMembers such as `developer.ret@` (password `SEED_MEMBER_PASSWORD`). The seed prints the full list.

## API conventions

- Everything under `/api/v1`. Responses are always `{ success, data, error }`.
- Roles: `PM`, `TeamMember`. Middleware: `requireAuth`, `requireRole("PM")`, `requireProjectMember`.
- Project data is always `/projects/:projectId/...` and only for members of that project.
- Every body is validated with zod (`schema.js`). One central error handler.
- Collections: users, projects, requirements, signals, status_history, ledger_entries, manual_links,
  requirement_links. Every document carries `projectId` (users also have `projectIds`, all projects they belong to).
- Stored documents keep the CSV extras (`split`, `batch`, `type`, `group_id` as `groupId`, `finalStatus`).
- Signal `author` is the sender role (the dataset has no names). `confidence` is an integer 0-100 for signals ingested through the API (`null` for seeded ones).
- `resourceRole` of a requirement = most frequent `author_role` among its signals.
- The seed leaves the 3 newest requirement-linked signals of each system `pending` (12 total) for the Accept/Reject demo.

### Integration contract (for the other components)

Read Component 1's data **only** through these read-only endpoints, never straight from Mongo:

```
GET /api/v1/projects/:projectId/live-state          requirements with status, role, granularity
GET /api/v1/projects/:projectId/network             nodes and links
GET /api/v1/projects/:projectId/ledger              ledger entries
GET /api/v1/projects/:projectId/schedule-baseline
GET /api/v1/projects/:projectId/requirement-candidates?status=pending   possible new requirements waiting for a PM (read-only; any member)
```

They live in `backend/src/modules/integration` and call the other modules' services.

## The core chain: signal -> classify -> map -> status -> ledger -> PM review

`POST /api/v1/projects/:projectId/signals` (any project member) with `{ source, text, authorRole?, timestamp?, requirementId? }`:

1. `ai-service /classify` gives a label and a confidence (stored as an integer 0-100, with the model version).
   If the ai-service is down the signal is stored as unclassified + `pending`, nothing is applied, and the API answers **202**.
2. `None`: stored, no mapping, no status change.
3. Otherwise the requirement is `requirementId` (if given) or the top `ai-service /match` result over the project's
   requirements (title + description). Below `MATCH_MIN_SIMILARITY` the signal stays unmapped and `pending`.
4. `signals/statusEngine.js` (pure, unit-tested): Expectation -> Confirmed, Constraint -> Modified, Conflict -> At Risk,
   Completion -> Confirmed. A Conflict containing *dropped, removed from scope, descoped, out of scope, postponed,
   cancelled, deferred, taken out* proposes **Dropped** instead. Dropped is terminal: later signals are stored but change nothing.
5. `signals/reviewPolicy.js` (pure, unit-tested): auto-accepted only if confidence >= `AUTO_ACCEPT_CONFIDENCE`, the label is
   not None, a requirement was matched and the proposal is not a move into Dropped. A `None` signal at/above the
   threshold is accepted with no effect. Everything else is `pending` and changes nothing until a PM accepts it.
6. An applied change updates the requirement's `liveStatus`, writes a `status_history` row (with `resourceRole` = author role and
   `granularity`) and appends a ledger entry. The response contains the signal, classification, match (+ top-3 alternatives),
   proposed status, `applied`, `reviewStatus`, `statusChange`, `ledgerEntry`, and the threshold and model version used.

`POST .../signals/preview` returns the same answer and saves nothing.

**Documents.** `POST .../signals/extract` takes a file (multipart field `file`: `.txt`, `.md`, `.docx` or `.pdf`, 2 MB at most) or JSON `{ text, name }`, splits it into statements (email headers, greetings, sign-offs, short lines are ignored; a leading `Name:` becomes `speakerLabel`; duplicates removed; at most 300 segments, otherwise 413), classifies them in one batch call and matches the non-None ones in another, and returns every segment with its label, match, proposed status and `wouldAutoApply`, using the same rules as preview. It **saves nothing**; the file is processed in memory, never stored and never logged. `POST .../signals/bulk` then saves the approved items (max 100) in order through the normal flow, stores `sourceDocument { id, name }` on each signal and returns `{ applied, pending, noChange, failed }` plus per-item results. The same `documentId` is a 409 unless `force: true`; if the ai-service is down nothing is saved (502). PDF text extraction uses `unpdf`; if it is unavailable a PDF is a 415. The ai-service has the matching `POST /classify/batch` and `POST /match/batch`.

Everything that finalises a signal's effect (status update, status history, ledger entry, feedback) lives in ONE function, `finalizeSignal()` in `modules/signals/finalize.js`, used by preview (dry run), create, bulk and review: hook future features in there.

PM review: `POST .../signals/:signalId/review` with `{ action: accept|reject|correct, correctedLabel?, correctedRequirementId?, note? }`.
Every action writes a `feedback` document; `GET .../feedback/export` (PM only) returns CSV `text,label,source,role` (accept and
correct rows, de-duplicated, seeded signals left out) that `python -m training.train --extra-data` accepts (see `ai-service/training/README.md`).

Optional settings (NOT required in `.env`; add them only to change the defaults): `AUTO_ACCEPT_CONFIDENCE` (default 90),
`MATCH_MIN_SIMILARITY` (default 0.30: whether a requirement is proposed at all), `AUTO_APPLY_MIN_SIMILARITY` (default 0.40: a signal
matched by similarity, not by an explicit `requirementId`, is auto-accepted only at or above this; below it the signal stays pending with the
proposed requirement shown, reason `low-similarity`). Each signal stores the values in force. Evidence: `docs/pipeline_analysis.md`
(`docker compose run --rm trainer python -m training.analyze_pipeline`).

### Known limitations

- **Rejecting or correcting an already auto-accepted signal is feedback only.** The status change and ledger entry it caused are
  **not reversed**; the response has `statusNotReversed: true`. A compensating correction ledger entry is the planned proper fix.
- Writes are ordered (conditional requirement update, status_history, ledger) but not transactional: standalone Mongo has no
  multi-document transactions. A crash between steps can leave a requirement changed without its ledger entry.
- Matching maps a message to the closest *existing* requirement. A message about something new (for example "add the koko payment
  option") is still mapped to the nearest requirement if the similarity is at least `MATCH_MIN_SIMILARITY`.
- The model's confidence is not a calibrated probability (see `docs/classifier_report.md` and `docs/pipeline_analysis.md`).
- Seeded signals (`seeded: true`) are already reflected in the data: accepting one only updates its `reviewStatus`.

## Requirements network (computed, not loaded)

`GET /api/v1/projects/:projectId/network` returns `nodes`, `links` and `clusters`. It is computed from the requirement **texts**:

1. title + description of each requirement are embedded with `ai-service /embed` (MiniLM; the vectors are cached on the requirement).
2. Distance = 1 - cosine similarity. **Pathfinder** PFNET(r = infinity, q = n - 1) (`modules/network/pathfinder.js`, pure, unit-tested) keeps an edge only if
   no indirect path has all its edges shorter. Links are stored in `requirement_links` with `kind: "pathfinder"`, `relationType: "semantic"`, `weight` (the cosine similarity) and `computedAt`.
3. **Clusters**: average-linkage agglomerative clustering on the same distances, cut to **k clusters** with `k = clamp(round(sqrt(n)), 3, 8)` per project (23 or 26 requirements give 5, 31 or 34 give 6; never more than n). k was chosen for usability in the UI and is **not tuned on `group_id`**. (The older distance-cutoff cut, `DEFAULT_CUTOFF` in `clustering.js`, is kept only so `npm run network:evaluate` can still report it; the app does not use it.) Each node gets `cluster` (`cluster-1`, ...; numbered by size, largest first) and `clusterLabel` ("Cluster 1 (payments, card)": the two most distinctive title words), stored on the requirement. **`group_id` is never used to form or name clusters.** `cluster` is `null` until the network has been computed. Changing the clustering rule changes only cluster ids and labels, not links, so re-running `npm run network:build` rewrites the clusters and writes no ledger entry.
4. When a requirement is created, or its title/description changes, only that requirement is re-embedded (the other vectors come from the cache), Pathfinder is rerun and **only added/removed links are written**. If any link was added or removed ONE ledger entry is appended (`eventCode: NETWORK_UPDATE`, display `eventType: "Network Updated"`, `details: { added: [...], removed: [...] }`); if nothing changed, no ledger entry. Weights of kept links are refreshed silently.
5. If the ai-service is down: requirement edits still succeed; `GET /network` returns the stored links (empty if none yet) plus a `warning`; `POST /network/recompute` returns 502.
6. Manual links (PM-authored) live in `manual_links` and are never pruned or changed by a recompute.

### Signals feed the network, baselines and alignment

The network is built **incrementally from communication signals**, not only from requirement text.
`finalizeSignal()` (`modules/signals/finalize.js`) is the single place where an applied signal is finalised (preview as a dry run, create, bulk, PM review), and the network update lives there:

- **When:** a signal that is *applied* (auto-accepted, or accepted/corrected by a PM), has a label other than None and is not a seeded dataset row. Never for rejected, pending, None or seeded signals, and never for a preview.
- **Evidence** (`signal_evidence`): one row per signal and requirement pair. `idmention`: the text names requirement ids of this project (`RET-R04`; two or more ids make pairs, one id plus the matched requirement makes a pair). `coref`: the top two match candidates are both >= `COREF_MIN_SIMILARITY` (env, default 0.40) and within 0.10 of each other.
- **Signal profile** (`requirements.signalProfile`, hidden like the embedding): moving average of the embeddings of the signals applied to the requirement, `profile = normalize(0.85 * profile + 0.15 * embedding)`.
- **Combined similarity** of a pair: `sim = (1 - w) * textSim + w * profileSim + boost`, capped at 1. `w = 0.35 * min(1, min(count_i, count_j) / 10)` (0 if either has no profile). `boost` = 0.15 per id-mention row (cap 0.30) + 0.06 per co-reference row (cap 0.20), total cap 0.35: an explicit id mention is stronger evidence than an inferred co-reference. All constants are in `modules/network/constants.js`, chosen a priori by evidence strength and **not tuned on `group_id`**.
- **Update:** Pathfinder is rerun on the combined matrix and diffed against the stored links; only added and removed links are written (kept links are re-weighted silently). If any link was added or removed ONE `NETWORK_UPDATE` ledger entry is appended with the signal as `triggeringSignalId`; if nothing changed there is none. Clusters are not touched (only `POST /network/recompute` recomputes them). A full recompute uses the same combined similarity.
- **ai-service down:** the signal still succeeds. Its evidence is kept, the network is marked stale (`network_state`, with the ids of the signals whose profile update is still pending) and the next `GET /network` or `POST /network/recompute` catches up.
- `GET /network` links carry `weight` (the combined similarity), `evidenceCount` and `contributions { text, profile, boost }`; `GET /projects/:projectId/network/links/:linkId/evidence` lists the contributions and up to 20 supporting signals, newest first.

**Baselines and alignment.** A baseline (`baselines`) freezes the computed links and the requirement states. The *Initial baseline* is created automatically (by `npm run network:build` and by the first `GET /network`; idempotent, also under concurrent calls) from the **text-only** network (no evidence, no profiles). A PM can freeze a new one with `POST /projects/:projectId/baselines { name }`. Alignment is how far the current network has drifted from a baseline: `GET /projects/:projectId/alignment?baselineId=` (default: the latest) returns `score = round(100 * |B and C| / |B or C|)` over the undirected computed-link sets (manual links excluded), the band (>= 80 Strong Alignment, 60-79 Moderate Drift, below 60 Significant Drift) and a daily history (Asia/Colombo days, max 90) rebuilt by replaying the `NETWORK_UPDATE` ledger entries written after the baseline. 404 if the project has no baseline. See `docs/demo_signal_network.md` for a worked example and `docs/network_evaluation.md` (section 6) for what the signals do to the network on the scenario data (short version: no clear difference on the less biased replay).

**Ledger note:** `BASELINE_CREATED` and `NETWORK_UPDATE` entries are API-created ledger entries. **`npm run rechain` refuses once any exist** (it only rewrites seed placeholders), so run the rechain, if you need it at all, before `network:build` or re-seed an empty database.

`scenario_related_pairs.csv` is the **answer key**, stored in `network_ground_truth` and used only by `npm run network:evaluate`; it is never returned as links. Re-running `npm run seed` moves the old pair rows out of `requirement_links` into it.

```
npm run network:build       # compute links + clusters for EVERY project (needs the ai-service); run it once after `npm run seed`
npm run network:evaluate    # writes docs/network_evaluation.md/.json (read-only; section 6 replays the scenario signals in memory)
POST /api/v1/projects/:projectId/network/recompute    # PM only: full recompute
```

Limits: on a complete similarity graph Pathfinder returns about n - 1 edges (a spanning structure), so it shows the strongest links, not every related pair.
Recomputation is serialized per project inside one backend process only. The link/cluster writes and the ledger entry are not one transaction. See the evaluation for how closely the result matches the scenario's `group_id` key (it is modest).

### Possible new requirements (requirement candidates)

A signal that looks like a **new** requirement (no existing requirement covers it, and it is not a repeat of other signals) becomes a *requirement candidate* that a PM must approve. The classifier is **not** retrained or changed: the detector (`backend/src/modules/signals/newRequirement.js`, pure and unit-tested) sits on top of its label, its confidence and the matcher's similarities, inside the shared decision step, so preview, create, extract, bulk and review all use it.

- **Rule.** Candidate only if the label is Expectation, confidence >= `NEW_REQ_MIN_CONFIDENCE` (70), the signal is not seeded, AND the top similarity is below `NEW_REQ_SIM_LOW` (0.35), or below `NEW_REQ_SIM_HIGH` (0.50) with at least one *novel token* (a content word in no requirement and in at most 2 earlier signals of the project; reason `new terms: koko`). A candidate signal is **always pending** (`new-requirement`), never auto-accepted, and changes nothing until a PM acts.
- **Grouping.** The text is embedded (`/embed`, one batched call per document); cosine >= `NEW_REQ_GROUP_SIM` (0.60) to a pending candidate's centroid attaches it as more evidence; >= `NEW_REQ_SUPPRESS_SIM` (0.80) to a rejected candidate stores the signal as pending with reason "similar to a rejected candidate" and no candidate (hidden from the default signal list; `?includeSuppressed=true` shows it).
- **Constants** are optional env vars with defaults (not required in `.env`), in `newRequirementConstants.js`, with a tuning log.
- **Endpoints.** `GET /projects/:projectId/requirement-candidates?status=` (any member), `POST /projects/:projectId/requirement-candidates/:candidateId/review` (PM only): `approve` (creates the requirement through the normal path: next free id, `REQUIREMENT_CREATED` ledger entry with the first evidence signal, then every evidence signal is accepted and mapped to it), `merge` (`mergeIntoRequirementId`), `reject`. Each action claims the candidate atomically from `pending` (concurrent calls: one wins, the rest get 409), runs at most **one** network update (one `NETWORK_UPDATE` ledger entry), and writes a feedback document of kind `requirement-candidate` (never part of the retraining export). Approving lowers the alignment score until a new baseline is frozen.
- **Evaluation.** `npm run newreq:evaluate` (see `docs/new_requirement_detection.md`). Run it inside the test container: `docker compose --profile localdb --profile test run --rm backend-test node src/scripts/newRequirementEvaluate.js --splits=dev`.

### Importing a project's initial requirements from an SRS

PM only: **Requirements -> Import requirements from an SRS** (also offered right after creating a project, and in the empty state of the Requirements list). The SRS template can be downloaded from the app (`Frontend/public/templates/SRS_Template.docx`, served at `/templates/SRS_Template.docx`).

```
POST /api/v1/projects/:projectId/requirements/import-srs/preview   multipart "file" (.docx .md .txt .pdf, 2 MB, in memory): saves nothing
POST /api/v1/projects/:projectId/requirements/import-srs/confirm   { documentId, documentName, items: [...], force? }, max 300
```

- **Template mode (read exactly).** A `.docx` with a table whose header row has **ID, Title, Requirement statement** (case-insensitive; also **Feature area, Priority, Verification**). Rows under a heading containing "Non-functional" are NFR, under "Functional" FR, otherwise the ID prefix (FR-/NFR-) decides. Placeholder rows (statement starting with `[` or `The system shall [`) are skipped. Priority is MoSCoW: Must -> High, Should -> Medium, Could / Won't -> Low (stored in the optional `priority` field). The feature area is stored **only** in the existing `groupId` answer-key field and is never used to form clusters.
- **Rule-based mode (everything else: pdf, md, txt, a free-form docx).** This is **simple rules, not a trained model**; every candidate has confidence `medium` or `low` and only `medium` rows are pre-selected, so a PM must review the table. It reads numbered lists under section headings (wrapped lines and bullet sub-lists stay with their item; page headers and footers are dropped; in PDF text the first line of a wrapped item may come before its number, which is handled), numbered requirement lines such as `FR-012 The system shall ...`, and sentences with *shall / must / should / will* plus a subject. FR or NFR comes from the nearest section heading first ("non-functional" -> NFR, "functional requirements" -> FR), keyword rules (performance, availability, security, response time, percent, seconds, compliance ...) only as a fallback. A title is the short lead phrase before a colon (8 words or fewer), otherwise the first 8 words. Items with template placeholders such as `<xx>` are flagged and left unselected; headings, introductions and "Note that" explanations are ignored. Confidence: a list item under a heading, or a sentence with *shall / must*, is `medium`; a list item without a modal verb, or a free sentence with only *should / will*, is `low`.
- **Confirm.** Creates each requirement through the normal create path (status Confirmed, granularity Sprint Commitment, the project's id scheme, one `REQUIREMENT_CREATED` ledger entry each, `sourceDocument { name, sourceId }`), skips duplicates of existing requirements (same source id or same normalised text) unless `force`, then runs **one** network recompute (embeddings in batch, Pathfinder, clusters, a single `NETWORK_UPDATE` entry) and creates the **Initial baseline** if the project has none. A down ai-service is a 502 before anything is saved. One import runs at a time per project, and sending the same `documentId` + items again within 10 minutes (a double click) returns the first result without creating anything twice.
- **Evidence.** `node src/scripts/srsEvaluate.js` (inside the test container) runs the samples through preview and confirm and checks the rule-based mode; see `docs/srs_import_evaluation.md`. Samples: `docs/samples/srs/` (two template-format samples) and the public document **CCTNS Functional Requirements Specification v1.0 (draft), Ministry of Home Affairs, Government of India** (`docs/samples/srs/0000 - cctns.pdf`), used as a real-world test of the rule-based mode.

## PLACEHOLDER ledger (read this)

The `ledger_entries` are **placeholders, not blockchain transactions** (`onChain: false`, `isPlaceholder: true`).
All appends go through one function, `appendLedgerEntry()` in `modules/ledger/service.js`, which a real blockchain provider replaces later.
Each entry has a sequential `blockNumber` per project, `previousBlockHash`, and
`txHash = sha256(canonical JSON of the entry fields + previousBlockHash)`. Event types are stored as `STATUS_CHANGE`,
`REQUIREMENT_CREATED`, `MANUAL_LINK` (+ `linkAction`), `NETWORK_UPDATE` and `BASELINE_CREATED` (display "Baseline Created", `details: { baselineId, name }`); the API keeps the old display string in `eventType` (the frontend uses it)
and adds `eventCode`.

- `GET /api/v1/projects/:projectId/ledger/verify` recomputes the chain: `{ valid, entries, brokenAt }`.
- The seed builds the ledger from the status changes in `scenario_status_history.csv`, and builds a valid chain on a **fresh** ledger.
- `npm run rechain` rebuilds the chain for older seed entries (their old hashes did not include `previousBlockHash`). It only
  rewrites seed placeholders and **refuses** (changing nothing) if any entry is on-chain, was created through the API (this includes every `NETWORK_UPDATE` and `BASELINE_CREATED` entry), or is not a seed entry.

## Tests (never against the Atlas demo data)

Tests use the local Mongo database `inspid_test` (unit tests for the status rules, review policy, ledger hash, Pathfinder, clustering, link diff and evaluation maths; integration tests for the signal flow and the network, with a stubbed ai client). `npm test` refuses to run if `MONGODB_DB_NAME` is `inspid` (or not `*_test`), or the URI is Atlas.
The integration tests create their own temporary project and users, and delete them afterwards.

```
docker compose --profile localdb --profile test run --rm backend-test                  # npm test (unit + integration)
docker compose --profile localdb --profile test run --rm backend-test npm run seed     # seed inspid_test
docker compose --profile localdb --profile test up -d backend-test-api                 # API on http://localhost:5001 using inspid_test
```

Rebuild after code changes: `docker compose build backend ai-service trainer` (the test service mounts `backend/src` and `backend/tests`, so it needs no rebuild).

## Still TODO (stubs are marked in code)

Real schedule baseline, real blockchain writes, Neo4j usage, a compensating
ledger entry for reversed signals, automatic retraining.

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
