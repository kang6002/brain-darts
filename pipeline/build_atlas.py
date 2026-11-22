"""Download the Allen CCFv3 (mouse) and export game data for the web app.

Run from the pipeline/ folder:
    python build_atlas.py

Downloads go to pipeline/cache/ (once, ~410 MB). Output goes to web/public/data/:
    structures.json                  the region tree (index, id, acronym, name, parent, depth, color)
    slices.json                      per-slice metadata, quiz targets, difficulty levels
    coronal_XXX_25um.png / _10um.png background image (average template, 8-bit grayscale)
    coronal_XXX_25um.bin.gz / ...    label map: gzip of uint16 little-endian, one structure index per pixel
    coronal_XXX.regions.json         area + centroid of every region on the slice (25 µm)

Two resolutions of the same slices:
    25 µm: small files ("Light" quality). Also used to choose slices, check the
           orientation, and decide which regions can be asked on each slice.
    10 µm: 2.5× sharper ("Sharp" quality). Read slice by slice from the huge
           10 µm volumes with stream_nrrd.py, then checked against 25 µm.

Data sources (verified 2026-11-22, see CLAUDE.md):
    https://api.brain-map.org/api/v2/structure_graph_download/1.json
    https://api.brain-map.org/api/v2/data/query.json (structure sets)
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
from stream_nrrd import read_coronal_slices

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
    "annotation_10.nrrd": f"{CCF}/annotation/ccf_2017/annotation_10.nrrd",
    "average_template_10.nrrd": f"{CCF}/average_template/average_template_10.nrrd",
    f"structure_set_{SET_AREAS}.json": structure_set_url(SET_AREAS),
    f"structure_set_{SET_SUMMARY}.json": structure_set_url(SET_SUMMARY),
}

N_CORONAL_SLICES = 36

# Easy mode: Allen's 12 "Brain - Major Divisions" (set 687527670) plus fiber
# tracts and the ventricles, which exams also ask about.
EASY_ACRONYMS = ["Isocortex", "OLF", "HPF", "CTXsp", "STR", "PAL", "TH", "HY",
                 "MB", "P", "MY", "CB", "fiber tracts", "VS"]

# Medium mode: Allen's "Mouse - Areas" set PLUS these classic exam nuclei
# (all are Allen summary structures, so the same regions as in hard mode).
MEDIUM_NUCLEI = [
    # thalamus
    "LGd", "MG", "VPM", "VPL", "MD", "AV", "RT", "LP", "PVT",
    # hypothalamus
    "PVH", "ARH", "VMH", "DMH", "SCH", "LHA", "MM", "SO", "ZI",
    # midbrain
    "SCs", "SCm", "IC", "PAG", "VTA", "SNr", "SNc", "RN", "IPN", "DR", "III",
    # pons
    "PG", "PB", "LC", "V", "PSV", "SOC",
    # medulla
    "NTS", "IO", "VII", "XII", "DMX", "AMB", "CU", "GR", "MV",
    # basal ganglia, septum, amygdala
    "CP", "ACB", "OT", "GPe", "GPi", "MS", "BST", "BLA", "CEA",
    # hippocampus, cerebellar nuclei, olfactory, claustrum
    "CA1", "CA3", "SUB", "FN", "IP", "DN", "MOB", "PIR", "CLA",
]

# Summary-set entries that make poor hard-mode questions:
#  - "fiber tracts": the whole white matter as one entry (it is in easy mode instead)
#  - "..., unassigned": annotation leftovers Allen could not assign to a subfield
HARD_EXCLUDE_ACRONYMS = {"fiber tracts"}
HARD_EXCLUDE_NAME_SUFFIX = ", unassigned"

# Smallest area (mm²) a region must cover on a slice to be asked there, so we
# never ask for a thin sliver at the edge of a region's extent.
MIN_TARGET_AREA_MM2 = {"easy": 0.5, "medium": 0.3, "hard": 0.05}
# Nuclei are small by nature (PVH, LC, SCH never reach 0.3 mm²), so the
# MEDIUM_NUCLEI use the same limit as hard mode. 0.05 mm² is ~18×18 screen
# pixels at the default size: small but fair to click.
MIN_NUCLEUS_AREA_MM2 = 0.05

# The two resolutions. Slices are picked at even 25 µm indices so that the
# 10 µm index (2.5 × the 25 µm index) is a whole number: the same position.
RES = {"25um": 0.025, "10um": 0.010}


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


def load_candidates(structures: list[dict], id_to_index: dict[int, int]) -> dict[str, dict[int, float]]:
    """For each difficulty: {structure index: minimum area in mm²}."""
    by_acronym = {s["acronym"]: s["index"] for s in structures}
    missing = [a for a in EASY_ACRONYMS + MEDIUM_NUCLEI if a not in by_acronym]
    if missing:
        sys.exit(f"acronyms not in ontology: {missing}")

    areas = lib.structure_set_indices(
        json.loads(download(f"structure_set_{SET_AREAS}.json").read_text()), id_to_index)
    summary = lib.structure_set_indices(
        json.loads(download(f"structure_set_{SET_SUMMARY}.json").read_text()), id_to_index)
    excluded = [i for i in summary
                if structures[i]["acronym"] in HARD_EXCLUDE_ACRONYMS
                or structures[i]["name"].endswith(HARD_EXCLUDE_NAME_SUFFIX)]
    print("excluded from hard: " + ", ".join(structures[i]["name"] for i in excluded))

    medium = {i: MIN_TARGET_AREA_MM2["medium"] for i in areas}
    for acronym in MEDIUM_NUCLEI:
        medium.setdefault(by_acronym[acronym], MIN_NUCLEUS_AREA_MM2)
    candidates = {
        "easy": {by_acronym[a]: MIN_TARGET_AREA_MM2["easy"] for a in EASY_ACRONYMS},
        "medium": medium,
        "hard": {i: MIN_TARGET_AREA_MM2["hard"] for i in summary if i not in excluded},
    }
    print("candidate targets: " + ", ".join(f"{k} {len(v)}" for k, v in candidates.items()))
    return candidates


def check_alignment(labels25: np.ndarray, labels10: np.ndarray, name: str) -> float:
    """Fraction of 25 µm brain pixels whose label matches the 10 µm label at the same spot.

    Exits if they disagree a lot, which would mean the slices are not at the
    same position or the axes differ. Some disagreement is normal: the 25 µm
    labels are a downsampled version, so region edges move by a pixel.
    """
    height, width = labels25.shape
    ys = np.minimum(((np.arange(height) + 0.5) * 2.5).astype(int), labels10.shape[0] - 1)
    xs = np.minimum(((np.arange(width) + 0.5) * 2.5).astype(int), labels10.shape[1] - 1)
    sampled = labels10[np.ix_(ys, xs)]
    brain = labels25 != lib.OUTSIDE
    agreement = float((sampled[brain] == labels25[brain]).mean())
    if agreement < 0.8:
        sys.exit(f"{name}: 10 µm and 25 µm labels agree on only {agreement:.1%} of pixels")
    return agreement


def save_variant(name: str, res: str, template: np.ndarray, labels: np.ndarray,
                 low: float, high: float) -> dict:
    Image.fromarray(lib.to_uint8(template, low, high), mode="L").save(OUT / f"{name}_{res}.png", optimize=True)
    lib.write_label_bin(OUT / f"{name}_{res}.bin.gz", labels)
    height, width = labels.shape
    return {"width": width, "height": height, "mmPerPixel": RES[res],
            "image": f"{name}_{res}.png", "labels": f"{name}_{res}.bin.gz"}


def main() -> None:
    ontology = json.loads(download("ontology.json").read_text())
    if not ontology.get("success"):
        sys.exit("ontology download did not report success")
    structures = lib.flatten_ontology(ontology["msg"][0])
    id_to_index = lib.id_to_index_map(structures)
    candidates = load_candidates(structures, id_to_index)

    # --- 25 µm: whole volume (small enough to load) ---
    annotation, ann_header = nrrd.read(str(download("annotation_25.nrrd")))
    template, _ = nrrd.read(str(download("average_template_25.nrrd")))
    print(f"25 µm: annotation {annotation.shape} {annotation.dtype}, template {template.shape} {template.dtype}")
    print(f"NRRD header says space = {ann_header.get('space')!r} (ignored, checked below)")
    if annotation.shape != template.shape:
        sys.exit("annotation and template shapes differ")
    check_orientation(annotation, structures)

    labels = lib.remap_labels(annotation, id_to_index)  # (AP, DV, LR) uint16
    brain = labels != lib.OUTSIDE
    low25, high25 = lib.contrast_limits(template, brain)
    positions = lib.pick_slices(brain.sum(axis=(1, 2)), N_CORONAL_SLICES)
    positions = sorted({2 * round(p / 2) for p in positions})  # even → whole 10 µm index
    if positions[-1] >= labels.shape[0]:
        positions[-1] -= 2

    # --- 10 µm: only the chosen slices, streamed from the big files ---
    ap10 = [p * 5 // 2 for p in positions]
    print(f"10 µm: reading {len(ap10)} slices from the annotation (4.8 GB unzipped)…")
    ann10, header10 = read_coronal_slices(download("annotation_10.nrrd"), ap10)
    print(f"10 µm: annotation sizes {header10['sizes']}, slices {ann10.shape}; reading template (2.4 GB unzipped)…")
    tpl10, _ = read_coronal_slices(download("average_template_10.nrrd"), ap10)
    labels10 = lib.remap_labels(ann10, id_to_index)
    low10, high10 = lib.contrast_limits(tpl10, labels10 != lib.OUTSIDE)

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("coronal_*"):
        old.unlink()

    slices = []
    best_area: dict[int, tuple[int, str]] = {}  # region -> (largest area, slice id)
    level_regions = set().union(*candidates.values())
    for k, ap in enumerate(positions):
        # Coronal slice: rows = dorsal->ventral (y), columns = left->right (x).
        name = f"coronal_{ap:03d}"
        l25, l10 = labels[ap], labels10[k]
        agreement = check_alignment(l25, l10, name)

        stats = lib.region_stats(l25, structures)
        targets = {
            level: [i for i, min_mm2 in sorted(regions.items())
                    if stats.get(i, {}).get("areaPx", 0) >= min_mm2 / RES["25um"] ** 2]
            for level, regions in candidates.items()
        }
        present10 = lib.region_stats(l10, structures)
        lost = [structures[i]["acronym"] for t in targets.values() for i in t if i not in present10]
        if lost:
            sys.exit(f"{name}: targets missing from the 10 µm slice: {lost}")

        for i in level_regions & stats.keys():
            if stats[i]["areaPx"] > best_area.get(i, (0, ""))[0]:
                best_area[i] = (stats[i]["areaPx"], name)

        slices.append({
            "id": name,
            "plane": "coronal",
            "index": ap,
            "apMm": round(ap * RES["25um"], 3),
            "variants": {
                "25um": save_variant(name, "25um", template[ap], l25, low25, high25),
                "10um": save_variant(name, "10um", tpl10[k], l10, low10, high10),
            },
            "regions": f"{name}.regions.json",
            "targets": targets,
        })
        # Areas and centroids of every region on the slice. Kept out of
        # slices.json so the game's first download stays small.
        (OUT / f"{name}.regions.json").write_text(
            json.dumps({str(i): v for i, v in stats.items()}, separators=(",", ":")))
        print(f"{name}: AP {ap * RES['25um']:5.2f} mm, 10/25 µm agreement {agreement:.1%}, targets "
              + " ".join(f"{level}={len(t):3d}" for level, t in targets.items()))

    never = [structures[i]["acronym"] for i in candidates["medium"]
             if not any(i in s["targets"]["medium"] for s in slices)]
    print("medium regions never big enough to ask: " + (", ".join(never) or "none"))

    (OUT / "structures.json").write_text(json.dumps(structures, separators=(",", ":")))
    (OUT / "slices.json").write_text(json.dumps({
        "source": {
            "atlas": "Allen Mouse Brain Common Coordinate Framework v3 (CCFv3), 2017 annotation",
            "files": SOURCES,
            "axes": "volume stored as (anterior->posterior, dorsal->ventral, left->right)",
            "apMm": "distance from the anterior edge of the CCF volume, not from bregma",
            "levels": {"medium": f"Allen structure set {SET_AREAS} + MEDIUM_NUCLEI",
                       "hard": f"Allen structure set {SET_SUMMARY} minus exclusions"},
        },
        # Every region of each difficulty (before the per-slice size filter).
        # The game uses it to say which region of that level a click fell in.
        "levels": {level: sorted(regions) for level, regions in candidates.items()},
        # For study-mode search: the slice where each region is largest.
        "bestSlice": {str(i): best_area[i][1] for i in sorted(best_area)},
        "slices": slices,
    }, indent=1))
    print(f"wrote {len(slices)} slices to {OUT}")


if __name__ == "__main__":
    main()
