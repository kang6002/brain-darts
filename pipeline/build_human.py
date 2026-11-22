"""Download the Allen Human Reference Atlas plates and export game data.

Run from the pipeline/ folder:
    python build_human.py download   # only download (cached in cache/human/)
    python build_human.py            # download if needed, then export

Source (verified 2026-11-22, see CLAUDE.md): Allen API atlas 138322605
"Human, 34 years, Cortex - Gyral" (atlas 265297126 "Mod. Brodmann" uses the
same images). 106 annotated coronal Nissl plates of one adult brain, with
region outlines as SVG. Structure ids belong to structure graph 16.
"""

from __future__ import annotations

import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

import atlas_lib as lib
from human_lib import rasterize, read_outlines
from net import fetch

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache" / "human"
OUT = HERE.parent / "web" / "public" / "data" / "human"

API = "https://api.brain-map.org/api/v2"
ATLAS_ID = 138322605
ONTOLOGY_URL = f"{API}/structure_graph_download/16.json"
IMAGES_URL = (f"{API}/data/query.json?criteria=model::AtlasImage,rma::criteria,[annotated$eqtrue],"
              f"atlas_data_set(atlases[id$eq{ATLAS_ID}])&num_rows=all")
SECTION_THICKNESS_UM = 50.0  # AtlasDataSet 100149965

# SVG annotation groups ("graphic group labels") of the Developing Human set,
# whose structure ids are in graph 16. The "Atlas - Human ..." groups in the
# same SVG use a different ontology and are not downloaded.
GROUP_MAIN = 31  # "Atlas - Developing Human": deep structures, hippocampus, ...
GROUP_GYRI = 113753815  # "Atlas - Developing Human Gyri"
GROUP_BRODMANN = 265297118  # "Atlas - Developing Human Brodmann"
GROUP_SULCI = 113753816  # "Atlas - Developing Human Sulci"
GROUP_HOTSPOTS = 141667008  # "Atlas - Developing Human Hotspots"
SVG_GROUPS = [GROUP_MAIN, GROUP_GYRI, GROUP_BRODMANN, GROUP_SULCI, GROUP_HOTSPOTS]

# Image sizes: the API's "downsample" halves the size per step.
# 6 → 1/64 of full size (~1144×1558 for a middle plate) = "Sharp"
# 7 → 1/128 = "Light"
DOWNSAMPLE = {"sharp": 6, "light": 7}


def plate_list() -> list[dict]:
    data = json.loads(fetch(IMAGES_URL, CACHE / "plates.json").read_text())
    if not data.get("success"):
        sys.exit("plate list query did not report success")
    return sorted(data["msg"], key=lambda r: r["section_number"])


def download_plate(plate: dict) -> None:
    pid = plate["id"]
    groups = ",".join(str(g) for g in SVG_GROUPS)
    fetch(f"{API}/svg_download/{pid}?groups={groups}", CACHE / f"{pid}.svg", quiet=True)
    for ds in DOWNSAMPLE.values():
        fetch(f"{API}/image_download/{pid}?downsample={ds}", CACHE / f"{pid}_ds{ds}.jpg", quiet=True)


def download_all() -> list[dict]:
    fetch(ONTOLOGY_URL, CACHE / "ontology16.json")
    plates = plate_list()
    print(f"{len(plates)} annotated plates; downloading SVGs and images (4 at a time)…")
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i, _ in enumerate(pool.map(download_plate, plates), 1):
            if i % 10 == 0 or i == len(plates):
                print(f"  {i}/{len(plates)} plates")
    return plates


# ---------------------------------------------------------------- export

# Label maps. Drawing order matters: the cortex map first, then the main group
# on top. The gyri group's "hippocampal gyrus" outline covers the detailed
# hippocampus (CA1, DG, subiculum) of the main group; checked on 28 plates:
# 2.3 % of gyri pixels overlap, almost all hippocampal.
# Sulci are only tiny arrowhead markers in this atlas (not areas), so they are
# not drawn. Hotspots add almost nothing (72 px on a test plate) and are skipped.
MAPS = {"gyral": [GROUP_GYRI, GROUP_MAIN], "brodmann": [GROUP_BRODMANN, GROUP_MAIN]}
MAP_FOR_LEVEL = {"easy": "gyral", "medium": "gyral", "hard": "brodmann"}

# Easy: lobes + big deep structures. The corpus callosum and internal capsule
# are NOT outlined as regions in this atlas (white matter is one region; those
# tracts only have small "hotspot" markers), so they cannot be asked fairly.
EASY = ["FroL", "ParL", "TemL", "OccL", "InL", "LimL",
        "THM", "Ca", "Pu", "GP", "HTH", "AMY", "HIP", "Cla", "LV", "M", "Pn", "Mo", "CB"]
