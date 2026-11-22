"""Pure helper functions for turning the Allen CCFv3 into game data.

Everything here works on plain Python objects and numpy arrays (no downloads,
no file formats except the tiny .bin label maps), so it is easy to unit test.
See build_atlas.py for the script that downloads the data and calls these.

Conventions
-----------
* "id"    = the Allen structure id (e.g. 382 for CA1). Can be > 2**24.
* "index" = our own compact number for a structure: its position in the
            flattened list written to structures.json. Index 0 is reserved for
            "outside the brain" (annotation value 0), so real structures start
            at 1. Indices fit in uint16 (the mouse ontology has 1327 entries).
"""

from __future__ import annotations

import gzip
from pathlib import Path

import numpy as np

OUTSIDE = 0  # label-map value for pixels outside the brain


# --------------------------------------------------------------------------
# Ontology (the region tree)
# --------------------------------------------------------------------------

def flatten_ontology(root: dict) -> list[dict]:
    """Flatten the nested Allen structure graph into a list.

    `root` is the top node from the structure_graph_download JSON (its
    "msg"[0]). Returns a list where entry i has "index" == i. Entry 0 is the
    "outside brain" placeholder. Parents always come before their children
    (depth-first order), so parentIndex < index for every real structure.
    """
    structures: list[dict] = [{
        "index": 0,
        "id": 0,
        "acronym": "",
        "name": "outside brain",
        "parentIndex": None,
        "depth": -1,
        "color": "#000000",
    }]

    def walk(node: dict, parent_index: int | None, depth: int) -> None:
        index = len(structures)
        structures.append({
            "index": index,
            "id": node["id"],
            "acronym": node["acronym"],
            "name": node["name"],
            "parentIndex": parent_index,
            "depth": depth,
            "color": "#" + node["color_hex_triplet"].upper(),
        })
        for child in node.get("children", []):
            walk(child, index, depth + 1)

    walk(root, None, 0)
    if len(structures) > np.iinfo(np.uint16).max:
        raise ValueError(f"{len(structures)} structures do not fit in uint16")
    return structures


def id_to_index_map(structures: list[dict]) -> dict[int, int]:
    """Map Allen id -> our index. Annotation value 0 maps to OUTSIDE."""
    mapping = {s["id"]: s["index"] for s in structures}
    if len(mapping) != len(structures):
        raise ValueError("duplicate structure ids in ontology")
    return mapping


def ancestors(index: int, structures: list[dict]) -> list[int]:
    """Return [index, parent, grandparent, ..., root]. Empty for OUTSIDE."""
    chain = []
    current: int | None = index
    while current is not None and current != OUTSIDE:
        chain.append(current)
        current = structures[current]["parentIndex"]
    return chain


def structure_set_indices(api_response: dict, id_to_index: dict[int, int]) -> list[int]:
    """Our indices for the members of an Allen structure set.

    `api_response` is the JSON from
    /api/v2/data/query.json?criteria=model::Structure,rma::criteria,structure_sets[id$eq<SET>]
    Raises ValueError if a member is not in the ontology.
    """
    if not api_response.get("success"):
        raise ValueError("structure set query did not report success")
    ids = [row["id"] for row in api_response["msg"]]
    missing = [i for i in ids if i not in id_to_index]
    if missing:
        raise ValueError(f"structure set members not in ontology: {missing}")
    return sorted(id_to_index[i] for i in ids)


def targets_for_slice(stats: dict[int, dict], candidates: list[int], min_area_px: float) -> list[int]:
    """Candidates that cover at least `min_area_px` on this slice (big enough to click fairly)."""
    return [i for i in candidates if stats.get(i, {}).get("areaPx", 0) >= min_area_px]


def descendant_ids(acronym: str, structures: list[dict]) -> set[int]:
    """All Allen ids at or below the structure with this acronym."""
    by_acronym = {s["acronym"]: s["index"] for s in structures}
    top = by_acronym[acronym]
    return {s["id"] for s in structures
            if s["index"] != OUTSIDE and top in ancestors(s["index"], structures)}


# --------------------------------------------------------------------------
# Label maps
# --------------------------------------------------------------------------

