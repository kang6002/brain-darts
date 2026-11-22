"""Download the Allen CCFv3 (mouse, 25 um) and export game data for the web app.

Run from the pipeline/ folder:
    python build_atlas.py

Downloads go to pipeline/cache/ (once). Output goes to web/public/data/:
    structures.json      the region tree (index, id, acronym, name, parent, depth, color)
    slices.json          per-slice metadata, region areas/centroids, quiz targets
    coronal_XXX.png      background image (average template, 8-bit grayscale)
    coronal_XXX.bin.gz   label map: gzip of uint16 little-endian, one structure index per pixel

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
API = "https://api.brain-map.org/api/v2/data/query.json"


def structure_set_url(set_id: int) -> str:
    return (f"{API}?criteria=model::Structure,rma::criteria,structure_sets[id$eq{set_id}]"
            "&num_rows=all&only=id,acronym,name")


# Allen curated structure sets (listed with model::StructureSet, checked 2026-11-22).
SET_AREAS = 3                     # "Mouse - Areas": 51 areal-level structures
SET_SUMMARY = 167587189           # "Brain – Summary Structures": 316, nuclei / cortical areas

SOURCES = {
    "ontology.json": "https://api.brain-map.org/api/v2/structure_graph_download/1.json",
    "annotation_25.nrrd": f"{CCF}/annotation/ccf_2017/annotation_25.nrrd",
    "average_template_25.nrrd": f"{CCF}/average_template/average_template_25.nrrd",
    f"structure_set_{SET_AREAS}.json": structure_set_url(SET_AREAS),
    f"structure_set_{SET_SUMMARY}.json": structure_set_url(SET_SUMMARY),
}

RESOLUTION_MM = 0.025
N_CORONAL_SLICES = 36

# Easy mode: Allen's 12 "Brain - Major Divisions" (set 687527670) plus fiber
# tracts and the ventricles, which exams also ask about.
EASY_ACRONYMS = ["Isocortex", "OLF", "HPF", "CTXsp", "STR", "PAL", "TH", "HY",
                 "MB", "P", "MY", "CB", "fiber tracts", "VS"]

# Summary-set entries that make poor hard-mode questions:
#  - "fiber tracts": the whole white matter as one entry (it is in easy mode instead)
#  - "..., unassigned": annotation leftovers Allen could not assign to a subfield
HARD_EXCLUDE_ACRONYMS = {"fiber tracts"}
HARD_EXCLUDE_NAME_SUFFIX = ", unassigned"

# Smallest area (mm²) a region must cover on a slice to be asked there.
# 0.1 mm² at 25 µm is 160 pixels, about 25×25 screen pixels at default size.
MIN_TARGET_AREA_MM2 = {"easy": 0.5, "medium": 0.3, "hard": 0.1}


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
    candidates = {
        "easy": [by_acronym[a] for a in EASY_ACRONYMS],
        "medium": lib.structure_set_indices(
            json.loads(download(f"structure_set_{SET_AREAS}.json").read_text()), id_to_index),
        "hard": lib.structure_set_indices(
            json.loads(download(f"structure_set_{SET_SUMMARY}.json").read_text()), id_to_index),
    }
    excluded = [i for i in candidates["hard"]
                if structures[i]["acronym"] in HARD_EXCLUDE_ACRONYMS
                or structures[i]["name"].endswith(HARD_EXCLUDE_NAME_SUFFIX)]
    candidates["hard"] = [i for i in candidates["hard"] if i not in excluded]
    print("excluded from hard: " + ", ".join(structures[i]["name"] for i in excluded))
    print("candidate targets: " + ", ".join(f"{k} {len(v)}" for k, v in candidates.items()))

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
    for old in OUT.glob("coronal_*"):
        old.unlink()

    slices = []
    for ap in positions:
        # Coronal slice: rows = dorsal->ventral (y), columns = left->right (x).
        label_slice = labels[ap]
        height, width = label_slice.shape
        name = f"coronal_{ap:03d}"
        Image.fromarray(lib.to_uint8(template[ap], low, high), mode="L").save(OUT / f"{name}.png")
        lib.write_label_bin(OUT / f"{name}.bin.gz", label_slice)

        stats = lib.region_stats(label_slice, structures)
        targets = {
            level: lib.targets_for_slice(stats, candidates[level], MIN_TARGET_AREA_MM2[level] / RESOLUTION_MM**2)
            for level in candidates
        }
        slices.append({
            "id": name,
            "plane": "coronal",
            "index": ap,
            "apMm": round(ap * RESOLUTION_MM, 3),
            "width": width,
            "height": height,
            "mmPerPixel": RESOLUTION_MM,
            "image": f"{name}.png",
            "labels": f"{name}.bin.gz",
            "regions": f"{name}.regions.json",
            "targets": targets,
        })
        # Areas and centroids of every region on the slice. Kept out of
        # slices.json so the game's first download stays small.
        (OUT / f"{name}.regions.json").write_text(
            json.dumps({str(i): v for i, v in stats.items()}, separators=(",", ":")))
        print(f"{name}: AP {ap * RESOLUTION_MM:5.2f} mm, targets "
              + " ".join(f"{level}={len(t):3d}" for level, t in targets.items())
              + "  easy: " + ", ".join(structures[i]["acronym"] for i in targets["easy"]))

    (OUT / "structures.json").write_text(json.dumps(structures, separators=(",", ":")))
    (OUT / "slices.json").write_text(json.dumps({
        "source": {
            "atlas": "Allen Mouse Brain Common Coordinate Framework v3 (CCFv3), 2017 annotation",
            "files": SOURCES,
            "resolutionMm": RESOLUTION_MM,
            "axes": "volume stored as (anterior->posterior, dorsal->ventral, left->right)",
            "apMm": "distance from the anterior edge of the CCF volume, not from bregma",
            "levels": {"medium": f"Allen structure set {SET_AREAS}",
                       "hard": f"Allen structure set {SET_SUMMARY} minus exclusions"},
        },
        # Every region of each difficulty (before the per-slice size filter).
        # The game uses it to say which region of that level a click fell in.
        "levels": candidates,
        "slices": slices,
    }, indent=1))
    print(f"wrote {len(slices)} slices to {OUT}")


if __name__ == "__main__":
    main()
