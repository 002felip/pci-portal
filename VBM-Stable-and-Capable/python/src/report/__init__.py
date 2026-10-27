"""
src.report — Multi-KPI PDF Report Generation Package

Modules:
    config           Configuration management (YAML + CLI)
    data_processor   Data loading, filtering, business rules
    chart_generator  Statistical charts (SPC, histogram, capability)
    page_composer    Page layout composition (cover, KPI list, detail)
    pdf_compiler     Multi-page PDF assembly
    report_builder   Orchestrator (ReportBuilder class)
    exceptions       Custom exception hierarchy
    utils            Shared utilities
"""

from .report_builder import ReportBuilder
from .config import ReportConfig, build_config
from .exceptions import (
    ReportGenerationError,
    DataValidationError,
    ConfigurationError,
    ChartGenerationError,
    PDFCompilationError,
)

__all__ = [
    'ReportBuilder',
    'ReportConfig',
    'build_config',
    'ReportGenerationError',
    'DataValidationError',
    'ConfigurationError',
    'ChartGenerationError',
    'PDFCompilationError',
]
