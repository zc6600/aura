#!/usr/bin/env python3
"""Real feature-engineering history for the Titanic validation run logged in
../VALIDATION_LOG.md. Each VERSIONS entry is the exact feature set used to
produce that run's cv_score in showcase/state/experiment_history.json — this
file is not illustrative, it is what was actually executed against the real
`kaggle competitions download -c titanic` output.

Run from an AutoKaggle competition workspace that already has
data/raw/train.csv and data/raw/test.csv (real Titanic download):

    python3 feature_engineering.py
"""
import csv
import re
import statistics

TITLE_MAP = {
    "Mr": "Mr", "Mrs": "Mrs", "Miss": "Miss", "Master": "Master",
    "Mlle": "Miss", "Mme": "Mrs", "Ms": "Miss",
}


def extract_title(name):
    m = re.search(r",\s*([^.]+)\.", name)
    raw = m.group(1).strip() if m else "Rare"
    return TITLE_MAP.get(raw, "Rare")


def load_and_engineer(train_path="data/raw/train.csv", test_path="data/raw/test.csv"):
    with open(train_path, newline="") as f:
        train = list(csv.DictReader(f))
    with open(test_path, newline="") as f:
        test = list(csv.DictReader(f))

    fare_median = statistics.median(float(r["Fare"]) for r in train)
    age_median = statistics.median(float(r["Age"]) for r in train if r["Age"] != "")
    embarked_mode = statistics.mode([r["Embarked"] for r in train if r["Embarked"] != ""])

    for rows in (train, test):
        for r in rows:
            if r.get("Fare", "") == "":
                r["Fare"] = str(fare_median)
            if r.get("Age", "") == "":
                r["Age"] = str(age_median)
            if r.get("Embarked", "") == "":
                r["Embarked"] = embarked_mode
            r["Sex"] = "1" if r["Sex"] == "female" else "0"
            for e in ["S", "C", "Q"]:
                r[f"Embarked_{e}"] = "1" if r["Embarked"] == e else "0"
            r["FamilySize"] = str(int(r["SibSp"]) + int(r["Parch"]) + 1)
            r["IsAlone"] = "1" if r["FamilySize"] == "1" else "0"
            title = extract_title(r["Name"])
            for t in ["Mr", "Mrs", "Miss", "Master", "Rare"]:
                r[f"Title_{t}"] = "1" if title == t else "0"
    return train, test


# Each entry: run_id -> (features, hypothesis, train_candidate.py CLI overrides)
VERSIONS = {
    "titanic_v1": {
        "features": ["Pclass", "SibSp", "Parch", "Fare"],
        "hypothesis": "Numeric baseline, z-score standardized. No domain knowledge, just the columns with zero missing values.",
        "cli": "python3 src/train_candidate.py --run-id titanic_v1 --epochs 300 --lr 0.3",
    },
    "titanic_v2": {
        "features": ["Pclass", "SibSp", "Parch", "Fare", "Sex"],
        "hypothesis": "Add Sex (male=0/female=1) — historically the single strongest Titanic survival predictor.",
        "cli": "python3 src/train_candidate.py --run-id titanic_v2 --epochs 300 --lr 0.3",
    },
    "titanic_v3": {
        "features": ["Pclass", "SibSp", "Parch", "Fare", "Sex", "Age", "Embarked_S", "Embarked_C", "Embarked_Q"],
        "hypothesis": "Add median-imputed Age and one-hot Embarked — use every remaining raw column.",
        "cli": "python3 src/train_candidate.py --run-id titanic_v3 --epochs 300 --lr 0.3",
    },
    "titanic_v4": {
        "features": ["Pclass", "SibSp", "Parch", "Fare", "Sex", "FamilySize", "IsAlone"],
        "hypothesis": "Engineer FamilySize (SibSp+Parch+1) and IsAlone instead of relying on raw counts.",
        "cli": "python3 src/train_candidate.py --run-id titanic_v4 --epochs 300 --lr 0.3",
    },
    "titanic_v5": {
        "features": ["Pclass", "Fare", "Sex", "FamilySize", "IsAlone", "Title_Mr", "Title_Mrs", "Title_Miss", "Title_Master", "Title_Rare"],
        "hypothesis": "Extract Title (Mr/Mrs/Miss/Master/Rare) from Name via regex; drop now-redundant raw SibSp/Parch.",
        "cli": "python3 src/train_candidate.py --run-id titanic_v5 --epochs 300 --lr 0.3",
    },
    "titanic_v6": {
        "features": ["Pclass", "Fare", "Sex", "FamilySize", "IsAlone", "Title_Mr", "Title_Mrs", "Title_Miss", "Title_Master", "Title_Rare"],
        "hypothesis": "Same features as v5 — tune lr/epochs/l2 to check whether the linear model had more room to converge.",
        "cli": "python3 src/train_candidate.py --run-id titanic_v6 --epochs 800 --lr 0.5 --l2 0.001",
    },
}


def write_version(version, train, test):
    feats = VERSIONS[version]["features"]
    means, stds = {}, {}
    for c in feats:
        vals = [float(r[c]) for r in train]
        means[c] = statistics.mean(vals)
        stds[c] = statistics.pstdev(vals) or 1.0

    def write(path, rows, has_target):
        with open(path, "w", newline="") as f:
            header = ["PassengerId"] + feats + (["Survived"] if has_target else [])
            w = csv.writer(f)
            w.writerow(header)
            for r in rows:
                vals = [(float(r[c]) - means[c]) / stds[c] for c in feats]
                row = [r["PassengerId"]] + [f"{v:.6f}" for v in vals]
                if has_target:
                    row.append(r["Survived"])
                w.writerow(row)

    write(f"data/processed/train_{version.split('_')[1]}.csv", train, True)
    write(f"data/processed/test_{version.split('_')[1]}.csv", test, False)


if __name__ == "__main__":
    train_rows, test_rows = load_and_engineer()
    for run_id in VERSIONS:
        write_version(run_id, train_rows, test_rows)
        print(f"wrote data/processed/{{train,test}}_{run_id.split('_')[1]}.csv")
