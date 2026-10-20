# Signal classifier: training and evaluation

Classes: Constraint, Expectation, Completion, Conflict, None. Everything runs inside Docker (Python 3.11)
through the `trainer` compose profile, so it never starts with a normal `docker compose up`.
Run all commands from the repo root.

## Commands

| Task | Command |
|---|---|
| Build the trainer image (after changing `ai-service/app/` or requirements) | `docker compose build trainer` |
| Rebuild + restart the service (same condition) | `docker compose up -d --build --no-deps ai-service` |
| Train all five models, save the selected one | `docker compose run --rm trainer python -m training.train` |
| Train with extra labelled data | `docker compose run --rm trainer python -m training.train --extra-data /data/processed/extra.csv` |
| Create the 300-row Jira review sample | `docker compose run --rm review-sample` |
| Evaluate the active model on your hand labels | `docker compose run --rm trainer python -m training.eval_review` |
| Promote a candidate (checks first) | `docker compose run --rm trainer python -m training.promote <version>` |
| Check promotion without switching | `docker compose run --rm trainer python -m training.promote <version> --dry-run` |

`--extra-data` paths are paths **inside the container**: `./data` is `/data` (read-only), `./docs` is `/docs`.
Put the file under `data/` (for example `data/processed/extra.csv`) and pass `/data/processed/extra.csv`.
(In Git Bash, prefix with `MSYS_NO_PATHCONV=1` so `/data/...` is not rewritten.)

Images that contain `ai-service/app/` (both `trainer` and `ai-service`) must be rebuilt after any change to
`app/` or the requirements. The `training/` folder is mounted, so edits there need no rebuild.

## The models

| Key | Model |
|---|---|
| keyword | Regex rules, no training (baseline) |
| A | spaCy lowercase + lemmatize only (stopwords and negations kept), TF-IDF 1-2 grams, logistic regression |
| B | `all-MiniLM-L6-v2` embeddings, logistic regression |
| C | Soft voting: `w * P(A) + (1 - w) * P(B)`, `w` tuned 0.0 to 1.0 in steps of 0.1 |
| D | One logistic regression on `[TF-IDF | scale * MiniLM embedding]`, `scale` in {0.5, 1, 2} tuned with C and class weight |

Saved models keep only classifiers and the embedding model **name**, never the transformer weights. Embeddings
are cached in the `ml_cache` volume, so reruns are fast.

## Rules (what is trained, tuned, chosen, reported)

- **Training:** scenario `train` rows (+ `--extra-data`). No weak Jira rows (they hurt in the earlier ablation).
- **Tuning** (C, class weight, D's scale, C's weight): scenario `val`, **batch A only**.
- **Choosing the model:** mean of (macro F1 on scenario val batch A, macro F1 on robustness **dev**). If two
  models are within 0.02, the simpler wins (keyword < A < B < D < C). Test columns are never looked at.
- **Never trained or tuned on:** `robustness_test.csv`. Its `dev` rows only choose between models; its `test` rows
  appear only in the final report and in promote.
- **Reported:** scenario test batch A (95% bootstrap CI), robustness test (95% CI), and the Jira hand-label score
  if `jira_review_sample.csv` has `reviewed_label` values (skipped cleanly otherwise).
- **Small sets:** val batch A 82, robustness dev 50, test batch A 106, robustness test 50 rows. Differences
  under about 0.03 macro F1 are noise. The report repeats this next to every table.

## Auto-accept precision

Confidence is the highest class probability. The report shows, per model, the share of predictions with
confidence >= threshold and the precision among them:

- (a) on the **dev** pool (val batch A + robustness dev) at 50, 60, 70, 80, 90. The recommended threshold is the
  lowest one where the **selected** model has dev precision >= 95% with at least 15 rows accepted
  (`AUTO_ACCEPT_TARGET`, `AUTO_ACCEPT_MIN_N` in `common.py`). If none qualifies, no threshold is recommended.
- (b) on the **test** pool (scenario test batch A + robustness test) at that recommended threshold only.

## Outputs

`docs/classifier_report.md`, `docs/classifier_metrics.json`, and `ai-service/models/<version>/`:

```
ai-service/models/
  current.json              {"version": "20261020T110553Z"}   <- the active model
  <version>/
    model.joblib
    metadata.json           version, trained_at, model type, hyperparameters, training row counts,
                            metrics (val A, val all, robustness dev, test A, test all, robustness test),
                            auto-accept tables, Jira review score
```

`train` activates its model only when no `current.json` exists yet; otherwise it prints the promote command.
`/classify` reloads whenever `current.json` changes (file modification time). Its response format is the same for
every model type: `{label, confidence, scores, model_version}`. It is text-only (`source` and `role` are accepted
but unused).

## Promote

`promote <version>` scores the candidate and the active model on three frozen test sets: **scenario test batch A,
scenario test all batches, and robustness test**. `current.json` changes only if the candidate's macro F1 is not
lower on **all three**; otherwise it refuses and prints which one failed. Each check reads the test sets, so do not
use promote to shop for a lucky candidate.

## Retraining later (manual)

1. Collect labelled rows in a CSV with columns `text,label,source,role`.
2. `train --extra-data <csv>`. If any extra text is also in the scenario test split or the robustness set, training
   stops with a LEAK GUARD error and lists examples.
3. `promote <new_version>`.

There is no automatic retraining and no feedback endpoint.

## Hand-labelled Jira check

1. `docker compose run --rm review-sample` writes `data/processed/jira_review_sample.csv` (60 rows per weak label
   class plus 60 with none, shuffled; refuses to overwrite an existing file unless `--force`).
2. Fill `reviewed_label` with Constraint, Expectation, Completion, Conflict or None.
3. `eval_review` prints macro F1, per-class scores, the confusion matrix and how often the weak label agreed with
   you; the next `train` run also adds this score to the comparison table.

## Using PM feedback from the backend

`GET /api/v1/projects/:projectId/feedback/export` (PM only) returns CSV with the columns `text,label,source,role`. Save it
under `data/` (for example `data/processed/feedback_SYS-RET.csv`) and pass `/data/processed/feedback_SYS-RET.csv` to
`train --extra-data`, then `promote`. Nothing is retrained automatically.

## Backend defaults evidence

`docker compose run --rm trainer python -m training.analyze_pipeline` writes `docs/pipeline_analysis.md`: the share of
scenario test signals at confidence >= 90 for the active model, and requirement-matching accuracy and similarity
distributions (the basis for `MATCH_MIN_SIMILARITY`).
