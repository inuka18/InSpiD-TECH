"""InSPiD-TECH AI service.

/classify uses the trained model; /embed and /similarity still return PLACEHOLDER values:
  - /classify   -> REAL: signal classifier (Constraint / Expectation / Completion / Conflict / None)
  - /embed     -> sentence-transformers embeddings
  - /similarity -> cosine similarity on those embeddings
The backend only talks to this service through backend/src/shared/aiClient.js.
"""
import os
import threading
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.signal_model import LABELS, load_model, read_current

app = FastAPI(title="InSPiD-TECH AI service", version="0.2.0")

EMBED_DIM = 384  # all-MiniLM-L6-v2 size, the likely model
MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/app/models"))


class ModelRegistry:
    """Holds the active classifier and reloads it when current.json changes (mtime check)."""

    def __init__(self, models_dir: Path):
        self.dir = models_dir
        self.lock = threading.Lock()
        self.mtime = None
        self.version: Optional[str] = None
        self.model = None
        self.error = "No model has been loaded yet."

    def get(self):
        cur = self.dir / "current.json"
        try:
            mtime = cur.stat().st_mtime_ns
        except FileNotFoundError:
            with self.lock:
                self.model, self.version, self.mtime = None, None, None
                self.error = f"No trained model: {cur} does not exist. Run the training script (see ai-service/training/README.md)."
            return None, None, self.error
        with self.lock:
            if mtime != self.mtime:
                try:
                    version = read_current(self.dir)
                    self.model, self.version = load_model(self.dir, version), version
                    self.error = None
                except Exception as exc:  # bad json, missing model file, unpickle error
                    self.model, self.version = None, None
                    self.error = f"Could not load the active model from {cur}: {exc}"
                self.mtime = mtime
            return self.model, self.version, self.error


registry = ModelRegistry(MODELS_DIR)


class ClassifyIn(BaseModel):
    text: str = Field(min_length=1)
    source: Optional[str] = None  # accepted for the API contract; the model is text-only
    role: Optional[str] = None  # accepted for the API contract; the model is text-only


class ClassifyOut(BaseModel):
    label: str
    confidence: float
    scores: dict
    model_version: str


class EmbedIn(BaseModel):
    texts: List[str] = Field(min_length=1)


class EmbedOut(BaseModel):
    embeddings: List[List[float]]
    dim: int
    placeholder: bool = True


class SimilarityIn(BaseModel):
    text_a: str
    text_b: str


class SimilarityOut(BaseModel):
    score: float
    placeholder: bool = True


@app.get("/health")
def health():
    return {"status": "ok", "service": "ai-service", "placeholder": True}


@app.post("/classify", response_model=ClassifyOut)
def classify(body: ClassifyIn):
    model, version, error = registry.get()
    if model is None:
        raise HTTPException(status_code=503, detail=error)
    proba = model.predict_proba([body.text])[0]
    scores = {l: round(float(p), 6) for l, p in zip(LABELS, proba)}
    label = max(scores, key=scores.get)
    return ClassifyOut(label=label, confidence=scores[label], scores=scores, model_version=version)


@app.post("/embed", response_model=EmbedOut)
def embed(body: EmbedIn):
    # TODO: replace with sentence-transformers encode().
    return EmbedOut(embeddings=[[0.0] * EMBED_DIM for _ in body.texts], dim=EMBED_DIM)


@app.post("/similarity", response_model=SimilarityOut)
def similarity(body: SimilarityIn):
    # TODO: replace with cosine similarity of real embeddings.
    return SimilarityOut(score=0.0)