# Medium: every gyrus/lobule drawn in the gyri group, plus these classic nuclei and tracts.
MEDIUM_NUCLEI = ["NAC", "STH", "SN", "RN", "LG", "MG", "Pul", "MD", "VPT", "VL", "R", "GPe", "GPi", "SEP",
                 "BNM", "BNST", "CA1", "CA3", "DG", "Sub", "BLN", "CEN", "PV", "SO", "Arc", "MB", "fx", "ot",
                 "3V", "4V", "Aq", "PAG", "SC", "IC", "DT", "IO", "LC"]
# Never asked: generic white matter.
EXCLUDE = {"FWM", "HWM", "MWM"}

# Smallest area (mm²) to be asked on a plate. The human hemisphere is ~12× wider
# than the mouse brain; these match the mouse limits in on-screen pixels
# (mouse 0.5 / 0.3 / 0.05 mm² at 10 µm ≈ human 20 / 12 / 2 mm² at ~62 µm/px).
MIN_AREA_MM2 = {"easy": 20.0, "medium": 12.0, "nucleus": 2.0, "hard": 2.0}
# Scoring: points halve roughly every DECAY_MM·ln2 (mouse uses 0.75 mm).
DECAY_MM = 5.0

LAYER_WORDS = re.compile(r"\b(layer|stratum|subgranular zone|pyramidal cells)\b", re.I)
POSITION_WORDS = re.compile(r"^(rostral|caudal|uncal) ", re.I)


def attach_cerebellar_surface(ontology_root: dict) -> None:
    """In graph 16 the cerebellar lobules ("surface structures of cerebellum",
    CbSS) are not under "cerebellum" (CB), which only holds the deep nuclei.
    Move CbSS under CB so that "Cerebellum" covers lobules and nuclei. This is
    the one deliberate change we make to the Allen tree (documented in CLAUDE.md)."""
    found: dict[str, tuple[dict, dict | None]] = {}

    def walk(node: dict, parent: dict | None) -> None:
        found[node["acronym"]] = (node, parent)
        for child in node.get("children", []):
            walk(child, node)

    walk(ontology_root, None)
    surface, old_parent = found["CbSS"]
    cerebellum, _ = found["CB"]
    old_parent["children"].remove(surface)
    cerebellum["children"].append(surface)


def hard_region(i: int, structures: list[dict], hip: int) -> int:
    """Roll layer-level structures up to something worth asking: "stratum
    pyramidale of rostral CA1" → "rostral CA1" → "CA1"."""
    while True:
        s = structures[i]
        in_hippocampus = hip in lib.ancestors(i, structures)
        if LAYER_WORDS.search(s["name"]) or (in_hippocampus and POSITION_WORDS.match(s["name"])):
            i = s["parentIndex"]
        else:
            return i


