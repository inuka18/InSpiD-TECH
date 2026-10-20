"""Promote a candidate model version to active if it is not worse than the active one.

    python -m training.promote <candidate_version> [--dry-run]

Both models are scored on three frozen test sets:
  1. scenario test, batch A only
  2. scenario test, all batches
  3. robustness test (robustness_test.csv, split == test)
current.json is switched only if the candidate's macro F1 is not lower on ALL THREE. Otherwise the script
refuses and says which one(s) failed. (Every promotion check reads the test sets; do not use it to hunt for a
lucky candidate.)
"""
import argparse

from app.signal_model import read_current, load_model, write_current
from training import common as C

CHECKS = (("test_A", "scenario test batch A"), ("test_all", "scenario test all batches"),
          ("robust_test", "robustness test"))


def score(model, sets):
    out = {}
    for name, df in sets.items():
        pred = C.predict_labels(model.predict_proba(list(df.text)))
        out[name] = C.macro_f1(df.label.to_numpy(), pred)
    return out


def fmt(s):
    return " | ".join(f"{label} {s[k]:.4f}" for k, label in CHECKS)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("candidate", help="version folder name under ai-service/models/, e.g. 20260101T120000Z")
    ap.add_argument("--dry-run", action="store_true", help="evaluate and report, but do not switch current.json")
    args = ap.parse_args()

    if not (C.MODELS_DIR / args.candidate / "model.joblib").exists():
        C.fail(f"candidate {args.candidate!r} not found in {C.MODELS_DIR}")
    sp = C.scenario_splits(C.load_scenario())
    sets = {"test_A": sp["test_A"], "test_all": sp["test_all"], "robust_test": C.load_robustness()["test"]}
    active = read_current(C.MODELS_DIR)
    cand = score(load_model(C.MODELS_DIR, args.candidate), sets)
    print(f"candidate {args.candidate}: {fmt(cand)}")

    if active is None:
        print("No active model: nothing to compare against.")
    elif active == args.candidate:
        print("Candidate is already the active version. Nothing to do.")
        return
    else:
        cur = score(load_model(C.MODELS_DIR, active), sets)
        print(f"active    {active}: {fmt(cur)}")
        problems = [f"{label}: candidate {cand[k]:.4f} < active {cur[k]:.4f}"
                    for k, label in CHECKS if cand[k] < cur[k] - 1e-9]
        if problems:
            print("REFUSED - candidate has lower macro F1 on the frozen test sets: " + "; ".join(problems))
            print("current.json unchanged.")
            raise SystemExit(2)
    if args.dry_run:
        print("Dry run: candidate would be promoted. current.json unchanged.")
        return
    write_current(C.MODELS_DIR, args.candidate)
    print(f"PROMOTED: current.json now names {args.candidate}. "
          "/classify picks it up automatically (it watches current.json).")


if __name__ == "__main__":
    main()
