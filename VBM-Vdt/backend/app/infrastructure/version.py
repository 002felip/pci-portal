from pathlib import Path


def read_version(backend_dir: Path) -> str:
    """`backend_dir` is the backend/ directory itself (VERSION lives at its
    root, alongside app.yaml and requirements.txt). Bump this file by hand
    - year.month.incremental, e.g. 2026.09.1, resetting to 1 each new
    month - right before running scripts/package_for_databricks.py.
    Purely informational: a missing file degrades to "unknown" rather than
    failing app startup over a cosmetic detail."""
    try:
        return (backend_dir / "VERSION").read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return "unknown"
