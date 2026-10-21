"""InSPiD-TECH AI service.

Every endpoint below returns PLACEHOLDER values. The real models arrive later:
  - /classify   -> signal classifier (Constraint / Expectation / Completion / Conflict / None)
  - /embed      -> sentence-transformers embeddings
  - /similarity -> cosine similarity on those embeddings
The backend only talks to this service through backend/src/shared/aiClient.js.
"""
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="InSPiD-TECH AI service", version="0.1.0")

LABELS = ["Constraint", "Expectation", "Completion", "Conflict", "None"]
EMBED_DIM = 384  # all-MiniLM-L6-v2 size, the likely model


class ClassifyIn(BaseModel):
    text: str = Field(min_length=1)


class ClassifyOut(BaseModel):
    label: str
    confidence: float
    scores: dict
    placeholder: bool = True


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
    # TODO: replace with the trained classifier.
    return ClassifyOut(label="None", confidence=0.0, scores={l: 0.0 for l in LABELS})


@app.post("/embed", response_model=EmbedOut)
def embed(body: EmbedIn):
    # TODO: replace with sentence-transformers encode().
    return EmbedOut(embeddings=[[0.0] * EMBED_DIM for _ in body.texts], dim=EMBED_DIM)


@app.post("/similarity", response_model=SimilarityOut)
def similarity(body: SimilarityIn):
    # TODO: replace with cosine similarity of real embeddings.
    return SimilarityOut(score=0.0)
