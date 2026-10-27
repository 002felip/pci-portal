"""
Page Composer Module

Handles the composition of individual pages for the multi-KPI PDF report:
    - compose_page3()          — KPI detail page (4 charts in 2×2 grid)
    - generate_cover_page()    — Cover page with BU image
    - generate_kpi_list_page() — KPI listing table page

Extracted from notebook 05_multi_kpi_pdf_generator.ipynb
"""

import logging
import os
from datetime import datetime
from io import BytesIO

import pandas as pd
import plotly.io as pio
from PIL import Image, ImageDraw, ImageFont

from .utils import get_bu_image_path, load_font

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# PIL helper
# ═══════════════════════════════════════════════════════════════════════════

def draw_rounded_rectangle(draw, xy, radius, fill=None, outline=None, width=1):
    """Draw a rounded rectangle on a PIL ImageDraw."""
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


# ═══════════════════════════════════════════════════════════════════════════
# PAGE 3 — KPI detail page
# ═══════════════════════════════════════════════════════════════════════════

def compose_page3(fig_control, fig_hist_table, fig_process2, kpi_metadata, config):
    """
    Compose a single KPI detail page with a 2×2 card grid layout.

    Layout: 452 mm × 254 mm (1707×960 px @ 96 DPI)
        - Title bar:  full width, teal background
        - Row 1:      Control Chart (65%) | Histogram (35%)
        - Row 2:      Process Capability (65%) | Comments (35%)

    Parameters
    ----------
    fig_control : plotly Figure
    fig_hist_table : plotly Figure
    fig_process2 : matplotlib Figure
    kpi_metadata : dict
    config : dict

    Returns
    -------
    PIL.Image
    """
    import matplotlib.pyplot as plt

    PAGE3_WIDTH = config['page3_width']
    PAGE3_HEIGHT = config['page3_height']
    TITLE_HEIGHT = config['title_height']

    BACKGROUND_COLOR = '#f9fafb'
    CARD_COLOR = 'white'
    BORDER_COLOR = '#e2e6e9'
    BORDER_WIDTH = 2
    CORNER_RADIUS = 10
    CARD_PADDING = 15
    TITLE_PADDING = 20

    content_height = PAGE3_HEIGHT - TITLE_HEIGHT
    row_height = (content_height - 3 * CARD_PADDING) // 2
    total_width = PAGE3_WIDTH - 3 * CARD_PADDING
    col1_width = int(total_width * 0.65)
    col2_width = int(total_width * 0.35)

    page3 = Image.new('RGB', (PAGE3_WIDTH, PAGE3_HEIGHT), BACKGROUND_COLOR)
    current_y = 0

    # ── Title bar ──────────────────────────────────────────────────
    title_img = Image.new('RGB', (PAGE3_WIDTH, TITLE_HEIGHT), '#3cb5e5')
    draw_title = ImageDraw.Draw(title_img)
    title_font = load_font(['calibrib.ttf', 'arialbd.ttf'], 36)

    site = kpi_metadata.get('site', '')
    phase = kpi_metadata.get('phase', '')
    kpi = kpi_metadata.get('kpi', '')
    display_unit = kpi_metadata.get('display_unit', kpi_metadata.get('unit', ''))

    if phase and phase.strip():
        title_text = f"{site} {phase} - {kpi} ({display_unit})"
    else:
        title_text = f"{site} - {kpi} ({display_unit})"

    text_y = (TITLE_HEIGHT - 36) // 2
    draw_title.text((25, text_y), title_text, fill='white', font=title_font)
    page3.paste(title_img, (0, current_y))
    current_y = TITLE_HEIGHT + CARD_PADDING

    card_title_font = load_font(['calibrib.ttf', 'arialbd.ttf'], 20)
    card_subtitle_font = load_font(['calibri.ttf', 'arial.ttf'], 16)
    TITLE_COLOR = '#2a3f5f'
    SUBTITLE_COLOR = 'gray'
    chart_area_height = row_height - 75

    # ── Card helper ────────────────────────────────────────────────
    def _make_card(w, h, title, subtitle):
        card = Image.new('RGB', (w, h), BACKGROUND_COLOR)
        d = ImageDraw.Draw(card)
        draw_rounded_rectangle(d, (0, 0, w - 1, h - 1), CORNER_RADIUS, CARD_COLOR, BORDER_COLOR, BORDER_WIDTH)
        d.text((TITLE_PADDING, TITLE_PADDING), title, fill=TITLE_COLOR, font=card_title_font)
        d.text((TITLE_PADDING, TITLE_PADDING + 22), subtitle, fill=SUBTITLE_COLOR, font=card_subtitle_font)
        d.line([(TITLE_PADDING, 62), (w - TITLE_PADDING, 62)], fill='#E8E8E8', width=1)
        return card

    # ── Row 1 ──────────────────────────────────────────────────────
    # Card 1: Control Chart
    card1 = _make_card(col1_width, row_height,
                       'Statistical Process Control (SPC) Chart',
                       'Standard method used to control process stability, distinguishing stable behavior from special cause events with nelson rules')
    ctrl_bytes = pio.to_image(fig_control, format='png', width=col1_width - 40, height=chart_area_height)
    card1.paste(Image.open(BytesIO(ctrl_bytes)), (20, 68))
    page3.paste(card1, (CARD_PADDING, current_y))

    # Card 2: Histogram
    card2 = _make_card(col2_width, row_height,
                       'Capability Histogram',
                       'Shows how the process results are distributed over the years')
    hist_bytes = pio.to_image(fig_hist_table, format='png', width=col2_width - 40, height=chart_area_height)
    card2.paste(Image.open(BytesIO(hist_bytes)), (20, 68))
    page3.paste(card2, (CARD_PADDING + col1_width + CARD_PADDING, current_y))

    # ── Row 2 ──────────────────────────────────────────────────────
    current_y += row_height + CARD_PADDING

    # Card 3: Process Capability (matplotlib)
    card3 = _make_card(col1_width, row_height,
                       'Statistical Measures and Comparisons',
                       'Summarize the process performance by quarter to understand if the budget is being consistently met')
    buf = BytesIO()
    fig_process2.savefig(buf, format='png', dpi=96, bbox_inches='tight')
    buf.seek(0)
    proc_img = Image.open(buf)
    plt.close(fig_process2)
    try:
        resample = Image.Resampling.LANCZOS
    except AttributeError:
        resample = Image.LANCZOS
    proc_img = proc_img.resize((col1_width - 40, chart_area_height), resample)
    card3.paste(proc_img, (20, 68))
    page3.paste(card3, (CARD_PADDING, current_y))

    # Card 4: Comments (empty placeholder)
    card4 = _make_card(col2_width, row_height, 'Comments', '')
    # Overwrite the subtitle line position for comments card
    d4 = ImageDraw.Draw(card4)
    d4.line([(TITLE_PADDING, 50), (col2_width - TITLE_PADDING, 50)], fill='#E0E0E0', width=1)
    page3.paste(card4, (CARD_PADDING + col1_width + CARD_PADDING, current_y))

    return page3


