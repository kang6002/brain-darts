"""The streaming reader must give exactly what pynrrd gives for the same slices."""

import nrrd
import numpy as np
import pytest

from stream_nrrd import read_coronal_slices


@pytest.mark.parametrize("dtype", [np.uint32, np.uint16, np.float32])
def test_matches_pynrrd_on_a_small_volume(tmp_path, dtype):
    rng = np.random.default_rng(0)
    # (AP, DV, LR) like the CCF; values above 2**16 for uint32 to check all bytes
    if dtype == np.float32:
        volume = rng.normal(100.0, 30.0, size=(7, 5, 6)).astype(dtype)
    else:
        high = 600_000_000 if dtype == np.uint32 else 65_000
        volume = rng.integers(0, high, size=(7, 5, 6)).astype(dtype)
    path = tmp_path / "vol.nrrd"
    # pynrrd writes Fortran order (first axis fastest), as the Allen files are
    nrrd.write(str(path), volume, header={"encoding": "gzip"})

    slices, header = read_coronal_slices(path, [0, 3, 6])

    assert header["sizes"] == "7 5 6"
    assert slices.dtype == dtype
    assert slices.shape == (3, 5, 6)
    full, _ = nrrd.read(str(path))
    np.testing.assert_array_equal(slices, full[[0, 3, 6]])


def test_rejects_out_of_range_index(tmp_path):
    path = tmp_path / "vol.nrrd"
    nrrd.write(str(path), np.zeros((4, 3, 2), dtype=np.uint16), header={"encoding": "gzip"})
    with pytest.raises(ValueError, match="out of range"):
        read_coronal_slices(path, [4])
