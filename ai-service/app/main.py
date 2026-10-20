"""InSPiD-TECH AI service.

  - /classify   -> signal classifier (Constraint / Expectation / Completion / Conflict / None)
  - /embed      -> all-MiniLM-L6-v2 vectors (normalized)
  - /similarity -> cosine similarity of two texts
  - /match      -> rank candidate texts by similarity to a text
The backend only talks to this service through backend/src/shared/aiClient.js.
"""
import os
import threading
from pathlib import Path
from typing import List, Optional

from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.embedder import Embedder
from app.signal_model import EMBED_MODEL_NAME, LABELS, load_model, read_current

embedder = Embedder()


@asynccontextmanager
async def lifespan(_app):
    embedder.load()  # once, at startup (the weights come from the ml_cache volume after the first download)
    yield


app = FastAPI(title="InSPiD-TECH AI service", version="0.3.0", lifespan=lifespan)
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
    texts: List[str] = Field(min_length=1, max_length=512)


class EmbedOut(BaseModel):
    vectors: List[List[float]]
    model: str


class SimilarityIn(BaseModel):
    a: str = Field(min_length=1)
    b: str = Field(min_length=1)


class SimilarityOut(BaseModel):
    similarity: float


class Candidate(BaseModel):
    id: str
    text: str = Field(min_length=1)


class MatchIn(BaseModel):
    text: str = Field(min_length=1)
    candidates: List[Candidate] = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=5, ge=1, le=50)


class MatchItem(BaseModel):
    id: str
    similarity: float


def need_embedder():
    if not embedder.ready:
        raise HTTPException(status_code=503, detail=f"Embedding model not available: {embedder.error}")


@app.get("/health")
def health():
    return {"status": "ok", "service": "ai-service", "embedder_ready": embedder.ready}


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
    need_embedder()
    return EmbedOut(vectors=embedder.encode(body.texts).tolist(), model=EMBED_MODEL_NAME)


@app.post("/similarity", response_model=SimilarityOut)
def similarity(body: SimilarityIn):
    need_embedder()
    va, vb = embedder.encode([body.a, body.b])
    return SimilarityOut(similarity=round(float(np.dot(va, vb)), 6))  # vectors are normalized -> cosine


@app.post("/match", response_model=List[MatchItem])
def match(body: MatchIn):
    need_embedder()
    q = embedder.encode([body.text])[0]
    cand = embedder.encode_cached([c.text for c in body.candidates])  # candidate vectors cached by text hash
    sims = cand @ q
    order = np.argsort(-sims, kind="stable")[: body.top_k]
    return [MatchItem(id=body.candidates[i].id, similarity=round(float(sims[i]), 6)) for i in order]
