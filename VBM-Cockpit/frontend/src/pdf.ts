/**
 * PDF export. html2canvas + jsPDF.
 *
 * WHAT THIS REPLACES
 * ------------------
 * `lib/pdf.ts` was 385 lines that cloned nodes, inlined every computed style,
 * baked <canvas> elements to PNG, rasterized through the browser's SVG
 * <foreignObject> pipeline, and then HAND-ENCODED a PDF -- xref table, object
 * offsets, DCTDecode streams and all. It worked. It was also a PDF writer
 * maintained by a consultancy as a side effect of a dashboard.
 *
 * WHY THE ORIGINAL ARGUMENT NO LONGER HOLDS
 *   "window.print() may be blocked by corporate policy."
 *        Still true. We do not use window.print() either.
 *   "Nothing may download at runtime."
 *        Still true. Both libraries are npm dependencies, bundled by Vite into
 *        the same asset the SPA already ships. No CDN, no network call.
 *   "Canvas does not survive serialization."
 *        That was a consequence of cloning the DOM first. html2canvas
 *        rasterizes the LIVE document, so canvases and SVG both come through,
 *        and the manual style-inlining pass disappears with it.
 *
 * Net: ~385 lines -> ~110, and page geometry, image compression and metadata
 * become someone else's maintained problem.
 *
 * WHAT IS STILL OURS
 *   Section selection and pagination policy -- keep a section whole, only slice
 *   content taller than a page, so a chart never straddles a page break. That
 *   is a product decision, not plumbing, so it stays in our code.
 */

import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

export interface PdfSection { id: string; label: string }

export interface PdfOptions {
  filename?: string;
  title?: string;
  subtitle?: string;
  /** 2 is crisp on a Retina display without exploding the file size. */
  scale?: number;
}

const A4 = { w: 210, h: 297 };       // mm, portrait
const MARGIN = 10;
const HEADER_H = 14;
const SECTION_LABEL_H = 7;   // mm, label block above each section image
const SECTION_GAP = 6;       // mm, vertical space between consecutive sections
const FOOTER_RESERVE = 8;    // mm, keeps content clear of the page-number line at A4.h - 5
const MIN_SLICE_H = 40;      // mm, smallest slice worth starting on a partially used page

const contentTop = MARGIN + HEADER_H;
const contentBottom = A4.h - MARGIN - FOOTER_RESERVE;
const usableH = contentBottom - contentTop;

/**
 * Render the chosen sections into one PDF and trigger a download.
 * Returns the number of pages written.
 */
export async function exportSections(
  sectionIds: string[],
  opts: PdfOptions = {},
): Promise<number> {
  const { filename = "cockpit.pdf", title = "VBM Strategic Cockpit",
    subtitle = "", scale = 2 } = opts;

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait",
    compress: true });
  doc.setProperties({ title, subject: subtitle, creator: title });

  const contentW = A4.w - MARGIN * 2;
  let pageStarted = false;
  let cursorY = contentTop;

  const newPage = (): void => {
    if (pageStarted) doc.addPage();
    header(doc, title, subtitle);
    cursorY = contentTop;
    pageStarted = true;
  };

  for (const id of sectionIds) {
    const el = document.querySelector<HTMLElement>(`[data-print-section="${id}"]`);
    if (!el) continue;

    const canvas = await html2canvas(el, {
      scale,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
      // Recharts uses absolutely positioned tooltips; excluding them keeps a
      // hover state from being baked into the export. The per-section
      // "include in bundle" checkbox is UI chrome, not page content.
      ignoreElements: (node) =>
        node.classList?.contains("recharts-tooltip-wrapper") ||
        node.classList?.contains("print-include") ||
        false,
    });

    const label = el.dataset.printLabel ?? id;
    const imgH = (canvas.height * contentW) / canvas.width;   // mm
    const blockH = SECTION_LABEL_H + imgH;

    if (!pageStarted) {
      // Open the first page lazily so an empty selection never creates one.
      newPage();
    }

    if (cursorY + blockH <= contentBottom) {
      // Fits in the space remaining on the current page.
      placeBlock(doc, label, canvas, cursorY, contentW, imgH);
      cursorY += blockH + SECTION_GAP;
    } else if (blockH <= usableH) {
      // Does not fit here, but fits on a fresh page. Never split what does
      // not need splitting.
      newPage();
      placeBlock(doc, label, canvas, cursorY, contentW, imgH);
      cursorY += blockH + SECTION_GAP;
    } else {
      // Taller than a page: slice the SOURCE canvas, so each page carries real
      // pixels rather than a scaled-down whole.
      const pxPerMm = canvas.height / imgH;

      let remaining = contentBottom - cursorY - SECTION_LABEL_H;
      if (remaining < MIN_SLICE_H) {
        // Not worth starting a sliver slice here; begin fresh instead.
        newPage();
        remaining = usableH - SECTION_LABEL_H;
      }

      const slicesPx: number[] = [];
      let heightLeftPx = canvas.height;
      let availableMm = remaining;
      while (heightLeftPx > 0) {
        const px = Math.min(heightLeftPx, Math.floor(availableMm * pxPerMm));
        slicesPx.push(px);
        heightLeftPx -= px;
        availableMm = usableH - SECTION_LABEL_H;
      }

      const parts = slicesPx.length;
      slicesPx.forEach((px, i) => {
        if (i > 0) newPage();

        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = px;
        const offset = slicesPx.slice(0, i).reduce((sum, v) => sum + v, 0);
        slice.getContext("2d")!.drawImage(
          canvas, 0, offset, canvas.width, px, 0, 0, canvas.width, px);

        const sliceImgH = px / pxPerMm;
        placeBlock(doc, `${label} (${i + 1}/${parts})`, slice, cursorY, contentW, sliceImgH);
        cursorY += SECTION_LABEL_H + sliceImgH + SECTION_GAP;
      });
    }
  }

  if (!pageStarted) throw new Error("Nothing selected to export.");

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFontSize(7).setTextColor(138, 148, 162);
    doc.text(`${p} / ${pages}`, A4.w - MARGIN, A4.h - 5, { align: "right" });
    doc.text(new Date().toLocaleString("en-CA"), MARGIN, A4.h - 5);
  }

  doc.save(filename);
  return pages;
}

function header(doc: jsPDF, title: string, subtitle: string): void {
  doc.setFontSize(13).setTextColor(27, 39, 51);
  doc.text(title, MARGIN, MARGIN + 6);
  doc.setFontSize(8).setTextColor(138, 148, 162);
  doc.text(subtitle, MARGIN, MARGIN + 11);
  doc.setDrawColor(216, 222, 230).setLineWidth(0.2);
  doc.line(MARGIN, MARGIN + 13, A4.w - MARGIN, MARGIN + 13);
}

function placeBlock(
  doc: jsPDF, label: string, canvas: HTMLCanvasElement, y: number,
  contentW: number, imgH: number,
): void {
  doc.setFontSize(11).setTextColor(27, 39, 51);
  doc.text(label, MARGIN, y + SECTION_LABEL_H - 2);
  doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG",
    MARGIN, y + SECTION_LABEL_H, contentW, imgH, undefined, "FAST");
}
