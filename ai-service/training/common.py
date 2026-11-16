"""Shared helpers for the training / evaluation scripts (run inside the trainer container)."""
import hashlib
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_recall_fscore_support

from app.signal_model import EMBED_MODEL_NAME, LABELS

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
DOCS_DIR = Path(os.environ.get("DOCS_DIR", "/docs"))
MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/app/models"))
EMBED_CACHE_DIR = Path(os.environ.get("EMBED_CACHE_DIR", "/cache/embeddings"))

WEAK_WEIGHT = 0.3
SEED = 42


def fail(msg: str):
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(1)


def norm_text(t: str) -> str:
    return " ".join(str(t).lower().split())


# ------------------------------------------------------------------------- data
def load_scenario() -> pd.DataFrame:
    # keep_default_na=False: the label "None" is text, not a missing value.
    df = pd.read_csv(DATA_DIR / "scenario" / "scenario_signals.csv", keep_default_na=False)
    bad = set(df["label"]) - set(LABELS)
    if bad:
        fail(f"unexpected labels in scenario_signals.csv: {bad}")
    return df


def scenario_splits(df: pd.DataFrame) -> dict:
    """Named evaluation sets. 'test_*' must only be used for final reporting / promotion."""
    return {
        "train": df[df.split == "train"],
        "val_A": df[(df.split == "val") & (df.batch == "A")],
        "val_all": df[df.split == "val"],
        "test_A": df[(df.split == "test") & (df.batch == "A")],
        "test_all": df[df.split == "test"],
    }


def load_jira_weak() -> pd.DataFrame:
    df = pd.read_csv(DATA_DIR / "processed" / "jira_cleaned.csv", keep_default_na=False)
    df = df[df["weak_label"] != ""]
    bad = set(df["weak_label"]) - set(LABELS)
    if bad:
        fail(f"unexpected weak labels in jira_cleaned.csv: {bad}")
    return df


def load_robustness() -> dict:
    """robustness_test.csv: 'dev' rows only choose between models, 'test' rows are only for the final report.
    Never used for training or tuning."""
    df = pd.read_csv(DATA_DIR / "scenario" / "robustness_test.csv", keep_default_na=False)
    bad = set(df["label"]) - set(LABELS)
    if bad:
        fail(f"unexpected labels in robustness_test.csv: {bad}")
    if set(df["split"]) - {"dev", "test"}:
        fail("robustness_test.csv split must be dev or test")
    return {"dev": df[df.split == "dev"], "test": df[df.split == "test"]}


def load_extra(path: str, held_out: pd.DataFrame) -> pd.DataFrame:
    """Extra labelled data (text,label,source,role). Refuses any text that is in a held-out set
    (scenario test split, robustness dev/test)."""
    df = pd.read_csv(path, keep_default_na=False)
    missing = {"text", "label", "source", "role"} - set(df.columns)
    if missing:
        fail(f"--extra-data {path} is missing columns: {sorted(missing)} (need text,label,source,role)")
    bad = set(df["label"]) - set(LABELS)
    if bad:
        fail(f"--extra-data has labels outside {LABELS}: {sorted(bad)}")
    test_texts = {norm_text(t) for t in held_out["text"]}
    leaks = df[df["text"].map(norm_text).isin(test_texts)]
    if len(leaks):
        examples = "; ".join(repr(t[:70]) for t in leaks["text"].head(3))
        fail(f"LEAK GUARD: {len(leaks)} row(s) of --extra-data also appear in the scenario test split or the robustness set "
             f"(e.g. {examples}). Remove them and run again.")
    return df


# ---------------------------------------------------------------------- metrics
def metrics(y_true, y_pred) -> dict:
    p, r, f, s = precision_recall_fscore_support(y_true, y_pred, labels=LABELS, zero_division=0)
    return {
        "n": int(len(y_true)),
        "macro_f1": float(f1_score(y_true, y_pred, labels=LABELS, average="macro", zero_division=0)),
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "per_class": {l: {"precision": float(p[i]), "recall": float(r[i]), "f1": float(f[i]), "support": int(s[i])}
                      for i, l in enumerate(LABELS)},
        "confusion_matrix": {"labels": LABELS,
                             "rows_true_cols_pred": confusion_matrix(y_true, y_pred, labels=LABELS).tolist()},
    }


def macro_f1(y_true, y_pred) -> float:
    return float(f1_score(y_true, y_pred, labels=LABELS, average="macro", zero_division=0))


AUTO_ACCEPT_TARGET = 0.95  # precision wanted from an auto-accept rule (chosen on DEV rows only)
AUTO_ACCEPT_MIN_N = 15  # a threshold must accept at least this many dev rows to be recommended


def auto_accept(y_true, proba: np.ndarray, thresholds) -> dict:
    """For each threshold t (percent): share of predictions with confidence >= t, and how many of those are right."""
    y_true = np.asarray(y_true)
    conf = proba.max(axis=1)
    pred = np.array(predict_labels(proba))
    out = {}
    for t in thresholds:
        sel = conf >= t / 100
        n = int(sel.sum())
        correct = int((pred[sel] == y_true[sel]).sum())
        out[str(t)] = {"threshold": t, "total": int(len(y_true)), "accepted": n,
                       "accepted_pct": 100.0 * n / len(y_true), "correct": correct,
                       "precision": (correct / n) if n else None}
    return out


def bootstrap_ci(y_true, y_pred, n_boot: int = 1000, seed: int = SEED) -> list:
    """95% percentile bootstrap CI of macro F1 (resampling test rows)."""
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    rng = np.random.default_rng(seed)
    vals = []
    for _ in range(n_boot):
        idx = rng.integers(0, len(y_true), len(y_true))
        vals.append(f1_score(y_true[idx], y_pred[idx], labels=LABELS, average="macro", zero_division=0))
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]


def predict_labels(proba: np.ndarray) -> list:
    return [LABELS[i] for i in proba.argmax(axis=1)]


# ------------------------------------------------------------ embedding cache
_cache = {}


def embed_cached(texts, model_name: str = EMBED_MODEL_NAME) -> np.ndarray:
    """MiniLM embeddings, cached on disk by text hash so reruns are fast."""
    import joblib
    from sentence_transformers import SentenceTransformer

    EMBED_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = EMBED_CACHE_DIR / (model_name.replace("/", "__") + ".joblib")
    if model_name not in _cache:
        _cache[model_name] = joblib.load(path) if path.exists() else {}
    cache = _cache[model_name]
    keys = [hashlib.sha1(str(t).encode("utf-8")).hexdigest() for t in texts]
    todo = sorted({(k, t) for k, t in zip(keys, texts) if k not in cache})
    if todo:
        print(f"  encoding {len(todo)} new texts with {model_name} ({len(cache)} cached)")
        st = SentenceTransformer(model_name)
        vecs = st.encode([str(t) for _, t in todo], batch_size=64, normalize_embeddings=True,
                         show_progress_bar=False)
        for (k, _), v in zip(todo, vecs):
            cache[k] = v.astype(np.float32)
        joblib.dump(cache, path)
    return np.stack([cache[k] for k in keys])
