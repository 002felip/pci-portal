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

import pandas as pd
from PIL import Image, ImageDraw

from .utils import load_font
from . import visual as V
from .scores import FAIXAS_CAPABILIDADE, FAIXAS_ESTABILIDADE, classificar, faixas_texto

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

def _cabecalho_pagina(page, W, titulo, kpi, unidade, meta, y=40):
    """Cabeçalho como a linha do site do Dashboard: o site em itálico azul e, ao lado, separado por
    um traço, o indicador em destaque (Poppins 500, azul-marinho) com a unidade; à direita, o período."""
    d = ImageDraw.Draw(page)
    f_tit = V.fonte('italic', 30)
    V.texto(d, (32, y), titulo, f_tit, V.ACENTO, 'lm')
    x = 32 + V.largura_texto(titulo, f_tit) + 16
    if kpi:
        d.line((V.s(x), V.s(y - 13), V.s(x), V.s(y + 13)), fill=V.rgb(V.LINHA), width=V.s(1.5))
        x += 16
        f_kpi = V.fonte('medium', 19)
        V.texto(d, (x, y + 1), kpi, f_kpi, V.AZUL_PROFUNDO, 'lm')
        x += V.largura_texto(kpi, f_kpi) + 10
        if unidade:
            V.pilula(d, x + (V.largura_texto(unidade, V.fonte('semibold', 11.5)) + 20) / 2, y + 1, unidade,
                     V.fonte('semibold', 11.5), V.PILULA, V.AZUL_ESCURO, pad_x=10, alt=24)
    f = V.fonte('italic', 11)
    for i, linha in enumerate(meta):
        V.texto(d, (W - 32, y - 9 + i * 18), linha, f, V.TINTA_FRACA, 'rm')
    return d


def _pilulas_score(d, x_dir, y, sc):
    """Pílulas "Stability Score 83" e "Capability Score 88" na cor da classificação, terminando em
    x_dir (alinhadas à direita). Devolve o x onde começam."""
    if not sc:
        return x_dir
    itens = [('Stability Score', sc.get('stability'), FAIXAS_ESTABILIDADE),
             ('Capability Score', sc.get('capability'), FAIXAS_CAPABILIDADE)]
    f_rot, f_val = V.fonte('regular', 11), V.fonte('semibold', 13)
    x = x_dir
    for rotulo, valor, faixas in reversed(itens):
        classe, fundo, cor = classificar(valor, faixas)
        txt_val = '—' if valor is None else str(valor)
        w = 14 + V.largura_texto(rotulo, f_rot) + 8 + V.largura_texto(txt_val, f_val) + 14
        d.rounded_rectangle((V.s(x - w), V.s(y - 14), V.s(x), V.s(y + 14)), radius=V.s(14), fill=V.rgb(fundo))
        V.texto(d, (x - w + 14, y), rotulo, f_rot, cor, 'lm')
        V.texto(d, (x - 14, y + 0.5), txt_val, f_val, cor, 'rm')
        x -= w + 10
    return x


def _periodo(meta):
    try:
        return f"{meta['date_min']:%b %Y} – {meta['date_max']:%b %Y}"
    except Exception:
        return ''


