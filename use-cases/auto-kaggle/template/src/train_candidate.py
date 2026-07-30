#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import time

import params
from ak_registry import record
from data import as_float_matrix, feature_columns, id_column, load_data, target, target_column
from metric import accuracy_from_probs
from model import fit_logreg, k_fold_cv, predict_proba


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def metric_name():
    return params.get("metric", "name", "accuracy")


def to_submission_values(probs, metric):
    """Accuracy is scored on exact label match, so a raw probability like
    0.27 never equals the 0/1 ground truth and would score as wrong on every
    row. Threshold at 0.5 for accuracy-style metrics; leave probabilities
    untouched for rank/probability metrics (AUC, log loss, ...)."""
    if "accuracy" in (metric or "").lower():
        return [1 if p >= 0.5 else 0 for p in probs]
    return probs


def write_submission(path, sample_rows, values):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    id_col, target_col = id_column(), target_column()
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"{id_col},{target_col}\n")
        for row, v in zip(sample_rows, values):
            formatted = str(v) if isinstance(v, int) else f"{v:.8f}"
            f.write(f"{row[id_col]},{formatted}\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default=f"candidate_{int(time.time())}")
    parser.add_argument("--hypothesis", default="logistic regression baseline")
    parser.add_argument("--lr", type=float, default=0.5, help="gradient descent learning rate")
    parser.add_argument("--epochs", type=int, default=500, help="gradient descent epochs")
    parser.add_argument("--l2", type=float, default=0.0, help="L2 regularization strength")
    parser.add_argument("--seed", type=int, default=42, help="weight init / CV seed")
    parser.add_argument("--n-splits", type=int, default=None, help="override validation.n_splits from config")
    args = parser.parse_args()

    metric = metric_name()
    n_splits = args.n_splits if args.n_splits is not None else int(params.get("validation", "n_splits", 5) or 5)

    train, test, sample = load_data()
    cols = feature_columns(train)
    x_train = as_float_matrix(train, cols)
    y = target(train)

    oof_probs = k_fold_cv(x_train, y, n_splits=n_splits, lr=args.lr, epochs=args.epochs, l2=args.l2, seed=args.seed)
    cv = accuracy_from_probs(y, oof_probs)

    w, b = fit_logreg(x_train, y, lr=args.lr, epochs=args.epochs, l2=args.l2, seed=args.seed)
    x_test = as_float_matrix(test, cols)
    test_probs = predict_proba(x_test, w, b)
    sub_path = f"submissions/{args.run_id}.csv"
    write_submission(sub_path, sample, to_submission_values(test_probs, metric))
    sub_hash = sha256_file(sub_path)

    os.makedirs("reports", exist_ok=True)
    report = {
        "run_id": args.run_id,
        "hypothesis": args.hypothesis,
        "metric_name": metric,
        "cv_score": cv,
        "cv_std": 0.0,
        "higher_is_better": True,
        "model_family": "logreg_gd",
        "params": {
            "lr": args.lr,
            "epochs": args.epochs,
            "l2": args.l2,
            "seed": args.seed,
            "n_splits": n_splits,
            "features": cols,
        },
        "submission_path": sub_path,
        "submission_sha256": sub_hash,
        "changed_files": ["src/train_candidate.py"],
        "artifacts": {"report": f"reports/{args.run_id}.json"},
    }
    with open(f"reports/{args.run_id}.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    rec = record(args.run_id, report)
    print(json.dumps({"status": "ok", "report": report, "registry": rec}, indent=2))


if __name__ == "__main__":
    main()
