"""
Chart Generator Module

All chart-creation functions for the Multi-KPI PDF report, drawn in the visual of the
app's Dashboard (Stable & Capable → Dashboard tab; tokens in visual.py):
    1. create_control_chart      — I-MR Control Chart grouped by Quarter      → GraficoSPC
    2. create_histogram_table2   — Histogram with statistics table            → GraficoHistograma
    3. create_process_capability — Process Performance (Plotly — kept for reference, unused)
    4. create_process_capability_moshe — Grouped bars + mean variation        → GraficoMedidas

The calculations are the same as before (notebook 05_multi_kpi_pdf_generator.ipynb).
Each function returns an object with the computed data and a ``desenhar(w, h)`` method
that renders the chart (matplotlib, Poppins) at the size of its card; titles, legends,
tables and the variation box are drawn by page_composer.compose_page3.
"""

import datetime
import logging

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from scipy.stats import norm

from src.spc_functions import calculate_xam_limits
from .utils import format_value_with_unit, get_display_unit
from . import visual as V

logger = logging.getLogger(__name__)


def _rotulo_trimestre(periodo):
    """'2025Q1' → 'Q1 2025' (como no Dashboard)."""
    p = str(periodo)
    return f"{p[4:]} {p[:4]}" if len(p) == 6 and p[4] == 'Q' else p


def _estilo_eixo(ax, grade_y=True):
    """Eixo no estilo do Dashboard: sem molduras, grade horizontal clara, base #e8edf3."""
    for lado in ('top', 'right', 'left'):
        ax.spines[lado].set_visible(False)
    ax.spines['bottom'].set_color(V.LINHA)
    ax.spines['bottom'].set_linewidth(V.pt(1))
    ax.tick_params(axis='both', length=0, labelsize=V.pt(10.5), labelcolor=V.TINTA_SUAVE, pad=V.pt(6))
    if grade_y:
        ax.yaxis.grid(True, color=V.LINHA_SUAVE, linewidth=V.pt(1))
    ax.xaxis.grid(False)
    ax.set_axisbelow(True)
    ax.set_facecolor(V.SUPERFICIE)


def _contorno(px):
    import matplotlib.patheffects as pe
    return [pe.withStroke(linewidth=V.pt(px), foreground=V.SUPERFICIE)]


def _fmt_eixo(v, faixa):
    return f"{v:,.2f}" if faixa < 10 else f"{v:,.0f}"


# ═══════════════════════════════════════════════════════════════════════════
# 1. CONTROL CHART
# ═══════════════════════════════════════════════════════════════════════════

REGRAS_SPC = [
    ('r1', 'Rule 1: point outside control limits'),
    ('r2', 'Rule 2: 7 points on same side of CL'),
    ('r3', 'Rule 3: 6 points increasing or decreasing'),
    ('r4', 'Rule 4: 14 points alternating up and down'),
]


