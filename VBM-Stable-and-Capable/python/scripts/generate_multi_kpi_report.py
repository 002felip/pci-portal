#!/usr/bin/env python
"""
Generate Multi-KPI PDF Report

CLI entry point for producing the Stable & Capable analysis PDF
from the data in data/Stable.xlsx.

Usage:
    python scripts/generate_multi_kpi_report.py --bu Ontario
    python scripts/generate_multi_kpi_report.py --bu Salobo --years 5
    python scripts/generate_multi_kpi_report.py --all-bus
    python scripts/generate_multi_kpi_report.py --bu Ontario --config config/report_config.yaml

Databricks (Python script task / spark_python_task):
    --all-bus --config config/report_config.databricks.yaml
    --bu Ontario --data-file /Volumes/<cat>/<schema>/<vol>/input/Stable.xlsx \
                 --output-dir /Volumes/<cat>/<schema>/<vol>/reports
"""

import argparse
import logging
import os
import shutil
import sys
import tempfile

# Ensure project root is on sys.path so `src` is importable.
# (Inside a Databricks notebook `__file__` may not exist — fall back to cwd.)
try:
    _SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
except NameError:
    _SCRIPT_DIR = os.path.join(os.getcwd(), 'scripts')
PROJECT_ROOT = os.path.abspath(os.path.join(_SCRIPT_DIR, '..'))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.report.config import build_config, resolve_path
from src.report.report_builder import ReportBuilder
from src.report.exceptions import ReportGenerationError


_LOCAL_LOG = None   # (local_path, final_dir) — copied at the end of the run


def _setup_logging(level_name: str, log_dir: str):
    """Configure root logger: console + file output.

    The log file is written to local temp disk and copied to *log_dir* when
    the run ends (see _publish_log). Appending line by line directly to a
    Databricks Volume / workspace path is not supported.
    """
    global _LOCAL_LOG
    level = getattr(logging, level_name.upper(), logging.INFO)

    fmt = logging.Formatter(
        '%(asctime)s | %(levelname)-7s | %(name)s | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S',
    )

    root = logging.getLogger()
    root.setLevel(level)

    # Console
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(level)
    ch.setFormatter(fmt)
    root.addHandler(ch)

    # File (local first)
    from datetime import datetime
    log_name = f"report_{datetime.now():%Y%m%d_%H%M%S}.log"
    local_log = os.path.join(tempfile.gettempdir(), log_name)
    fh = logging.FileHandler(local_log, encoding='utf-8')
    fh.setLevel(level)
    fh.setFormatter(fmt)
    root.addHandler(fh)
    _LOCAL_LOG = (local_log, log_dir)

    logging.getLogger().info("Log file: %s", os.path.join(log_dir, log_name))


def _publish_log():
    """Copy the local log file to the configured log_dir (best effort)."""
    if not _LOCAL_LOG:
        return
    local_log, log_dir = _LOCAL_LOG
    for h in logging.getLogger().handlers:
        h.flush()
    try:
        os.makedirs(log_dir, exist_ok=True)
        shutil.copyfile(local_log, os.path.join(log_dir, os.path.basename(local_log)))
    except Exception as e:  # never fail the job because of the log copy
        print(f"WARNING: could not copy log to {log_dir}: {e}", file=sys.stderr)


def _install_project_fonts():
    """Make fonts in data/fonts visible to Plotly/kaleido (Chromium uses fontconfig).

    PIL already reads data/fonts directly (see src/report/utils.load_font); this
    copies them to ~/.fonts so the Plotly charts can use Calibri/Arial too.
    Best effort — on failure Chromium just uses its default fonts.
    """
    from src.report.utils import FONTS_DIR
    if not os.path.isdir(FONTS_DIR):
        return
    fonts = [f for f in os.listdir(FONTS_DIR) if f.lower().endswith(('.ttf', '.otf'))]
    if not fonts:
        return
    try:
        target = os.path.join(os.path.expanduser('~'), '.fonts')
        os.makedirs(target, exist_ok=True)
        for f in fonts:
            dst = os.path.join(target, f)
            if not os.path.exists(dst):
                shutil.copyfile(os.path.join(FONTS_DIR, f), dst)
        logging.getLogger(__name__).info("Project fonts installed for charts: %d file(s)", len(fonts))
    except Exception as e:
        logging.getLogger(__name__).warning("Could not install project fonts: %s", e)


