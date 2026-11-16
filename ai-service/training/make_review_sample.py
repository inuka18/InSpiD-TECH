"""Create data/processed/jira_review_sample.csv: 300 random Jira rows for hand labelling.

    python -m training.make_review_sample [--force]

Stratified by weak_label with equal allocation: 60 rows for each of Constraint, Expectation,
Completion, Conflict and 60 with no weak_label. Fill the empty `reviewed_label` column with one of
Constraint, Expectation, Completion, Conflict, None. Note the weak_label column is visible, which can
bias you; hide that column while labelling if you can.
"""
import argparse
from pathlib import Path

import pandas as pd

from app.signal_model import LABELS
from training import common as C

PER_STRATUM = 60


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(C.DATA_DIR / "processed" / "jira_review_sample.csv"))
    ap.add_argument("--force", action="store_true", help="overwrite an existing file (destroys hand labels!)")
    args = ap.parse_args()
    out = Path(args.out)
    if out.exists() and not args.force:
        C.fail(f"{out} already exists; refusing to overwrite your hand labels. Use --force to replace it.")

    df = pd.read_csv(C.DATA_DIR / "processed" / "jira_cleaned.csv", keep_default_na=False)
    parts = []
    for stratum in LABELS[:4] + [""]:
        pool = df[df.weak_label == stratum]
        parts.append(pool.sample(n=min(PER_STRATUM, len(pool)), random_state=C.SEED))
    sample = pd.concat(parts).sample(frac=1, random_state=C.SEED)  # shuffle strata together
    sample = sample[["text_id", "collection", "issue_type", "text_source", "text", "weak_label"]].copy()
    sample["reviewed_label"] = ""
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        sample.to_csv(out, index=False)
    except OSError as exc:
        C.fail(f"could not write {out} ({exc}). If data/processed is read-only, use --out /docs/jira_review_sample.csv")
    print(f"wrote {len(sample)} rows to {out}")
    print(sample.weak_label.replace("", "(none)").value_counts().to_string())


if __name__ == "__main__":
    main()
