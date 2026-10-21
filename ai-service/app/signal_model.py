"""Signal classifier models shared by the training scripts and the /classify endpoint.

Three model kinds, all exposing predict_proba(texts) -> array (n, 5) in LABELS order:
  keyword   - simple regex rules (baseline, no training)
  tfidf_lr  - Model A: spaCy lowercase + lemma, TF-IDF, logistic regression
  minilm_lr - Model B: all-MiniLM-L6-v2 embeddings, logistic regression
              (only the classifier and the embedding model NAME are saved)
"""
import json
import re
from pathlib import Path
from typing import List, Optional

import numpy as np

LABELS = ["Constraint", "Expectation", "Completion", "Conflict", "None"]
EMBED_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
SPACY_MODEL = "en_core_web_sm"

_nlp = None


def clean_texts(texts: List[str]) -> List[str]:
    """Lowercase + lemmatize only. Stopwords and negations (must, not, no, never,
    without, only, unless, instead, but, ...) are deliberately kept."""
    global _nlp
    if _nlp is None:
        import spacy

        _nlp = spacy.load(SPACY_MODEL, disable=["parser", "ner"])
    out = []
    for doc in _nlp.pipe([str(t) for t in texts], batch_size=256):
        out.append(" ".join(t.lemma_.lower() for t in doc if not t.is_space))
    return out


# ---------------------------------------------------------------- keyword baseline
_RULES = {
    "Constraint": [
        r"\bmust not\b", r"\bmust (stay|remain|be)\b", r"\bcannot\b", r"\bcan ?not\b", r"\bshall not\b",
        r"\bonly\b", r"\bwritten approval\b", r"\bnot allowed\b", r"\bprohibited\b", r"\bmandatory\b",
        r"\bwithin the agreed\b", r"\bno more than\b", r"\bat most\b", r"\bcompliance\b", r"\bregulat",
        r"\bany change\b", r"\bpolicy\b", r"\bmust\b",
    ],
    "Expectation": [
        r"\bshould\b", r"\bwe need\b", r"\bexpect", r"\bready (by|before)\b", r"\bwas promised\b",
        r"\bkey ask\b", r"\bfrom day one\b", r"\brely on\b", r"\bwants?\b", r"\bwould like\b",
        r"\bneeds? to be\b", r"\bpromised\b",
    ],
    "Completion": [
        r"\bcomplete[d]?\b", r"\bimplemented\b", r"\bmerged\b", r"\bpassed\b", r"\blive\b",
        r"\baccepted\b", r"\bdeployed\b", r"\breleased\b", r"\bdone\b", r"\bfinished\b",
        r"\bsigned off\b", r"\bdelivered\b", r"\bshipped\b",
    ],
    "Conflict": [
        r"\bblocked\b", r"\bincompatible\b", r"\bdisagree", r"\bconflict", r"\bdefer", r"\bpostpone",
        r"\bbreaks\b", r"\bclash", r"\bdrop(ped)?\b", r"\bdescope", r"\bout of scope\b",
        r"\bnot feasible\b", r"\bcontradict", r"\bat odds\b", r"\bimpossible\b", r"\bdecision from\b",
        r"\bcannot both\b",
    ],
}
_PRIORITY = {"Conflict": 4e-3, "Completion": 3e-3, "Constraint": 2e-3, "Expectation": 1e-3, "None": 0.0}


class KeywordModel:
    kind = "keyword"
    classes_ = LABELS

    def __init__(self):
        self.patterns = {l: [re.compile(p, re.I) for p in ps] for l, ps in _RULES.items()}

    def predict_proba(self, texts: List[str]) -> np.ndarray:
        rows = []
        for t in texts:
            raw = [sum(1 for p in self.patterns[l] if p.search(t)) if l != "None" else 0.5 for l in LABELS]
            raw = np.array(raw, dtype=float) + 0.05
            p = raw / raw.sum()
            rows.append(p + np.array([_PRIORITY[l] for l in LABELS]))  # deterministic tie-break
        rows = np.array(rows)
        return rows / rows.sum(axis=1, keepdims=True)


# ------------------------------------------------------------------ trained models
def _align(proba: np.ndarray, classes) -> np.ndarray:
    out = np.zeros((proba.shape[0], len(LABELS)))
    for i, c in enumerate(classes):
        out[:, LABELS.index(c)] = proba[:, i]
    return out


class TfidfLrModel:
    kind = "tfidf_lr"

    def __init__(self, vectorizer, classifier):
        self.vectorizer = vectorizer
        self.classifier = classifier

    def predict_proba(self, texts: List[str]) -> np.ndarray:
        X = self.vectorizer.transform(clean_texts(texts))
        return _align(self.classifier.predict_proba(X), self.classifier.classes_)


class _Embedder:
    """Lazy MiniLM encoder. The transformer weights are never pickled, only the model name."""

    embed_model_name = EMBED_MODEL_NAME
    _st = None

    def __getstate__(self):
        state = self.__dict__.copy()
        state["_st"] = None
        return state

    def encode(self, texts: List[str]) -> np.ndarray:
        if self._st is None:
            from sentence_transformers import SentenceTransformer

            self._st = SentenceTransformer(self.embed_model_name)
        return self._st.encode([str(t) for t in texts], batch_size=64, normalize_embeddings=True,
                               show_progress_bar=False)


class MiniLmLrModel(_Embedder):
    kind = "minilm_lr"

    def __init__(self, classifier, embed_model_name: str = EMBED_MODEL_NAME):
        self.classifier = classifier
        self.embed_model_name = embed_model_name

    def predict_proba(self, texts: List[str]) -> np.ndarray:
        return _align(self.classifier.predict_proba(self.encode(texts)), self.classifier.classes_)


class VotingModel:
    """Model C: soft voting. weight_a * P(Model A) + (1 - weight_a) * P(Model B)."""

    kind = "voting"

    def __init__(self, model_a: TfidfLrModel, model_b: MiniLmLrModel, weight_a: float):
        self.model_a, self.model_b, self.weight_a = model_a, model_b, float(weight_a)

    def predict_proba(self, texts: List[str]) -> np.ndarray:
        return self.weight_a * self.model_a.predict_proba(texts) + (1 - self.weight_a) * self.model_b.predict_proba(texts)


class ConcatLrModel(_Embedder):
    """Model D: one logistic regression on [TF-IDF | scale * MiniLM embedding]."""

    kind = "concat_lr"

    def __init__(self, vectorizer, classifier, scale: float, embed_model_name: str = EMBED_MODEL_NAME):
        self.vectorizer, self.classifier = vectorizer, classifier
        self.scale = float(scale)
        self.embed_model_name = embed_model_name

    def predict_proba(self, texts: List[str]) -> np.ndarray:
        from scipy import sparse

        X = sparse.hstack([self.vectorizer.transform(clean_texts(texts)),
                           sparse.csr_matrix(self.scale * self.encode(texts))]).tocsr()
        return _align(self.classifier.predict_proba(X), self.classifier.classes_)


# ----------------------------------------------------------------- version registry
def read_current(models_dir: Path) -> Optional[str]:
    p = Path(models_dir) / "current.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8")).get("version")


def write_current(models_dir: Path, version: str) -> None:
    (Path(models_dir) / "current.json").write_text(json.dumps({"version": version}, indent=2), encoding="utf-8")


def load_model(models_dir: Path, version: str):
    import joblib

    path = Path(models_dir) / version / "model.joblib"
    if not path.exists():
        raise FileNotFoundError(f"model file not found: {path}")
    return joblib.load(path)
