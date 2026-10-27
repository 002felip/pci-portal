"""
PDF Compiler Module

Compiles multiple PNG page images into a single multi-page PDF.
Page size: 452 × 254 mm (landscape).

Strategy:
    1. reportlab (primary)  — draws images to an exact-size PDF canvas
    2. img2pdf  (fallback)  — resizes PNGs to 1281×720 px first

Extracted from notebook 05_multi_kpi_pdf_generator.ipynb
"""

import os
import shutil
import logging
import tempfile

from PIL import Image

from .exceptions import PDFCompilationError

logger = logging.getLogger(__name__)

# 452 × 254 mm → PDF points  (1 pt = 1/72 in = 25.4/72 mm)
PAGE_W_PT = 452 * 72 / 25.4   # ≈ 1281.42 pt
PAGE_H_PT = 254 * 72 / 25.4   # ≈ 720.00  pt


def compile_multi_page_pdf(image_paths, output_path, config=None):
    """
    Compile multiple PNG images into a single multi-page PDF.

    Parameters
    ----------
    image_paths : list[str]
        Ordered list of PNG file paths (cover + KPI pages).
    output_path : str
        Destination PDF file path.
    config : dict, optional
        Configuration dict (unused currently; reserved for future options).

    Raises
    ------
    PDFCompilationError
        If neither reportlab nor img2pdf can produce the PDF.
    """
    if not image_paths:
        raise PDFCompilationError("No pages to compile — image_paths is empty.")

    os.makedirs(os.path.dirname(output_path) or '.', exist_ok=True)

    # ── Primary: reportlab ──────────────────────────────────────────────
    try:
        from reportlab.pdfgen import canvas as rl_canvas
        from reportlab.lib.utils import ImageReader

        c = rl_canvas.Canvas(output_path, pagesize=(PAGE_W_PT, PAGE_H_PT))
        for img_path in image_paths:
            c.drawImage(
                ImageReader(img_path), 0, 0,
                width=PAGE_W_PT, height=PAGE_H_PT,
                preserveAspectRatio=False,
            )
            c.showPage()
        c.save()
        logger.info("PDF created with reportlab: %s", output_path)
        return

    except ImportError:
        logger.warning("reportlab not installed — trying img2pdf...")
    except Exception as e:
        logger.warning("reportlab error: %s — trying img2pdf...", e)

    # ── Fallback: img2pdf with pre-resized images ───────────────────────
    try:
        import img2pdf as img2pdf_lib

        px_w = round(452 * 72 / 25.4)   # 1281
        px_h = round(254 * 72 / 25.4)   # 720

        tmp_dir = tempfile.mkdtemp()
        try:
            try:
                resample = Image.Resampling.LANCZOS
            except AttributeError:
                resample = Image.LANCZOS

            resized = []
            for p in image_paths:
                img = Image.open(p).resize((px_w, px_h), resample)
                rp = os.path.join(tmp_dir, os.path.basename(p))
                img.save(rp, 'PNG')
                resized.append(rp)

            with open(output_path, 'wb') as f:
                f.write(img2pdf_lib.convert(resized))

            logger.info("PDF created with img2pdf: %s", output_path)
            return
        finally:
            shutil.rmtree(tmp_dir)

    except ImportError:
        raise PDFCompilationError(
            "Neither reportlab nor img2pdf is installed.\n"
            "Install one of them:  pip install reportlab  OR  pip install img2pdf"
        )
    except Exception as e:
        raise PDFCompilationError(f"PDF compilation failed: {e}") from e
