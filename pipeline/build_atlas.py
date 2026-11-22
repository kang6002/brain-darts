"""Download the Allen CCFv3 (mouse, 25 um) and export game data for the web app.

Run from the pipeline/ folder:
    python build_atlas.py

Downloads go to pipeline/cache/ (once). Output goes to web/public/data/:
    structures.json      the region tree (index, id, acronym, name, parent, depth, color)
    slices.json          per-slice metadata, region areas/centroids, quiz targets
    coronal_XXX.png      background image (average template, 8-bit grayscale)
    coronal_XXX.bin      label map: uint16 little-endian, one structure index per pixel

Data sources (verified 2026-11-22, see CLAUDE.md):
    https://api.brain-map.org/api/v2/structure_graph_download/1.json
    https://download.alleninstitute.org/informatics-archive/current-release/mouse_ccf/...
"""

from __future__ import annotations

import json
import shutil
import ssl
import sys
import urllib.request
from pathlib import Path

import certifi
import nrrd
import numpy as np
from PIL import Image

import atlas_lib as lib

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
OUT = HERE.parent / "web" / "public" / "data"

CCF = "https://download.alleninstitute.org/informatics-archive/current-release/mouse_ccf"
SOURCES = {
    "ontology.json": "https://api.brain-map.org/api/v2/structure_graph_download/1.json",
    "annotation_25.nrrd": f"{CCF}/annotation/ccf_2017/annotation_25.nrrd",
    "average_template_25.nrrd": f"{CCF}/average_template/average_template_25.nrrd",
}

RESOLUTION_MM = 0.025
N_CORONAL_SLICES = 10

# Easy mode: major divisions a first-year course expects you to know.
# Chosen by hand because depth in the Allen tree does not match region size
# (CB is at depth 2, TH at depth 4, Isocortex at depth 5).
EASY_ACRONYMS = ["Isocortex", "OLF", "HPF", "CTXsp", "STR", "PAL", "TH", "HY",
                 "MB", "P", "MY", "CB", "fiber tracts", "VS"]
MIN_TARGET_AREA_MM2 = 0.5


def download(name: str) -> Path:
    path = CACHE / name
    if path.exists():
        return path
    CACHE.mkdir(exist_ok=True)
    url = SOURCES[name]
    print(f"downloading {url}")
    tmp = path.with_suffix(path.suffix + ".part")
    # certifi supplies trusted root certificates; the python.org macOS
    # installer does not set them up by default (CERTIFICATE_VERIFY_FAILED).
    context = ssl.create_default_context(cafile=certifi.where())
    with urllib.request.urlopen(url, context=context) as response, open(tmp, "wb") as f:
        shutil.copyfileobj(response, f)
    tmp.rename(path)
    return path


def check_orientation(annotation: np.ndarray, structures: list[dict]) -> None:
    """Stop if the volume is not stored as (AP, DV, LR).

    The NRRD header claims "left-posterior-superior", which is known to be
    wrong for these files, so we check the anatomy directly instead.
    """
    def mean_position(acronym: str) -> np.ndarray:
        ids = np.array(sorted(lib.descendant_ids(acronym, structures)))
        coords = np.argwhere(np.isin(annotation, ids))
        return coords.mean(axis=0)

    mob, cb = mean_position("MOB"), mean_position("CB")
    iso, hy = mean_position("Isocortex"), mean_position("HY")
    problems = []
    if not mob[0] < cb[0]:
        problems.append(f"axis 0 is not anterior->posterior (MOB {mob[0]:.0f}, CB {cb[0]:.0f})")
    if not iso[1] < hy[1]:
        problems.append(f"axis 1 is not dorsal->ventral (Isocortex {iso[1]:.0f}, HY {hy[1]:.0f})")
    # Left/right: the labels should be (almost) mirror-symmetric along axis 2.
    mirrored = annotation[:, :, ::-1]
    inside = annotation > 0
    symmetry = float((annotation[inside] == mirrored[inside]).mean())
    if symmetry < 0.9:
        problems.append(f"axis 2 is not left-right symmetric ({symmetry:.1%} of labels match)")
    if problems:
        sys.exit("Orientation check failed:\n  " + "\n  ".join(problems))
    print(f"orientation OK: axis0 A->P, axis1 D->V, axis2 L-R "
          f"(mirror symmetry {symmetry:.1%})")


