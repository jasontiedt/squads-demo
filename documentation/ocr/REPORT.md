# OCR Ingest Report — Image-only PDFs

## Pipeline

- **Library choice:** [`tesseract.js`](https://github.com/naptha/tesseract.js) v7 (WASM Tesseract — pure JS) + [`pdf-to-png-converter`](https://www.npmjs.com/package/pdf-to-png-converter) v3 (rasterizer wrapping `pdfjs-dist`).
- **System deps:** **None.** Both libraries are pure JS / WASM. The Tesseract English language pack (`eng.traineddata`, ~5MB) is auto-downloaded by `tesseract.js` on first run and cached at repo root. It is gitignored (`*.traineddata`) and must NOT be committed.
- **Output schema:** Per-PDF file at `documentation/ocr/<basename>.ocr.json`. Top-level shape is `{ source, generatedAt, pageCount, pages: [...] }`. Each page is:
  ```json
  { "page": 1, "text": "...", "confidence": 47.2, "words": [{ "text": "...", "bbox": {...}, "confidence": 88 }, ...] }
  ```
- **Reproduce:**
  - Single file: `pnpm ocr:pdf documentation/<File>.pdf`
  - All three sources: `pnpm ocr:all`
- **Windows note:** The script monkey-patches `pdf-to-png-converter`'s `normalizePath` because `pdfjs-dist` v5 strictly requires forward-slash `cMapUrl`; the converter emits backslashes on Windows. See header comment in `scripts/ocr-pdf.mjs`.

## Sources processed

### Byzantines_Base_EN.pdf

- **Pages:** 4
- **Overall confidence:** ~47% average (Tesseract per-page weighted)
- **High-confidence fields:**
  - Unit/card **names** are recoverable: `Optimatoi`, `Skoutatoi`, `Stratiotai`, `Varangian Guard` are all visible in the OCR text on page 1 (sometimes spelled `Sitios`/`Stratitai` — context disambiguates).
  - **Flavor text and lore paragraphs** parse with usable accuracy (e.g. *"Making up the bulk of the Byzantine army, Skoutatoi were named after the round, kite-shaped shields they..."*, *"Civilians barred from commerce..."*, *"recruits from Northern Europe..."*).
  - **Ability keywords** are legible: `Anti Cavalry 1 (+1 % against Cavalry)`, `Armor 2 (Take less damage during combat)`, `Hanged Armd 3 (Takes 3 less damage)`.
- **Low-confidence fields:**
  - **Numeric costs and stats** are unreliable — digits are routinely confused with glyphs (`8`/`B`, `0`/`O`, `5`/`S`) and most cost icons live inside small badges that rasterize poorly at viewportScale 2.
  - **Resource-type icons** (food / gold / wood / stone) are images, not text, and do NOT come through OCR at all.
  - Card boundaries / which text belongs to which card is positional — OCR linearizes everything top-to-bottom across the page's three card columns, so cross-bleed between adjacent cards is common.
- **Resolves `_needsConfirmation` flags:** n/a for this source. The `_needsConfirmation` array lives in `packages/assets-meta/data/english.json`, not in the Byzantines placeholder.

### Constantinople.pdf

- **Pages:** 4
- **Overall confidence:** ~32% average
- **Output size:** 1.2KB (`Constantinople.ocr.json`) — very sparse.
- **Findings:** Page is mostly visual (map / board overlay / tile imagery). Almost no recoverable text. Sample output is fragmented punctuation and ligatures (`= ~ ht Wer it`, `0 An NB`).
- **Suitable for auto-ingest?** **No.** This PDF is graphical reference, not card data — treat as image asset and transcribe any captions manually if needed.

### StartingTiles.pdf

- **Pages:** 1
- **Overall confidence:** ~28% average
- **Output size:** 306 B (`StartingTiles.ocr.json`) — essentially empty.
- **Findings:** Pure tile/board art. No usable text. Recovered fragments are OCR hallucination (`(4 | ama`, `bopmy A`, `1 TAL i`).
- **Suitable for auto-ingest?** **No.** Tile metadata (terrain type, starting resources, adjacency rules) must be transcribed by hand from the visual layout. Recommend filing a follow-up issue.

## English `_needsConfirmation` resolution

**This PR does NOT resolve the 10 `_needsConfirmation` flags in `packages/assets-meta/data/english.json`.**

- `English_Base_EN.pdf` was **not** OCR'd in this run — only `Byzantines_Base_EN.pdf`, `Constantinople.pdf`, and `StartingTiles.pdf` are listed in the `ocr:all` script.
- The English flags (`eng-watchman` cost breakdown, `eng-billman` resource types, `eng-welsh-infantry` resource types, and 7 others) are all blocked on rasterizing the English Base PDF through the same pipeline.
- **Recommendation:** File a follow-up issue (see below) to run `pnpm ocr:pdf documentation/English_Base_EN.pdf` and propose resolutions for each of the 10 flags in a data-only PR.

## Recommendations / follow-up issues

1. **"OCR English_Base_EN.pdf and resolve `_needsConfirmation` flags"** — run the pipeline against the English Base PDF, then open a data-only PR proposing values for the 10 flags in `english.json`. Lower-priority but unblocks Cassian's gameplay-balance work.
2. **"Apply OCR findings to `byzantines.json`"** — replace the placeholder Byzantine card data (issue #11) with real card data derived from `Byzantines_Base_EN.ocr.json`. Names, abilities, and flavor text can come straight from OCR; costs and resource-type icons require visual inspection of the PDF alongside the JSON. Owner: Sabine. Data-only PR after Jason reviews this one.
3. **"Manual transcription: StartingTiles.pdf"** — OCR returned 200 chars at 28% confidence. Tile maps cannot be read by Tesseract. Transcribe by hand into a structured tiles dataset.
4. **"Manual transcription / asset catalog: Constantinople.pdf"** — same situation; OCR yields 785 chars at 32%. Treat as visual reference, capture any caption text by hand.
5. **(Optional, low priority)** — experiment with higher `viewportScale` (4–6) on the Byzantines PDF to see if numeric stats become recoverable. Current scale=2 trades digit accuracy for memory/runtime.

## Confidence summary table

| Source                  | Pages | Avg confidence | Total text chars | Suitable for auto-ingest?         |
|-------------------------|-------|----------------|------------------|-----------------------------------|
| `Byzantines_Base_EN`    | 4     | ~47%           | ~10,000          | **Partial** — names/flavor/abilities yes; costs & stats no |
| `Constantinople`        | 4     | ~32%           | ~785             | **No** — image-only, no usable text |
| `StartingTiles`         | 1     | ~28%           | ~200             | **No** — image-only, manual transcription required |
| `English_Base_EN`       | —     | —              | —                | **Not run in this PR** — see follow-up #1 |
