#!/usr/bin/env python3
import argparse
import csv
import os
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "template"
TOOLS = ROOT / "tools"


def copy_file(src: Path, dst: Path, force: bool) -> str:
    if dst.exists() and not force:
        return f"skip {dst}"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)
    return f"write {dst}"


def copy_tree(src_root: Path, dst_root: Path, force: bool) -> list[str]:
    actions: list[str] = []
    for src in sorted(p for p in src_root.rglob("*") if p.is_file()):
        if "__pycache__" in src.parts or src.suffix == ".pyc":
            continue
        rel = src.relative_to(src_root)
        actions.append(copy_file(src, dst_root / rel, force))
    return actions


def patch_params(path: Path, slug: str, mode: str) -> None:
    text = path.read_text(encoding="utf-8")
    text = text.replace('slug: ""', f'slug: "{slug}"')
    text = text.replace('title: ""', f'title: "{slug}"')
    text = text.replace('mode: "offline"', f'mode: "{mode}"')
    path.write_text(text, encoding="utf-8")


def write_csv(path: Path, header: list[str], rows: list[list[object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)
    path.with_suffix(path.suffix + ".hint").write_text(
        f"Small offline AutoKaggle fixture: {path.name}\n",
        encoding="utf-8",
    )


def write_offline_fixture(workspace: Path, force: bool) -> None:
    files = [
        (
            workspace / "data/raw/train.csv",
            ["id", "x1", "x2", "target"],
            [
                [1, 0.1, 1.0, 0],
                [2, 0.2, 0.9, 0],
                [3, 0.8, 0.1, 1],
                [4, 0.9, 0.2, 1],
                [5, 0.4, 0.7, 0],
                [6, 0.7, 0.3, 1],
            ],
        ),
        (
            workspace / "data/raw/test.csv",
            ["id", "x1", "x2"],
            [[7, 0.15, 0.95], [8, 0.85, 0.15], [9, 0.45, 0.55]],
        ),
        (
            workspace / "data/raw/sample_submission.csv",
            ["id", "target"],
            [[7, 0], [8, 0], [9, 0]],
        ),
    ]
    for path, header, rows in files:
        if path.exists() and not force:
            continue
        write_csv(path, header, rows)


def ensure_dirs(workspace: Path) -> None:
    for rel in [
        "data/raw",
        "data/processed",
        "experiments/artifacts",
        "reports",
        "submissions",
        "knowledge",
    ]:
        (workspace / rel).mkdir(parents=True, exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Copy AutoKaggle use-case files into an Aura workspace."
    )
    parser.add_argument("--workspace", default=".", help="Target Aura workspace.")
    parser.add_argument("--slug", required=True, help="Kaggle competition slug.")
    parser.add_argument("--mode", choices=["offline", "kaggle"], default="offline")
    parser.add_argument("--force", action="store_true", help="Overwrite files.")
    args = parser.parse_args()

    workspace = Path(args.workspace).expanduser().resolve()
    if not (workspace / ".aura-workspace").is_dir():
        raise SystemExit(
            f"{workspace} is not an Aura workspace. Run: aura new {workspace}"
        )
    if not TEMPLATE.is_dir() or not TOOLS.is_dir():
        raise SystemExit("AutoKaggle package is incomplete: missing template/ or tools/.")

    ensure_dirs(workspace)
    actions = []
    actions.extend(copy_tree(TEMPLATE, workspace, args.force))
    actions.extend(copy_tree(TOOLS, workspace / "tools", args.force))
    patch_params(workspace / "params/autokaggle.yml", args.slug, args.mode)
    if args.mode == "offline":
        write_offline_fixture(workspace, args.force)

    print("AutoKaggle files copied.")
    for action in actions:
        print(f"- {action}")
    print("\nNext:")
    print("  aura workflow doctor")
    print("  python src/train_candidate.py --run-id baseline_001")
    print(
        "  aura kernel run_call ak_submit_guard "
        '\'{"action":"validate","submission_path":"submissions/baseline_001.csv","run_id":"baseline_001","dry_run":true}\''
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
