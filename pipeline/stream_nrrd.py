"""Read selected coronal slices from a large gzip-compressed NRRD volume.

The 10 µm CCF volumes are 4.8 GB (annotation) and 2.4 GB (template) once
unzipped. Loading them whole with pynrrd needs that much memory, so this
module unzips the file once from start to end and keeps only the slices we
ask for (36 slices × 800 × 1140 values).

Memory layout (NRRD spec): the FIRST axis varies fastest. For the CCF that is
axis 0 = anterior→posterior, then dorsal→ventral, then left→right. So for one
left-right position z, the file holds a complete (DV × AP) block, and we take
the AP columns we need from each block.
"""

from __future__ import annotations

import gzip
from pathlib import Path

import numpy as np

NRRD_TYPES = {
    "unsigned int": "u4", "uint32": "u4",
    "unsigned short": "u2", "uint16": "u2",
    "float": "f4",  # the ARA Nissl volume
}


def read_header(f) -> dict[str, str]:
    """Read 'key: value' lines up to the blank line that ends an NRRD header."""
    magic = f.readline()
    if not magic.startswith(b"NRRD"):
        raise ValueError("not an NRRD file")
    header: dict[str, str] = {}
    while True:
        line = f.readline()
        if line in (b"\n", b"\r\n", b""):
            return header
        text = line.decode("ascii").rstrip("\r\n")
        if text.startswith("#"):
            continue
        key, sep, value = text.partition(": ")
        if not sep:  # "key:=value" lines are key/value comments; not needed here
            continue
        header[key] = value


def read_coronal_slices(path: Path, ap_indices: list[int]) -> tuple[np.ndarray, dict[str, str]]:
    """Return volume[ap_indices] as an array of shape (len(ap_indices), DV, LR)."""
    with open(path, "rb") as f:
        header = read_header(f)
        if header.get("dimension") != "3" or header.get("encoding") != "gzip":
            raise ValueError(f"expected a 3-D gzip NRRD, got {header}")
        if header.get("endian", "little") != "little":
            raise ValueError("expected little-endian data")
        dtype = np.dtype("<" + NRRD_TYPES[header["type"]])
        n_ap, n_dv, n_lr = (int(v) for v in header["sizes"].split())
        if min(ap_indices) < 0 or max(ap_indices) >= n_ap:
            raise ValueError(f"AP index out of range 0..{n_ap - 1}")

        out = np.empty((len(ap_indices), n_dv, n_lr), dtype=dtype)
        block_bytes = n_ap * n_dv * dtype.itemsize
        with gzip.GzipFile(fileobj=f) as data:
            for z in range(n_lr):
                raw = data.read(block_bytes)
                if len(raw) != block_bytes:
                    raise ValueError(f"file ended early at left-right index {z}")
                block = np.frombuffer(raw, dtype=dtype).reshape(n_dv, n_ap)  # [dv, ap]
                out[:, :, z] = block[:, ap_indices].T
    return out, header
