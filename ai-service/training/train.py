"""Train and compare: keyword baseline, Model A, B, C (soft voting) and D (concatenated features).

    python -m training.train [--extra-data path.csv]

Rules (see README.md):
  * Training data: scenario "train" rows (+ --extra-data). No weak Jira rows.
  * Tuning uses scenario "val" batch A only.
  * Model CHOICE uses the mean of (macro F1 on val batch A, macro F1 on robustness dev). Within 0.02 -> simpler.
  * Test sets (scenario test, robustness test) are only reported, never used to train, tune or choose.
  * robustness_test.csv is never trained or tuned on.
"""
import argparse
import itertools
import json
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression

from app.signal_model import (EMBED_MODEL_NAME, LABELS, SPACY_MODEL, ConcatLrModel, KeywordModel, MiniLmLrModel,
                              TfidfLrModel, VotingModel, _align, clean_texts, load_model, read_current,
                              write_current)
from training import common as C

GRID_C = [0.1, 0.3, 1, 3, 10, 30, 100]
GRID_CW = [None, "balanced"]
GRID_SCALE = [0.5, 1, 2]  # Model D: multiplier on the MiniLM block
GRID_W = [round(0.1 * i, 1) for i in range(11)]  # Model C: weight of Model A
TIE_MARGIN = 0.02
THRESHOLDS = [50, 60, 70, 80, 90]
# Lower rank = simpler (used only for the tie-break rule): keyword < A < B < D < C
RANK = {"keyword": 0, "A": 1, "B": 2, "D": 3, "C": 4}
DISPLAY = ["keyword", "A", "B", "C", "D"]
TITLE = {
    "keyword": "Keyword baseline",
    "A": "Model A (TF-IDF + LR)",
    "B": "Model B (MiniLM + LR)",
    "C": "Model C (soft voting A+B)",
    "D": "Model D (TF-IDF + MiniLM concatenated, one LR)",
}
SMALL_SETS_NOTE = ("**The evaluation sets are small** (val batch A 82 rows, robustness dev 50, test batch A 106, "
                   "robustness test 50). Differences under about 0.03 macro F1 should be treated as noise.")


