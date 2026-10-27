"""
Data Processor Module

Handles all data loading, filtering, transformation, and statistical calculations.
Extracted from notebook 05_multi_kpi_pdf_generator.ipynb — load_kpi_data() and
calculate_statistics_by_year().

Business Rules Applied:
    1. Site name normalization (Salobo I e II → Salobo I&II, etc.)
    2. Remove records where ACTUAL is empty but BUDGET is filled
    3. Convert negative values to zero
    4. Multiply %/day values by 100
    5. Remove zeros for %/day unit
    6. Convert tonnes/day → ktonnes/day for Salobo/Sossego specific KPIs
    7. Remove upper outliers (μ+3.5σ) for %/day unit
"""

import logging

import numpy as np
import pandas as pd
from scipy import stats

from .utils import filter_last_n_years
from .exceptions import DataValidationError

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Site normalization mapping
# ---------------------------------------------------------------------------

SITE_NAME_REPLACEMENTS = {
    'Salobo I e II': 'Salobo I&II',
    'Copper Cliff | CCNR': 'Copper Cliff',
    'Clydach | CNR': 'Clydach',
    'Matsusaka | Tonimet': 'Matsusaka Tonimet',
}

# KPIs that require tonnes→ktonnes conversion
KPIS_FOR_KTONNES_CONVERSION = [
    'Ore Mined', 'Ore Mined (dry)', 'Total Movement', 'Ore Milled | ROP (dry)', 'Ore Milled - ROP', 'Ore Milled - ROP (dry)',
]

# Business Units that require tonnes→ktonnes conversion
BUS_FOR_KTONNES_CONVERSION = ['Salobo', 'Sossego']