# ═══════════════════════════════════════════════════════════════════════════
# PAGE 1 — Cover page
# ═══════════════════════════════════════════════════════════════════════════

COVER_TEMPLATE_FILE = 'cover_template.png'

# Font candidates (first one found is used). Vale Sans first; fallbacks
# for machines where it is not installed.
COVER_FONT_BOLD = [
    'ValeSans-Bold.ttf', 'ValeSans-Medium.ttf', 'Vale Sans Bold.ttf',
    'Inter-SemiBold.otf', 'segoeuib.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf',
]
COVER_FONT_ITALIC = [
    'ValeSans-Italic.ttf', 'ariali.ttf', 'segoeuii.ttf',
    'Inter-Italic.otf', 'DejaVuSans-Oblique.ttf',
]


def generate_cover_page(business_unit, config, temp_dir, images_dir, bu_image_map):
    """
    Generate the cover page (page 1).

    Returns the path to the saved PNG file.
    """
    PAGE_W = config['page3_width']
    PAGE_H = config['page3_height']

    # ── Background: single template for ALL BUs ────────────────────
    # (world map + Vale logo + vertical bar, exported from
    #  "New Cover for SC Reports.pptx" without the text boxes)
    template_path = os.path.join(images_dir, COVER_TEMPLATE_FILE)
    if os.path.exists(template_path):
        try:
            resample = Image.Resampling.LANCZOS
        except AttributeError:
            resample = Image.LANCZOS
        page = Image.open(template_path).convert('RGB')
        if page.size != (PAGE_W, PAGE_H):
            page = page.resize((PAGE_W, PAGE_H), resample)
        logger.info("  Cover template: %s", COVER_TEMPLATE_FILE)
    else:
        logger.warning("  Cover template not found: %s — using plain background", template_path)
        page = Image.new('RGB', (PAGE_W, PAGE_H), (31, 120, 150))

    draw = ImageDraw.Draw(page)

    # ── Dynamic texts ──────────────────────────────────────────────
    now = datetime.now()
    d = now.day
    suffix = 'th' if 11 <= d <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(d % 10, 'th')
    date_str = f"{now.strftime('%B')} {d}{suffix}, {now.year}"   # e.g. "August 21st, 2026"
    month_str = now.strftime('%B')                                 # e.g. "August"

    title_lines = [
        ("Stable & Capable",        COVER_FONT_BOLD, 110),
        (f"{month_str} Analysis",   COVER_FONT_BOLD, 94),
        (f"{business_unit}",        COVER_FONT_BOLD, 71),
    ]

    # Texts scale with page size (layout designed for 1707 × 960)
    sx = PAGE_W / 1707
    sy = PAGE_H / 960

    # Title block — left-aligned, baselines next to the vertical bar
    x_title = int(97 * sx)
    baselines = [int(y * sy) for y in (237, 340, 427)]
    for (text, font_names, size), y in zip(title_lines, baselines):
        font = load_font(font_names, int(size * sy))
        draw.text((x_title, y), text, fill='white', font=font, anchor='ls')

    # Bottom-right — date + "PERFORMANCE & CI" (right-aligned)
    x_right = int(1633 * sx)
    draw.text((x_right, int(808 * sy)), date_str, fill='white',
              font=load_font(COVER_FONT_ITALIC, int(28 * sy)), anchor='rs')
    draw.text((x_right, int(850 * sy)), 'PERFORMANCE & CI', fill=(222, 248, 252),
              font=load_font(COVER_FONT_BOLD, int(25 * sy)), anchor='rs')

    temp_file = os.path.join(temp_dir, '_page_00_cover.png')
    page.save(temp_file, format='PNG', dpi=(96, 96))
    return temp_file