def _parse_args():
    parser = argparse.ArgumentParser(
        description='Generate Multi-KPI Stable & Capable PDF Report',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    parser.add_argument(
        '--bu', dest='business_unit', type=str, default=None,
        help='Business Unit name (e.g. Ontario, Salobo, Sossego)',
    )
    parser.add_argument(
        '--all-bus', action='store_true', default=False,
        help='Generate reports for ALL available Business Units',
    )
    parser.add_argument(
        '--years', dest='max_years', type=int, default=None,
        help='Number of years to include (default: 3)',
    )
    parser.add_argument(
        '--config', dest='config_file', type=str, default=None,
        help='Path to YAML config file (default: config/report_config.yaml if exists)',
    )
    parser.add_argument(
        '--output-dir', dest='output_dir', type=str, default=None,
        help='Output directory for PDFs (default: reports/)',
    )
    parser.add_argument(
        '--reference-year', dest='reference_year', type=int, default=None,
        help='Last year of the analysis (default: year of the last date in the data)',
    )
    parser.add_argument(
        '--data-file', dest='data_file', type=str, default=None,
        help='Path to Stable.xlsx (e.g. /Volumes/<cat>/<schema>/<vol>/input/Stable.xlsx)',
    )
    parser.add_argument(
        '--kpi-list-file', dest='kpi_list_file', type=str, default=None,
        help='Path to kpi_list.xlsx',
    )
    parser.add_argument(
        '--images-dir', dest='images_dir', type=str, default=None,
        help='Folder with cover images',
    )
    parser.add_argument(
        '--log-dir', dest='log_dir', type=str, default=None,
        help='Folder for log files (default: <output-dir>/logs from YAML)',
    )
    parser.add_argument(
        '--keep-temp', action='store_true', default=False,
        help='Keep temporary PNG files after PDF generation',
    )
    parser.add_argument(
        '--log-level', dest='log_level', type=str, default=None,
        choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'],
        help='Logging level (default: INFO)',
    )

    return parser.parse_args()


def _resolve_config_file(cli_path):
    """Return a YAML config path if one exists."""
    if cli_path:
        # Accept paths relative to the cwd OR to the project root
        if os.path.exists(cli_path):
            return os.path.abspath(cli_path)
        return resolve_path(cli_path)
    default = os.path.join(PROJECT_ROOT, 'config', 'report_config.yaml')
    if os.path.exists(default):
        return default
    return None


def main():
    args = _parse_args()

    # Resolve YAML config
    yaml_path = _resolve_config_file(args.config_file)

    # Build CLI overrides dict
    cli_overrides = {
        'business_unit': args.business_unit,
        'max_years': args.max_years,
        'output_dir': args.output_dir,
        'reference_year': args.reference_year,
        'data_file': args.data_file,
        'kpi_list_file': args.kpi_list_file,
        'images_dir': args.images_dir,
        # If only --output-dir is given, keep logs next to the PDFs
        'log_dir': args.log_dir or (os.path.join(args.output_dir, 'logs') if args.output_dir else None),
        'keep_temp': args.keep_temp,
        'log_level': args.log_level,
    }

    # Build a temporary config just to get log settings
    temp_config = build_config(cli_args=cli_overrides, yaml_path=yaml_path)
    _setup_logging(temp_config.log_level, temp_config.log_dir)

    logger = logging.getLogger(__name__)
    logger.info("Project root: %s", PROJECT_ROOT)
    logger.info("Data file:    %s", temp_config.data_file)
    logger.info("Output dir:   %s", temp_config.output_dir)
    _install_project_fonts()

    if args.all_bus:
        # Discover all BUs from data
        from src.data_loader import load_excel_data

        data_file = temp_config.data_file
        logger.info("Loading data to discover Business Units...")
        df_raw = load_excel_data(data_file)
        available_bus = sorted(df_raw['BUSINESS UNIT'].dropna().unique())
        logger.info("Found %d BUs: %s", len(available_bus), ', '.join(available_bus))

        results = []
        for bu in available_bus:
            cli_overrides_bu = {**cli_overrides, 'business_unit': bu}
            config = build_config(cli_args=cli_overrides_bu, yaml_path=yaml_path)
            config.validate()

            try:
                builder = ReportBuilder(config)
                pdf_path = builder.run()
                results.append((bu, pdf_path, None))
            except ReportGenerationError as e:
                logger.error("FAILED for BU '%s': %s", bu, e)
                results.append((bu, None, str(e)))
                # Fail-fast: interrupt on first error
                logger.error("Execution interrupted (fail-fast). Fix the error and re-run.")
                sys.exit(1)

        # Summary
        logger.info("=" * 60)
        logger.info("ALL-BU SUMMARY")
        logger.info("=" * 60)
        for bu, path, err in results:
            if path:
                logger.info("  [OK] %s → %s", bu, path)
            else:
                logger.info("  [FAIL] %s → %s", bu, err)

    else:
        # Single BU
        if not args.business_unit:
            # Try from YAML
            if not temp_config.business_unit:
                logger.error(
                    "No Business Unit specified. Use --bu <name> or --all-bus.\n"
                    "Example: python scripts/generate_multi_kpi_report.py --bu Ontario"
                )
                sys.exit(1)

        config = build_config(cli_args=cli_overrides, yaml_path=yaml_path)
        config.validate()

        try:
            builder = ReportBuilder(config)
            pdf_path = builder.run()
            logger.info("Report saved: %s", pdf_path)
        except ReportGenerationError as e:
            logger.error("Report generation FAILED: %s", e)
            sys.exit(1)


if __name__ == '__main__':
    try:
        main()
    finally:
        _publish_log()
