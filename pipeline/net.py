"""Downloading files safely (shared by build_atlas.py and build_human.py)."""

from __future__ import annotations

import shutil
import ssl
import urllib.request
from pathlib import Path

import certifi

# certifi supplies trusted root certificates; the python.org macOS installer
# does not set them up by default (CERTIFICATE_VERIFY_FAILED).
_CONTEXT = ssl.create_default_context(cafile=certifi.where())


def fetch(url: str, path: Path, quiet: bool = False) -> Path:
    """Download `url` to `path` once. Writes to a .part file first, so an
    interrupted download never leaves a half file that looks complete."""
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    if not quiet:
        print(f"downloading {url}")
    tmp = path.with_suffix(path.suffix + ".part")
    with urllib.request.urlopen(url, context=_CONTEXT, timeout=120) as response, open(tmp, "wb") as f:
        shutil.copyfileobj(response, f)
    tmp.rename(path)
    return path