def _caixa_variacao(page, x, y, w, h, linhas):
    """Caixa "Mean variation" do Dashboard (.dsc-variacao-caixa)."""
    d = ImageDraw.Draw(page)
    d.rounded_rectangle((V.s(x), V.s(y), V.s(x + w), V.s(y + h)), radius=V.s(12),
                        fill=V.rgb(V.SUPERFICIE_ALT), outline=V.rgb(V.LINHA), width=max(1, V.s(1)))
    V.texto(d, (x + 14, y + 12), 'Mean variation', V.fonte('semibold', 11.5), V.TINTA_SUAVE)
    if not linhas:
        V.texto(d, (x + 14, y + 40), '—', V.fonte('regular', 11), V.TINTA_SUAVE)
        return
    topo, base = y + 38, y + h - 8
    passo = min(32, (base - topo) / len(linhas))
    f_rot = V.fonte('regular', 10.5 if passo >= 24 else 9.5)
    f_val = V.fonte('semibold', 10.5 if passo >= 24 else 9.5)
    for i, (de, para, pct) in enumerate(linhas):
        ym = topo + i * passo + passo / 2
        if i:
            d.line((V.s(x + 12), V.s(topo + i * passo), V.s(x + w - 12), V.s(topo + i * passo)),
                   fill=V.rgb(V.LINHA_SUAVE), width=max(1, V.s(1)))
        # "Q1 2025 → Q2 2025" (a seta é desenhada: a Poppins não tem o caractere →)
        V.texto(d, (x + 14, ym), de, f_rot, V.TINTA_SUAVE, 'lm')
        ax0 = x + 14 + V.largura_texto(de, f_rot) + 5
        d.line((V.s(ax0), V.s(ym), V.s(ax0 + 10), V.s(ym)), fill=V.rgb(V.TINTA_SUAVE), width=max(1, V.s(1)))
        d.polygon([(V.s(ax0 + 11), V.s(ym)), (V.s(ax0 + 7), V.s(ym - 3)), (V.s(ax0 + 7), V.s(ym + 3))], fill=V.rgb(V.TINTA_SUAVE))
        V.texto(d, (ax0 + 16, ym), para, f_rot, V.TINTA_SUAVE, 'lm')
        sobe = pct > 0
        cor = V.SUBIU if sobe else V.CAIU
        rot = f"{'+' if sobe else ''}{pct:.1f}%"
        lw = V.largura_texto(rot, f_val) + 12 + 16
        x1 = x + w - 12
        alt = min(20, passo - 6)
        d.rounded_rectangle((V.s(x1 - lw), V.s(ym - alt / 2), V.s(x1), V.s(ym + alt / 2)), radius=V.s(alt / 2),
                            fill=V.rgb('#f6f6f6'), outline=V.rgb('#e4e7eb'), width=max(1, V.s(1)))
        tx = x1 - lw + 8
        tri = [(tx, ym + 3), (tx + 7, ym + 3), (tx + 3.5, ym - 3)] if sobe else [(tx, ym - 3), (tx + 7, ym - 3), (tx + 3.5, ym + 3)]
        d.polygon([(V.s(a), V.s(b)) for a, b in tri], fill=V.rgb(cor))
        V.texto(d, (tx + 11, ym), rot, f_val, cor, 'lm')


def compose_page3(fig_control, fig_hist_table, fig_process2, kpi_metadata, config):
    """
    Compose a single KPI detail page in the visual of the app's Dashboard.

    Layout: 452 mm × 254 mm (1707×960 logical px, drawn at visual.ESCALA×)
        - Header:  site title (italic blue) | KPI (highlighted) + unit pill; period on the right
        - Row 1:   Control Chart (full width)
        - Row 2:   Statistical Measures + Mean variation (65%) | Capability Histogram (35%)

    Parameters
    ----------
    fig_control : chart_generator.GraficoSPC
    fig_hist_table : chart_generator.GraficoHistograma
    fig_process2 : chart_generator.GraficoMedidas
    kpi_metadata : dict
    config : dict

    Returns
    -------
    PIL.Image
    """
    W = config['page3_width']
    H = config['page3_height']
    page = V.nova_pagina(W, H)

    site = kpi_metadata.get('site', '')
    phase = (kpi_metadata.get('phase', '') or '').strip()
    kpi = kpi_metadata.get('kpi', '')
    unidade = kpi_metadata.get('display_unit', kpi_metadata.get('unit', ''))
    titulo = f"{site} {phase}".strip()
    meta = [f"Period: {_periodo(kpi_metadata)}", f"Business Unit: {kpi_metadata.get('business_unit', '')}"]
    d = _cabecalho_pagina(page, W, titulo, kpi, unidade, meta)
    f_meta = V.fonte('italic', 11)
    larg_meta = max(V.largura_texto(m, f_meta) for m in meta)
    _pilulas_score(d, W - 32 - larg_meta - 24, 40, kpi_metadata.get('scores'))

    MX, GAP, TOPO, BASE = 28, 18, 80, 22
    largura = W - 2 * MX
    c1 = int((largura - GAP) * 0.65)
    c2 = largura - GAP - c1
    lin_h = (H - TOPO - BASE - GAP) // 2
    x1, x2 = MX, MX + c1 + GAP
    y1, y2 = TOPO, TOPO + lin_h + GAP
    PX, PY = 22, 18

    # ── Linha 1: carta de controle na largura toda ─────────────────
    d = V.card(page, x1, y1, largura, lin_h)
    yy = V.cabecalho_card(d, x1 + PX, y1 + PY, largura - 2 * PX, 'Statistical Process Control (SPC) Chart',
                          'Limits per quarter: CL = mean, UCL / LCL = CL ± 3 sigma (moving range). Special causes by the Nelson rules')
    yy += 4 + V.legenda(d, x1 + PX, yy + 4, fig_control.legenda, tamanho=10.5, largura_max=largura - 2 * PX)
    img = fig_control.desenhar(largura - 2 * PX + 8, y1 + lin_h - 10 - (yy + 4))
    V.colar(page, img, x1 + PX - 4, yy + 4)

    # ── Linha 2, à esquerda: medidas ───────────────────────────────
    d = V.card(page, x1, y2, c1, lin_h)
    larg_leg = 420
    yy = V.cabecalho_card(d, x1 + PX, y2 + PY, c1 - 2 * PX - larg_leg - 12, 'Statistical Measures and Comparisons')
    V.legenda(d, x1 + c1 - PX - larg_leg, y2 + PY + 2, fig_process2.legenda, tamanho=10.5,
              largura_max=larg_leg, alinhar_direita=True)
    caixa_w = 220
    corpo_top = yy + 8
    corpo_h = y2 + lin_h - 12 - corpo_top
    img = fig_process2.desenhar(c1 - 2 * PX - caixa_w - 16, corpo_h)
    V.colar(page, img, x1 + PX, corpo_top)
    _caixa_variacao(page, x1 + c1 - PX - caixa_w, corpo_top + 6, caixa_w,
                    min(corpo_h - 12, 40 + 32 * max(1, len(fig_process2.variacao)) + 8), fig_process2.variacao)

    # ── Linha 2, à direita: histograma (no lugar dos comentários) ──
    d = V.card(page, x2, y2, c2, lin_h)
    yy = V.cabecalho_card(d, x2 + PX, y2 + PY, c2 - 2 * PX, 'Capability Histogram')
    cols = [('Year', .15, 'l'), ('Mean', .15, 'r'), ('StDev', .15, 'r'), ('CV', .12, 'r'),
            ('Budget', .16, 'r'), ('Days', .11, 'r'), ('Days Out', .16, 'r')]
    linhas = fig_hist_table.linhas_tabela()
    yy += 6 + V.tabela(page, x2 + PX, yy + 6, c2 - 2 * PX, cols, linhas, tam=10.5, alt_linha=24, alt_cab=26)
    d = ImageDraw.Draw(page)
    f_nota = V.fonte('regular', 9.5)
    notas = fig_hist_table.notas
    alt_notas = 16 * len(notas)
    img = fig_hist_table.desenhar(c2 - 2 * PX + 8, y2 + lin_h - 12 - alt_notas - (yy + 8))
    V.colar(page, img, x2 + PX - 4, yy + 8)
    for i, n in enumerate(notas):
        V.texto(d, (x2 + PX, y2 + lin_h - 10 - alt_notas + i * 16), V.encurtar(n, f_nota, c2 - 2 * PX), f_nota, V.TINTA_SUAVE)

    return page


