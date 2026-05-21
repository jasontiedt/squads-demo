# English card images — placeholder

This directory will hold the rendered card art for English unit cards (issue #10).

**Status:** Real card art is **deferred**. No binary image files ship in this PR.

**Why:**

- Source card art lives in `documentation/English_Base_EN.pdf` (image-only PDF). Extracting and normalizing per-card images is its own pipeline.
- Card image extraction is naturally aligned with the OCR follow-up tracked in issue #17 (image-only PDF for Byzantines). The English PDF has a partial text extract already, but the images are still binary-bound.
- The card metadata in `packages/assets-meta/data/english.json` already references stable paths via `imageRef` (e.g. `english/watchman.png`). When real art lands, drop the files at those paths and nothing else changes.

**For the web app:**

The `apps/web` build should treat missing `english/*.png` files as expected during MVP-1 and fall back to a neutral card frame. A follow-up issue should pair real card art with the renderer.

**Filenames the data expects:**

- `watchman.png`
- `billman.png`
- `welsh-infantry.png`
- `longbowman.png`
- `esquire.png`
- `english-knight.png`

— Sabine
