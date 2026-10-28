import hashlib
import re
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


class FileTooLargeError(Exception):
    pass


@dataclass
class ArchivedFile:
    path: Path
    sha256: str
    size_bytes: int
    original_name: str


def sha256_of(path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def archive_upload(source_path, archive_dir, original_name: str) -> ArchivedFile:
    """Copy the upload into the archive unchanged, before any parsing, so a
    file that later fails validation is still auditable."""
    source_path = Path(source_path)
    size = source_path.stat().st_size
    if size > MAX_UPLOAD_BYTES:
        raise FileTooLargeError(
            f"Upload is {size} bytes; the limit is {MAX_UPLOAD_BYTES} bytes"
        )

    checksum = sha256_of(source_path)
    archive_dir = Path(archive_dir)
    archive_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    safe = _SAFE_NAME.sub("_", original_name) or "workbook.xlsx"
    target = archive_dir / f"{stamp}_{checksum[:16]}_{safe}"
    shutil.copy2(source_path, target)

    return ArchivedFile(path=target, sha256=checksum, size_bytes=size,
                        original_name=original_name)