class GraficoSPC:
    """Carta de controle por trimestre, desenhada como a do Dashboard."""

    def __init__(self, serie, grupos, sinais, separadores, unit, kpi_name):
        self.serie = serie                # DataFrame DT_REF, ACTUAL (com NaN: a linha quebra)
        self.grupos = grupos              # [dict(rotulo, x0, x1, cl, ucl, lcl, best)]
        self.sinais = sinais              # {'r1': [(data, valor)], …}
        self.separadores = separadores    # datas de início dos trimestres (menos o 1º)
        self.unit = unit
        self.kpi_name = kpi_name
        self.violations_by_quarter = {}

    legenda = (
        [('linha', V.C_SERIE, 'Values'), ('linha', V.C_CL, 'CL'), ('tracejada', V.C_LIM, 'UCL / LCL'),
         ('faixa', '#dff2fb', 'Best 30 days')]
        + [('ponto', V.C_REGRA[k], rot) for k, rot in REGRAS_SPC]
    )

    def desenhar(self, w, h):
        import matplotlib.dates as mdates
        import matplotlib.transforms as mtrans
        from matplotlib.ticker import MaxNLocator

        fig = V.figura_px(w, h)
        m = dict(l=54, r=10, t=34, b=26)
        ax = fig.add_axes([m['l'] / w, m['b'] / h, (w - m['l'] - m['r']) / w, (h - m['t'] - m['b']) / h])
        _estilo_eixo(ax)
        larg_px = w - m['l'] - m['r']
        alt_px = h - m['t'] - m['b']

        datas = pd.to_datetime(self.serie['DT_REF'])
        valores = self.serie['ACTUAL'].astype(float)
        t0, t1 = datas.min(), datas.max()
        ax.set_xlim(t0 - pd.Timedelta(hours=12), t1 + pd.Timedelta(hours=12))

        refs = list(valores.dropna())
        for g in self.grupos:
            refs += [g['ucl'], g['lcl']]
        ymin, ymax = (min(refs), max(refs)) if refs else (0, 1)
        pad = (ymax - ymin or abs(ymax) or 1) * 0.06
        ymin, ymax = ymin - pad, ymax + pad
        ax.set_ylim(ymin, ymax)
        ax.yaxis.set_major_locator(MaxNLocator(5))
        faixa = ymax - ymin
        ax.yaxis.set_major_formatter(lambda v, _: _fmt_eixo(v, faixa))

        # meses no eixo x, espaçados para caber
        meses = pd.date_range(t0.normalize().replace(day=1), t1, freq='MS')
        meses = [d for d in meses if d >= t0] or [t0]
        passo = max(1, int(np.ceil(len(meses) / max(1, larg_px // 70))))
        ax.set_xticks(meses[::passo])
        ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %y'))

        x_dados_y_eixo = mtrans.blended_transform_factory(ax.transData, ax.transAxes)
        dias_por_px = (t1 - t0).days / max(1, larg_px)

        # melhores 30 dias e separadores de trimestre
        for g in self.grupos:
            if g['best']:
                b0, b1 = g['best']
                ax.axvspan(b0, b1, color=tuple(c / 255 for c in V.C_BEST), linewidth=0, zorder=0)
                if (b1 - b0).days / max(dias_por_px, 1e-9) > 48:
                    ax.text(b0 + (b1 - b0) / 2, 0.012, f"{b0:%d/%m}–{b1:%d/%m}", transform=x_dados_y_eixo,
                            ha='center', va='bottom', fontsize=V.pt(9), color=V.AZUL_ESCURO, zorder=3)
        for d in self.separadores:
            ax.axvline(d, color=V.LINHA, linewidth=V.pt(1), linestyle=(0, (3, 4)), zorder=1)

        # série diária
        ax.plot(datas, valores, color=V.C_SERIE, linewidth=V.pt(1.2), solid_joinstyle='round', zorder=2)

        # limites, rótulos e pílula do trimestre
        for g in self.grupos:
            xm = g['x0'] + (g['x1'] - g['x0']) / 2
            ax.text(xm, 1 + 17 / alt_px, g['rotulo'], transform=x_dados_y_eixo, ha='center', va='center',
                    fontsize=V.pt(10.5), fontweight='semibold', color=V.AZUL_ESCURO, clip_on=False, zorder=6,
                    bbox=dict(boxstyle='round,pad=0.38,rounding_size=0.85', fc=V.PILULA, ec='none'))
            if g['cl'] is None:
                continue
            for val, estilo in ((g['ucl'], 'lim'), (g['lcl'], 'lim'), (g['cl'], 'cl')):
                if estilo == 'lim':
                    ax.hlines(val, g['x0'], g['x1'], colors=V.C_LIM, linewidth=V.pt(1.2), linestyles=(0, (5, 4)), zorder=3)
                else:
                    ax.hlines(val, g['x0'], g['x1'], colors=V.C_CL, linewidth=V.pt(2.5), zorder=4, capstyle='round')
            # rótulos no início do trimestre; num trimestre curto no fim do eixo (ex.: o mês em
            # andamento) eles sairiam da imagem, então vão alinhados à direita, no fim da linha
            restante = (t1 - pd.Timestamp(g['x0'])).days / max(dias_por_px, 1e-9)
            no_fim = restante < 110
            xr, ha, dx = (g['x1'], 'right', -6) if no_fim else (g['x0'], 'left', 6)
            desloc = lambda dy: mtrans.offset_copy(ax.transData, fig=fig, x=V.pt(dx), y=V.pt(dy), units='points')
            ax.text(xr, g['ucl'], f"UCL {format_value_with_unit(g['ucl'], self.unit)}", transform=desloc(4),
                    va='bottom', ha=ha, fontsize=V.pt(9.5), color=V.C_LIM, path_effects=_contorno(3), zorder=8)
            ax.text(xr, g['cl'], f"CL {format_value_with_unit(g['cl'], self.unit)}", transform=desloc(5),
                    va='bottom', ha=ha, fontsize=V.pt(11.5), fontweight='semibold', color=V.C_CL,
                    path_effects=_contorno(4), zorder=9)
            ax.text(xr, g['lcl'], f"LCL {format_value_with_unit(g['lcl'], self.unit)}", transform=desloc(-4),
                    va='top', ha=ha, fontsize=V.pt(9.5), color=V.C_LIM, path_effects=_contorno(3), zorder=8)

        # sinais: a regra 1 por cima (ordem do script: 4, 3, 2, 1)
        for k in ('r4', 'r3', 'r2', 'r1'):
            pts = self.sinais.get(k) or []
            if not pts:
                continue
            raio = 3.8 if k == 'r1' else 3.2
            ax.scatter([p[0] for p in pts], [p[1] for p in pts], s=V.pt(2 * raio) ** 2, c=V.C_REGRA[k],
                       edgecolors=V.SUPERFICIE, linewidths=V.pt(1), zorder=7)

        return V.figura_para_imagem(fig)


def create_control_chart(df_kpi, unit, kpi_name, config, colors):
    """
    Compute the I-MR Control Chart grouped by Quarter (limits per quarter, Best 30 Days,
    Nelson rules 1–4) and return a GraficoSPC ready to be drawn.

    Parameters
    ----------
    df_kpi : DataFrame
        KPI data with DT_REF, ACTUAL, BUDGET columns.
    unit : str
        Unit of measurement (already transformed).
    kpi_name : str
        KPI name.
    config, colors : dict
        Kept for compatibility (the visual comes from visual.py).
    """
    df_hist = df_kpi.copy()
    df_hist['Quarter'] = df_hist['DT_REF'].dt.to_period('Q').astype(str)

    groupby_col = 'Quarter'
    groups = sorted(df_hist[groupby_col].unique())

    # Control limits per quarter
    limits_by_group = {}
    for group in groups:
        data_group = df_hist[df_hist[groupby_col] == group]['ACTUAL'].dropna()
        if len(data_group) >= 3:
            limits_by_group[group] = calculate_xam_limits(data_group)
        else:
            limits_by_group[group] = None

    # Best 30 Days helper
    def best_30_days_period(df_period):
        if len(df_period) < 30:
            return None, None, None
        s = df_period.set_index('DT_REF')['ACTUAL'].sort_index()
        roll = s.rolling(30).mean()
        best_end_idx = roll.idxmax()
        if pd.isna(best_end_idx):
            return None, None, None
        best_end = pd.Timestamp(best_end_idx).to_pydatetime()
        best_start = best_end - datetime.timedelta(days=29)
        best_mean = roll.max()
        return best_start, best_end, best_mean

    sinais = {'r1': [], 'r2': [], 'r3': [], 'r4': []}
    grupos = []
    violations_by_quarter = {}

    for group in groups:
        group_data = df_hist[df_hist[groupby_col] == group].sort_values('DT_REF').reset_index(drop=True)
        group_data_clean = group_data.dropna(subset=['ACTUAL']).reset_index(drop=True)
        if len(group_data_clean) == 0:
            continue
        group_dates = group_data_clean['DT_REF']
        group_values = group_data_clean['ACTUAL']
        x_start = pd.Timestamp(group_dates.min()).to_pydatetime()
        x_end = pd.Timestamp(group_dates.max()).to_pydatetime()

        limits = limits_by_group.get(group)
        if limits is None or len(group_values) < 7:
            # como antes: trimestre sem limites fica sem linhas, sinais e faixa
            grupos.append(dict(rotulo=_rotulo_trimestre(group), x0=x_start, x1=x_end, cl=None, ucl=None, lcl=None, best=None))
            continue

        cl = limits['CL']
        ucl = limits['UCL']
        lcl = max(limits['LCL'], 0)

        best_start, best_end, _ = best_30_days_period(group_data)
        grupos.append(dict(rotulo=_rotulo_trimestre(group), x0=x_start, x1=x_end, cl=cl, ucl=ucl, lcl=lcl,
                           best=(best_start, best_end) if best_start is not None else None))

        # Violation detection
        values = group_values.values
        dates_list = pd.to_datetime(group_dates).tolist()
        violations_by_quarter[group] = {
            'Rule 1': 0, 'Rule 2': 0, 'Rule 3': 0, 'Rule 4': 0,
            'Rule 2 Points': 0, 'Rule 3 Points': 0, 'Rule 4 Points': 0,
        }

        # RULE 1: point outside limits
        mask1 = (values > ucl) | (values < lcl)
        for i, include in enumerate(mask1):
            if include:
                sinais['r1'].append((dates_list[i], values[i]))
                violations_by_quarter[group]['Rule 1'] += 1

        # RULE 2: 7 consecutive on same side of CL
        side = np.where(values > cl, 1, -1)
        run = 1
        rule2_detected = set()
        for i in range(1, len(values)):
            run = run + 1 if side[i] == side[i - 1] else 1
            if run >= 7:
                for j in range(i - 6, i + 1):
                    if j < len(dates_list) and j not in rule2_detected:
                        sinais['r2'].append((dates_list[j], values[j]))
                        rule2_detected.add(j)
                        violations_by_quarter[group]['Rule 2 Points'] += 1

        # RULE 3: 6 points in trend
        rule3_detected = set()
        if len(values) >= 6:
            for i in range(len(values) - 5):
                window = values[i:i + 6]
                is_inc = all(window[j] < window[j + 1] for j in range(5))
                is_dec = all(window[j] > window[j + 1] for j in range(5))
                if is_inc or is_dec:
                    for j in range(i, i + 6):
                        if j < len(dates_list) and j not in rule3_detected:
                            sinais['r3'].append((dates_list[j], values[j]))
                            rule3_detected.add(j)
                            violations_by_quarter[group]['Rule 3 Points'] += 1

        # RULE 4: 14 points alternating
        rule4_detected = set()
        if len(values) >= 14:
            for i in range(len(values) - 13):
                window = values[i:i + 14]
                is_alt = all(
                    (window[j + 1] - window[j]) * (window[j + 2] - window[j + 1]) < 0
                    for j in range(12)
                )
                if is_alt:
                    for j in range(i, i + 14):
                        if j < len(dates_list) and j not in rule4_detected:
                            sinais['r4'].append((dates_list[j], values[j]))
                            rule4_detected.add(j)
                            violations_by_quarter[group]['Rule 4 Points'] += 1

    # Divide points by sequence size for counts
    for quarter in violations_by_quarter:
        violations_by_quarter[quarter]['Rule 2'] = violations_by_quarter[quarter]['Rule 2 Points'] // 7
        violations_by_quarter[quarter]['Rule 3'] = violations_by_quarter[quarter]['Rule 3 Points'] // 6
        violations_by_quarter[quarter]['Rule 4'] = violations_by_quarter[quarter]['Rule 4 Points'] // 14

    quarter_boundaries = df_hist.groupby('Quarter')['DT_REF'].min().sort_values()
    separadores = [pd.Timestamp(d).to_pydatetime() for d in quarter_boundaries[1:]]

    serie = df_hist[['DT_REF', 'ACTUAL']].sort_values('DT_REF').reset_index(drop=True)
    grafico = GraficoSPC(serie, grupos, sinais, separadores, unit, kpi_name)
    grafico.violations_by_quarter = violations_by_quarter
    return grafico


# ═══════════════════════════════════════════════════════════════════════════
# 2. HISTOGRAM WITH STATISTICS TABLE
# ═══════════════════════════════════════════════════════════════════════════

class GraficoHistograma:
    """Histograma do último ano + curvas normais por ano, linhas de Budget e limites."""

    def __init__(self, unit, years, anos, bin_edges, barras, budget, upper, lower):
        self.unit = unit
        self.years = years
        self.anos = anos          # [dict(year, mean, std, cv, budget, n, days_out, cor, curva=(x, y))]
        self.bin_edges = bin_edges
        self.barras = barras      # (centros, percentuais, cor) do último ano, ou None
        self.budget, self.upper, self.lower = budget, upper, lower

    @property
    def notas(self):
        return [
            f"1. Budget line, control limits and the bars are based on year {self.years[-1]}. "
            f"Limits calculated as Budget ±3·StdDev.",
            "2. Days Out: number of days where actual values fall outside the control limits.",
        ]

    def linhas_tabela(self):
        return [[{'texto': str(a['year']), 'marca': a['cor'], 'peso': 'semibold', 'cor': V.AZUL_ESCURO},
                 {'texto': a['mean'], 'peso': 'semibold'}, a['std'], f"{a['cv']:.1f}%", a['budget'],
                 str(a['n']), {'texto': str(a['days_out']), 'cor': V.CAIU if a['days_out'] else V.TINTA}]
                for a in self.anos]

    def desenhar(self, w, h):
        import matplotlib.transforms as mtrans
        from matplotlib.ticker import MaxNLocator

        fig = V.figura_px(w, h)
        m = dict(l=40, r=12, t=12, b=26)
        ax = fig.add_axes([m['l'] / w, m['b'] / h, (w - m['l'] - m['r']) / w, (h - m['t'] - m['b']) / h])
        _estilo_eixo(ax)
        largura = self.bin_edges[1] - self.bin_edges[0]
        ymax = 0
        if self.barras is not None:
            centros, pct, cor = self.barras
            ax.bar(centros, pct, width=largura * 0.88, color=cor, alpha=0.55 if len(self.anos) > 1 else 0.78,
                   linewidth=0, zorder=2)
            ymax = max(ymax, float(np.max(pct)) if len(pct) else 0)
        for a in self.anos:
            xs, ys = a['curva']
            ax.plot(xs, ys, color=a['cor'], linewidth=V.pt(2.2), linestyle=(0, (6, 4)), zorder=3)
            ymax = max(ymax, float(np.max(ys)) if len(ys) else 0)
        ax.set_ylim(0, (ymax or 1) * 1.08)
        ax.yaxis.set_major_locator(MaxNLocator(4))
        ax.yaxis.set_major_formatter(lambda v, _: f"{v:.0f}%")
        x0, x1 = self.bin_edges[0], self.bin_edges[-1]
        for v in (self.upper, self.lower):
            if v is not None:
                x0, x1 = min(x0, v), max(x1, v)
        ax.set_xlim(x0 - largura, x1 + largura)
        ax.xaxis.set_major_locator(MaxNLocator(max(3, int(w // 90))))
        faixa = x1 - x0
        ax.xaxis.set_major_formatter(lambda v, _: f"{v:,.1f}" if faixa < 10 else f"{v:,.0f}")

        if self.budget is not None:
            topo = mtrans.blended_transform_factory(ax.transData, ax.transAxes)
            desloc = lambda dx: mtrans.offset_copy(topo, fig=fig, x=V.pt(dx), y=0, units='points')
            xmin_ax, xmax_ax = ax.get_xlim()
            ax.axvline(self.budget, color=V.AZUL_PROFUNDO, linewidth=V.pt(1.6), zorder=4)
            for v in (self.upper, self.lower):
                ax.axvline(v, color=V.C_LIM, linewidth=V.pt(1.2), linestyle=(0, (5, 4)), zorder=4)
            for v, rot, cor, peso in ((self.budget, f"Budget {self.years[-1]}", V.AZUL_PROFUNDO, 'semibold'),
                                      (self.upper, 'Upper', V.C_LIM, 'medium'),
                                      (self.lower, 'Lower', V.C_LIM, 'medium')):
                # perto da borda direita, o rótulo vai para a esquerda da linha (não sai do card)
                direita = (v - xmin_ax) / (xmax_ax - xmin_ax) > 0.82
                ax.text(v, 0.98, f"{rot}\n{format_value_with_unit(v, self.unit)}", transform=desloc(-4 if direita else 4),
                        ha='right' if direita else 'left', va='top', fontsize=V.pt(9.5), color=cor, fontweight=peso,
                        linespacing=1.25, path_effects=_contorno(3), zorder=6)
        return V.figura_para_imagem(fig)


def create_histogram_table2(df_kpi, unit_kpi, kpi_name):
    """
    Compute the capability histogram (bars of the latest year, one normal curve per year,
    Budget ±3·StdDev lines and the statistics table) and return a GraficoHistograma.
    """
    df_hist = df_kpi.copy()
    df_hist['Year'] = df_hist['DT_REF'].dt.year
    years = sorted(df_hist['Year'].unique())

    all_values = df_hist['ACTUAL'].dropna()
    global_min = all_values.min()
    global_max = all_values.max()
    nbins = 35
    bin_edges = np.linspace(global_min, global_max, nbins + 1)
    bin_width = bin_edges[1] - bin_edges[0]

    validos = [y for y in years if len(df_hist[df_hist['Year'] == y]['ACTUAL'].dropna()) >= 5]
    anos = []
    barras = None
    std_last_year = None

    for idx, year in enumerate(years):
        data_year = df_hist[df_hist['Year'] == year]['ACTUAL'].dropna()
        if len(data_year) < 5:
            continue

        cor = V.cor_do_ano(validos.index(year), len(validos))
        mean = data_year.mean()
        std = data_year.std()
        n = len(data_year)
        cv = (std / mean) * 100 if mean != 0 else 0
        if idx == len(years) - 1:
            std_last_year = std
            hist, _ = np.histogram(data_year, bins=bin_edges)
            barras = ((bin_edges[:-1] + bin_edges[1:]) / 2, (hist / len(data_year)) * 100, cor)

        x_range = np.linspace(data_year.min(), data_year.max(), 300)
        y_normal_scaled = norm.pdf(x_range, mean, std) * 100 * bin_width

        budget_year = df_hist[df_hist['Year'] == year]['BUDGET'].iloc[0] if len(df_hist[df_hist['Year'] == year]) > 0 else None
        budget_formatted = format_value_with_unit(budget_year, unit_kpi) if not pd.isna(budget_year) else '-'

        days_out = 0
        if not pd.isna(budget_year) and std > 0:
            upper_limit_year = budget_year + 3 * std
            lower_limit_year = max(budget_year - 3 * std, 0)
            days_out = int(((data_year < lower_limit_year) | (data_year > upper_limit_year)).sum())

        anos.append(dict(year=year, mean=format_value_with_unit(mean, unit_kpi), std=format_value_with_unit(std, unit_kpi),
                         cv=cv, budget=budget_formatted, n=n, days_out=days_out, cor=cor, curva=(x_range, y_normal_scaled)))

    budget_line_value = upper_limit_value = lower_limit_value = None
    try:
        last_year = years[-1]
        budget_value = df_hist[df_hist['Year'] == last_year]['BUDGET'].iloc[0]
        if not pd.isna(budget_value) and std_last_year:
            budget_line_value = budget_value
            upper_limit_value = budget_value + 3 * std_last_year
            lower_limit_value = max(budget_value - 3 * std_last_year, 0)
    except Exception:
        pass

    return GraficoHistograma(unit_kpi, years, anos, bin_edges, barras,
                             budget_line_value, upper_limit_value, lower_limit_value)


# ═══════════════════════════════════════════════════════════════════════════
# 4. PROCESS CAPABILITY MOSHE (grouped bars + mean variation — active version)
# ═══════════════════════════════════════════════════════════════════════════

class GraficoMedidas:
    """Quatro colunas por trimestre (Mean, Best 30 Days, P75, Budget), como no Dashboard."""

    SERIES = ['Mean', 'Best 30 Days', 'P75', 'Budget']
    legenda = [('quadrado', V.M_COR[k], k) for k in SERIES]

    def __init__(self, agg, decimals, variacao):
        self.agg = agg              # DataFrame Quarter + as 4 séries
        self.decimals = decimals
        self.variacao = variacao    # [(de, para, pct)]

    def desenhar(self, w, h):
        from matplotlib.patches import FancyBboxPatch, Rectangle

        fig = V.figura_px(w, h)
        m = dict(l=4, r=4, t=24, b=28)
        ax = fig.add_axes([m['l'] / w, m['b'] / h, (w - m['l'] - m['r']) / w, (h - m['t'] - m['b']) / h])
        _estilo_eixo(ax, grade_y=False)
        ax.set_yticks([])
        larg_px, alt_px = w - m['l'] - m['r'], h - m['t'] - m['b']

        agg = self.agg
        n = len(agg)
        vals = agg[self.SERIES]
        y_min, y_max = vals.min().min(), vals.max().max()
        if pd.isna(y_min) or pd.isna(y_max) or y_min == y_max:
            if pd.notna(y_min):
                y_max = y_min * 1.1 if y_min > 0 else y_min + 1
            elif pd.notna(y_max):
                y_min = y_max * 0.9 if y_max > 0 else y_max - 1
            else:
                y_min, y_max = 0, 100
        padding = (y_max - y_min) * 0.15
        base, topo = y_min - padding, y_max + padding
        ax.set_ylim(base, topo)
        ax.set_xlim(-0.5, n - 0.5)

        # grupo: até 150 px, colunas de até 30 px com 3 px entre elas (como .cg-grupo / .cg-col)
        grupo_px = min(150, larg_px / max(n, 1) * 0.82)
        col_px = min(30, (grupo_px - 9) / 4)
        px_x = larg_px / n
        px_y = alt_px / (topo - base)
        col_w = col_px / px_x
        passo = (col_px + 3) / px_x
        raio = 4
        fv = 9 if col_px >= 24 else (8.5 if col_px >= 16 else 7.5)

        # rótulo que não cabe sobre a coluna: fonte menor e, se ainda não couber, em milhares (k)
        maior = vals.abs().max().max()
        rotulo = lambda v: f"{v:,.{self.decimals}f}"
        largura_rot = lambda t, f: len(t) * f * 0.6
        if pd.notna(maior):
            while fv > 7 and largura_rot(rotulo(maior), fv) > col_px + 3:
                fv -= 0.5
            if largura_rot(rotulo(maior), fv) > col_px + 3 and maior >= 1000:
                rotulo = lambda v: f"{v / 1000:,.1f}k"

        for i, row in agg.iterrows():
            for j, k in enumerate(self.SERIES):
                v = row[k]
                if pd.isna(v):
                    continue
                x0 = i + (j - 1.5) * passo - col_w / 2
                alt = v - base
                if alt <= 0:
                    continue
                cor = V.M_COR[k]
                ax.add_patch(FancyBboxPatch((x0, base), col_w, alt, boxstyle=f"round,pad=0,rounding_size={raio / px_x}",
                                            mutation_aspect=px_x / px_y, fc=cor, ec='none', zorder=2))
                ax.add_patch(Rectangle((x0, base), col_w, min(alt, alt / 2), fc=cor, ec='none', zorder=2))
                ax.text(x0 + col_w / 2, v + 4 / px_y, rotulo(v), ha='center', va='bottom',
                        fontsize=V.pt(fv), fontweight='semibold', color=V.TINTA, zorder=3)

        ax.set_xticks(range(n))
        ax.set_xticklabels([_rotulo_trimestre(q) for q in agg['Quarter']])
        return V.figura_para_imagem(fig)


def create_process_capability_moshe(df_kpi, unit, kpi_name, config, colors):
    """
    Compute Mean / Best 30 Days / P75 / Budget per quarter and the quarter-over-quarter
    mean variation, and return a GraficoMedidas.
    """
    df_hist = df_kpi.copy()
    df_hist['Quarter'] = df_hist['DT_REF'].dt.to_period('Q').astype(str)
    groups = sorted(df_hist['Quarter'].unique())
    window_size = 30

    media, budget_l, p75_l, best_l = _compute_period_metrics(df_hist, groups, 'Quarter', window_size)

    agg = pd.DataFrame({
        'Quarter': groups,
        'Mean': media,
        'Best 30 Days': best_l,
        'P75': p75_l,
        'Budget': budget_l,
    }).replace({None: np.nan})
    for k in GraficoMedidas.SERIES:
        agg[k] = pd.to_numeric(agg[k], errors='coerce')

    agg['Mean_Pct_Change'] = agg['Mean'].pct_change() * 100
    variacao = []
    for i in range(1, len(agg)):
        pct = agg.iloc[i]['Mean_Pct_Change']
        if pd.notna(pct) and np.isfinite(pct):
            variacao.append((_rotulo_trimestre(agg.iloc[i - 1]['Quarter']), _rotulo_trimestre(agg.iloc[i]['Quarter']), pct))

    decimals = 2 if unit == '%/day' else 0
    return GraficoMedidas(agg, decimals, variacao)


# ═══════════════════════════════════════════════════════════════════════════
# 3. PROCESS CAPABILITY (Plotly version — kept for reference)
# ═══════════════════════════════════════════════════════════════════════════

def create_process_capability(df_kpi, unit, kpi_name, config, colors):
    """
    Generate Process Performance chart — Plotly version.

    Uses Mean bars with Budget/P75/Best30days lines overlaid.
    """
    df_hist = df_kpi.copy()
    df_hist['Quarter'] = df_hist['DT_REF'].dt.to_period('Q').astype(str)
    groups = sorted(df_hist['Quarter'].unique())
    group_labels = groups
    groupby_col = 'Quarter'
    window_size = 30
    unit_kpi = unit
    display_unit = get_display_unit(unit)

    def format_bar_label(value, unit):
        if value is None or np.isnan(value):
            return ''
        if unit.lower() == 'tonnes/day':
            return f"{value / 1000:.0f}"
        elif unit.strip() == '%/day':
            return f"{value:.1f}"
        return f"{value:.1f}"

    media, budget_l, p75_l, best_l = _compute_period_metrics(df_hist, groups, groupby_col, window_size)

    fig_process = go.Figure()
    text_colors, bar_colors_list = [], []
    for m, b in zip(media, budget_l):
        if b is not None and not np.isnan(b):
            if m < b:
                bar_colors_list.append('#EE4747')
                text_colors.append(colors['mean_text_below_budget'])
            else:
                text_colors.append(colors['mean_text'])
                bar_colors_list.append(colors['mean_bar'])
        else:
            text_colors.append(colors['mean_text'])
            bar_colors_list.append(colors['mean_bar'])

    fig_process.add_trace(go.Bar(
        x=group_labels, y=media, name='Mean',
        marker_color=bar_colors_list, marker_line_color=colors['mean_bar'],
        marker_line_width=0, text='', width=0.5, showlegend=False,
    ))
    fig_process.add_trace(go.Bar(
        x=[None], y=[None], name='Mean',
        marker_color=colors['mean_bar'], showlegend=True,
    ))

    has_budget = False
    annotations = []
    all_vals = [v for v in media + budget_l + p75_l + best_l if v is not None and not np.isnan(v)]
    y_min_t = max(min(all_vals) - 0.5 * min(all_vals), 0) if all_vals else 0

    for i, (m, c) in enumerate(zip(media, text_colors)):
        if m is not None and not np.isnan(m):
            y_center = y_min_t + (m - y_min_t) / 2
            annotations.append(dict(
                x=i, y=y_center,
                text=f'<b style="color:{c}">{format_bar_label(m, unit_kpi)}</b>',
                showarrow=False, xanchor='center', yanchor='middle', font=dict(size=10),
            ))

    for i, (_, b) in enumerate(zip(group_labels, budget_l)):
        if b is not None and not np.isnan(b):
            has_budget = True
            fig_process.add_shape(
                type='line', x0=i - 0.35, x1=i + 0.35, y0=b, y1=b,
                line=dict(color=colors['budget'], width=3),
            )
            annotations.append(dict(
                x=i, y=b,
                text=f"<b style='font-size:8px'>{format_bar_label(b, unit_kpi)}</b>",
                showarrow=False, xanchor='center', yanchor='bottom',
                font=dict(size=8, color=colors['budget']),
            ))

    if has_budget:
        fig_process.add_trace(go.Scatter(
            x=[None], y=[None], mode='lines',
            line=dict(color=colors['budget'], width=3), name='Budget', showlegend=True,
        ))

    for lbl, vals, clr, w in [
        ('P75', p75_l, colors['p75'], 2),
        ('Best30days', best_l, colors['best90'], 2),
    ]:
        for i, v in enumerate(vals):
            if v is not None and not np.isnan(v):
                fig_process.add_shape(
                    type='line', x0=i - 0.35, x1=i + 0.35, y0=v, y1=v,
                    line=dict(color=clr, width=w),
                )
                annotations.append(dict(
                    x=i, y=v,
                    text=f"<span style='font-size:7px'>{format_bar_label(v, unit_kpi)}</span>",
                    showarrow=False, xanchor='center', yanchor='bottom',
                    font=dict(size=7, color=clr),
                ))
        fig_process.add_trace(go.Scatter(
            x=[None], y=[None], mode='lines',
            line=dict(color=clr, width=w), name=lbl, showlegend=True,
        ))

    y_max = max(all_vals) * 1.1 if all_vals else None
    y_min = y_min_t if all_vals else None

    fig_process.update_layout(
        title=dict(
            text=(
                f"<b>Process Capability ({display_unit})</b><br>"
                "<span style='font-size:10px; color:gray'>Can the process achieve the budget consistently?</span>"
            ),
            font=dict(size=14), x=0.06, xanchor='left',
        ),
        xaxis=dict(
            title='', type='category', tickfont=dict(size=8),
            showline=False, zeroline=False,
            tickmode='array', tickvals=list(range(len(group_labels))),
            ticktext=[l[4:] if len(l) >= 4 else l for l in group_labels],
        ),
        yaxis=dict(
            showticklabels=False, zeroline=False,
            range=[y_min, y_max] if y_min is not None else None,
        ),
        width=900, height=350, showlegend=True,
        legend=dict(
            orientation='h', yanchor='bottom', y=1.0,
            xanchor='center', x=0.5, font=dict(size=9),
        ),
        font=dict(size=9), plot_bgcolor='white', paper_bgcolor='white',
        margin=dict(l=40, r=10, t=100, b=10),
        annotations=annotations,
    )

    if not has_budget:
        fig_process.add_annotation(
            text='⚠️ No Budget', xref='paper', yref='paper',
            x=0.5, y=-0.11, showarrow=False,
            font=dict(size=8, color='orange'),
            bgcolor='#fff3cd', bordercolor='orange', borderwidth=1,
        )

    return fig_process



# ═══════════════════════════════════════════════════════════════════════════
# Internal helpers
# ═══════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════
# Internal helpers
# ═══════════════════════════════════════════════════════════════════════════

def _compute_period_metrics(df_hist, groups, groupby_col, window_size):
    """Compute mean, budget, p75 and best-30-days per period."""
    media, budget_l, p75_l, best_l = [], [], [], []
    for group in groups:
        dg = df_hist[df_hist[groupby_col] == group]
        media.append(dg['ACTUAL'].mean())
        bg = dg['BUDGET'].dropna()
        budget_l.append(bg.mean() if len(bg) > 0 else None)
        p75_l.append(dg['ACTUAL'].quantile(0.75))
        dg_sorted = dg.sort_values('DT_REF')
        if len(dg_sorted) >= window_size:
            best = -np.inf
            for i in range(len(dg_sorted) - window_size + 1):
                wm = dg_sorted.iloc[i:i + window_size]['ACTUAL'].dropna().mean()
                if wm > best:
                    best = wm
            best_l.append(best if best != -np.inf else None)
        else:
            best_l.append(None)
    return media, budget_l, p75_l, best_l