def remap_labels(annotation: np.ndarray, id_to_index: dict[int, int]) -> np.ndarray:
    """Convert an array of Allen ids into an array of our uint16 indices.

    Raises ValueError if the annotation contains an id that is not in the
    ontology. We fail loudly instead of guessing what that id should be.
    """
    unique_ids, inverse = np.unique(annotation, return_inverse=True)
    lookup = np.empty(len(unique_ids), dtype=np.uint16)
    missing = []
    for i, allen_id in enumerate(unique_ids.tolist()):
        if allen_id == 0:
            lookup[i] = OUTSIDE
        elif allen_id in id_to_index:
            lookup[i] = id_to_index[allen_id]
        else:
            missing.append(allen_id)
    if missing:
        raise ValueError(f"annotation ids not in ontology: {missing}")
    return lookup[inverse].reshape(annotation.shape)


def write_label_bin(path: Path, labels: np.ndarray) -> None:
    """Write a 2-D label map as gzip-compressed raw little-endian uint16, row by row.

    Pixel (x, y) is at position y * width + x, which is exactly how the
    browser reads it back (see web/src/labelmap.ts). Label maps are mostly
    large uniform areas, so gzip shrinks them ~50-100x. mtime=0 keeps the
    output identical between rebuilds, so git only sees real changes.
    """
    if labels.ndim != 2:
        raise ValueError("label map must be 2-D")
    raw = np.ascontiguousarray(labels, dtype="<u2").tobytes()
    Path(path).write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))


def read_label_bin(path: Path, width: int, height: int) -> np.ndarray:
    data = np.frombuffer(gzip.decompress(Path(path).read_bytes()), dtype="<u2")
    if data.size != width * height:
        raise ValueError(f"{path}: expected {width * height} values, got {data.size}")
    return data.reshape(height, width)


# --------------------------------------------------------------------------
# Per-slice statistics
# --------------------------------------------------------------------------

def region_stats(labels: np.ndarray, structures: list[dict]) -> dict[int, dict]:
    """Pixel area and centroid of every structure present in a 2-D label map.

    Areas are aggregated up the tree: a pixel labelled CA1 also counts towards
    Ammon's horn, Hippocampal region, Hippocampal formation, ... and root.
    Returns {index: {"areaPx": int, "centroid": [x, y]}}.
    """
    height, width = labels.shape
    ys, xs = np.indices((height, width))
    flat = labels.ravel().astype(np.int64)
    n = len(structures)
    counts = np.bincount(flat, minlength=n).astype(np.int64)
    sum_x = np.bincount(flat, weights=xs.ravel(), minlength=n)
    sum_y = np.bincount(flat, weights=ys.ravel(), minlength=n)

    # Children come after parents in the list, so walking backwards pushes
    # each structure's totals into its parent after its own children did.
    for s in reversed(structures[1:]):
        parent = s["parentIndex"]
        if parent is not None:
            counts[parent] += counts[s["index"]]
            sum_x[parent] += sum_x[s["index"]]
            sum_y[parent] += sum_y[s["index"]]

    stats = {}
    for index in range(1, n):
        if counts[index] > 0:
            stats[index] = {
                "areaPx": int(counts[index]),
                "centroid": [round(float(sum_x[index] / counts[index]), 1),
                             round(float(sum_y[index] / counts[index]), 1)],
            }
    return stats


# --------------------------------------------------------------------------
# Images and slice choice
# --------------------------------------------------------------------------

def contrast_limits(volume: np.ndarray, mask: np.ndarray,
                    low_pct: float = 0.5, high_pct: float = 99.5) -> tuple[float, float]:
    """Intensity range used for every slice, so all slices look alike."""
    values = volume[mask]
    low, high = np.percentile(values, [low_pct, high_pct])
    return float(low), float(high)


def to_uint8(image: np.ndarray, low: float, high: float) -> np.ndarray:
    scaled = (image.astype(np.float64) - low) / (high - low)
    return (np.clip(scaled, 0.0, 1.0) * 255).round().astype(np.uint8)


def pick_slices(brain_area_per_slice: np.ndarray, n: int,
                min_fraction: float = 0.25) -> list[int]:
    """Choose n evenly spaced slice positions where the brain is big enough.

    A position counts if its brain area is at least `min_fraction` of the
    largest slice. This drops the thin tips (olfactory bulb front, caudal
    medulla), which make poor quiz slices.
    """
    big = np.flatnonzero(brain_area_per_slice >= min_fraction * brain_area_per_slice.max())
    first, last = int(big[0]), int(big[-1])
    return sorted({int(round(v)) for v in np.linspace(first, last, n)})
