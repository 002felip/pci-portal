"""
Custom Exceptions for Report Generation

Exceções customizadas para tratamento de erros específicos do sistema de geração de relatórios.
Estratégia: Fail-Fast — interrompe execução ao primeiro erro com mensagem detalhada.
"""


class ReportGenerationError(Exception):
    """Base exception for report generation errors."""
    pass


class DataValidationError(ReportGenerationError):
    """
    Raised when data validation fails.

    Examples:
        - Business Unit not found in dataset
        - Insufficient data records for a KPI
        - Missing required columns in source data
    """
    pass


class ConfigurationError(ReportGenerationError):
    """
    Raised when configuration is invalid.

    Examples:
        - max_years out of valid range
        - Missing required config parameters
        - Invalid file paths
    """
    pass


class ChartGenerationError(ReportGenerationError):
    """
    Raised when chart generation fails.

    Examples:
        - Plotly rendering error
        - Matplotlib figure creation error
        - Invalid data for specific chart type
    """
    pass


class PDFCompilationError(ReportGenerationError):
    """
    Raised when PDF compilation fails.

    Examples:
        - Reportlab canvas error
        - img2pdf conversion error
        - Permission denied writing PDF file
    """
    pass