def main() -> None:
    ontology = json.loads(download("ontology.json").read_text())
    if not ontology.get("success"):
        sys.exit("ontology download did not report success")
    structures = lib.flatten_ontology(ontology["msg"][0])
    id_to_index = lib.id_to_index_map(structures)
    by_acronym = {s["acronym"]: s["index"] for s in structures}
    missing = [a for a in EASY_ACRONYMS if a not in by_acronym]
    if missing:
        sys.exit(f"easy-mode acronyms not in ontology: {missing}")

    annotation, ann_header = nrrd.read(str(download("annotation_25.nrrd")))
    template, _ = nrrd.read(str(download("average_template_25.nrrd")))
    print(f"annotation {annotation.shape} {annotation.dtype}, template {template.shape} {template.dtype}")
    print(f"NRRD header says space = {ann_header.get('space')!r} (ignored, checked below)")
    if annotation.shape != template.shape:
        sys.exit("annotation and template shapes differ")
    check_orientation(annotation, structures)

    labels = lib.remap_labels(annotation, id_to_index)  # (AP, DV, LR) uint16
    brain = labels != lib.OUTSIDE
    low, high = lib.contrast_limits(template, brain)
    area_per_ap = brain.sum(axis=(1, 2))
    positions = lib.pick_slices(area_per_ap, N_CORONAL_SLICES)

    OUT.mkdir(parents=True, exist_ok=True)
    for old in list(OUT.glob("coronal_*.png")) + list(OUT.glob("coronal_*.bin")):
        old.unlink()

    min_area_px = MIN_TARGET_AREA_MM2 / RESOLUTION_MM**2
    easy_indices = [by_acronym[a] for a in EASY_ACRONYMS]
    slices = []
    for ap in positions:
        # Coronal slice: rows = dorsal->ventral (y), columns = left->right (x).
        label_slice = labels[ap]
        height, width = label_slice.shape
        name = f"coronal_{ap:03d}"
        Image.fromarray(lib.to_uint8(template[ap], low, high), mode="L").save(OUT / f"{name}.png")
        lib.write_label_bin(OUT / f"{name}.bin", label_slice)

        stats = lib.region_stats(label_slice, structures)
        targets = [i for i in easy_indices if stats.get(i, {}).get("areaPx", 0) >= min_area_px]
        slices.append({
            "id": name,
            "plane": "coronal",
            "index": ap,
            "apMm": round(ap * RESOLUTION_MM, 3),
            "width": width,
            "height": height,
            "mmPerPixel": RESOLUTION_MM,
            "image": f"{name}.png",
            "labels": f"{name}.bin",
            "targets": {"easy": targets},
            "regions": {str(i): v for i, v in stats.items()},
        })
        print(f"{name}: AP {ap * RESOLUTION_MM:5.2f} mm, easy targets: "
              + ", ".join(structures[i]["acronym"] for i in targets))

    (OUT / "structures.json").write_text(json.dumps(structures, separators=(",", ":")))
    (OUT / "slices.json").write_text(json.dumps({
        "source": {
            "atlas": "Allen Mouse Brain Common Coordinate Framework v3 (CCFv3), 2017 annotation",
            "files": SOURCES,
            "resolutionMm": RESOLUTION_MM,
            "axes": "volume stored as (anterior->posterior, dorsal->ventral, left->right)",
            "apMm": "distance from the anterior edge of the CCF volume, not from bregma",
        },
        "slices": slices,
    }, indent=1))
    print(f"wrote {len(slices)} slices to {OUT}")


if __name__ == "__main__":
    main()
