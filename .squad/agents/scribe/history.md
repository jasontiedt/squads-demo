# Project Context

- **Project:** squads-demo
- **Created:** 2026-05-20

## Core Context

Agent Scribe initialized and ready for work.

## Recent Updates

📌 Team initialized on 2026-05-20

## Learnings

Initial setup complete.

### 2026-05-27: MVP-6 scope merge ("Cards Respond")

Merged Wedge's `wedge-mvp6-scope.md` inbox doc into `.squad/decisions.md` under a new `## MVP-6 scope — 2026-05-27` section after Brady's approval. Preserved Wedge's text verbatim except: H1 → H2 with the original title kept in an italic note, and the `**Status:**` line flipped from `OPEN — awaiting Brady ack` to `APPROVED — 2026-05-27 by Brady`. Also folded the dangling `wedge-capital-units-shape.md` RFC into MVP-6 S1 (issue #97) with a one-line resolution note pointing readers to §1/§5 of the scope. Both inbox files deleted.

**Archive triggered.** decisions.md was 51,685 bytes (≥ 51,200 threshold), so archived all 8 entries from the `## MVP-5 closeout — 2025-11-21` section to a new `.squad/decisions-archive.md` file. The archive uses a "newest batch on top" pattern with a dated header recording the cutoff (entries older than 7 days from 2026-05-27).

**Lesson — archive gate runs *before* the merge.** I measured size on the pre-merge file (correct) before computing the cutoff. Appending the new MVP-6 content brought the file back over the threshold (~73 KB) — that's expected, and the next session's pre-check will re-archive what's then >7d.