# ═══════════════════════════════════════════════════════════════════════════
# PAGE 1 — Cover page
# ═══════════════════════════════════════════════════════════════════════════

COVER_TEMPLATE_FILE = 'cover_template.png'

# Font candidates (first one found is used). Vale Sans first; fallbacks
# for machines where it is not installed.
COVER_FONT_BOLD = [
    'ValeSans-Bold.ttf', 'ValeSans-Medium.ttf', 'Vale Sans Bold.ttf',
    'Poppins-SemiBold.ttf', 'Inter-SemiBold.otf', 'segoeuib.ttf', 'arialbd.ttf', 'DejaVuSans-Bold.ttf',
]
COVER_FONT_ITALIC = [
    'ValeSans-Italic.ttf', 'Poppins-Italic.ttf', 'ariali.ttf', 'segoeuii.ttf',
    'Inter-Italic.otf', 'DejaVuSans-Oblique.ttf',
]


def generate_cover_page(business_unit, config, temp_dir, images_dir, bu_image_map):
    """
    Generate the cover page (page 1).

    Returns the path to the saved PNG file.
    """
    PAGE_W = config['page3_width'] * V.ESCALA
    PAGE_H = config['page3_height'] * V.ESCALA

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

    # JPEG: a capa é uma foto; em PNG, na escala 2×, ela sozinha passava de 5 MB no PDF
    temp_file = os.path.join(temp_dir, '_page_00_cover.jpg')
    page.save(temp_file, format='JPEG', quality=90, dpi=(96 * V.ESCALA, 96 * V.ESCALA))
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

    # Cabeçalho como o do Dashboard: título em itálico azul e a linha de informações
    page = V.nova_pagina(PAGE_W, PAGE_H)
    d = ImageDraw.Draw(page)
    n_shown = len(df_table) if df_table is not None and len(df_table) > 0 else len(kpi_list)
    V.texto(d, (32, 20), 'Selected KPIs for Analysis', V.fonte('italic', 30), V.ACENTO)
    V.texto(d, (34, 66), f"Business Unit: {site_name}  ·  {n_shown} KPIs  ·  Data period: {date_range_str}",
            V.fonte('regular', 12.5), V.TEXTO_SUAVE)

    COLS = ['KPI', 'Phase', 'Site', 'Definition', 'Unit', 'Source']
    if df_table is not None and len(df_table) > 0:
        rows_data = df_table.reindex(columns=COLS).fillna('').to_dict('records')
    else:
        rows_data = [{'KPI': k, 'Phase': '', 'Site': '', 'Definition': '', 'Unit': '', 'Source': ''} for k in kpi_list]

    # Larguras pelo conteúdo (como antes), repartindo a largura útil
    X, Y_TABLE, BOTTOM = 28, 100, 22
    largura = PAGE_W - 2 * X
    f_cel = V.fonte('regular', 12)
    f_cab = V.fonte('medium', 12)
    minimos = {}
    for col in COLS:
        w = V.largura_texto(col, f_cab) + 28
        for row in rows_data:
            w = max(w, V.largura_texto(str(row.get(col, '') or '').strip(), f_cel) + 28)
        minimos[col] = max(w, 60)
    total = sum(minimos.values()) or 1
    fr = {c: minimos[c] / total for c in COLS}

    ALT_CAB = 34
    disponivel = PAGE_H - Y_TABLE - BOTTOM - ALT_CAB
    n_rows = max(1, len(rows_data))
    alt = max(24, min(44, disponivel // n_rows))
    cabem = max(1, int(disponivel // alt))

    def celula(col, val):
        val = str(val or '').strip()
        if col == 'KPI':
            return {'texto': val, 'peso': 'medium', 'tam': 12}
        if col == 'Unit':
            return {'texto': val, 'cor': V.TINTA_SUAVE, 'tam': 12}
        if col == 'Source' and val:
            return {'texto': val, 'pilula': (V.PILULA, V.AZUL_ESCURO), 'peso': 'semibold', 'tam': 10.5}
        return {'texto': val, 'tam': 12}

    linhas = [[celula(c, r.get(c, '')) for c in COLS] for r in rows_data[:cabem]]
    colunas = [(c, fr[c], 'l') for c in COLS]
    V.tabela(page, X, Y_TABLE, largura, colunas, linhas, tam=12, alt_linha=alt, alt_cab=ALT_CAB, raio=12)

    temp_file = os.path.join(temp_dir, '_page_01_kpi_list.png')
    V.salvar_png(page, temp_file)
    return temp_file

# ═══════════════════════════════════════════════════════════════════════════
# CONSOLIDATED — Stability & Capability Scores summary (first page)
# ═══════════════════════════════════════════════════════════════════════════

def _card_faixas(page, x, y, w, h, titulo, faixas, texto_interp, formula):
    """Card da legenda: faixas com a cor de cada classificação, interpretação e fórmula."""
    d = V.card(page, x, y, w, h)
    PX = 22
    V.cabecalho_card(d, x + PX, y + 16, w - 2 * PX, titulo)
    larg_tab = 300
    linhas = [[{'texto': intervalo, 'peso': 'medium'},
               {'texto': rotulo, 'pilula': (fundo, cor), 'peso': 'semibold', 'tam': 10, 'largura_min': 150}]
              for intervalo, rotulo, fundo, cor in faixas_texto(faixas)]
    V.tabela(page, x + PX, y + 48, larg_tab, [('Score', .36, 'l'), ('Classification', .64, 'c')], linhas,
             tam=10.5, alt_linha=22, alt_cab=24, raio=10)
    d = ImageDraw.Draw(page)
    xt, wt = x + PX + larg_tab + 22, w - 2 * PX - larg_tab - 22
    f = V.fonte('regular', 10.5)
    yy = y + 50
    for linha in V.quebrar(texto_interp, f, wt):
        V.texto(d, (xt, yy), linha, f, V.TINTA_SUAVE)
        yy += 16
    yy += 6
    ff = V.fonte('medium', 11)
    for linha in V.quebrar(formula, ff, wt):
        V.texto(d, (xt, yy), linha, ff, V.AZUL_PROFUNDO)
        yy += 17


def generate_scores_page(grupos, ano, rotulo_periodo, config, temp_dir):
    """
    Página de resumo do relatório consolidado: Stability & Capability Scores de todos os
    KPIs, um card por Business Unit, e a legenda das classificações com as fórmulas.

    grupos : [(bu, [score dict de ReportBuilder.scores])]
    Returns the path to the saved PNG file.
    """
    W = config['page3_width']
    H = config['page3_height']
    page = V.nova_pagina(W, H)

    d = _cabecalho_pagina(page, W, 'Stability & Capability Scores', str(ano), rotulo_periodo,
                          ['Stable & Capable · Consolidated', datetime.now().strftime('Generated on %B %d, %Y')])

    MX, GAP, TOPO = 28, 18, 80
    ALT_LEGENDA = 196
    base_cards = H - 22 - ALT_LEGENDA - GAP
    disponivel = base_cards - TOPO
    grupos = [(bu, linhas) for bu, linhas in grupos if linhas]

    def altura(n, alt):
        return 16 + 24 + 8 + 24 + n * alt + 16

    # 3 ou 4 colunas e a maior altura de linha que faça tudo caber (cada BU vai para a coluna
    # mais baixa, na ordem das BUs)
    escolha = None
    for ncol in (3, 4):
        for alt in (24, 23, 22, 21, 20, 19, 18):
            colunas = [[] for _ in range(ncol)]
            alturas = [0] * ncol
            for bu, linhas in sorted(grupos, key=lambda g: -len(g[1])):
                i = alturas.index(min(alturas))
                colunas[i].append((bu, linhas))
                alturas[i] += altura(len(linhas), alt) + GAP
            if max(alturas) - GAP <= disponivel:
                escolha = (ncol, alt, colunas)
                break
        if escolha:
            break
    if not escolha:  # muitos KPIs: 4 colunas na menor altura, mesmo passando um pouco
        ncol, alt = 4, 18
        colunas = [[] for _ in range(ncol)]
        alturas = [0] * ncol
        for bu, linhas in sorted(grupos, key=lambda g: -len(g[1])):
            i = alturas.index(min(alturas))
            colunas[i].append((bu, linhas))
            alturas[i] += altura(len(linhas), alt) + GAP
        escolha = (ncol, alt, colunas)
    ncol, alt, colunas = escolha
    larg = (W - 2 * MX - (ncol - 1) * GAP) / ncol

    # ordem das colunas: a da 1ª BU de cada uma, para manter a sequência das BUs
    ordem = [g[0] for g in grupos]
    colunas.sort(key=lambda c: min(ordem.index(b) for b, _ in c) if c else 99)
    for c in colunas:
        c.sort(key=lambda g: ordem.index(g[0]))

    for i, coluna in enumerate(colunas):
        x = MX + i * (larg + GAP)
        y = TOPO
        for bu, linhas in coluna:
            h = altura(len(linhas), alt)
            dc = V.card(page, x, y, larg, h)
            V.cabecalho_card(dc, x + 18, y + 16, larg - 36, bu)
            cel = []
            for r in linhas:
                _, f1, c1 = classificar(r.get('stability'), FAIXAS_ESTABILIDADE)
                _, f2, c2 = classificar(r.get('capability'), FAIXAS_CAPABILIDADE)
                v1 = '—' if r.get('stability') is None else str(r['stability'])
                v2 = '—' if r.get('capability') is None else str(r['capability'])
                cel.append([{'texto': r.get('processo', ''), 'tam': 10.5},
                            {'texto': v1, 'pilula': (f1, c1), 'peso': 'semibold', 'tam': 10.5, 'largura_min': 46},
                            {'texto': v2, 'pilula': (f2, c2), 'peso': 'semibold', 'tam': 10.5, 'largura_min': 46}])
            V.tabela(page, x + 14, y + 48, larg - 28, [('Process', .58, 'l'), ('Stability', .21, 'c'), ('Capability', .21, 'c')],
                     cel, tam=10.5, alt_linha=alt, alt_cab=24, raio=10)
            y += h + GAP

    # Legenda e interpretação
    y = H - 22 - ALT_LEGENDA
    meia = (W - 2 * MX - GAP) / 2
    _card_faixas(page, MX, y, meia, ALT_LEGENDA, 'Stability Score', FAIXAS_ESTABILIDADE,
                 f"How consistently a process performed in {ano}. It starts at 100 and loses points for "
                 f"out-of-control behaviour (days flagged by the Nelson rules on the {ano} control chart) and, "
                 "partially, for high variation. Higher means a more predictable process.",
                 "Stability = 100 × (1 - out-of-control days ÷ days - 0.3 × CV)")
    _card_faixas(page, MX + meia + GAP, y, meia, ALT_LEGENDA, 'Capability Score', FAIXAS_CAPABILIDADE,
                 f"Share of the {ano} results within the specification limits, based on the {ano} budget "
                 f"using the current variation (Budget ± 2 sigma of {ano}). A score of 80 means 80% of the days "
                 "were within the limits.",
                 "Capability = 100 × days within the limits ÷ days")

    temp_file = os.path.join(temp_dir, '_page_scores.png')
    V.salvar_png(page, temp_file)
    return temp_file