def fit_lr(X, y, c, cw):
    return LogisticRegression(C=c, class_weight=cw, max_iter=3000).fit(X, y)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--extra-data", help="CSV with columns text,label,source,role added to the training data")
    args = ap.parse_args()

    scen = C.load_scenario()
    sp = C.scenario_splits(scen)
    rob = C.load_robustness()

    base = sp["train"][["text", "label"]].copy()
    extra_n = 0
    if args.extra_data:
        held_out = pd.concat([sp["test_all"][["text"]], rob["dev"][["text"]], rob["test"][["text"]]])
        extra = C.load_extra(args.extra_data, held_out)  # leak guard
        extra_n = len(extra)
        base = pd.concat([base, extra[["text", "label"]]], ignore_index=True)
    train_norm = {C.norm_text(t) for t in base.text}
    overlap = sum(C.norm_text(t) in train_norm for t in pd.concat([rob["dev"].text, rob["test"].text]))
    if overlap:
        print(f"WARNING: {overlap} robustness text(s) also occur in the training data (exact match).")

    val, test, rdev, rtest = sp["val_all"], sp["test_all"], rob["dev"], rob["test"]
    mA_val = (val.batch == "A").to_numpy()
    mA_test = (test.batch == "A").to_numpy()
    counts = {"scenario_train": int(len(sp["train"])), "extra_data": extra_n, "val_batch_A": int(mA_val.sum()),
              "val_all": int(len(val)), "test_batch_A": int(mA_test.sum()), "test_all": int(len(test)),
              "robustness_dev": int(len(rdev)), "robustness_test": int(len(rtest)),
              "robustness_texts_also_in_training": int(overlap)}
    print("rows:", counts)

    texts = list(base.text) + list(val.text) + list(test.text) + list(rdev.text) + list(rtest.text)
    bounds = np.cumsum([0, len(base), len(val), len(test), len(rdev), len(rtest)])
    sl = {k: slice(bounds[i], bounds[i + 1]) for i, k in enumerate(["base", "val", "test", "rdev", "rtest"])}
    y_base = base.label.to_numpy()
    y = {"val": val.label.to_numpy(), "test": test.label.to_numpy(), "rdev": rdev.label.to_numpy(),
         "rtest": rtest.label.to_numpy()}

    print("cleaning text with spaCy ...")
    cleaned = np.array(clean_texts(texts), dtype=object)
    print("embedding with MiniLM (cached on disk) ...")
    emb = C.embed_cached(texts)
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=2, sublinear_tf=True, token_pattern=r"(?u)\b\w+\b")
    vec.fit(cleaned[sl["base"]])
    T = vec.transform(cleaned)

    def val_key(P):  # tuning criterion: val batch A macro F1 (tie-break: val all)
        pred = np.array(C.predict_labels(P[sl["val"]]))
        return (C.macro_f1(y["val"][mA_val], pred[mA_val]), C.macro_f1(y["val"], pred))

    def align(clf, X):
        return _align(clf.predict_proba(X), clf.classes_)

    R = {}  # name -> {"P": probabilities for every text row, "model": object, "hyper": {...}}

    kw = KeywordModel()
    R["keyword"] = {"P": kw.predict_proba(texts), "model": kw, "hyper": {}}

    def tune_lr(X, extra_grid=({},), build=None):
        best = None
        for eg, c, cw in itertools.product(extra_grid, GRID_C, GRID_CW):
            Xe = build(eg) if build else X
            clf = fit_lr(Xe[sl["base"]], y_base, c, cw)
            P = align(clf, Xe)
            key = val_key(P) + (-c,)
            if best is None or key > best[0]:
                best = (key, clf, P, {"C": c, "class_weight": cw, **eg})
        return best[1], best[2], best[3]

    clfA, PA, hA = tune_lr(T)
    R["A"] = {"P": PA, "model": TfidfLrModel(vec, clfA), "hyper": hA}
    clfB, PB, hB = tune_lr(emb)
    R["B"] = {"P": PB, "model": MiniLmLrModel(clfB), "hyper": hB}

    # Model C: soft voting, weight tuned on val batch A
    bestw = max(GRID_W, key=lambda w: val_key(w * PA + (1 - w) * PB) + (-abs(w - 0.5),))
    R["C"] = {"P": bestw * PA + (1 - bestw) * PB,
              "model": VotingModel(R["A"]["model"], R["B"]["model"], bestw), "hyper": {"weight_a": bestw}}

    # Model D: [TF-IDF | scale * embedding] -> one LR; scale, C and class weight tuned together
    clfD, PD, hD = tune_lr(None, extra_grid=[{"scale": s} for s in GRID_SCALE],
                           build=lambda eg: sparse.hstack([T, sparse.csr_matrix(eg["scale"] * emb)]).tocsr())
    R["D"] = {"P": PD, "model": ConcatLrModel(vec, clfD, hD["scale"]), "hyper": hD}
    for k in DISPLAY:
        print(f"  {k}: val_A macro F1 {val_key(R[k]['P'])[0]:.3f}  {R[k]['hyper']}")

    # ---- metrics for every model on every set
    def sets(P):
        return {"val": P[sl["val"]], "test": P[sl["test"]], "rdev": P[sl["rdev"]], "rtest": P[sl["rtest"]]}

    for k, r in R.items():
        S = sets(r["P"])
        pred = {n: np.array(C.predict_labels(p)) for n, p in S.items()}
        tA = C.metrics(y["test"][mA_test], pred["test"][mA_test])
        tA["macro_f1_ci95_bootstrap"] = C.bootstrap_ci(y["test"][mA_test], pred["test"][mA_test])
        rt = C.metrics(y["rtest"], pred["rtest"])
        rt["macro_f1_ci95_bootstrap"] = C.bootstrap_ci(y["rtest"], pred["rtest"])
        r["metrics"] = {
            "val_batch_A": C.metrics(y["val"][mA_val], pred["val"][mA_val]),
            "val_all": C.metrics(y["val"], pred["val"]),
            "robustness_dev": C.metrics(y["rdev"], pred["rdev"]),
            "test_batch_A": tA, "test_all": C.metrics(y["test"], pred["test"]), "robustness_test": rt}
        r["selection_score"] = (r["metrics"]["val_batch_A"]["macro_f1"] + r["metrics"]["robustness_dev"]["macro_f1"]) / 2
        # auto-accept pools
        dev_y = np.r_[y["val"][mA_val], y["rdev"]]
        dev_P = np.vstack([S["val"][mA_val], S["rdev"]])
        tst_y = np.r_[y["test"][mA_test], y["rtest"]]
        tst_P = np.vstack([S["test"][mA_test], S["rtest"]])
        r["_pools"] = (dev_y, dev_P, tst_y, tst_P)
        r["auto_accept_dev"] = C.auto_accept(dev_y, dev_P, THRESHOLDS)

    # ---- choose (dev information only; test columns are not read here)
    top = max(r["selection_score"] for r in R.values())
    eligible = [k for k, r in R.items() if r["selection_score"] >= top - TIE_MARGIN]
    chosen = min(eligible, key=lambda k: RANK[k])
    why = (f"Selection score = mean(val batch A macro F1, robustness dev macro F1). Best score {top:.3f}. "
           f"Within {TIE_MARGIN} of it: {', '.join(sorted(eligible, key=lambda k: RANK[k]))}. "
           f"The simplest of those was kept: {chosen} ({TITLE[chosen]}). Simplicity order: keyword < A < B < D < C.")
    print(why)

    # ---- recommended auto-accept threshold: chosen on DEV rows of the selected model only
    rec = None
    for t in THRESHOLDS:
        a = R[chosen]["auto_accept_dev"][str(t)]
        if a["precision"] is not None and a["precision"] >= C.AUTO_ACCEPT_TARGET and a["accepted"] >= C.AUTO_ACCEPT_MIN_N:
            rec = t
            break
    if rec is not None:
        rec_text = (f"Recommended auto-accept threshold: **{rec}** - the lowest threshold where the selected model "
                    f"has dev precision >= {C.AUTO_ACCEPT_TARGET:.0%} with at least {C.AUTO_ACCEPT_MIN_N} dev rows accepted.")
    else:
        rec_text = (f"**No threshold met the target** (dev precision >= {C.AUTO_ACCEPT_TARGET:.0%} with at least "
                    f"{C.AUTO_ACCEPT_MIN_N} dev rows accepted), so no auto-accept threshold is recommended. "
                    "The test table below uses 90 for information only.")
    test_t = rec if rec is not None else 90
    for r in R.values():
        r["auto_accept_test"] = C.auto_accept(r["_pools"][2], r["_pools"][3], [test_t])[str(test_t)]

    # ---- Jira hand-labelled review score (skipped while reviewed_label is empty)
    review_note, review = review_scores(R)
    for k, r in R.items():
        r["jira_review"] = review.get(k)

    # ---- save the selected model as a new version (current.json untouched, unless none exists)
    now = datetime.now(timezone.utc)
    version = now.strftime("%Y%m%dT%H%M%SZ")
    vdir = C.MODELS_DIR / version
    vdir.mkdir(parents=True, exist_ok=True)
    r = R[chosen]
    joblib.dump(r["model"], vdir / "model.joblib", compress=3)
    loaded = load_model(C.MODELS_DIR, version)  # verify the saved file reproduces the numbers above
    chk = np.vstack([r["_pools"][3]])
    texts_chk = list(test.text[mA_test]) + list(rtest.text)
    diff = float(np.abs(loaded.predict_proba(texts_chk) - chk).max())
    print(f"reload check: max |difference| in probabilities = {diff:.2e}")
    if diff > 1e-3:
        C.fail(f"saved model does not reproduce training-time probabilities (max diff {diff}); not activating.")

    pools_meta = {"recommended_threshold": rec, "target_precision": C.AUTO_ACCEPT_TARGET,
                  "dev": r["auto_accept_dev"], "test_at_threshold": r["auto_accept_test"],
                  "test_threshold_is_recommendation": rec is not None}
    meta = {
        "version": version, "trained_at": now.isoformat(), "model_type": r["model"].kind, "variant": chosen,
        "title": TITLE[chosen], "hyperparameters": r["hyper"],
        "embedding_model": EMBED_MODEL_NAME if chosen in ("B", "C", "D") else None,
        "spacy_model": SPACY_MODEL if chosen in ("A", "C", "D") else None,
        "extra_data_file": args.extra_data, "uses_weak_jira": False,
        "training_rows": {"scenario_train": counts["scenario_train"], "extra_data": extra_n, "weak_jira": 0},
        "selection": why, "selection_score": r["selection_score"],
        "metrics": r["metrics"], "auto_accept": pools_meta, "jira_review": r["jira_review"],
    }
    (vdir / "metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    C.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    active = read_current(C.MODELS_DIR)
    if active is None:
        write_current(C.MODELS_DIR, version)
        activation = f"No active model existed, so `{version}` is now active (current.json)."
    else:
        activation = (f"`current.json` was NOT changed (active model is `{active}`). To switch, run:\n\n"
                      f"    docker compose run --rm trainer python -m training.promote {version}")
    print(activation)

    # ---- reports
    C.DOCS_DIR.mkdir(parents=True, exist_ok=True)
    out = {"version": version, "trained_at": now.isoformat(), "chosen": chosen, "selection": why,
           "row_counts": counts, "tie_margin": TIE_MARGIN, "auto_accept_thresholds_dev": THRESHOLDS,
           "recommended_threshold": rec, "jira_review_note": review_note,
           "candidates": {k: {"title": TITLE[k], "model_type": v["model"].kind, "hyperparameters": v["hyper"],
                              "selection_score": v["selection_score"], "metrics": v["metrics"],
                              "auto_accept_dev": v["auto_accept_dev"], "auto_accept_test": v["auto_accept_test"],
                              "jira_review": v["jira_review"]} for k, v in R.items()}}
    (C.DOCS_DIR / "classifier_metrics.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    (C.DOCS_DIR / "classifier_report.md").write_text(
        build_report(R, chosen, why, counts, version, activation, rec, rec_text, test_t, review_note,
                     args.extra_data), encoding="utf-8")
    print(f"wrote {C.DOCS_DIR/'classifier_report.md'} and classifier_metrics.json")
    size = sum(f.stat().st_size for f in C.MODELS_DIR.rglob("*") if f.is_file())
    print(f"models folder size: {size/1024:.1f} KiB ({size/1024/1024:.2f} MiB)")


def review_scores(R):
    """Macro F1 of each model on the hand-labelled Jira sample, if it has labels."""
    path = C.DATA_DIR / "processed" / "jira_review_sample.csv"
    if not path.exists():
        return "Jira review sample file not found: skipped.", {}
    df = pd.read_csv(path, keep_default_na=False)
    df["reviewed_label"] = df["reviewed_label"].str.strip()
    done = df[df.reviewed_label != ""]
    if done.empty:
        return "jira_review_sample.csv has no reviewed_label values yet: skipped.", {}
    bad = sorted(set(done.reviewed_label) - set(LABELS))
    if bad:
        C.fail(f"jira_review_sample.csv has reviewed_label values outside {LABELS}: {bad}")
    out = {}
    for k, r in R.items():
        pred = C.predict_labels(r["model"].predict_proba(list(done.text)))
        out[k] = C.macro_f1(done.reviewed_label.to_numpy(), pred)
    return f"Scored on {len(done)} hand-labelled Jira rows.", out


def build_report(R, chosen, why, counts, version, activation, rec, rec_text, test_t, review_note, extra_path) -> str:
    L = LABELS
    f = lambda x: "-" if x is None else f"{x:.3f}"
    pct = lambda x: f"{x:.0f}%"
    m = lambda k, s: R[k]["metrics"][s]
    ci = lambda k, s: m(k, s)["macro_f1_ci95_bootstrap"]
    withci = lambda k, s: f"**{f(m(k, s)['macro_f1'])}** ({f(ci(k, s)[0])} to {f(ci(k, s)[1])})"
    sel = R[chosen]
    out = ["# Signal classifier report", "",
           f"Generated by `training.train` (model version `{version}`). Labels: {', '.join(L)}.", "",
           "## Headline", "",
           f"Selected model: **{TITLE[chosen]}** (`{chosen}`), hyperparameters {sel['hyper'] or '-'}.", "",
           f"- Scenario test batch A macro F1: **{f(m(chosen,'test_batch_A')['macro_f1'])}** "
           f"(95% bootstrap CI {f(ci(chosen,'test_batch_A')[0])} to {f(ci(chosen,'test_batch_A')[1])}, n={m(chosen,'test_batch_A')['n']}).",
           f"- Robustness test macro F1: **{f(m(chosen,'robustness_test')['macro_f1'])}** "
           f"(95% CI {f(ci(chosen,'robustness_test')[0])} to {f(ci(chosen,'robustness_test')[1])}, n={m(chosen,'robustness_test')['n']}).", "",
           f"**Why this model:** {why}", "",
           "## Comparison (macro F1)", "",
           "Model choice uses only the **val batch A** and **robustness dev** columns (their mean is the selection "
           "score). The test columns were not used to train, tune or choose. Tuning used val batch A only. "
           "Models were trained on scenario train rows only (no weak Jira rows); `robustness_test.csv` was never "
           "trained or tuned on.", "",
           "| Model | Val batch A | Robustness dev | Selection score | Test batch A (95% CI) | Robustness test (95% CI) | Jira review |",
           "|---|---|---|---|---|---|---|"]
    for k in DISPLAY:
        mark = " **(selected)**" if k == chosen else ""
        out.append(f"| {TITLE[k]}{mark} | {f(m(k,'val_batch_A')['macro_f1'])} | {f(m(k,'robustness_dev')['macro_f1'])} | "
                   f"{f(R[k]['selection_score'])} | {withci(k,'test_batch_A')} | {withci(k,'robustness_test')} | "
                   f"{f(R[k]['jira_review'])} |")
    out += ["", SMALL_SETS_NOTE, "", f"Jira review column: {review_note}", "",
            "Hyperparameters (tuned on val batch A): " + "; ".join(f"{k}: {R[k]['hyper'] or '-'}" for k in DISPLAY), "",
            "For information (not used for choosing): val all batches - " +
            ", ".join(f"{k} {f(m(k,'val_all')['macro_f1'])}" for k in DISPLAY) + "; scenario test all batches - " +
            ", ".join(f"{k} {f(m(k,'test_all')['macro_f1'])}" for k in DISPLAY) + ".", "",
            "## Auto-accept precision", "",
            "Auto-accept means: accept the predicted label when its confidence (highest class probability) is at or "
            "above a threshold. Keyword-baseline confidences are crude rule counts and are not comparable with the "
            "trained models. Confidence calibration also differs between models.", "",
            "### (a) DEV sets (scenario val batch A + robustness dev) - used to recommend a threshold", "",
            f"{R[chosen]['auto_accept_dev']['50']['total']} rows. Each cell: share of all predictions auto-accepted / "
            "precision among them (correct of accepted).", "",
            "| Model | " + " | ".join(f">= {t}" for t in THRESHOLDS) + " |", "|---|" + "---|" * len(THRESHOLDS)]
    for k in DISPLAY:
        cells = []
        for t in THRESHOLDS:
            a = R[k]["auto_accept_dev"][str(t)]
            cells.append(f"{pct(a['accepted_pct'])} / {'n/a' if a['precision'] is None else pct(100*a['precision'])} "
                         f"({a['correct']}/{a['accepted']})")
        out.append(f"| {TITLE[k]}{' **(selected)**' if k == chosen else ''} | " + " | ".join(cells) + " |")
    out += ["", rec_text, "", SMALL_SETS_NOTE, "",
            f"### (b) TEST sets (scenario test batch A + robustness test) at threshold {test_t}"
            f"{'' if rec is not None else ' (information only, not a recommendation)'}", "",
            "The threshold was fixed from the dev table above; no test rows were used to choose it.", "",
            f"| Model | Auto-accepted (share of {R[chosen]['auto_accept_test']['total']}) | Precision among accepted |",
            "|---|---|---|"]
    for k in DISPLAY:
        a = R[k]["auto_accept_test"]
        out.append(f"| {TITLE[k]}{' **(selected)**' if k == chosen else ''} | {pct(a['accepted_pct'])} ({a['accepted']}) | "
                   f"{'n/a' if a['precision'] is None else pct(100*a['precision'])} ({a['correct']}/{a['accepted']}) |")
    out += ["", SMALL_SETS_NOTE, "", "## Data", "",
            f"- Scenario train rows: {counts['scenario_train']}; extra data rows: {counts['extra_data']}"
            f"{' (' + extra_path + ')' if extra_path else ''}.",
            f"- Val batch A {counts['val_batch_A']}, val all {counts['val_all']}; test batch A {counts['test_batch_A']}, "
            f"test all {counts['test_all']}; robustness dev {counts['robustness_dev']}, robustness test {counts['robustness_test']}.",
            f"- Robustness texts that also occur (exact match) in the training data: {counts['robustness_texts_also_in_training']}."]
    for s, title in (("test_batch_A", "Scenario test batch A"), ("robustness_test", "Robustness test")):
        mm = m(chosen, s)
        out += ["", f"## Selected model: {title}", "",
                f"Macro F1 {f(mm['macro_f1'])}, accuracy {f(mm['accuracy'])}, n={mm['n']}.", "",
                "| Class | Precision | Recall | F1 | Support |", "|---|---|---|---|---|"]
        for l in L:
            c = mm["per_class"][l]
            out.append(f"| {l} | {f(c['precision'])} | {f(c['recall'])} | {f(c['f1'])} | {c['support']} |")
        out += ["", "Confusion matrix (rows = true, columns = predicted):", "",
                "| true \\ pred | " + " | ".join(L) + " |", "|---|" + "---|" * len(L)]
        for l, row in zip(L, mm["confusion_matrix"]["rows_true_cols_pred"]):
            out.append(f"| **{l}** | " + " | ".join(str(x) for x in row) + " |")
    out += ["", "## Activation", "", activation, ""]
    return "\n".join(out)


if __name__ == "__main__":
    main()
