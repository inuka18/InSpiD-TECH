"""Clean the public Jira text export for classifier work.

Input : data/raw/jira_extracted_texts.csv
Output: data/processed/jira_cleaned.csv

Run from the repo root:  python scripts/prepare_jira.py
"""
import re
import pandas as pd

SRC = "data/raw/jira_extracted_texts.csv"
OUT = "data/processed/jira_cleaned.csv"

COMMIT = re.compile(r"Author:\{|Message:|Merged|git commit|^commit ")
TRACE = re.compile(r"Traceback|Exception in|\bat [a-z]+\.[a-z.]+\(|stack trace|\.java:\d+", re.I)
MIN_CHARS = 60

# Simple keyword rules used only to bootstrap labels. They are rough.
# Exactly one rule must match for a weak label to be assigned.
RULES = {
    "Constraint": r"\b(must|have to|has to|needs? to be|required|only if|cannot|limit|restricted|compliance|should not)\b",
    "Expectation": r"\b(would like|expect|want(?:ed)? to|should (?:be able|support)|feature request|please (?:add|support)|it would be (?:nice|great)|ability to)\b",
    "Completion": r"\b(fixed|done|completed|resolved|implemented|merged|released|works now|closed|verified)\b",
    "Conflict": r"\b(blocked|conflict|contradict|disagree|can.?t|won.?t|not possible|breaks|regression|incompatible|instead of)\b",
}

def weak_label(text: str) -> str:
    hits = [k for k, p in RULES.items() if re.search(p, text, re.I)]
    return hits[0] if len(hits) == 1 else ""

df = pd.read_csv(SRC)
n0 = len(df)
df["cleaned_text"] = (
    df["cleaned_text"].fillna("").astype(str).str.replace(r"\s+", " ", regex=True).str.strip()
)

df = df[~df.cleaned_text.str.contains(COMMIT)]
n1 = len(df)
df = df[~df.cleaned_text.str.contains(TRACE)]
n2 = len(df)
df = df[df.cleaned_text.str.len() >= MIN_CHARS]
n3 = len(df)
df = df.drop_duplicates("cleaned_text")
n4 = len(df)

out = pd.DataFrame({
    "text_id": [f"JT-{i:05d}" for i in range(1, n4 + 1)],
    "collection": df["collection"].values,
    "issue_key": df["issue_key"].values,
    "issue_type": df["issue_type"].values,
    "text_source": df["text_source"].values,
    "text": df["cleaned_text"].values,
    "char_len": df["cleaned_text"].str.len().values,
})
out["weak_label"] = out["text"].map(weak_label)
out["label"] = ""  # fill after manual review

out.to_csv(OUT, index=False)
print(f"rows in: {n0}")
print(f"after removing commit-like: {n1}")
print(f"after removing stack traces: {n2}")
print(f"after removing short (<{MIN_CHARS}): {n3}")
print(f"after removing duplicates: {n4}")
print(out.weak_label.replace("", "(none)").value_counts().to_string())
