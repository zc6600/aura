#!/usr/bin/env python3
import argparse
import csv
import json
import os
import sys

from ak_registry import get


SAMPLE = "data/raw/sample_submission.csv"


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.reader(f))


def verify(submission, run_id):
    problems = []
    if not os.path.exists(submission):
        problems.append(f"submission missing: {submission}")
    if not os.path.exists(SAMPLE):
        problems.append(f"sample submission missing: {SAMPLE}")

    if not problems:
        sample = read_csv(SAMPLE)
        sub = read_csv(submission)
        if sample[0] != sub[0]:
            problems.append("columns do not match sample submission")
        if len(sample) != len(sub):
            problems.append("row count does not match sample submission")
        if [r[0] for r in sample[1:]] != [r[0] for r in sub[1:]]:
            problems.append("id order does not match sample submission")
        if any(any(c == "" for c in row) for row in sub[1:]):
            problems.append("submission contains missing values")

    if not problems:
        run_data = get(run_id)
        if not run_data or run_data.get("cv_score") is None:
            problems.append("run has no recorded CV score")

    return {"completed": len(problems) == 0, "problems": problems}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--submission", required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    result = verify(args.submission, args.run_id)
    os.makedirs("reports", exist_ok=True)
    with open(f"reports/verify_{args.run_id}.json", "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result))
    sys.exit(0 if result["completed"] else 1)


if __name__ == "__main__":
    main()