# ═══════════════════════════════════════════════════════════════════════════
# PAGE 2 — KPI list table
# ═══════════════════════════════════════════════════════════════════════════

def generate_kpi_list_page(kpi_list, site_name, config, temp_dir, df_bu, kpi_list_file):
    """
    Generate the KPI list page (page 2) from kpi_list.xlsx.

    Returns the path to the saved PNG file.
    """
    PAGE_W = config['page3_width']
    PAGE_H = config['page3_height']
    TITLE_COLOR = (60, 181, 229)

    page = Image.new('RGB', (PAGE_W, PAGE_H), 'white')
    draw = ImageDraw.Draw(page)

    min_date = df_bu['DT_REF'].min()
    max_date = df_bu['DT_REF'].max()
    date_range_str = f"{min_date.strftime('%b %Y')} to {max_date.strftime('%b %Y')}"

    # Load KPI metadata
    df_table = None
    try:
        df_all = pd.read_excel(kpi_list_file)
        col_lower = {c.strip().lower(): c for c in df_all.columns}

        bu_col = (col_lower.get('business unit') or col_lower.get('business_unit') or col_lower.get('businessunit'))
        if bu_col:
            df_table = df_all[df_all[bu_col].str.strip().str.lower() == site_name.strip().lower()].reset_index(drop=True)
        else:
            df_table = df_all.reset_index(drop=True)

        column_mapping = {
            'KPI': ['kpi', 'name kpi', 'name_kpi', 'kpi name'],
            'Phase': ['phase', 'type operation', 'type_operation', 'operation'],
            'Site': ['site', 'name site', 'name_site', 'site name'],
            'Definition': ['definition', 'description', 'desc'],
            'Unit': ['unit', 'units', 'measurement'],
            'Source': ['source', 'data source', 'data_source'],
        }
        rename = {}
        for display_name, variations in column_mapping.items():
            for var in variations:
                if var in col_lower:
                    rename[col_lower[var]] = display_name
                    break
        df_table = df_table.rename(columns=rename)
        logger.info("  kpi_list.xlsx: %d rows for BU '%s'", len(df_table), site_name)
    except Exception as e:
        logger.warning("  kpi_list.xlsx not loaded: %s", e)
        df_table = None

    # Title & subtitle
    TITLE_FONT_SIZE = 42
    SUBTITLE_FONT_SIZE = 16
    TITLE_Y = 5
    SUBTITLE_Y = TITLE_Y + TITLE_FONT_SIZE + 22

    font_title = load_font(['segoeuiz.ttf', 'calibriz.ttf', 'calibrib.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf'], TITLE_FONT_SIZE)
    font_sub = load_font(['segoeuii.ttf', 'calibrii.ttf', 'calibri.ttf', 'arial.ttf', 'DejaVuSans.ttf'], SUBTITLE_FONT_SIZE)

    draw.text((40, TITLE_Y), 'Selected KPIs for Analysis', fill=TITLE_COLOR, font=font_title)
    n_shown = len(df_table) if df_table is not None and len(df_table) > 0 else len(kpi_list)
    draw.text((42, SUBTITLE_Y),
              f"Business Unit: {site_name}  |  Total: {n_shown} KPIs  |  Data Period: {date_range_str}",
              fill='#666666', font=font_sub)

    # Table
    COLS = ['KPI', 'Phase', 'Site', 'Definition', 'Unit', 'Source']
    X_MARGIN = 30
    Y_TABLE = SUBTITLE_Y + SUBTITLE_FONT_SIZE + 14
    CELL_PAD = 16
    BOTTOM_PAD = 12
    FONT_HDR_SIZE = 20
    FONT_CELL_SIZE = 18

    font_hdr = load_font(['calibrib.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf'], FONT_HDR_SIZE)
    font_cell = load_font(['calibri.ttf', 'arial.ttf', 'DejaVuSans.ttf'], FONT_CELL_SIZE)

    HDR_BG = (60, 181, 229)
    ROW_ODD = (242, 249, 255)
    ROW_EVN = (255, 255, 255)
    BORDER = (200, 212, 220)

    if df_table is not None and len(df_table) > 0:
        rows_data = df_table.reindex(columns=COLS).fillna('').to_dict('records')
    else:
        rows_data = [{'KPI': k, 'Phase': '', 'Site': '', 'Definition': '', 'Unit': '', 'Source': ''} for k in kpi_list]

    n_rows = len(rows_data)

    def _tw(text, font):
        try:
            return int(font.getlength(str(text)))
        except AttributeError:
            bb = font.getbbox(str(text))
            return bb[2] - bb[0]

    col_min_w = {}
    for col in COLS:
        w = _tw(col, font_hdr) + CELL_PAD * 2
        for row in rows_data:
            val = str(row.get(col, '') or '').strip()
            w = max(w, _tw(val, font_cell) + CELL_PAD * 2)
        col_min_w[col] = max(w, 50)

    available_w = PAGE_W - 2 * X_MARGIN
    total_min = sum(col_min_w.values())
    scale = available_w / total_min if total_min > 0 else 1.0
    COL_W_dict = {col: int(col_min_w[col] * scale) for col in COLS}
    COL_W_dict[COLS[-1]] += available_w - sum(COL_W_dict.values())
    COL_W_list = [COL_W_dict[col] for col in COLS]

    HDR_ROW_H = FONT_HDR_SIZE + 20
    available_h = PAGE_H - Y_TABLE - HDR_ROW_H - BOTTOM_PAD
    ROW_H = max(FONT_CELL_SIZE + 14, available_h // n_rows if n_rows > 0 else 40)
    ROW_H = min(ROW_H, 80)

    # Header
    x = X_MARGIN
    for col, w in zip(COLS, COL_W_list):
        draw.rectangle([(x, Y_TABLE), (x + w - 1, Y_TABLE + HDR_ROW_H - 1)], fill=HDR_BG, outline=BORDER)
        text_w = _tw(col, font_hdr)
        x_text = x + max(CELL_PAD, (w - text_w) // 2)
        draw.text((x_text, Y_TABLE + (HDR_ROW_H - FONT_HDR_SIZE) // 2), col, fill='white', font=font_hdr)
        x += w

    # Data rows
    y = Y_TABLE + HDR_ROW_H
    for i, row in enumerate(rows_data):
        if y + ROW_H > PAGE_H - BOTTOM_PAD:
            break
        bg = ROW_ODD if i % 2 == 0 else ROW_EVN
        x = X_MARGIN
        for col, w in zip(COLS, COL_W_list):
            draw.rectangle([(x, y), (x + w - 1, y + ROW_H - 1)], fill=bg, outline=BORDER)
            val = str(row.get(col, '') or '').strip()
            max_w = w - CELL_PAD * 2
            while len(val) > 1 and _tw(val, font_cell) > max_w:
                val = val[:-2] + '\u2026'
            text_w = _tw(val, font_cell)
            x_text = x + max(CELL_PAD, (w - text_w) // 2)
            draw.text((x_text, y + (ROW_H - FONT_CELL_SIZE) // 2), val, fill='black', font=font_cell)
            x += w
        y += ROW_H

    temp_file = os.path.join(temp_dir, '_page_01_kpi_list.png')
    page.save(temp_file, format='PNG', dpi=(96, 96))
    return temp_file