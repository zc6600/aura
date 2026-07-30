import os

PATH = "params/autokaggle.yml"


def _read_text(path=PATH):
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _parse_scalar(raw):
    raw = raw.strip()
    if raw.startswith('"'):
        end = raw.find('"', 1)
        return raw[1:end] if end != -1 else raw.strip('"')
    if raw.startswith("'"):
        end = raw.find("'", 1)
        return raw[1:end] if end != -1 else raw.strip("'")
    if "#" in raw:
        raw = raw.split("#", 1)[0]
    return raw.strip()


def get(section, key, default=None, path=PATH):
    """Read a scalar value out of the flat two-level autokaggle.yml without
    requiring a yaml dependency. Real competitions rename files (Kaggle's
    Titanic ships `gender_submission.csv`, not `sample_submission.csv`), so
    callers must read paths from here instead of hardcoding fixture names."""
    text = _read_text(path)
    current = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.strip().startswith("#"):
            continue
        if not raw.startswith(" ") and line.endswith(":"):
            current = line[:-1].strip()
            continue
        if current == section and line.strip().startswith(key + ":"):
            return _parse_scalar(line.split(":", 1)[1])
    return default
