"""
Report Configuration Module

Defines ReportConfig dataclass and YAML configuration loading.
All parameters for report generation are centralized here.
"""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import yaml

from .exceptions import ConfigurationError


# Project root (…/stable-capable-pdf-generator). Relative paths in the config
# are resolved against it, so the script works no matter the current working
# directory (Databricks jobs do not run from the project root).
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

PATH_FIELDS = ('data_file', 'kpi_list_file', 'images_dir', 'output_dir', 'log_dir')


def resolve_path(path: Optional[str]) -> Optional[str]:
    """Return *path* as absolute. Relative paths are taken from PROJECT_ROOT.

    Absolute paths (e.g. ``/Volumes/<catalog>/<schema>/<volume>/...`` or
    ``/dbfs/...``) are returned unchanged. ``~`` and env vars are expanded.
    """
    if not path:
        return path
    path = os.path.expandvars(os.path.expanduser(str(path)))
    if os.path.isabs(path):
        return path
    return os.path.normpath(os.path.join(PROJECT_ROOT, path))


# Default color scheme (matches notebook COLORS dict)
DEFAULT_COLORS = {
    'years': [
        '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
        '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
    ],
    'control_chart': {
        'line': 'steelblue',
        'cl': 'green',
        'ucl_lcl': 'red',
        'sigma1': 'orange',
        'sigma2': 'darkorange',
        'violations': {
            'rule1': 'red',
            'rule2': 'orange',
            'rule3': 'gold',
            'rule4': 'purple',
        },
    },
    'budget': '#00afef',
    'mean_bar': '#e8e8e8',
    'mean_text': '#155f82',
    'mean_text_below_budget': 'white',
    'p75': '#9db0cf',
    'best90': '#6e8db8',
    'annual_mean': 'darkgreen',
}

# BU → cover image filename (without extension)
DEFAULT_BU_IMAGE_MAP = {
    'Manitoba': 'image_manitoba',
    'Onça Puma': 'image_onca_puma',
    'Ontario': 'image_ontario',
    'Salobo': 'image_salobo',
    'Sossego': 'image_sossego',
    'VNL+IR': 'image_vnl_ir',
}


@dataclass
class ReportConfig:
    """Configuration for multi-KPI PDF report generation."""

    # Required
    business_unit: str = ''

    # Data parameters
    max_years: int = 3  # Reference year + (max_years - 1) previous
    # Last year of the analysis. None → year of the last date in the data.
    reference_year: Optional[int] = None

    # Paths (relative to project root)
    data_file: str = 'data/Stable.xlsx'
    kpi_list_file: str = 'data/kpi_list.xlsx'
    images_dir: str = 'data/images'
    output_dir: str = 'reports'
    log_dir: str = 'reports/logs'

    # Page dimensions (452 mm × 254 mm @ 96 DPI)
    dpi: int = 96
    page3_width: int = 1707
    page3_height: int = 960
    title_height: int = 60
    side_margin: int = 1
    grid_row1_height: int = 450
    grid_row2_height: int = 450

    # Chart sizes
    chart_sizes: Dict = field(default_factory=lambda: {
        'control': {'width': 1080, 'height': 420},
        'hist_table': {'width': 540, 'height': 420},
        'process': {'width': 1080, 'height': 420},
    })

    # Colors
    colors: Dict = field(default_factory=lambda: DEFAULT_COLORS.copy())

    # BU image mapping
    bu_image_map: Dict = field(default_factory=lambda: DEFAULT_BU_IMAGE_MAP.copy())

    # Runtime flags
    keep_temp: bool = False
    log_level: str = 'INFO'

    def validate(self):
        """Validate configuration. Raises ConfigurationError on invalid values."""
        if not self.business_unit and not hasattr(self, '_all_bus'):
            raise ConfigurationError(
                "business_unit is required.\n"
                "Use --bu <name> or set business_unit in the config file."
            )

        if not 1 <= self.max_years <= 10:
            raise ConfigurationError(
                f"max_years must be between 1 and 10 (got {self.max_years}).\n"
                "Adjust --years or max_years in the config file."
            )

        if not os.path.exists(self.data_file):
            raise ConfigurationError(
                f"Data file not found: {self.data_file}\n"
                "Verify the file exists or adjust data_file in the config."
            )

    def as_chart_config(self) -> Dict:
        """Return a dict compatible with the chart functions' `config` parameter."""
        return {
            'max_years': self.max_years,
            'dpi': self.dpi,
            'page3_width': self.page3_width,
            'page3_height': self.page3_height,
            'title_height': self.title_height,
            'side_margin': self.side_margin,
            'grid_row1_height': self.grid_row1_height,
            'grid_row2_height': self.grid_row2_height,
            'chart_sizes': self.chart_sizes,
        }


def load_config_from_yaml(yaml_path: str) -> Dict:
    """Load configuration from a YAML file and return as a dict."""
    if not os.path.exists(yaml_path):
        raise ConfigurationError(f"Config file not found: {yaml_path}")

    with open(yaml_path, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f) or {}

    return data


def build_config(cli_args: Optional[Dict] = None, yaml_path: Optional[str] = None) -> ReportConfig:
    """
    Build a ReportConfig by merging YAML defaults with CLI overrides.

    Priority: CLI args > YAML file > dataclass defaults.
    """
    merged: Dict = {}

    # 1. Load YAML if provided
    if yaml_path:
        yaml_data = load_config_from_yaml(yaml_path)

        # Flatten nested 'output' and 'page' sections
        if 'output' in yaml_data:
            out = yaml_data.pop('output')
            merged['output_dir'] = out.get('base_dir', merged.get('output_dir'))
            merged['log_dir'] = out.get('log_dir', merged.get('log_dir'))

        if 'page' in yaml_data:
            pg = yaml_data.pop('page')
            if 'width' in pg:
                merged['page3_width'] = pg['width']
            if 'height' in pg:
                merged['page3_height'] = pg['height']
            if 'dpi' in pg:
                merged['dpi'] = pg['dpi']

        merged.update(yaml_data)

    # 2. Apply CLI overrides (non-None values only)
    if cli_args:
        for key, value in cli_args.items():
            if value is not None:
                merged[key] = value

    # 3. Build config, ignoring unknown keys
    valid_fields = {f.name for f in ReportConfig.__dataclass_fields__.values()}
    filtered = {k: v for k, v in merged.items() if k in valid_fields and v is not None}

    # 4. Resolve paths (relative → PROJECT_ROOT)
    config = ReportConfig(**filtered)
    for name in PATH_FIELDS:
        setattr(config, name, resolve_path(getattr(config, name)))
    return config