def load_kpi_data(df_raw, bu_name, kpi_name, site_name, type_operation, n_years=3, ref_year=None):
    """
    Load and filter data for a specific KPI within a Business Unit, Site, and Type Operation.

    Parameters
    ----------
    df_raw : DataFrame
        Raw data with all sites and KPIs.
    bu_name : str
        Business Unit name to filter (column 'BUSINESS UNIT').
    kpi_name : str
        KPI name to filter (column 'NAME KPI').
    site_name : str
        Site name to filter (column 'NAME SITE').
    type_operation : str
        Type Operation (Phase) to filter (column 'TYPE OPERATION').
    n_years : int
        Number of years to include.
    ref_year : int, optional
        Last year of the analysis (default: current calendar year).

    Returns
    -------
    dict or None
        Dictionary with keys: df_kpi, data_series, dates, unit, display_unit, metadata.
        Returns None if no data is found after filtering.

    Raises
    ------
    DataValidationError
        If critical data issues are detected.
    """
    # Filter by Business Unit, KPI, Site, and Type Operation
    df_kpi = df_raw[
        (df_raw['BUSINESS UNIT'] == bu_name) &
        (df_raw['NAME SITE'] == site_name) &
        (df_raw['NAME KPI'] == kpi_name) &
        (df_raw['TYPE OPERATION'] == type_operation)
    ].copy()

    # Treatment: Normalize site names
    if 'NAME SITE' in df_kpi.columns:
        for old_name, new_name in SITE_NAME_REPLACEMENTS.items():
            df_kpi['NAME SITE'] = df_kpi['NAME SITE'].str.replace(old_name, new_name, regex=False)

    if len(df_kpi) == 0:
        return None

    # Apply year filter
    df_kpi = filter_last_n_years(df_kpi, n_years=n_years, ref_year=ref_year)

    # Sort by date
    df_kpi = df_kpi.sort_values('DT_REF').reset_index(drop=True)

    # Treatment: Remove records where ACTUAL is empty but BUDGET is filled
    if 'ACTUAL' in df_kpi.columns and 'BUDGET' in df_kpi.columns:
        df_kpi = df_kpi[~(df_kpi['ACTUAL'].isna() & df_kpi['BUDGET'].notna())].reset_index(drop=True)

    if len(df_kpi) == 0:
        return None

    # Treatment: transform negative values to zero
    if 'ACTUAL' in df_kpi.columns:
        df_kpi['ACTUAL'] = df_kpi['ACTUAL'].apply(lambda x: max(0, x) if pd.notna(x) else x)
    if 'BUDGET' in df_kpi.columns:
        df_kpi['BUDGET'] = df_kpi['BUDGET'].apply(lambda x: max(0, x) if pd.notna(x) else x)

    # Get unit before transformations
    unit = df_kpi['UNIT'].iloc[0] if 'UNIT' in df_kpi.columns else ''

    # Treatment 1: If UNIT == '%/day', multiply values by 100
    if unit == '%/day':
        if 'ACTUAL' in df_kpi.columns:
            df_kpi['ACTUAL'] = df_kpi['ACTUAL'] * 100
        if 'BUDGET' in df_kpi.columns:
            df_kpi['BUDGET'] = df_kpi['BUDGET'] * 100
        # Remove zeros for %/day
        if 'ACTUAL' in df_kpi.columns:
            df_kpi.loc[df_kpi['ACTUAL'] == 0, 'ACTUAL'] = np.nan
        if 'BUDGET' in df_kpi.columns:
            df_kpi.loc[df_kpi['BUDGET'] == 0, 'BUDGET'] = np.nan

    # Treatment 2: tonnes/day → ktonnes/day (only for Salobo/Sossego and specific KPIs)
    if (unit == 'tonnes/day'
            and bu_name in BUS_FOR_KTONNES_CONVERSION
            and kpi_name in KPIS_FOR_KTONNES_CONVERSION):
        if 'ACTUAL' in df_kpi.columns:
            df_kpi['ACTUAL'] = df_kpi['ACTUAL'] / 1000
        if 'BUDGET' in df_kpi.columns:
            df_kpi['BUDGET'] = df_kpi['BUDGET'] / 1000
        unit = 'ktonnes/day'
        df_kpi['UNIT'] = 'ktonnes/day'

    # Treatment 3: Remove upper outliers for %/day (μ + 3.5σ)
    if unit == '%/day' and 'ACTUAL' in df_kpi.columns:
        actual_values = df_kpi['ACTUAL'].dropna()
        if len(actual_values) > 0:
            mean_val = actual_values.mean()
            std_val = actual_values.std()
            if std_val > 0:
                upper_limit = mean_val + (3.5 * std_val)
                df_kpi.loc[df_kpi['ACTUAL'] > upper_limit, 'ACTUAL'] = np.nan
                logger.info(
                    "  Outliers removed for %s: values > %.2f (μ+3.5σ)",
                    kpi_name, upper_limit,
                )

    # Extract series — filter for non-null ACTUAL to keep data_series and dates synchronized
    mask_valid = df_kpi['ACTUAL'].notna()
    data_series = pd.Series(df_kpi.loc[mask_valid, 'ACTUAL'].values).reset_index(drop=True)
    dates = pd.Series(df_kpi.loc[mask_valid, 'DT_REF'].values).reset_index(drop=True)

    if len(data_series) == 0:
        return None

    metadata = {
        'business_unit': bu_name,
        'site': site_name,
        'phase': type_operation,
        'kpi': df_kpi['NAME KPI'].iloc[0],
        'unit': unit,
        'display_unit': unit,
        'n_records': len(data_series),
        'date_min': dates.min(),
        'date_max': dates.max(),
    }

    return {
        'df_kpi': df_kpi,
        'data_series': data_series,
        'dates': dates,
        'unit': unit,
        'display_unit': unit,
        'metadata': metadata,
    }


def calculate_statistics_by_year(data_series, dates):
    """
    Calculate descriptive statistics grouped by year.

    Returns
    -------
    dict
        Mapping year → dict of statistics (mean, median, std, cv, n, percentiles,
        normality test results).
    """
    data_series = pd.Series(data_series)
    dates = pd.Series(dates)

    df_temp = pd.DataFrame({'value': data_series.values, 'date': dates.values})
    df_temp['year'] = pd.to_datetime(df_temp['date']).dt.year

    stats_by_year = {}

    for year in sorted(df_temp['year'].unique()):
        data_year = pd.Series(df_temp[df_temp['year'] == year]['value']).dropna()
        if len(data_year) < 2:
            continue

        mean_val = data_year.mean()
        std_val = data_year.std()

        ks_stat, ks_pvalue = (None, None)
        if len(data_year) >= 3:
            ks_stat, ks_pvalue = stats.kstest(data_year, 'norm', args=(mean_val, std_val))

        stats_by_year[year] = {
            'mean': mean_val,
            'median': data_year.median(),
            'std': std_val,
            'cv': (std_val / mean_val * 100) if mean_val != 0 else None,
            'n': len(data_year),
            'p10': data_year.quantile(0.10),
            'p16': data_year.quantile(0.16),
            'p50': data_year.quantile(0.50),
            'p75': data_year.quantile(0.75),
            'p90': data_year.quantile(0.90),
            'ks_stat': ks_stat,
            'ks_pvalue': ks_pvalue,
            'is_normal': ks_pvalue > 0.05 if ks_pvalue is not None else None,
        }

    return stats_by_year
