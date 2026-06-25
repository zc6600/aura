#!/usr/bin/env python3
import argparse
import json
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


def patch_params(path: Path, area: str, budget: int, mode: str) -> None:
    text = path.read_text(encoding="utf-8")
    text = text.replace('mode: "offline"', f'mode: "{mode}"')
    text = text.replace('area: "one-north"', f'area: "{area}"')
    text = text.replace("max_budget_sgd: 4200", f"max_budget_sgd: {budget}")
    path.write_text(text, encoding="utf-8")


def write_offline_fixture(workspace: Path, force: bool) -> None:
    path = workspace / "data/rental_listings/sample_99co_singapore.json"
    if path.exists() and not force:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = [
        {
            "title": "Lentor Modern / Lentor Modern Mall",
            "address": "3 Lentor Central, 788888",
            "price_sgd": 4200,
            "bedrooms": 2,
            "bathrooms": 1,
            "size_sqft": 678,
            "property_type": "Apartment",
            "furnishing": "Partially furnished",
            "mrt": "Lentor MRT",
            "mrt_minutes": 3,
            "tags": ["Near MRT Station", "Move-In Ready", "Near Mall"],
            "source": "offline fixture modeled after public 99.co listing fields",
        },
        {
            "title": "The Linc",
            "address": "7 Lincoln Road, 308346",
            "price_sgd": 1550,
            "bedrooms": 0,
            "bathrooms": None,
            "size_sqft": 110,
            "property_type": "Common Room",
            "furnishing": "Fully furnished",
            "mrt": "Newton MRT",
            "mrt_minutes": 7,
            "tags": ["No Landlord Stay", "Near MRT Station", "Cooking Allowed"],
            "source": "offline fixture modeled after public 99.co listing fields",
        },
        {
            "title": "Rochester Residences",
            "address": "33 Rochester Drive, 138638",
            "price_sgd": 4100,
            "bedrooms": 1,
            "bathrooms": 1,
            "size_sqft": 506,
            "property_type": "Condo",
            "furnishing": "Fully furnished",
            "mrt": "Buona Vista MRT",
            "mrt_minutes": 5,
            "tags": ["Near MRT Station", "Near one-north", "Gymnasium"],
            "source": "offline fixture",
        },
        {
            "title": "Heritage View",
            "address": "6 Dover Rise, 138678",
            "price_sgd": 3900,
            "bedrooms": 1,
            "bathrooms": 1,
            "size_sqft": 600,
            "property_type": "Condo",
            "furnishing": "Partially furnished",
            "mrt": "one-north MRT",
            "mrt_minutes": 8,
            "tags": ["Near MRT Station", "Quiet", "Pool"],
            "source": "offline fixture",
        },
    ]
    path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    path.with_suffix(path.suffix + ".hint").write_text(
        "Offline Rental Advisor fixture with 99.co-style Singapore rental fields.\n",
        encoding="utf-8",
    )


def ensure_dirs(workspace: Path) -> None:
    for rel in ["data/rental_listings", "reports", "knowledge"]:
        (workspace / rel).mkdir(parents=True, exist_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Copy Rental Advisor use-case files into an Aura workspace."
    )
    parser.add_argument("--workspace", default=".", help="Target Aura workspace.")
    parser.add_argument("--area", default="one-north", help="Preferred area.")
    parser.add_argument("--budget", type=int, default=4200, help="Monthly budget in SGD.")
    parser.add_argument("--mode", choices=["offline", "live"], default="offline")
    parser.add_argument("--force", action="store_true", help="Overwrite files.")
    args = parser.parse_args()

    workspace = Path(args.workspace).expanduser().resolve()
    if not (workspace / ".aura-workspace").is_dir():
        raise SystemExit(
            f"{workspace} is not an Aura workspace. Run: aura new {workspace}"
        )
    if not TEMPLATE.is_dir() or not TOOLS.is_dir():
        raise SystemExit("Rental Advisor package is incomplete: missing template/ or tools/.")

    ensure_dirs(workspace)
    actions = []
    actions.extend(copy_tree(TEMPLATE, workspace, args.force))
    actions.extend(copy_tree(TOOLS, workspace / "tools", args.force))
    patch_params(workspace / "params/rental_advisor.yml", args.area, args.budget, args.mode)
    if args.mode == "offline":
        write_offline_fixture(workspace, args.force)

    print("Rental Advisor files copied.")
    for action in actions:
        print(f"- {action}")
    print("\nNext:")
    print("  aura workflow doctor")
    print(
        "  aura kernel run_call rental_search "
        '\'{"action":"search","area":"one-north","max_budget":4200,"bedrooms":1}\''
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

