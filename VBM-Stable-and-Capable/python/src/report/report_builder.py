"""
Report Builder Module

Orchestrates the entire multi-KPI PDF report generation workflow:
    1. Load & validate configuration
    2. Load raw data
    3. Discover KPI combinations (kpi, type_operation, site)
    4. Generate cover pages
    5. Generate KPI detail pages (one per combination)
    6. Compile all pages into a single PDF
    7. Cleanup temporary files

Fail-fast: any error interrupts execution with a detailed message.
"""

import os
import shutil
import logging
import tempfile
from datetime import datetime

import pandas as pd

from .config import ReportConfig
from .exceptions import (
    ReportGenerationError,
    DataValidationError,
    ChartGenerationError,
    PDFCompilationError,
)
from .data_processor import load_kpi_data, calculate_statistics_by_year
from .chart_generator import (
    create_control_chart,
    create_histogram_table2,
    create_process_capability_moshe,
)
from .page_composer import compose_page3, generate_cover_page, generate_kpi_list_page
from .pdf_compiler import compile_multi_page_pdf
from .utils import sanitize_filename, build_output_path

logger = logging.getLogger(__name__)


class ReportBuilder:
    """
    Orchestrates the multi-KPI PDF report generation for a single Business Unit.

    Usage
    -----
    >>> from src.report.config import build_config
    >>> config = build_config(cli_args={'business_unit': 'Ontario', 'max_years': 3})
    >>> builder = ReportBuilder(config)
    >>> pdf_path = builder.run()
    """

    def __init__(self, config: ReportConfig):
        self.config = config
        self._temp_dir = None
        self._df_raw = None
        self._df_bu = None
        self._kpi_list = None
        self._combinations = []

    # ═══════════════════════════════════════════════════════════════════
    # Public API
    # ═══════════════════════════════════════════════════════════════════

    def run(self) -> str:
        """
        Execute the full report generation pipeline.

        Returns
        -------
        str
            Path to the generated PDF file.

        Raises
        ------
        ReportGenerationError
            On any failure during the pipeline.
        """
        bu = self.config.business_unit
        logger.info("=" * 60)
        logger.info("STARTING REPORT GENERATION  |  BU: %s", bu)
        logger.info("=" * 60)

        try:
            self._temp_dir = tempfile.mkdtemp(prefix='kpi_pages_')
            logger.info("Temporary directory: %s", self._temp_dir)

            # Step 1 — Load data
            self._load_data()

            # Step 2 — Discover combinations
            self._discover_combinations()

            # Step 3 — Generate cover pages
            cover_pages = self._generate_cover_pages()

            # Step 4 — Generate KPI detail pages
            kpi_pages = self._generate_kpi_pages()

            # Step 5 — Compile PDF
            all_pages = cover_pages + kpi_pages
            pdf_path = self._compile_pdf(all_pages)

            logger.info("=" * 60)
            logger.info("SUCCESS  |  BU: %s  |  Pages: %d", bu, len(all_pages))
            logger.info("PDF: %s", pdf_path)
            logger.info("=" * 60)

            return pdf_path

        except (ReportGenerationError, DataValidationError, ChartGenerationError, PDFCompilationError):
            raise  # Already has context

        except Exception as e:
            raise ReportGenerationError(
                f"Unexpected error during report generation for BU '{bu}': {e}"
            ) from e

        finally:
            self._cleanup()

    # ═══════════════════════════════════════════════════════════════════
    # Pipeline steps
    # ═══════════════════════════════════════════════════════════════════

    def _load_data(self):
        """Load raw data from Excel and filter by business unit."""
        from src.data_loader import load_excel_data

        data_file = self.config.data_file
        logger.info("Loading data from %s ...", data_file)

        self._df_raw = load_excel_data(data_file)
        logger.info("  Total records loaded: %d", len(self._df_raw))

        # Reference year = last year in the data (unless set explicitly), so
        # the year window follows the data interval, not the clock.
        if not self.config.reference_year:
            last = self._df_raw['DT_REF'].max()
            self.config.reference_year = int(last.year) if pd.notna(last) else None
        logger.info("  Years: %s → %s (max_years=%d)",
                    (self.config.reference_year or 0) - self.config.max_years + 1,
                    self.config.reference_year, self.config.max_years)

        # Filter by BU
        bu = self.config.business_unit
        self._df_bu = self._df_raw[self._df_raw['BUSINESS UNIT'] == bu].copy()

        if len(self._df_bu) == 0:
            available = sorted(self._df_raw['BUSINESS UNIT'].dropna().unique())
            raise DataValidationError(
                f"No records found for Business Unit '{bu}'.\n"
                f"Available BUs: {', '.join(available)}"
            )

        logger.info("  Records for '%s': %d", bu, len(self._df_bu))

    def _discover_combinations(self):
        """Build the ordered list of (KPI, TYPE_OPERATION, SITE) combinations."""
        bu = self.config.business_unit
        df_bu = self._df_bu

        # Get KPI list from data
        kpi_list_from_data = df_bu['NAME KPI'].unique().tolist()

        # Try to load ordered KPI list from kpi_list.xlsx
        kpi_list_file = self.config.kpi_list_file
        self._kpi_list = self._load_kpi_order(kpi_list_from_data, kpi_list_file, bu)

        # Filter df_bu to keep only combinations present in kpi_list.xlsx
        self._df_bu = self._filter_by_kpi_list(self._df_bu, kpi_list_file, bu)
        df_bu = self._df_bu

        # Build combinations following KPI order
        combinations = []
        seen = set()

        for kpi_name in self._kpi_list:
            df_kpi_filtered = df_bu[df_bu['NAME KPI'] == kpi_name]
            if len(df_kpi_filtered) == 0:
                continue

            unique_combos = df_kpi_filtered[['TYPE OPERATION', 'NAME SITE']].drop_duplicates()
            for _, row in unique_combos.iterrows():
                type_op = row['TYPE OPERATION']
                site = row['NAME SITE']
                key = (
                    kpi_name.strip().lower(),
                    str(type_op).strip().lower() if pd.notna(type_op) else '',
                    site.strip().lower(),
                )
                if key not in seen:
                    seen.add(key)
                    combinations.append((kpi_name, type_op, site))

        if not combinations:
            raise DataValidationError(
                f"No KPI combinations found for BU '{bu}'. "
                "Check that data contains NAME KPI, TYPE OPERATION, and NAME SITE columns."
            )

        self._combinations = combinations
        logger.info("Total combinations to generate: %d", len(combinations))

    def _generate_cover_pages(self):
        """Generate cover page and KPI list page."""
        bu = self.config.business_unit
        cfg = self.config.as_chart_config()
        pages = []

        logger.info("Generating cover pages...")

        # Cover image
        cover_path = generate_cover_page(
            bu, cfg, self._temp_dir,
            self.config.images_dir,
            self.config.bu_image_map,
        )
        pages.append(cover_path)
        logger.info("  Cover page: %s", os.path.basename(cover_path))

        # KPI list table
        kpi_list_path = generate_kpi_list_page(
            self._kpi_list,
            bu,
            cfg,
            self._temp_dir,
            self._df_bu,
            self.config.kpi_list_file,
        )
        pages.append(kpi_list_path)
        logger.info("  KPI list page: %s", os.path.basename(kpi_list_path))

        return pages

    # def _generate_kpi_pages(self):
    #     """Generate one detail page per KPI combination. Fail-fast on any error."""
    #     bu = self.config.business_unit
    #     cfg = self.config.as_chart_config()
    #     colors = self.config.colors
    #     pages = []
    #     total = len(self._combinations)

    #     logger.info("Generating %d KPI pages for BU '%s' ...", total, bu)

    #     for idx, (kpi_name, type_op, site_name) in enumerate(self._combinations, 1):
    #         logger.info(
    #             "  [%d/%d] %s | %s | %s",
    #             idx, total, kpi_name, type_op, site_name,
    #         )

    #         page_path = self._generate_single_page(
    #             kpi_name, type_op, site_name, cfg, colors,
    #         )
    #         pages.append(page_path)

    #     logger.info("All %d KPI pages generated successfully.", total)
    #     return pages

    def _generate_kpi_pages(self):
        """Generate one detail page per KPI combination. Fail-fast on any error."""
        bu = self.config.business_unit
        cfg = self.config.as_chart_config()
        colors = self.config.colors
        pages = []

        # Build sort order from Excel row index keyed by (kpi, type_op, site) —
        # all three columns — so combinations sharing the same KPI name but
        # different sites are ordered by their individual Excel row position,
        # matching the order shown on the KPI list page.
        combo_excel_order = {}
        try:
            df_xlsx = pd.read_excel(self.config.kpi_list_file)
            col_lower = {c.strip().lower(): c for c in df_xlsx.columns}
            bu_col = (col_lower.get('business unit')
                      or col_lower.get('business_unit')
                      or col_lower.get('businessunit'))
            kpi_col = (col_lower.get('kpi')
                       or col_lower.get('name kpi')
                       or col_lower.get('name_kpi'))
            type_op_col = (col_lower.get('type operation')
                           or col_lower.get('type_operation'))
            site_col = (col_lower.get('name site')
                        or col_lower.get('name_site'))
            if bu_col and kpi_col:
                df_bu_kpis = df_xlsx[
                    df_xlsx[bu_col].str.strip().str.lower() == bu.strip().lower()
                ].reset_index(drop=True)
                for i, row in df_bu_kpis.iterrows():
                    kpi_val = row.get(kpi_col, '')
                    if not pd.notna(kpi_val):
                        continue
                    kpi_key = str(kpi_val).strip().lower()
                    type_op_key = str(row.get(type_op_col, '') or '').strip().lower() if type_op_col else ''
                    site_key = str(row.get(site_col, '') or '').strip().lower() if site_col else ''
                    # Store first occurrence wins (preserves Excel row order)
                    full_key = (kpi_key, type_op_key, site_key)
                    if full_key not in combo_excel_order:
                        combo_excel_order[full_key] = i
        except Exception:
            pass

        def _sort_key(combo):
            kpi_name, type_op, site_name = combo
            k = (kpi_name.strip().lower(),
                 str(type_op or '').strip().lower(),
                 str(site_name or '').strip().lower())
            # Try exact (kpi, type_op, site) match first
            if k in combo_excel_order:
                return combo_excel_order[k]
            # Fall back to (kpi, site) ignoring type_op
            for (ek, et, es), idx in combo_excel_order.items():
                if ek == k[0] and es == k[2]:
                    return idx
            # Fall back to kpi-only
            for (ek, et, es), idx in combo_excel_order.items():
                if ek == k[0]:
                    return idx
            return len(combo_excel_order)

        if combo_excel_order:
            sorted_combinations = sorted(self._combinations, key=_sort_key)
        else:
            sorted_combinations = self._combinations

        total = len(sorted_combinations)

        logger.info("Generating %d KPI pages for BU '%s' ...", total, bu)

        for idx, (kpi_name, type_op, site_name) in enumerate(sorted_combinations, 1):
            logger.info(
                "  [%d/%d] %s | %s | %s",
                idx, total, kpi_name, type_op, site_name,
            )
            page_path = self._generate_single_page(
                kpi_name, type_op, site_name, cfg, colors,
            )
            pages.append(page_path)

        logger.info("All %d KPI pages generated successfully.", total)
        return pages

    def _generate_single_page(self, kpi_name, type_op, site_name, cfg, colors):
        """Generate a single KPI detail page. Raises on failure."""

        # Load data
        kpi_data = load_kpi_data(
            self._df_raw,
            self.config.business_unit,
            kpi_name,
            site_name=site_name,
            type_operation=type_op,
            n_years=self.config.max_years,
            ref_year=self.config.reference_year,
        )

        if kpi_data is None:
            raise DataValidationError(
                f"No data found for combination:\n"
                f"  BU: {self.config.business_unit}\n"
                f"  KPI: {kpi_name}\n"
                f"  Phase: {type_op}\n"
                f"  Site: {site_name}\n"
                "Check data source for missing records."
            )

        # Charts
        try:
            fig_control = create_control_chart(
                kpi_data['df_kpi'], kpi_data['unit'], kpi_name, cfg, colors,
            )
        except Exception as e:
            raise ChartGenerationError(
                f"Control chart failed for '{kpi_name}' ({site_name}): {e}"
            ) from e

        try:
            fig_hist_table = create_histogram_table2(
                kpi_data['df_kpi'], kpi_data['unit'], kpi_name,
            )
        except Exception as e:
            raise ChartGenerationError(
                f"Histogram chart failed for '{kpi_name}' ({site_name}): {e}"
            ) from e

        try:
            fig_process = create_process_capability_moshe(
                kpi_data['df_kpi'], kpi_data['unit'], kpi_name, cfg, colors,
            )
        except Exception as e:
            raise ChartGenerationError(
                f"Process capability chart failed for '{kpi_name}' ({site_name}): {e}"
            ) from e

        # Compose page
        page_img = compose_page3(
            fig_control, fig_hist_table, fig_process,
            kpi_data['metadata'], cfg,
        )

        # Save to temp
        safe_kpi = sanitize_filename(kpi_name)
        safe_phase = sanitize_filename(str(type_op))
        safe_site = sanitize_filename(site_name)

        existing = [f for f in os.listdir(self._temp_dir)
                     if f.endswith('.png') and not f.startswith('_page_')]
        file_num = len(existing) + 1

        temp_file = os.path.join(
            self._temp_dir,
            f"page_{file_num:03d}_{safe_kpi}_{safe_phase}_{safe_site}.png",
        )
        page_img.save(temp_file, format='PNG', dpi=(96, 96))
        logger.info("    Saved: %s", os.path.basename(temp_file))

        return temp_file

    def _compile_pdf(self, all_pages):
        """Compile all page images into a single PDF."""
        output_path = build_output_path(self.config.output_dir, self.config.business_unit)
        os.makedirs(self.config.output_dir, exist_ok=True)

        # Build the PDF on local disk first, then copy it to the destination.
        # Destinations such as Databricks Unity Catalog Volumes (/Volumes/...)
        # or workspace files are FUSE mounts that do not support the random /
        # incremental writes a PDF library may do; a single sequential copy is safe.
        local_pdf = os.path.join(self._temp_dir, os.path.basename(output_path))

        logger.info("Compiling PDF: %s  (%d pages)", output_path, len(all_pages))
        compile_multi_page_pdf(all_pages, local_pdf, self.config.as_chart_config())
        shutil.copyfile(local_pdf, output_path)

        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        logger.info("  File size: %.2f MB", size_mb)

        return output_path

    def _cleanup(self):
        """Remove temporary directory unless keep_temp is set."""
        if self._temp_dir and os.path.exists(self._temp_dir):
            if self.config.keep_temp:
                logger.info("Keeping temp directory: %s", self._temp_dir)
            else:
                shutil.rmtree(self._temp_dir)
                logger.info("Temporary directory removed.")

    # ═══════════════════════════════════════════════════════════════════
    # Helper
    # ═══════════════════════════════════════════════════════════════════

    @staticmethod
    def _load_kpi_order(kpi_list_from_data, kpi_list_file, bu_name):
        """
        Load KPI order from kpi_list.xlsx. Falls back to data order.
        """
        try:
            df_xlsx = pd.read_excel(kpi_list_file)
            col_lower = {c.strip().lower(): c for c in df_xlsx.columns}

            bu_col = (col_lower.get('business unit')
                      or col_lower.get('business_unit')
                      or col_lower.get('businessunit'))
            kpi_col = (col_lower.get('kpi')
                       or col_lower.get('name kpi')
                       or col_lower.get('name_kpi'))

            if bu_col and kpi_col:
                df_bu_kpis = df_xlsx[
                    df_xlsx[bu_col].str.strip().str.lower() == bu_name.strip().lower()
                ]
                if len(df_bu_kpis) > 0:
                    kpi_mapping = {k.strip().lower(): k for k in kpi_list_from_data}
                    ordered = []
                    for kpi_excel in df_bu_kpis[kpi_col]:
                        if pd.notna(kpi_excel):
                            norm = str(kpi_excel).strip().lower()
                            if norm in kpi_mapping:
                                ordered.append(kpi_mapping[norm])

                    # Add KPIs present in data but missing from Excel
                    matched = {k.strip().lower() for k in ordered}
                    extras = sorted(k for k in kpi_list_from_data if k.strip().lower() not in matched)
                    ordered.extend(extras)

                    if extras:
                        logger.info(
                            "  %d KPIs from kpi_list.xlsx + %d extras from data",
                            len(ordered) - len(extras), len(extras),
                        )
                    else:
                        logger.info(
                            "  Using KPI order from kpi_list.xlsx (%d KPIs)",
                            len(ordered),
                        )

                    # Deduplicate preserving order
                    seen = set()
                    unique = []
                    for k in ordered:
                        n = k.strip().lower()
                        if n not in seen:
                            seen.add(n)
                            unique.append(k)
                    return unique

            logger.info("  kpi_list.xlsx: required columns not found — using data order")
        except FileNotFoundError:
            logger.info("  kpi_list.xlsx not found — using data order")
        except Exception as e:
            logger.warning("  Error loading kpi_list.xlsx: %s — using data order", e)

        return list(kpi_list_from_data)

    @staticmethod
    def _filter_by_kpi_list(df_bu, kpi_list_file, bu_name):
        """
        Filter df_bu to keep only rows whose (TYPE OPERATION, NAME SITE, NAME KPI)
        combination exists in kpi_list.xlsx for the given BU.
        Returns df_bu unchanged if kpi_list.xlsx is unavailable or missing columns.
        """
        try:
            df_xlsx = pd.read_excel(kpi_list_file)
            col_lower = {c.strip().lower(): c for c in df_xlsx.columns}

            bu_col = (col_lower.get('business unit')
                      or col_lower.get('business_unit')
                      or col_lower.get('businessunit'))
            kpi_col = (col_lower.get('kpi')
                       or col_lower.get('name kpi')
                       or col_lower.get('name_kpi'))
            type_op_col = (col_lower.get('type operation')
                           or col_lower.get('type_operation'))
            site_col = (col_lower.get('name site')
                        or col_lower.get('name_site'))

            if not (bu_col and kpi_col):
                return df_bu

            df_bu_kpis = df_xlsx[
                df_xlsx[bu_col].str.strip().str.lower() == bu_name.strip().lower()
            ]
            if len(df_bu_kpis) == 0:
                return df_bu

            # Build filter keys from kpi_list.xlsx
            filter_cols = ['NAME KPI']
            merge_map = {kpi_col: 'NAME KPI'}
            if type_op_col:
                filter_cols.append('TYPE OPERATION')
                merge_map[type_op_col] = 'TYPE OPERATION'
            if site_col:
                filter_cols.append('NAME SITE')
                merge_map[site_col] = 'NAME SITE'

            df_filter_keys = df_bu_kpis.rename(columns=merge_map)[filter_cols].drop_duplicates()

            # Normalize for case-insensitive matching
            match_cols = [f'_match_{c}' for c in filter_cols]
            for col, mcol in zip(filter_cols, match_cols):
                df_filter_keys[mcol] = df_filter_keys[col].astype(str).str.strip().str.upper()
            df_filter_keys = df_filter_keys[match_cols].drop_duplicates()

            df_bu_temp = df_bu.copy()
            for col, mcol in zip(filter_cols, match_cols):
                df_bu_temp[mcol] = df_bu_temp[col].astype(str).str.strip().str.upper()

            before = len(df_bu_temp)
            df_bu_filtered = df_bu_temp.merge(df_filter_keys, on=match_cols, how='inner').drop(columns=match_cols)
            after = len(df_bu_filtered)

            logger.info(
                "  Filtered df_bu by %s from kpi_list.xlsx (%d → %d records)",
                ', '.join(filter_cols), before, after,
            )
            return df_bu_filtered

        except FileNotFoundError:
            return df_bu
        except Exception as e:
            logger.warning("  Error filtering by kpi_list.xlsx: %s — skipping filter", e)
            return df_bu
