#!/usr/bin/env node
// OCR a PDF using pdf-to-png-converter + tesseract.js.
// Writes raw per-page OCR dumps to documentation/ocr/<basename>.ocr.json.
//
// Usage: node scripts/ocr-pdf.mjs <path-to-pdf>
//
// Output format (per page):
//   { page: number, text: string, confidence: number,
//     words: [{ text, bbox, confidence }] }
//
// Pure JS — no system dependencies (no Poppler, no Tesseract CLI required).

// NOTE: pdf-to-png-converter v3/v4 + pdfjs-dist v5 have a Windows-only path bug —
// pdf-to-png-converter normalizes cMapUrl using `path.sep` (backslash on Windows),
// but pdfjs-dist v5 strictly requires URL-style trailing forward-slash. We monkey-
// patch the converter's normalizePath module AFTER importing pdfToPng (which loads
// and caches normalizePath in require.cache) so subsequent calls return forward
// slashes. `pdfToPng` calls `propsToPdfDocInitParams` → `normalizePath` on every
// invocation, so the patch takes effect immediately.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

const { pdfToPng } = await import('pdf-to-png-converter');
const { createWorker } = await import('tesseract.js');

// Patch normalizePath via require.cache (subpath is not in "exports", so we
// can't import it directly — but pdfToPng has already loaded it).
const require_ = createRequire(import.meta.url);
const cacheKey = Object.keys(require_.cache).find((k) =>
  k.replace(/\\/g, '/').endsWith('/pdf-to-png-converter/out/normalizePath.js')
);
if (!cacheKey) {
  throw new Error(
    '[ocr] could not find pdf-to-png-converter/out/normalizePath in require.cache — internal layout changed?'
  );
}
const normalizePathMod = require_.cache[cacheKey].exports;
const originalNormalize = normalizePathMod.normalizePath;
normalizePathMod.normalizePath = function patchedNormalize(p) {
  return originalNormalize(p).replace(/\\/g, '/');
};

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node scripts/ocr-pdf.mjs <path-to-pdf>');
  process.exit(1);
}
if (!existsSync(pdfPath)) {
  console.error(`[ocr] file not found: ${pdfPath}`);
  process.exit(1);
}

const base = basename(pdfPath, '.pdf');
const outDir = 'documentation/ocr';
mkdirSync(outDir, { recursive: true });

const t0 = Date.now();
console.log(`[ocr] rasterizing ${pdfPath}`);
const pngs = await pdfToPng(pdfPath, { viewportScale: 2 });
console.log(`[ocr] ${pngs.length} page(s) rasterized in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

console.log('[ocr] initializing tesseract worker (eng)');
const worker = await createWorker('eng');

const pages = [];
for (let i = 0; i < pngs.length; i++) {
  const tp = Date.now();
  const { data } = await worker.recognize(pngs[i].content);
  const words = (data.words ?? []).map((w) => ({
    text: w.text,
    bbox: w.bbox,
    confidence: w.confidence,
  }));
  pages.push({
    page: i + 1,
    text: data.text,
    confidence: data.confidence,
    words,
  });
  console.log(
    `[ocr] page ${i + 1}/${pngs.length} — confidence=${data.confidence.toFixed(1)} words=${words.length} (${((Date.now() - tp) / 1000).toFixed(1)}s)`
  );
}

await worker.terminate();

const outPath = join(outDir, `${base}.ocr.json`);
writeFileSync(outPath, JSON.stringify(pages, null, 2));
const totalConfidence = pages.reduce((sum, p) => sum + p.confidence, 0) / pages.length;
console.log(
  `[ocr] wrote ${outPath} — ${pages.length} page(s), avg confidence ${totalConfidence.toFixed(1)}, ${((Date.now() - t0) / 1000).toFixed(1)}s total`
);
