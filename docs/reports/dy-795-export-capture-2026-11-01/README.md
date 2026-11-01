# DY-795: complete export-dialog capture

The recipe now uses a 1440 × 1440 CSS-pixel viewport at 2× scale. The previous 1200px height capped `.modal-content` at 840px (70vh), below its reported 887px content height. The new height gives it 1008px of room. The runner's hidden-overflow refusal is unchanged; app layout and action groups are unchanged.

Verified on dev-server-1 against v1.97.2 plus this recipe change, using a freshly created, migrated PostgreSQL scratch database and the fixed dev capture identity. `capture.json` reports 1/1 success. The attached `export-dropdown-full.png` was visually inspected: Which slides, all export rows and the bottom Handoff ZIP row are fully visible. The scratch database was dropped after the run. Targeted ESLint and Prettier checks pass.

This is capture evidence, not release evidence. DY-795 remains open until independent review, merge, a regular release and return of tag/SHA plus this capture proof to deckyard-video for the website capture batch (B838).
