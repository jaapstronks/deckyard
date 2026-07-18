#!/usr/bin/env bash
cd ~/src/deckyard
exec claude --model opus --dangerously-skip-permissions "Lees briefing-ai-test-suite.md in de repo-root (inclusief het operationele addendum onderaan) en voer de opdracht volledig autonoom uit. Maak eerst een plan en leg dat vast in test-suite/PLAN.md, commit de briefing + het plan als eerste commits op deze branch (feat/ai-test-suite), en ga daarna direct door met de uitvoering t/m de PR. Niet wachten op bevestiging."
