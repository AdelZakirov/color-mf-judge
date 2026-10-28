"""Build the image pool for the pairwise study.

Picks images from ImageNet val5k (256 centre crops, the ColorMF eval protocol), copies each
method's colorization as lossless WebP (no chroma subsampling, so compression cannot favour a
method) and writes public/pool.json. Images go to public/img/, which is not committed.

Catch trials: GT against the GT with a*b* negated (blue faces, purple grass) on separate images.

Folders and pool.json use neutral codes, so participants cannot tell the methods apart from URLs;
study/methods.json maps the codes back for the analysis.
"""

import argparse
import hashlib
import json
import random
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

CMF = Path("/mnt/IMAGING/WORKSPACE/Adel/cmf")
METHODS = {
    # B+D + FD (step 25k) + distilled autoguidance w 2, omega 2: the final one-pass model
    "colormf": CMF / "val50k/bdfd_agd_w2_omega2/predictions/seed_1",
    # released DDColor checkpoint through its own pipeline at its native input 512, same 256 crops
    "ddcolor": Path("/home/AZA/Projects/side/ColorMF/ddcolor/results/val5k_crop256_pipeline_in512/predictions"),
    # CtrlColor (IJCV 2025), automatic mode, DDIM 20 steps
    "ctrlcolor": CMF / "baselines/ctrlcolor/val5k/predictions/seed_1",
}
# Catch candidates dropped by eye: the negation must be obvious (sepia, glass, mostly-beige
# objects, stock watermarks are not)
CATCH_EXCLUDE = {
    "ILSVRC2012_val_00000669", "ILSVRC2012_val_00000703", "ILSVRC2012_val_00000858",
    "ILSVRC2012_val_00002333", "ILSVRC2012_val_00002858", "ILSVRC2012_val_00003963",
    "ILSVRC2012_val_00004015", "ILSVRC2012_val_00004779",
}
HERO = "ILSVRC2012_val_00002011"  # squirrel monkey on grass, a GT photo shown on the intro screen
GT = Path("/home/AZA/Projects/side/ColorMF/data/imagenet_val5k_256")


def code(name: str, seed: int) -> str:
    return hashlib.sha256(f"{seed}:{name}".encode()).hexdigest()[:6]


def save_webp(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", lossless=True, method=6)


def negate_chroma(rgb: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.int16)
    lab[..., 1:] = 256 - lab[..., 1:]
    return cv2.cvtColor(np.clip(lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "public")
    ap.add_argument("--n", type=int, default=300)
    ap.add_argument("--n-catch", type=int, default=16)
    ap.add_argument("--min-cf", type=float, default=5.0, help="skip near-grayscale originals")
    ap.add_argument("--catch-min-cf", type=float, default=30.0, help="negation must be obvious")
    ap.add_argument("--seed", type=int, default=2026)
    args = ap.parse_args()

    manifest = json.loads((GT / "manifest.json").read_text())["images"]
    cf = {m["image_id"]: m["colorfulness_absolute"] for m in manifest}
    ids = [i for i in cf if cf[i] >= args.min_cf]
    ids = [i for i in ids if all((d / f"{i}.png").exists() for d in METHODS.values())]
    random.Random(args.seed).shuffle(ids)
    main_ids = ids[: args.n]
    catch_ids = [i for i in ids[args.n :] if cf[i] >= args.catch_min_cf and i not in CATCH_EXCLUDE]
    catch_ids = catch_ids[: args.n_catch]
    assert HERO in catch_ids

    codes = {name: code(name, args.seed) for name in [*METHODS, "gt", "negated"]}
    img = args.out / "img"
    for i in main_ids:
        for name, src in METHODS.items():
            save_webp(Image.open(src / f"{i}.png").convert("RGB"), img / codes[name] / f"{i}.webp")
    for i in catch_ids:
        rgb = np.array(Image.open(GT / "rgb" / f"{i}.png").convert("RGB"))
        save_webp(Image.fromarray(rgb), img / codes["gt"] / f"{i}.webp")
        save_webp(Image.fromarray(negate_chroma(rgb)), img / codes["negated"] / f"{i}.webp")

    version = f"val5k-cf{args.min_cf:g}-n{args.n}-seed{args.seed}"
    pool = {
        "version": version,
        "methods": [codes[m] for m in METHODS],
        "images": sorted(main_ids),
        # catch pair: [real, negated]
        "catch": {"methods": [codes["gt"], codes["negated"]], "images": sorted(catch_ids)},
        "hero": HERO,
    }
    (args.out / "pool.json").write_text(json.dumps(pool, indent=1))
    study = Path(__file__).resolve().parents[1] / "study"
    study.mkdir(exist_ok=True)
    sources = {**{m: str(p) for m, p in METHODS.items()}, "gt": str(GT / "rgb"), "negated": "GT, a*b* negated"}
    (study / "methods.json").write_text(json.dumps(
        {"pool": version, "codes": {c: m for m, c in codes.items()}, "sources": sources}, indent=1))
    print(f"{len(main_ids)} images x {len(METHODS)} methods, {len(catch_ids)} catch -> {args.out}")


if __name__ == "__main__":
    main()
