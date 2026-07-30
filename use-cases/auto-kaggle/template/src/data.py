import csv

import params


def train_path():
    return params.get("data", "train_file", "data/raw/train.csv")


def test_path():
    return params.get("data", "test_file", "data/raw/test.csv")


def sample_path():
    return params.get("data", "sample_submission_file", "data/raw/sample_submission.csv")


def id_column():
    return params.get("data", "id_column", "id")


def target_column():
    return params.get("data", "target_column", "target")


def read_csv_dicts(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_data():
    return read_csv_dicts(train_path()), read_csv_dicts(test_path()), read_csv_dicts(sample_path())


def feature_columns(rows):
    ignore = {id_column(), target_column()}
    return [c for c in rows[0].keys() if c not in ignore]


def as_float_matrix(rows, cols):
    return [[float(r[c]) for c in cols] for r in rows]


def target(rows):
    col = target_column()
    return [float(r[col]) for r in rows]
