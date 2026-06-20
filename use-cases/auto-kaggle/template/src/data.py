import csv


TRAIN = "data/raw/train.csv"
TEST = "data/raw/test.csv"
SAMPLE = "data/raw/sample_submission.csv"


def read_csv_dicts(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_data():
    return read_csv_dicts(TRAIN), read_csv_dicts(TEST), read_csv_dicts(SAMPLE)


def feature_columns(rows):
    ignore = {"id", "target"}
    return [c for c in rows[0].keys() if c not in ignore]


def as_float_matrix(rows, cols):
    return [[float(r[c]) for c in cols] for r in rows]


def target(rows):
    return [float(r["target"]) for r in rows]
