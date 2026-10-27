"""
Utility Functions for Report Generation

Helper functions shared across multiple modules:
- Value formatting
- Date filtering
- Font loading
- Filename sanitization
"""

import os
import re
import logging
from datetime import datetime

import numpy as np
import pandas as pd
from PIL import ImageFont

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Value formatting
# ---------------------------------------------------------------------------

def format_value_with_unit(value, unit, show_decimal=False):
    """
    Format a numeric value according to its unit of measurement.
    No thousand separator is used.

    Rules:
        - %/day          → 2 decimal places  (e.g. 12.45)
        - tonnes/day     → 1 decimal place   (e.g. 1342.1)
        - ktonnes/day    → 1 decimal place   (e.g. 85.3)
        - eqm/day        → 1 decimal place   (e.g. 7.2)
        - Others         → 0 decimal places   (e.g. 85000)
    """
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return 'N/A'

    unit_stripped = unit.strip() if isinstance(unit, str) else ''
    unit_lower = unit_stripped.lower()

    if unit_stripped == '%/day':
        return f"{value:.2f}"
    elif unit_lower in ('tonnes/day', 'ktonnes/day', 'eqm/day'):
        return f"{value:.1f}"
    else:
        return f"{value:.0f}"


def get_display_unit(unit):
    """Return the display-ready unit string (identity — unit is processed elsewhere)."""
    return unit


# ---------------------------------------------------------------------------
# Date filtering
# ---------------------------------------------------------------------------

def filter_last_n_years(df, date_col='DT_REF', n_years=3, ref_year=None):
    """Filter a DataFrame to the last *n_years* (reference year + n-1 previous).

    *ref_year* is the last year of the analysis. When omitted, the current
    calendar year is used (original behaviour). The report builder passes the
    year of the last date in the data, so a report built from a past interval
    (e.g. Jan/2024–Dec/2025, generated in 2026) keeps all of its years.
    """
    current_year = ref_year or datetime.now().year
    min_year = current_year - (n_years - 1)
    return df[df[date_col].dt.year >= min_year].copy()


# ---------------------------------------------------------------------------
# Font helpers
# ---------------------------------------------------------------------------

# Project-local font folder. Drop .ttf/.otf files here (e.g. calibri.ttf,
# calibrib.ttf, ValeSans-Bold.ttf) to get the same look on Linux/Databricks,
# where Windows fonts are not installed. Can be overridden with the
# REPORT_FONTS_DIR environment variable.
_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONTS_DIR = os.environ.get('REPORT_FONTS_DIR', os.path.join(_PROJECT_ROOT, 'data', 'fonts'))

_warned_fonts = set()


def _dejavu_fallback(names):
    """Pick a DejaVu variant (shipped with matplotlib) matching the requested style."""
    first = os.path.splitext(str(names[0]).lower())[0] if names else ''
    # Windows-style names: <base><suffix>, e.g. calibrib, arialbd, segoeuiz
    suffix = first
    for base in ('calibri', 'segoeui', 'arial'):
        if first.startswith(base):
            suffix = first[len(base):]
            break
    bold = any(k in first for k in ('bold', 'medium')) or suffix in ('b', 'bd', 'z', 'bi')
    italic = any(k in first for k in ('italic', 'oblique')) or suffix in ('i', 'z', 'bi')
    variant = {
        (True, True): 'DejaVuSans-BoldOblique.ttf',
        (True, False): 'DejaVuSans-Bold.ttf',
        (False, True): 'DejaVuSans-Oblique.ttf',
        (False, False): 'DejaVuSans.ttf',
    }[(bold, italic)]
    try:
        import matplotlib
        return os.path.join(matplotlib.get_data_path(), 'fonts', 'ttf', variant)
    except Exception:
        return variant


def load_font(names, size):
    """
    Load a TrueType font from a list of candidates.

    Search order: project font folder (FONTS_DIR) → system font paths →
    DejaVu Sans bundled with matplotlib (same weight/style) → PIL default.
    The DejaVu step keeps titles at the right size on Linux/Databricks,
    where Calibri/Arial/Segoe are not available.
    """
    for name in names:
        # DejaVu entries are handled by the style-aware fallback below, so the
        # result is the same whether or not DejaVu is installed system-wide.
        if str(name).lower().startswith('dejavu'):
            continue
        local = os.path.join(FONTS_DIR, name)
        for candidate in (local, name):
            try:
                return ImageFont.truetype(candidate, size)
            except (OSError, IOError):
                continue

    fallback = _dejavu_fallback(names)
    key = (tuple(names), fallback)
    if key not in _warned_fonts:
        _warned_fonts.add(key)
        logger.debug("Fonts %s not found — using %s", names, os.path.basename(fallback))
    try:
        return ImageFont.truetype(fallback, size)
    except (OSError, IOError):
        try:
            return ImageFont.load_default(size=size)   # Pillow >= 10.1
        except TypeError:
            return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Filename helpers
# ---------------------------------------------------------------------------

def sanitize_filename(name):
    """Remove characters not allowed in Windows file names."""
    return re.sub(r'[\\/:*?"<>|]', '_', str(name))


def build_output_path(output_dir, business_unit):
    """Build the output PDF path: ``<output_dir>/<BU>_<timestamp>.pdf``."""
    safe_bu = business_unit.replace(' ', '_').replace('/', '_')
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"{safe_bu}_{timestamp}.pdf"
    return os.path.join(output_dir, filename)


# ---------------------------------------------------------------------------
# BU image helper
# ---------------------------------------------------------------------------

def get_bu_image_path(bu_name, images_dir, bu_image_map):
    """
    Return the full path to a BU cover image, or *None* if not found.
    Tries .png, .jpg, .jpeg extensions.
    """
    image_base = bu_image_map.get(bu_name, 'image_capa')

    for ext in ('.png', '.jpg', '.jpeg'):
        candidate = os.path.join(images_dir, image_base + ext)
        if os.path.exists(candidate):
            return candidate

    return None
