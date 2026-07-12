// Rasterizes a rendered <svg> element to a PNG and downloads it — the mermaid
// "export PNG" action. Draws the serialized SVG onto a 2x canvas so the output
// is crisp, with a solid background so transparent diagrams read on any viewer.

import { downloadTextFile } from "./download.ts";

const PNG_SCALE = 2;
const FALLBACK_WIDTH_PX = 960;
const FALLBACK_HEIGHT_PX = 540;

function svgElementDimensions(svg: SVGSVGElement): { width: number; height: number } {
  const rect = svg.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return { width: rect.width, height: rect.height };
  }
  const viewBox = svg.viewBox.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }
  return { width: FALLBACK_WIDTH_PX, height: FALLBACK_HEIGHT_PX };
}

function loadSvgImage(svgMarkup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("failed to load SVG for PNG export"));
    image.src = encoded;
  });
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas produced no PNG blob"));
    }, "image/png");
  });
}

function triggerBlobDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function downloadSvgAsPng(
  svg: SVGSVGElement,
  filename: string,
  backgroundColor: string,
): Promise<void> {
  const { width, height } = svgElementDimensions(svg);
  const svgMarkup = new XMLSerializer().serializeToString(svg);
  const image = await loadSvgImage(svgMarkup);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * PNG_SCALE);
  canvas.height = Math.round(height * PNG_SCALE);
  const context = canvas.getContext("2d");
  if (!context) {
    // No 2D context — fall back to shipping the raw SVG so the user still
    // gets an artifact rather than nothing.
    downloadTextFile(filename.replace(/\.png$/, ".svg"), svgMarkup, "image/svg+xml");
    return;
  }
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await canvasToPngBlob(canvas);
  triggerBlobDownload(filename, blob);
}