def export(plates: list[dict]) -> None:
    ontology = json.loads((CACHE / "ontology16.json").read_text())
    if not ontology.get("success"):
        sys.exit("ontology download did not report success")
    root = ontology["msg"][0]
    attach_cerebellar_surface(root)
    structures = lib.flatten_ontology(root)
    id_to_index = lib.id_to_index_map(structures)
    by_acronym = {s["acronym"]: s["index"] for s in structures}
    missing = [a for a in EASY + MEDIUM_NUCLEI if a not in by_acronym]
    if missing:
        sys.exit(f"acronyms not in graph 16: {missing}")
    hip = by_acronym["HIP"]
    excluded = {by_acronym[a] for a in EXCLUDE if a in by_acronym}

    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("plate_*"):
        old.unlink()

    first_section = plates[0]["section_number"]
    medium_extra = {by_acronym[a] for a in MEDIUM_NUCLEI}
    slices, rasters = [], []
    gyri_seen: set[int] = set()
    brodmann_seen: set[int] = set()
    main_seen: set[int] = set()
    for n, plate in enumerate(plates, 1):
        pid = plate["id"]
        name = f"plate_{n:03d}"
        outlines = read_outlines((CACHE / f"{pid}.svg").read_text())
        for o in outlines:
            if o.structure_id not in id_to_index:
                sys.exit(f"plate {pid}: structure id {o.structure_id} not in graph 16")
            {GROUP_GYRI: gyri_seen, GROUP_BRODMANN: brodmann_seen, GROUP_MAIN: main_seen}.get(o.group, set()).add(
                id_to_index[o.structure_id])
        variants, maps = {}, {}
        for quality, ds in DOWNSAMPLE.items():
            img = Image.open(CACHE / f"{pid}_ds{ds}.jpg").convert("RGB")
            width, height = img.size
            img.save(OUT / f"{name}_{quality}.jpg", quality=82, optimize=True, progressive=True)
            labels, maps[quality] = {}, {}
            for map_name, groups in MAPS.items():
                # image pixels = full-resolution SVG coordinates / 2^downsample
                lab = rasterize(outlines, groups, width, height, 1 / 2**ds, id_to_index)
                lib.write_label_bin(OUT / f"{name}_{quality}_{map_name}.bin.gz", lab)
                labels[map_name] = f"{name}_{quality}_{map_name}.bin.gz"
                maps[quality][map_name] = lab
            variants[quality] = {"width": width, "height": height,
                                 "mmPerPixel": round(plate["resolution"] * 2**ds / 1000, 5),
                                 "image": f"{name}_{quality}.jpg", "labels": labels}
        rasters.append((name, maps["sharp"], variants["sharp"]["mmPerPixel"], maps["light"]))
        slices.append({
            "id": name, "plane": "coronal", "index": n, "section": plate["section_number"],
            "apMm": round((plate["section_number"] - first_section) * SECTION_THICKNESS_UM / 1000, 2),
            "atlasImageId": pid, "variants": variants, "regions": f"{name}.regions.json",
        })
        print(f"\r  rasterized {n}/{len(plates)} plates", end="", flush=True)
    print()

    # Level candidates: {structure index: minimum area mm²}
    gyral_regions = {i for i in gyri_seen if by_acronym["CeG"] in lib.ancestors(i, structures)
                     or by_acronym["CbSS"] in lib.ancestors(i, structures)}
    candidates = {
        "easy": {by_acronym[a]: MIN_AREA_MM2["easy"] for a in EASY},
        "medium": {**{i: MIN_AREA_MM2["medium"] for i in gyral_regions},
                   **{i: MIN_AREA_MM2["nucleus"] for i in medium_extra}},
        "hard": {i: MIN_AREA_MM2["hard"]
                 for i in {hard_region(i, structures, hip) for i in main_seen} | brodmann_seen
                 if i not in excluded},
    }
    print("candidate targets: " + ", ".join(f"{k} {len(v)}" for k, v in candidates.items()))

    best_area: dict[int, tuple[float, str]] = {}
    for (name, maps_sharp, mm_per_px, light_maps), meta in zip(rasters, slices):
        stats = {m: lib.region_stats(lab, structures) for m, lab in maps_sharp.items()}
        light_stats = {m: lib.region_stats(lab, structures) for m, lab in light_maps.items()}
        px_mm2 = mm_per_px**2
        targets = {}
        for level, regions in candidates.items():
            st = stats[MAP_FOR_LEVEL[level]]
            targets[level] = [i for i, min_mm2 in sorted(regions.items())
                              if st.get(i, {}).get("areaPx", 0) * px_mm2 >= min_mm2]
            lost = [structures[i]["acronym"] for i in targets[level] if i not in light_stats[MAP_FOR_LEVEL[level]]]
            if lost:
                sys.exit(f"{name}: {level} targets missing from the light map: {lost}")
            for i in regions:
                area = st.get(i, {}).get("areaPx", 0) * px_mm2
                if area > best_area.get(i, (0.0, ""))[0]:
                    best_area[i] = (area, name)
        meta["targets"] = targets
        (OUT / f"{name}.regions.json").write_text(json.dumps(
            {m: {str(i): v for i, v in s.items()} for m, s in stats.items()}, separators=(",", ":")))

    for level, regions in candidates.items():
        asked = {t for s in slices for t in s["targets"][level]}
        print(f"{level}: {len(asked)} of {len(regions)} regions askable on some plate")
        never = [structures[i]["acronym"] for i in regions if i not in asked]
        if level != "hard" and never:
            print(f"   never big enough: {', '.join(sorted(never))}")
    print("easy:", ", ".join(structures[i]["acronym"] for i in sorted(candidates["easy"])))
    print("medium sample:", ", ".join(sorted(structures[i]["acronym"] for i in candidates["medium"]))[:600])
    print("hard sample:", ", ".join(sorted(structures[i]["acronym"] for i in candidates["hard"]))[:600])

    (OUT / "structures.json").write_text(json.dumps(structures, separators=(",", ":")))
    (OUT / "slices.json").write_text(json.dumps({
        "species": {
            "id": "human", "name": "Human", "plates": len(slices),
            "planeLabel": "Coronal plate", "hemisphere": "one hemisphere (midline on the left)",
            "maps": list(MAPS), "mapForLevel": MAP_FOR_LEVEL, "decayMm": DECAY_MM,
        },
        "source": {
            "atlas": f"Allen Human Reference Atlas, adult (Allen API atlas {ATLAS_ID}), structure graph 16",
            "images": f"{API}/image_download/<atlasImageId>?downsample=6|7",
            "annotation": f"{API}/svg_download/<atlasImageId>?groups=...",
            "apMm": "distance from the first annotated plate (section number × 50 µm), not a stereotaxic coordinate",
            "treeChange": "CbSS (cerebellar lobules) moved under CB (cerebellum)",
        },
        "levels": {level: sorted(regions) for level, regions in candidates.items()},
        "bestSlice": {str(i): best_area[i][1] for i in sorted(best_area) if best_area[i][0] > 0},
        "slices": slices,
    }, indent=1))
    print(f"wrote {len(slices)} plates to {OUT}")


def main() -> None:
    plates = download_all()
    if sys.argv[1:] == ["download"]:
        return
    export(plates)


if __name__ == "__main__":
    main()
