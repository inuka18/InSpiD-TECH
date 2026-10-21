"""MiniLM embedder for /embed, /similarity and /match. Loaded once at startup; vectors are normalized."""
import hashlib
import threading
from collections import OrderedDict
from typing import List

import numpy as np

from app.signal_model import EMBED_MODEL_NAME

CACHE_MAX = 20000  # candidate vectors kept in memory (LRU)


class Embedder:
    def __init__(self):
        self.model = None
        self.error = "not loaded yet"
        self._lock = threading.Lock()
        self._cache: "OrderedDict[str, np.ndarray]" = OrderedDict()

    def load(self):
        try:
            from sentence_transformers import SentenceTransformer

            self.model = SentenceTransformer(EMBED_MODEL_NAME)
            self.error = None
        except Exception as exc:  # no network and no cached weights, etc.
            self.model, self.error = None, f"{type(exc).__name__}: {exc}"

    @property
    def ready(self) -> bool:
        return self.model is not None

    def encode(self, texts: List[str]) -> np.ndarray:
        with self._lock:
            return self.model.encode([str(t) for t in texts], batch_size=64, normalize_embeddings=True,
                                     show_progress_bar=False)

    def encode_cached(self, texts: List[str]) -> np.ndarray:
        """Same as encode, but vectors are cached in memory by text hash (repeat /match calls are fast)."""
        keys = [hashlib.sha1(str(t).encode("utf-8")).hexdigest() for t in texts]
        todo = {k: t for k, t in zip(keys, texts) if k not in self._cache}
        if todo:
            vecs = self.encode(list(todo.values()))
            for k, v in zip(todo, vecs):
                self._cache[k] = v
            while len(self._cache) > CACHE_MAX:
                self._cache.popitem(last=False)
        for k in keys:
            if k in self._cache:
                self._cache.move_to_end(k)
        return np.stack([self._cache[k] for k in keys]) if keys else np.zeros((0, 384), dtype=np.float32)
