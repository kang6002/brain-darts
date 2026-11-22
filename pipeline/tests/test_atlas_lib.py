"""Tests for atlas_lib on a tiny hand-made ontology (no downloads needed)."""

import numpy as np
import pytest

import atlas_lib as lib

# root(997) ─┬─ HPF(1089) ── CA1(382)
#            └─ TH(549)
# CA1 gets a huge id on purpose: real Allen ids go up to 614454277 (> 2**24).
BIG_ID = 614454277
TREE = {
    "id": 997, "acronym": "root", "name": "root", "color_hex_triplet": "ffffff",
    "children": [
        {"id": 1089, "acronym": "HPF", "name": "Hippocampal formation",
         "color_hex_triplet": "7ED04B",
         "children": [{"id": BIG_ID, "acronym": "CA1", "name": "Field CA1",
                       "color_hex_triplet": "7ED04B", "children": []}]},
        {"id": 549, "acronym": "TH", "name": "Thalamus",
         "color_hex_triplet": "FF7080", "children": []},
    ],
}


@pytest.fixture
def structures():
    return lib.flatten_ontology(TREE)


def by_acronym(structures, acronym):
    return next(s for s in structures if s["acronym"] == acronym)


def test_flatten_gives_parents_depths_and_placeholder(structures):
    assert [s["acronym"] for s in structures] == ["", "root", "HPF", "CA1", "TH"]
    assert [s["index"] for s in structures] == [0, 1, 2, 3, 4]
    assert structures[0]["name"] == "outside brain"
    ca1 = by_acronym(structures, "CA1")
    assert ca1["parentIndex"] == by_acronym(structures, "HPF")["index"]
    assert ca1["depth"] == 2
    assert by_acronym(structures, "root")["parentIndex"] is None
    assert ca1["color"] == "#7ED04B"
    # parents always come before children (region_stats relies on this)
    for s in structures[1:]:
        if s["parentIndex"] is not None:
            assert s["parentIndex"] < s["index"]


def test_ancestors(structures):
    ca1 = by_acronym(structures, "CA1")["index"]
    assert [structures[i]["acronym"] for i in lib.ancestors(ca1, structures)] == ["CA1", "HPF", "root"]
    assert lib.ancestors(lib.OUTSIDE, structures) == []


def test_remap_round_trip_including_big_ids(structures):
    id_to_index = lib.id_to_index_map(structures)
    annotation = np.array([[0, 549], [BIG_ID, 1089]], dtype=np.uint32)
    labels = lib.remap_labels(annotation, id_to_index)
    assert labels.dtype == np.uint16
    index_to_id = {s["index"]: s["id"] for s in structures}
    back = np.vectorize(lambda i: 0 if i == 0 else index_to_id[i])(labels)
    np.testing.assert_array_equal(back, annotation)


def test_remap_fails_loudly_on_unknown_id(structures):
    with pytest.raises(ValueError, match="12345"):
        lib.remap_labels(np.array([[12345]], dtype=np.uint32), lib.id_to_index_map(structures))


def test_region_stats_aggregates_up_the_tree(structures):
    ca1 = by_acronym(structures, "CA1")["index"]
    hpf = by_acronym(structures, "HPF")["index"]
    th = by_acronym(structures, "TH")["index"]
    root = by_acronym(structures, "root")["index"]
    labels = np.array([
        [0,   ca1, ca1],
        [hpf, th,  0],
    ], dtype=np.uint16)
    stats = lib.region_stats(labels, structures)
    assert stats[ca1] == {"areaPx": 2, "centroid": [1.5, 0.0]}
    assert stats[hpf]["areaPx"] == 3           # its own pixel + 2 CA1 pixels
    assert stats[hpf]["centroid"] == [1.0, 0.3]  # mean of (1,0),(2,0),(0,1)
    assert stats[th]["areaPx"] == 1
    assert stats[root]["areaPx"] == 4          # every non-outside pixel
    assert lib.OUTSIDE not in stats


def test_label_bin_round_trip_keeps_row_order(tmp_path, structures):
    labels = np.arange(12, dtype=np.uint16).reshape(3, 4)  # height 3, width 4
    path = tmp_path / "x.bin"
    lib.write_label_bin(path, labels)
    raw = path.read_bytes()
    assert len(raw) == 12 * 2
    # pixel (x=1, y=2) is value 9 and lives at position y*width + x = 9
    assert int.from_bytes(raw[9 * 2: 9 * 2 + 2], "little") == labels[2, 1] == 9
    np.testing.assert_array_equal(lib.read_label_bin(path, width=4, height=3), labels)


def test_pick_slices_skips_thin_ends():
    area = np.array([0, 1, 50, 100, 80, 60, 30, 5, 0])
    picks = lib.pick_slices(area, n=3, min_fraction=0.25)
    assert picks == [2, 4, 6]
