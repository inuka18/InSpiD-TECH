"""Evaluate the saved model on the hand-labelled Jira review sample.

    python -m training.eval_review [--version V] [--file path]

Only rows with a filled `reviewed_label` are used. Writes docs/review_eval.json.
"""
import argparse
import json

import pandas as pd

from app.signal_model import LABELS, load_model, read_current
from training import common as C


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", help="model version (default: the active one)")
    ap.add_argument("--file", default=str(C.DATA_DIR / "processed" / "jira_review_sample.csv"))
    args = ap.parse_args()

    version = args.version or read_current(C.MODELS_DIR)
    if not version:
        C.fail("no active model (current.json missing). Train one first.")
    df = pd.read_csv(args.file, keep_default_na=False)
    df["reviewed_label"] = df["reviewed_label"].str.strip()
    done = df[df.reviewed_label != ""]
    if done.empty:
        C.fail(f"no rows in {args.file} have a reviewed_label yet.")
    bad = sorted(set(done.reviewed_label) - set(LABELS))
    if bad:
        C.fail(f"reviewed_label values outside {LABELS}: {bad}")
    print(f"{len(done)} of {len(df)} rows labelled; model {version}")

    model = load_model(C.MODELS_DIR, version)
    pred = C.predict_labels(model.predict_proba(list(done.text)))
    res = {"version": version, "file": args.file, "n_labelled": int(len(done)),
           "model_vs_reviewed": C.metrics(done.reviewed_label.to_numpy(), pred)}
    w = done[done.weak_label != ""]
    if len(w):  # how good were the rough keyword labels?
        res["weak_label_vs_reviewed"] = {"n": int(len(w)),
                                         "agreement": float((w.weak_label == w.reviewed_label).mean())}
    m = res["model_vs_reviewed"]
    print(f"macro F1 {m['macro_f1']:.3f}, accuracy {m['accuracy']:.3f}")
    for l, c in m["per_class"].items():
        print(f"  {l:12s} P {c['precision']:.3f}  R {c['recall']:.3f}  F1 {c['f1']:.3f}  support {c['support']}")
    print("confusion matrix (rows true, cols pred), order:", LABELS)
    for l, row in zip(LABELS, m["confusion_matrix"]["rows_true_cols_pred"]):
        print(f"  {l:12s}", row)
    if "weak_label_vs_reviewed" in res:
        print(f"weak_label agrees with your label on {res['weak_label_vs_reviewed']['agreement']:.1%} "
              f"of {res['weak_label_vs_reviewed']['n']} rows that had one")
    C.DOCS_DIR.mkdir(parents=True, exist_ok=True)
    (C.DOCS_DIR / "review_eval.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
    print(f"wrote {C.DOCS_DIR / 'review_eval.json'}")


if __name__ == "__main__":
    main()
