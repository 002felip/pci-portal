"""
Consolidated report — one PDF with all the selected Business Units.

Order: for each BU, cover, KPI list and one page per KPI (the same pages of the BU report).
The Stability & Capability Scores summary page (page_composer.generate_scores_page) is still
in development and is left out of the PDF for now.

The pages of each BU come from ReportBuilder.build_pages(); the Excel is read only once.
A BU that fails is logged ("FAILED for BU '<bu>': …") and left out; the others go on.
"""

import logging
import os
import shutil
import tempfile

from .config import build_config
from .exceptions import ReportGenerationError
from .page_composer import generate_scores_page  # noqa: F401 — resumo dos scores, desligado por ora
from .pdf_compiler import compile_multi_page_pdf
from .report_builder import ReportBuilder
from .utils import build_output_path

logger = logging.getLogger(__name__)

MESES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
         'September', 'October', 'November', 'December']


def _rotulo_periodo(df_raw, ano):
    """'January – September data': meses do ano de referência presentes nos dados."""
    do_ano = df_raw[df_raw['DT_REF'].dt.year == ano]['DT_REF']
    if do_ano.empty:
        return f"{ano} data"
    m0, m1 = do_ano.min().month, do_ano.max().month
    return f"{MESES[m0 - 1]} data" if m0 == m1 else f"{MESES[m0 - 1]} – {MESES[m1 - 1]} data"


def generate_consolidated(bus, cli_overrides, yaml_path=None):
    """Build the consolidated PDF for the BUs in `bus` (in that order). Returns the PDF path."""
    from src.data_loader import load_excel_data

    base = build_config(cli_args={**cli_overrides, 'business_unit': (bus or [None])[0]}, yaml_path=yaml_path)
    logger.info("Loading data from %s ...", base.data_file)
    df_raw = load_excel_data(base.data_file)
    disponiveis = set(df_raw['BUSINESS UNIT'].dropna().unique())
    if not bus:
        bus = sorted(disponiveis)

    ano = base.reference_year
    if not ano:
        ano = int(df_raw['DT_REF'].max().year)
    cli_overrides = {**cli_overrides, 'reference_year': ano}

    paginas, grupos, builders, falhas = [], [], [], []
    try:
        for bu in bus:
            logger.info("=" * 60)
            logger.info("STARTING REPORT GENERATION  |  BU: %s", bu)
            logger.info("=" * 60)
            if bu not in disponiveis:
                logger.error("FAILED for BU '%s': no records in the data", bu)
                falhas.append(bu)
                continue
            config = build_config(cli_args={**cli_overrides, 'business_unit': bu}, yaml_path=yaml_path)
            config.validate()
            builder = ReportBuilder(config)
            builders.append(builder)
            try:
                paginas_bu = builder.build_pages(df_raw)
            except Exception as e:  # noqa: BLE001 — uma BU com erro não derruba as outras
                logger.error("FAILED for BU '%s': %s", bu, e)
                falhas.append(bu)
                continue
            paginas.extend(paginas_bu)
            grupos.append((bu, builder.scores))
            logger.info("BU DONE  |  %s  |  Pages: %d", bu, len(paginas_bu))

        # Nome do processo repetido na mesma BU (ex.: "Ferro Nickel" nos dois fornos): acrescenta o site
        for _, linhas in grupos:
            vistos = {}
            for r in linhas:
                vistos[r['processo']] = vistos.get(r['processo'], 0) + 1
            for r in linhas:
                if vistos[r['processo']] > 1:
                    r['processo'] = f"{r['processo']} · {str(r['site']).split('|')[-1].strip()}"

        if not grupos:
            raise ReportGenerationError("No Business Unit could be generated for the consolidated report.")

        temp = tempfile.mkdtemp(prefix='kpi_consolidado_')
        try:
            cfg = base.as_chart_config()
            # Página de resumo dos Stability & Capability Scores: em desenvolvimento, fora do PDF
            # por ora. Para voltar com ela: todas = [generate_scores_page(grupos, ano,
            # _rotulo_periodo(df_raw, ano), cfg, temp)] + paginas
            todas = list(paginas)

            output_path = build_output_path(base.output_dir, 'Consolidated')
            os.makedirs(base.output_dir, exist_ok=True)
            local_pdf = os.path.join(temp, os.path.basename(output_path))
            logger.info("Compiling consolidated PDF: %s  (%d pages)", output_path, len(todas))
            compile_multi_page_pdf(todas, local_pdf, cfg)
            shutil.copyfile(local_pdf, output_path)
        finally:
            shutil.rmtree(temp, ignore_errors=True)

        logger.info("=" * 60)
        logger.info("SUCCESS  |  CONSOLIDATED  |  BUs: %d  |  Pages: %d", len(grupos), len(todas))
        if falhas:
            logger.warning("Left out: %s", ', '.join(falhas))
        logger.info("PDF: %s", output_path)
        logger.info("=" * 60)
        return output_path
    finally:
        for b in builders:
            b.cleanup()
