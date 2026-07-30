#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import time

from ak_registry import record
from data import as_float_matrix, feature_columns, load_data, target
from metric import accuracy_from_probs
from model import fit_logreg, leave_one_out_cv, predict_proba


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def write_submission(path, sample_rows, probs):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("id,target\n")
        for row, p in zip(sample_rows, probs):
            f.write(f"{row['id']},{p:.8f}\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default=f"candidate_{int(time.time())}")
    parser.add_argument("--hypothesis", default="logistic regression baseline")
    parser.add_argument("--lr", type=float, default=0.5, help="gradient descent learning rate")
    parser.add_argument("--epochs", type=int, default=500, help="gradient descent epochs")
    parser.add_argument("--l2", type=float, default=0.0, help="L2 regularization strength")
    parser.add_argument("--seed", type=int, default=42, help="weight init / CV seed")
    args = parser.parse_args()

    train, test, sample = load_data()
    cols = feature_columns(train)
    x_train = as_float_matrix(train, cols)
    y = target(train)

    oof_probs = leave_one_out_cv(x_train, y, lr=args.lr, epochs=args.epochs, l2=args.l2, seed=args.seed)
    cv = accuracy_from_probs(y, oof_probs)

    w, b = fit_logreg(x_train, y, lr=args.lr, epochs=args.epochs, l2=args.l2, seed=args.seed)
    x_test = as_float_matrix(test, cols)
    test_probs = predict_proba(x_test, w, b)
    sub_path = f"submissions/{args.run_id}.csv"
    write_submission(sub_path, sample, test_probs)
    sub_hash = sha256_file(sub_path)

    os.makedirs("reports", exist_ok=True)
    report = {
        "run_id": args.run_id,
        "hypothesis": args.hypothesis,
        "metric_name": "accuracy",
        "cv_score": cv,
        "cv_std": 0.0,
        "higher_is_better": True,
        "model_family": "logreg_gd",
        "params": {"lr": args.lr, "epochs": args.epochs, "l2": args.l2, "seed": args.seed, "features": cols},
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
