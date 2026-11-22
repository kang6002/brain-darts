"""Turning the Allen human atlas SVG outlines into label maps.

The annotation of each plate is an SVG file: one <path> per outlined region,
with a `structure_id` attribute, inside <g> groups that each carry a
`graphic_group_label_id` (e.g. the gyri map or the Brodmann map). We read the
XML ourselves (so we decide exactly which groups are used), let svgelements
turn the path curves into points, and fill each outline with a scanline fill.

Coordinates: path coordinates × the group's transform = full-resolution image
pixels. The downloaded images are downsampled by 2^k, so we multiply by
`scale` = 1 / 2^k to land on image pixels.
"""

from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass

import numpy as np
from svgelements import Close, Line, Matrix, Move, Path


@dataclass
class Outline:
    group: int  # graphic_group_label_id
    structure_id: int
    d: str  # SVG path data
    transform: str  # all transforms from the root down to the path, outermost first


def read_outlines(svg_text: str) -> list[Outline]:
    """All annotated paths in document order (= drawing order)."""
    root = ET.fromstring(svg_text)
    outlines: list[Outline] = []

    def walk(node: ET.Element, group: int | None, transform: str) -> None:
        tag = node.tag.rsplit("}", 1)[-1]  # strip the XML namespace
        transform = f"{transform} {node.get('transform', '')}".strip()
        if node.get("graphic_group_label_id"):
            group = int(node.get("graphic_group_label_id"))
        if tag == "path" and node.get("structure_id") and group is not None:
            outlines.append(Outline(group, int(node.get("structure_id")), node.get("d", ""), transform))
        for child in node:
            walk(child, group, transform)

    walk(root, None, "")
    return outlines


def to_polygons(outline: Outline, scale: float) -> list[np.ndarray]:
    """One (n, 2) array of x, y image coordinates per closed sub-path."""
    matrix = Matrix(outline.transform) if outline.transform else Matrix()
    path = Path(outline.d) * matrix * Matrix.scale(scale)
    path.reify()  # apply the transform to the coordinates
    polygons = []
    for sub in path.as_subpaths():
        points: list[tuple[float, float]] = []
        for seg in sub.segments():
            if isinstance(seg, Move):
                points = [(seg.end.x, seg.end.y)]
            elif isinstance(seg, (Line, Close)):
                if seg.end is not None:
                    points.append((seg.end.x, seg.end.y))
            else:  # curves: sample about one point per image pixel along the control polygon
                ctrl = [p for p in (seg.start, getattr(seg, "control1", None), getattr(seg, "control2", None),
                                    getattr(seg, "control", None), seg.end) if p is not None]
                rough_length = sum(math.dist(a, b) for a, b in zip(ctrl, ctrl[1:]))
                n = max(2, min(200, math.ceil(rough_length)))
                points.extend(map(tuple, seg.npoint(np.linspace(0, 1, n + 1))[1:]))
        if len(points) >= 3:
            polygons.append(np.array(points, dtype=float))
    return polygons


def fill_mask(polygons: list[np.ndarray], width: int, height: int) -> tuple[np.ndarray, tuple[int, int]] | None:
    """Scanline fill with the even-odd rule: pixel (x, y) is inside when its
    centre (x + 0.5, y + 0.5) is inside an odd number of the polygons, so an
    inner ring makes a hole. Returns (mask, (x0, y0)) for the bounding box
    only, or None if the outline is off the image.

    (Pillow's polygon fill also colours the edge pixels on both sides, which
    makes holes one pixel too big; this rule has no such ambiguity.)
    """
    if not polygons:
        return None
    allpts = np.vstack(polygons)
    x0 = max(0, int(math.floor(allpts[:, 0].min())))
    y0 = max(0, int(math.floor(allpts[:, 1].min())))
    x1 = min(width, int(math.ceil(allpts[:, 0].max())) + 1)
    y1 = min(height, int(math.ceil(allpts[:, 1].max())) + 1)
    if x1 <= x0 or y1 <= y0:
        return None
    # All edges of all sub-polygons (each polygon closed back to its start).
    starts = np.vstack(polygons)
    ends = np.vstack([np.roll(p, -1, axis=0) for p in polygons])
    ys1, ys2 = starts[:, 1], ends[:, 1]
    mask = np.zeros((y1 - y0, x1 - x0), dtype=bool)
    for row in range(y1 - y0):
        yc = y0 + row + 0.5
        crosses = (ys1 <= yc) != (ys2 <= yc)  # edge spans this row's centre line
        if not crosses.any():
            continue
        s, e = starts[crosses], ends[crosses]
        xs = np.sort(s[:, 0] + (yc - s[:, 1]) * (e[:, 0] - s[:, 0]) / (e[:, 1] - s[:, 1]))
        for xa, xb in zip(xs[0::2], xs[1::2]):  # inside between pairs of crossings
            first = max(x0, math.ceil(xa - 0.5))  # first pixel whose centre ≥ xa
            last = min(x1, math.ceil(xb - 0.5))  # first pixel whose centre ≥ xb (exclusive)
            if last > first:
                mask[row, first - x0:last - x0] = True
    return mask, (x0, y0)


def rasterize(outlines: list[Outline], groups: list[int], width: int, height: int,
              scale: float, id_to_index: dict[int, int]) -> np.ndarray:
    """Label map (uint16 structure indices) from the outlines of `groups`.
    Groups are drawn in the given order, paths within a group in document
    order; later outlines cover earlier ones."""
    missing = sorted({o.structure_id for o in outlines if o.group in groups and o.structure_id not in id_to_index})
    if missing:
        raise ValueError(f"structure ids not in the ontology: {missing}")
    labels = np.zeros((height, width), dtype=np.uint16)
    for group in groups:
        for outline in (o for o in outlines if o.group == group):
            filled = fill_mask(to_polygons(outline, scale), width, height)
            if filled is None:
                continue
            mask, (x0, y0) = filled
            h, w = mask.shape
            labels[y0:y0 + h, x0:x0 + w][mask] = id_to_index[outline.structure_id]
    return labels


def tissue_mask(rgb: np.ndarray, threshold: float = 228.0) -> np.ndarray:
    """Stained tissue = pixels clearly darker than the white slide background."""
    return rgb.astype(float).mean(axis=2) < threshold
