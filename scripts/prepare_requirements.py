"""Build a clean requirement bank from the FR/NFR spreadsheet.

Input : data/raw/FR_NFR_Dataset.xlsx
Output: data/processed/requirement_bank.csv

Run from the repo root:  python scripts/prepare_requirements.py
"""
import pandas as pd

SRC = "data/raw/FR_NFR_Dataset.xlsx"
OUT = "data/processed/requirement_bank.csv"

df = pd.read_excel(SRC)
df.columns = ["text", "type"]
n0 = len(df)

df["text"] = df["text"].astype(str).str.replace(r"\s+", " ", regex=True).str.strip()
df = df[df.text.str.len() >= 20]
df = df.drop_duplicates("text").reset_index(drop=True)

df["type"] = df["type"].fillna("").astype(str).str.strip().str.upper()
df.loc[~df["type"].isin(["FR", "NFR"]), "type"] = ""
df["needs_type_review"] = (df["type"] == "").astype(int)

df.insert(0, "req_bank_id", [f"RB-{i:05d}" for i in range(1, len(df) + 1)])
df["char_len"] = df["text"].str.len()

df.to_csv(OUT, index=False)
print(f"rows in: {n0}, rows out: {len(df)}")
print(df["type"].replace("", "(unlabelled)").value_counts().to_string())
