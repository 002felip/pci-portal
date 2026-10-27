"""
Chart Generator Module

All chart-creation functions for the Multi-KPI PDF report:
    1. create_control_chart      — I-MR Control Chart grouped by Quarter (Plotly)
    2. create_histogram_table2   — Histogram with statistics table (Plotly)
    3. create_process_capability — Process Performance with Mean/Budget/P75/Best30 (Plotly)
    4. create_process_capability_moshe — Grouped bar chart with variation table (Matplotlib)

Extracted from notebook 05_multi_kpi_pdf_generator.ipynb
"""

import datetime
import logging

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from scipy.stats import norm

from src.spc_functions import calculate_xam_limits
from .utils import format_value_with_unit, get_display_unit

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════
# 1. CONTROL CHART
# ═══════════════════════════════════════════════════════════════════════════

def create_control_chart(df_kpi, unit, kpi_name, config, colors):
    """
    Generate I-MR Control Chart grouped by Quarter — Power BI style.

    Parameters
    ----------
    df_kpi : DataFrame
        KPI data with DT_REF, ACTUAL, BUDGET columns.
    unit : str
        Unit of measurement (already transformed).
    kpi_name : str
        KPI name for axis label.
    config : dict
        Chart configuration.
    colors : dict
        Color scheme.

    Returns
    -------
    plotly.graph_objects.Figure
    """
    df_hist = df_kpi.copy()
    df_hist['Quarter'] = df_hist['DT_REF'].dt.to_period('Q').astype(str)

    groupby_col = 'Quarter'
    groups = sorted(df_hist[groupby_col].unique())
    unit_kpi = unit

    df_all = df_hist.dropna(subset=['ACTUAL']).sort_values('DT_REF').reset_index(drop=True)
    dates = df_all['DT_REF']
    data_series = df_all['ACTUAL']

    # Control limits per quarter
    limits_by_group = {}
    for group in groups:
        data_group = df_hist[df_hist[groupby_col] == group]['ACTUAL'].dropna()
        if len(data_group) >= 3:
            limits_by_group[group] = calculate_xam_limits(data_group)
        else:
            limits_by_group[group] = None

    fig_control = go.Figure()

    # Main line (light gray)
    fig_control.add_trace(go.Scatter(
        x=dates, y=data_series,
        mode='lines', name='Values',
        line=dict(color='#d3d3d3', width=1),
        showlegend=True,
    ))

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

    # Violation lists
    viol1_dates, viol1_vals = [], []
    viol2_dates, viol2_vals = [], []
    viol3_dates, viol3_vals = [], []
    viol4_dates, viol4_vals = [], []

    violations_by_quarter = {}

    for idx, group in enumerate(groups):
        limits = limits_by_group.get(group)
        if limits is None:
            continue

        group_data = df_hist[df_hist[groupby_col] == group].sort_values('DT_REF').reset_index(drop=True)
        group_data_clean = group_data.dropna(subset=['ACTUAL']).reset_index(drop=True)
        group_dates = group_data_clean['DT_REF']
        group_values = group_data_clean['ACTUAL']

        if len(group_values) < 7:
            continue

        x_start = pd.Timestamp(group_dates.min()).to_pydatetime()
        x_end = pd.Timestamp(group_dates.max()).to_pydatetime()
        mid_idx = len(group_dates) // 2
        x_mid = pd.Timestamp(group_dates.iloc[mid_idx]).to_pydatetime()

        cl = limits['CL']
        ucl = limits['UCL']
        lcl = max(limits['LCL'], 0)

        # Best 30 Days
        best_start, best_end, best_mean = best_30_days_period(group_data)
        if best_start is not None:
            fig_control.add_vrect(
                x0=best_start, x1=best_end,
                fillcolor='gold', opacity=0.1,
                layer='below', line_width=0,
            )
            x_mid_best = best_start + datetime.timedelta(days=(best_end - best_start).days // 2)
            fig_control.add_annotation(
                x=x_mid_best, y=0.02, yref='paper',
                text=f"{best_start.strftime('%d/%m')} - {best_end.strftime('%d/%m')}",
                showarrow=False,
                font=dict(size=6, color='#5C4305'),
                bgcolor='white', bordercolor='#B8860B',
                borderwidth=1, borderpad=2, yanchor='bottom',
            )

        # Control limit lines
        fig_control.add_trace(go.Scatter(
            x=[x_start, x_end], y=[cl, cl],
            mode='lines', name='CL',
            line=dict(color='green', width=3), showlegend=False,
        ))
        fig_control.add_trace(go.Scatter(
            x=[x_start, x_end], y=[ucl, ucl],
            mode='lines', name='UCL',
            line=dict(color='red', width=1, dash='dot'), showlegend=False,
        ))
        fig_control.add_trace(go.Scatter(
            x=[x_start, x_end], y=[lcl, lcl],
            mode='lines', name='LCL',
            line=dict(color='red', width=1, dash='dot'), showlegend=False,
        ))

        # Limit labels
        fig_control.add_annotation(
            x=x_start, y=ucl,
            text=f"UCL = {format_value_with_unit(ucl, unit_kpi)}",
            showarrow=False,
            font=dict(size=7, color='red', family='Arial Black'),
            bgcolor='rgba(255,255,255,0.6)', borderpad=4, xanchor='left',
        )
        fig_control.add_annotation(
            x=x_start, y=cl,
            text=f"CL = {format_value_with_unit(cl, unit_kpi)}",
            showarrow=False,
            font=dict(size=10, color='green', family='Arial Black'),
            bgcolor='rgba(255,255,255,0.6)', borderpad=4, yshift=10, xanchor='left',
        )
        fig_control.add_annotation(
            x=x_start, y=lcl,
            text=f"LCL = {format_value_with_unit(lcl, unit_kpi)}",
            showarrow=False,
            font=dict(size=7, color='red', family='Arial Black'),
            bgcolor='rgba(255,255,255,0.6)', borderpad=4, xanchor='left',
        )

        # Quarter label
        fig_control.add_annotation(
            x=x_mid, y=1.03,
            text=group, showarrow=False,
            xref='x', yref='paper',
            font=dict(size=10, color='#1D1C1C'),
            bgcolor='#f2f2f2', bordercolor='#8A8989',
            borderwidth=0.8, borderpad=4,
        )

        # Violation detection
        values = group_values.values
        dates_list = pd.to_datetime(group_dates).tolist()

        if group not in violations_by_quarter:
            violations_by_quarter[group] = {
                'Rule 1': 0, 'Rule 2': 0, 'Rule 3': 0, 'Rule 4': 0,
                'Rule 2 Points': 0, 'Rule 3 Points': 0, 'Rule 4 Points': 0,
            }

        # RULE 1: point outside limits
        mask1 = (values > ucl) | (values < lcl)
        for i, include in enumerate(mask1):
            if include:
                viol1_dates.append(dates_list[i])
                viol1_vals.append(values[i])
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
                        viol2_dates.append(dates_list[j])
                        viol2_vals.append(values[j])
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
                            viol3_dates.append(dates_list[j])
                            viol3_vals.append(values[j])
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
                            viol4_dates.append(dates_list[j])
                            viol4_vals.append(values[j])
                            rule4_detected.add(j)
                            violations_by_quarter[group]['Rule 4 Points'] += 1

    # Divide points by sequence size for counts
    for quarter in violations_by_quarter:
        violations_by_quarter[quarter]['Rule 2'] = violations_by_quarter[quarter]['Rule 2 Points'] // 7
        violations_by_quarter[quarter]['Rule 3'] = violations_by_quarter[quarter]['Rule 3 Points'] // 6
        violations_by_quarter[quarter]['Rule 4'] = violations_by_quarter[quarter]['Rule 4 Points'] // 14

    # Plot violations
    for vd, vv, name, color, sz in [
        (viol4_dates, viol4_vals, 'Rule 4', 'orange', 5),
        (viol3_dates, viol3_vals, 'Rule 3', 'black', 5),
        (viol2_dates, viol2_vals, 'Rule 2', '#007e7a', 5),
        (viol1_dates, viol1_vals, 'Rule 1', 'red', 5),
    ]:
        fig_control.add_trace(go.Scatter(
            x=vd if vd else [None], y=vv if vv else [None],
            mode='markers', name=name,
            marker=dict(size=sz, color=color, line=dict(width=1, color=color)),
            showlegend=True,
        ))

    fig_control.add_trace(go.Scatter(
        x=[None], y=[None], mode='lines', name='Best 30 Days',
        line=dict(color='gold', width=10), opacity=0.2, showlegend=True,
    ))

    # Quarter separators
    quarter_boundaries = df_hist.groupby('Quarter')['DT_REF'].min().sort_values()
    for quarter_date in quarter_boundaries[1:]:
        fig_control.add_vline(
            x=pd.Timestamp(quarter_date).to_pydatetime(),
            line=dict(color='#c0c0c0', width=1.1), layer='below',
        )

    # Layout
    fig_control.update_layout(
        title='',
        xaxis=dict(
            title='', tickformat='%Y-%m',
            tickfont=dict(size=10, color='#6E6E6E'),
            linecolor='#6E6E6E', showgrid=False, showline=True, mirror=True,
        ),
        yaxis=dict(
            title=dict(text=f"{kpi_name} ({unit})", font=dict(size=11, color='#6E6E6E')),
            tickfont=dict(size=11, color='#6E6E6E'),
            linecolor='#6E6E6E', showgrid=False, showline=True, mirror=True,
        ),
        width=900, height=400, hovermode='x unified', showlegend=True,
        legend=dict(
            orientation='h', yanchor='bottom', y=1.05,
            xanchor='center', x=0.5, font=dict(size=12),
            bgcolor='rgba(0,0,0,0)',
        ),
        font=dict(size=10),
        margin=dict(l=10, r=10, t=10, b=50),
        plot_bgcolor='white', paper_bgcolor='white',
    )

    # Separator line
    fig_control.add_shape(
        type='line', xref='paper', yref='paper',
        x0=0, x1=1, y0=-0.08, y1=-0.08,
        line=dict(color='#CCCCCC', width=1),
    )

    # Footer with rule definitions
    fig_control.add_annotation(
        text=(
            "<span style='font-size:11px; color:#666'>"
            "<b>Rule 1:</b> Point outside control limits  |  "
            "<b>Rule 2:</b> 7 points on same side of center line  |  "
            "<b>Rule 3:</b> 6 points increasing or decreasing  |  "
            "<b>Rule 4:</b> 14 points alternating up and down"
            "</span>"
        ),
        xref='paper', yref='paper', x=0.5, y=-0.18,
        showarrow=False, xanchor='center', align='center',
    )

    return fig_control


# ═══════════════════════════════════════════════════════════════════════════
# 2. HISTOGRAM WITH STATISTICS TABLE
# ═══════════════════════════════════════════════════════════════════════════

def create_histogram_table2(df_kpi, unit_kpi, kpi_name):
    """
    Generate histogram with statistics table — Power BI style.

    Parameters
    ----------
    df_kpi : DataFrame
        DataFrame containing KPI values with DT_REF, ACTUAL, BUDGET columns.
    unit_kpi : str
        Unit of measurement.
    kpi_name : str
        Name of the KPI for axis label.

    Returns
    -------
    plotly.graph_objects.Figure
    """
    df_hist = df_kpi.copy()
    df_hist['Year'] = df_hist['DT_REF'].dt.year
    years = sorted(df_hist['Year'].unique())

    fig_hist_table = go.Figure()

    all_values = df_hist['ACTUAL'].dropna()
    global_min = all_values.min()
    global_max = all_values.max()
    nbins = 35
    bin_edges = np.linspace(global_min, global_max, nbins + 1)
    bin_width = bin_edges[1] - bin_edges[0]

    colors_powerbi = ['#e5e7eb', '#f6caca', '#e9f0f8', '#D5F5E3']
    line_colors_powerbi = ['#ff7f0e', '#e56768', '#3985e4', '#006D5B']

    stats_table = []
    mean_values = {}
    std_last_year = None

    for idx, year in enumerate(years):
        data_year = df_hist[df_hist['Year'] == year]['ACTUAL'].dropna()
        if len(data_year) < 5:
            continue

        line_color = line_colors_powerbi[idx % len(line_colors_powerbi)]
        mean = data_year.mean()
        std = data_year.std()
        n = len(data_year)
        cv = (std / mean) * 100 if mean != 0 else 0
        mean_values[year] = (mean, line_color)
        if idx == len(years) - 1:
            std_last_year = std

        # Histogram bars only for the most recent year
        if idx == len(years) - 1:
            hist, _ = np.histogram(data_year, bins=bin_edges)
            hist_percent = (hist / len(data_year)) * 100
            fig_hist_table.add_trace(go.Bar(
                x=(bin_edges[:-1] + bin_edges[1:]) / 2,
                y=hist_percent, width=bin_width * 0.95,
                name=str(year),
                marker=dict(color=line_color, line=dict(color='black', width=1.5)),
                opacity=0.2, showlegend=False,
            ))

        # Normal curve
        x_range = np.linspace(data_year.min(), data_year.max(), 300)
        y_normal = norm.pdf(x_range, mean, std)
        y_normal_scaled = y_normal * 100 * bin_width
        fig_hist_table.add_trace(go.Scatter(
            x=x_range, y=y_normal_scaled,
            mode='lines', name=str(year),
            line=dict(color=line_color, width=2.5), showlegend=False,
        ))

        budget_year = df_hist[df_hist['Year'] == year]['BUDGET'].iloc[0] if len(df_hist[df_hist['Year'] == year]) > 0 else None
        budget_formatted = format_value_with_unit(budget_year, unit_kpi) if not pd.isna(budget_year) else '-'

        days_out = 0
        if not pd.isna(budget_year) and std > 0:
            upper_limit_year = budget_year + 3 * std
            lower_limit_year = max(budget_year - 3 * std, 0)
            days_out = ((data_year < lower_limit_year) | (data_year > upper_limit_year)).sum()

        stats_table.append({
            'year': year,
            'mean': format_value_with_unit(mean, unit_kpi),
            'std': format_value_with_unit(std, unit_kpi),
            'cv': cv,
            'budget': budget_formatted,
            'n': n,
            'days_out': days_out,
            'line_color': line_color,
        })

    # Budget and control limit lines
    budget_line_value = None
    upper_limit_value = None
    lower_limit_value = None

    try:
        last_year = years[-1]
        budget_value = df_hist[df_hist['Year'] == last_year]['BUDGET'].iloc[0]
        if not pd.isna(budget_value) and std_last_year:
            budget_line_value = budget_value
            upper_limit_value = budget_value + 3 * std_last_year
            lower_limit_value = max(budget_value - 3 * std_last_year, 0)
            fig_hist_table.add_vline(x=budget_value, line=dict(color='#505050', width=2))
            fig_hist_table.add_vline(x=upper_limit_value, line=dict(color='#909090', width=1.5, dash='dot'))
            fig_hist_table.add_vline(x=lower_limit_value, line=dict(color='#909090', width=1.5, dash='dot'))
    except Exception:
        pass

    # Legend / table block
    legend_text = "<span style='font-size:10px; color:#2a3f5f;'><b>            Year                Mean                  StDev                 CV(%)               Budget               Days             Days Out</b></span><br>"
    legend_text += "<span style='color:#E8E8E8; line-height:0.7;'><b>─────────────────────────────────────────────────────────────────────────</b></span><br>"

    for i, stat in enumerate(stats_table):
        circle_icon = f"<span style='color:{stat['line_color']}; font-size:16px;'>●</span>"
        year_colored = f"<b>{stat['year']}</b>"
        legend_text += (
            f"<span style='line-height:0.8;'>{circle_icon}     {year_colored}"
            f"     {stat['mean']:>13}     {stat['std']:>14}     {stat['cv']:>13.1f}"
            f"     {stat['budget']:>13}     {stat['n']:>12}     {stat['days_out']:>11}</span><br>"
        )
        if i < len(stats_table) - 1:
            legend_text += "<span style='color:#E8E8E8; line-height:0.8;'>─────────────────────────────────────────────────────────────────────────</span><br>"

    annotations = [
        dict(
            text=legend_text, xref='paper', yref='paper',
            x=0.07, y=1.07, xanchor='left', yanchor='bottom',
            font=dict(size=12, family='Calibri, monospace', color='#333333'),
            showarrow=False, bgcolor='white', borderwidth=0, borderpad=1, align='left',
        ),
        dict(
            text=(
                f"<b>1.</b> Budget line, control limits and the bars are based on year {years[-1]}. "
                f"Limits calculated as Budget ±3*StdDev <br>"
                f"<b>2.</b> Days Out: Number of days where actual values fall outside the control limits "
            ),
            xref='paper', yref='paper', x=0.0, y=-0.15,
            xanchor='left', yanchor='top', showarrow=False,
            font=dict(size=11, family='Calibri', color='#808495'),
            bgcolor='white', align='left',
        ),
    ]

    fig_hist_table.update_layout(
        title='',
        yaxis_title=dict(text='Percent (%)', font=dict(size=12, color='#6E6E6E')),
        xaxis=dict(
            tickfont=dict(size=12, color='#6E6E6E'), showgrid=False,
            showline=True, linewidth=1, linecolor='#6E6E6E', mirror=True,
            ticks='outside', ticklen=5, tickwidth=1, tickcolor='#6E6E6E',
        ),
        yaxis=dict(
            tickfont=dict(size=12, color='#6E6E6E'), showgrid=False,
            showline=True, linewidth=1, linecolor='#6E6E6E', mirror=True,
            ticks='outside', ticklen=5, tickwidth=1, tickcolor='#6E6E6E',
        ),
        width=700, height=430, barmode='overlay', showlegend=False,
        font=dict(size=12, family='Calibri, monospace', color='#6E6E6E'),
        plot_bgcolor='white', paper_bgcolor='white',
        margin=dict(l=5, r=5, t=120, b=60),
        annotations=annotations,
    )

    # Labels beside budget/limit lines
    if budget_line_value is not None:
        y_pos = 0.95
        for val, label, color in [
            (budget_line_value, f'<b>Budget {years[-1]}</b><br>{format_value_with_unit(budget_line_value, unit_kpi)}', '#505050'),
            (upper_limit_value, f'Upper<br>{format_value_with_unit(upper_limit_value, unit_kpi)}', '#909090'),
            (lower_limit_value, f'Lower<br>{format_value_with_unit(lower_limit_value, unit_kpi)}', '#909090'),
        ]:
            fig_hist_table.add_annotation(
                x=val, y=y_pos, xref='x', yref='paper',
                text=label, showarrow=False,
                font=dict(size=10, color=color, family='Arial'),
                xanchor='left', yanchor='top', xshift=5,
            )

    return fig_hist_table


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
# 4. PROCESS CAPABILITY MOSHE (Matplotlib — active version)
# ═══════════════════════════════════════════════════════════════════════════

def create_process_capability_moshe(df_kpi, unit, kpi_name, config, colors):
    """
    Generate Process Performance chart — Matplotlib version with grouped bars
    and a QoQ variation table on the right side.

    Returns
    -------
    matplotlib.figure.Figure
    """
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    df_hist = df_kpi.copy()
    df_hist['Quarter'] = df_hist['DT_REF'].dt.to_period('Q').astype(str)
    groups = sorted(df_hist['Quarter'].unique())
    group_labels = groups
    groupby_col = 'Quarter'
    window_size = 30
    unit_kpi = unit

    media, budget_l, p75_l, best_l = _compute_period_metrics(df_hist, groups, groupby_col, window_size)

    agg = pd.DataFrame({
        'Quarter': group_labels,
        'Mean': media,
        'Best 30 Days': best_l,
        'P75': p75_l,
        'Budget': budget_l,
    }).replace({None: np.nan})

    agg['Mean_Pct_Change'] = agg['Mean'].pct_change() * 100

    labels = agg['Quarter']
    x = np.arange(len(labels))
    width = 0.21

    fig, ax = plt.subplots(figsize=(12, 4))

    bar_colors = {
        'Mean': '#0B3C5D',
        'Best 30 Days': '#6C83B5',
        'P75': '#A6B1D9',
        'Budget': '#00A3E0',
    }

    ax.bar(x - 1.5 * width, agg['Mean'], width, label='Mean', color=bar_colors['Mean'])
    ax.bar(x - 0.5 * width, agg['Best 30 Days'], width, label='Best 30 Days', color=bar_colors['Best 30 Days'])
    ax.bar(x + 0.5 * width, agg['P75'], width, label='P75', color=bar_colors['P75'])
    ax.bar(x + 1.5 * width, agg['Budget'], width, label='Budget', color=bar_colors['Budget'])

    ax.set_xlim(-0.5, len(x) - 0.02)

    if unit_kpi == '%/day':
        decimals = 2
    elif unit_kpi in ('ton/day', 'tonnes/day', 'ktonnes/day', 'eqm/day'):
        decimals = 0
    else:
        decimals = 0

    for i, row in agg.iterrows():
        for offset, col in zip([-1.5, -0.5, 0.5, 1.5], ['Mean', 'Best 30 Days', 'P75', 'Budget']):
            val = row[col]
            if pd.notna(val):
                ax.text(
                    x[i] + offset * width, val,
                    f"{val:,.{decimals}f}",
                    ha='center', va='bottom', fontsize=8, fontweight='bold',
                    color=bar_colors[col],
                )

    y_min = agg[['Mean', 'Best 30 Days', 'P75', 'Budget']].min().min()
    y_max = agg[['Mean', 'Best 30 Days', 'P75', 'Budget']].max().max()

    if pd.isna(y_min) or pd.isna(y_max) or y_min == y_max:
        if pd.notna(y_min):
            y_max = y_min * 1.1 if y_min > 0 else y_min + 1
        elif pd.notna(y_max):
            y_min = y_max * 0.9 if y_max > 0 else y_max - 1
        else:
            y_min, y_max = 0, 100

    padding = (y_max - y_min) * 0.15
    ax.set_ylim(y_min - padding, y_max + padding)

    ax.set_xticks(x)
    ax.set_xticklabels(labels, fontsize=9)
    ax.set_yticks([])
    ax.set_ylabel('')

    ax.spines['left'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['top'].set_visible(False)
    ax.spines['bottom'].set_visible(True)

    ax.legend(ncol=4, fontsize=12, loc='upper center', bbox_to_anchor=(0.5, 1.10), frameon=False)

    # QoQ variation table on the right
    rows = []
    for i in range(1, len(agg)):
        q_from = agg.iloc[i - 1]['Quarter']
        q_to = agg.iloc[i]['Quarter']
        pct = agg.iloc[i]['Mean_Pct_Change']
        if pd.notna(pct):
            rows.append((q_from, q_to, pct))

    if rows:
        x_box = 1.15
        y_box = 0.98
        line_step = 0.09
        ax.text(x_box, y_box, '', transform=ax.transAxes, ha='right', va='top',
                bbox=dict(boxstyle='round, pad=0.45', facecolor='white', edgecolor='#D0D0D0'))
        ax.text(x_box - 0.05, y_box + 0.08, 'Mean variation', transform=ax.transAxes,
                ha='right', va='top', fontsize=9, fontweight='bold', color='#4D4D4D')
        for i, (q_from, q_to, pct) in enumerate(rows):
            arrow = '▲' if pct > 0 else '▼'
            sign = '+' if pct > 0 else ''
            color = '#1F77B4' if pct > 0 else '#D62728'
            ax.text(
                x_box - 0.01, y_box - i * line_step,
                f"{q_from} → {q_to}   {arrow} {sign}{pct:.1f}%",
                transform=ax.transAxes, ha='right', va='top',
                fontsize=9, fontweight='normal', color=color,
            )

    plt.tight_layout()
    return fig


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
