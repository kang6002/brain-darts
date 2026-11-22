"""Rasterizing SVG outlines into label maps, on tiny hand-made SVGs."""

import numpy as np
import pytest

from human_lib import rasterize, read_outlines, tissue_mask

SVG = """<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">
<g transform="scale(1.0)">
  <g graphic_group_label_id="31" transform="scale(2.0, 2.0)">
    <!-- 10x10 square at (10,10)-(20,20) in group units = (20,20)-(40,40) full res -->
    <path structure_id="100" d="M10,10 L20,10 L20,20 L10,20 z"/>
    <!-- ring: outer 40..80, inner hole 50..70 (two sub-paths, even-odd) -->
    <path structure_id="200" d="M40,40 L80,40 L80,80 L40,80 z M50,50 L70,50 L70,70 L50,70 z"/>
  </g>
  <g graphic_group_label_id="999">
    <!-- circle of radius 40 around (300, 300) drawn with 4 cubic curves -->
    <path structure_id="300" d="M340,300 C340,322 322,340 300,340 C278,340 260,322 260,300 C260,278 278,260 300,260 C322,260 340,278 340,300 z"/>
    <!-- covers the first square: later outlines win -->
    <path structure_id="400" d="M20,20 L30,20 L30,30 L20,30 z"/>
  </g>
</g>
</svg>"""

IDS = {100: 1, 200: 2, 300: 3, 400: 4}


def test_reads_groups_structures_and_transforms():
    outlines = read_outlines(SVG)
    assert [(o.group, o.structure_id) for o in outlines] == [(31, 100), (31, 200), (999, 300), (999, 400)]
    assert outlines[0].transform == "scale(1.0) scale(2.0, 2.0)"


def test_square_with_group_scale_and_image_downsampling():
    # scale 0.5: full-res (20..40) → image pixels 10..20
    labels = rasterize(read_outlines(SVG), [31], 200, 200, 0.5, IDS)
    assert labels[15, 15] == 1
    assert labels[10, 10] == 1 and labels[19, 19] == 1  # pixel centres inside
    assert labels[9, 15] == 0 and labels[20, 15] == 0  # just outside
    assert (labels == 1).sum() == 100


def test_hole_is_left_empty():
    labels = rasterize(read_outlines(SVG), [31], 200, 200, 0.5, IDS)
    # ring: full-res 80..160 outer, 100..140 hole → image 40..80, hole 50..70
    assert labels[45, 45] == 2
    assert labels[60, 60] == 0
    assert (labels == 2).sum() == 40 * 40 - 20 * 20


def test_curves_make_a_round_shape():
    labels = rasterize(read_outlines(SVG), [999], 400, 400, 1.0, IDS)
    area = (labels == 3).sum()
    assert abs(area - np.pi * 40**2) / (np.pi * 40**2) < 0.03  # within 3 % of a true circle
    assert labels[300, 300] == 3 and labels[300, 339] == 3 and labels[300, 345] == 0


def test_later_groups_and_paths_cover_earlier_ones():
    labels = rasterize(read_outlines(SVG), [31, 999], 400, 400, 1.0, IDS)
    assert labels[25, 25] == 4  # square 400 drawn over square 100
    assert labels[35, 35] == 1  # rest of square 100 unchanged


def test_unknown_structure_id_fails_loudly():
    with pytest.raises(ValueError, match="not in the ontology"):
        rasterize(read_outlines(SVG), [31], 10, 10, 1.0, {100: 1})


def test_tissue_mask_separates_stain_from_white_slide():
    rgb = np.array([[[250, 250, 250], [190, 193, 214]]], dtype=np.uint8)
    assert tissue_mask(rgb).tolist() == [[False, True]]
