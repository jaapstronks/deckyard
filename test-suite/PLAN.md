# Plan — Test suite voor Deckyard AI-slide-generatie

Uitvoeringsplan bij `BRIEFING.md`. Autonome uitvoering op
dev-server-1, branch `feat/ai-test-suite`.

> **Status: uitgevoerd.** Dit document beschrijft het plan zoals vooraf
> opgesteld en is bewust niet achteraf bijgewerkt. Wat er daadwerkelijk
> gebeurde — inclusief drie harness-bugs die tijdens de nulmeting boven water
> kwamen en een iteratieronde die is teruggedraaid — staat in
> `CHANGES.md` en in de PR-beschrijving.
>
> Afwijkingen van dit plan, kort:
> - **Kosten.** Richtbudget was ~$50; werkelijk ~$59. Oorzaak: de nulmeting
>   kostte $26,68 doordat drie cases ruwe HTML in plaats van geëxtraheerde
>   tekst kregen, en ronde 2 draaide per ongeluk op alle 11 cases ($13,90)
>   doordat een lege `--cases`-waarde als "geen filter" werd gelezen. Na de
>   fixes kost een ronde ~$2.
> - **Iteratierondes.** Drie gedraaid (minimum gehaald), niet meer, vanwege
>   het budget.
> - **Eindmeting.** Op de subset van 3 cases, niet op de volledige set: een
>   volledige run kost ~$5 en het budget was op.

## 0. Verkenning (gedaan)

De generatiepipeline is in kaart gebracht voordat dit plan is geschreven.

**Entry point.** `generateDeckV2(rawContent, opts)` in
`server/utils/ai/generate-deck-v2.js:89` (re-export via
`server/utils/ai/index.js`). Dit is effectief een **pure functie van
`(rawContent, options)`**: geen database, geen auth, geen presentatie-record,
geen storage. Alle persistentie zit in de route (`server/routes/api/ai.js`),
niet in de pipeline. Dat betekent dat de harness de productie-code paths
exact kan aanroepen zonder de server te starten — precies wat Fase 2 van de
briefing vraagt.

Pipeline: `generateOutline` → `separateSlidesForProcessing` →
`refineAllSlideGroups` → `validateAndFixRefinedSlides` → `assembleDeck`.

**Waar de prompts staan** (dit zijn de knoppen van Fase 4):

| Prompt | Locatie |
| --- | --- |
| Fase 1 systeemprompt (analyse, opsplitsing, slide-budget) | `server/utils/ai/generate-outline.js:49-239` |
| — dichtheidsregels `roughContent` | `generate-outline.js:161-175` |
| — slide-budget / contentdichtheid | `generate-outline.js:194-208` |
| — `calculateTargetSlides` (numerieke knop) | `generate-outline.js:24-44` |
| Fase 2 systeemprompt (slide-compositie, typekeuze) | `server/utils/ai/refine-slides.js:24-111` |
| — MAX LENGTHS-blok | `refine-slides.js:73-78` |
| Slide-type catalogus in de Fase 2-prompt | `server/utils/ai/slide-catalog/builders.js:87-191` |
| Per-type dichtheidsteksten | `slide-catalog/*.js` (o.a. `basic-content-slides.js`) |
| Post-hoc afkapping (geen prompt, maar begrenst output) | `validate-slides.js:142-260` |

**Modelkeuze.** `getLlmConfig({role})` in `server/utils/llm/config.js:91`
kiest voor Claude: plan-stap → `CLAUDE_MODEL_PLAN || CLAUDE_MODEL ||
claude-opus-4-8`, fill-stap → `CLAUDE_MODEL || claude-sonnet-5`. De suite zet
beide op `claude-opus-4-8` conform het addendum.

**Bekende beperking.** De provider-laag (`server/utils/llm/provider-base.js`,
`providers/claude.js`) doet een kale `fetch` en geeft alleen een string terug —
**geen usage/tokentellingen**. Voor de kostenteller uit het addendum is dat een
blokkade. Zie beslissing D2.

## Beslissingen (autonoom genomen, met motivering)

**D1 — Generatie via de bestaande app-code, judge via de officiële SDK.**
Het addendum zegt "gebruik de officiële `@anthropic-ai/sdk` (geen fetch naar
de API)"; de briefing (Fase 2.1) zegt dat generatie "exact dezelfde prompts en
code paths als in productie" moet gebruiken. Die twee botsen: de app roept de
API met `fetch` aan. Ik geef voorrang aan de briefing voor de *generatie*
(anders test de suite niet wat er in productie draait) en pas de SDK-eis toe
op alle **eigen** API-calls van de suite: de LLM-judge en de
kernonderwerp-extractie. Dit is inhoud vs. werkwijze, en de briefing gaat voor
op inhoud.

**D2 — Kleine, gerechtvaardigde wijziging in de app-LLM-laag.** Om kosten per
run te kunnen loggen krijgt `provider-base.js` een optionele
usage-callback die de `usage`-velden van het API-antwoord doorgeeft. Zonder
callback verandert er niets aan het gedrag; bestaande aanroepen blijven werken.
Dit is de minst invasieve manier om aan de kosteneis te voldoen en is ook
buiten de suite nuttig (observability).

**D3 — Testmateriaal wordt niet gecommit.** Conform de briefing committen we
`case.json` (met bron-URL's, licentie, verwachte kenmerken) plus een
download-script; de opgehaalde bronnen en referentiedecks staan in
`.gitignore`. Referentiedecks worden na download geparsed naar een
gestructureerde JSON-representatie (per slide: titel, tekst, woordaantal).

**D4 — Determinisme.** `claude-opus-4-8` accepteert geen `temperature`. De
runmetadata legt in plaats daarvan model-ID, effort-instelling en een
prompt-versiehash vast (SHA-256 over de prompt-dragende bestanden). Variantie
wordt zichtbaar gemaakt door herhalingen (`--repeat`), niet weggeregeld.

**D5 — Budgetbeheersing.** Iteratierondes draaien op een subset van 4 cases
(`--cases`-flag); alleen de nulmeting en de eindmeting draaien de volledige
set. Judge-oordelen en bron-extracties worden gecached op een hash van de
input, zodat een herhaalde run zonder promptwijziging vrijwel gratis is.
`--dry-run` draait alleen de deterministische metrics, zonder judge.

## Fase 1 — Testmateriaal (`test-suite/cases/`)

Structuur per case: `case.json`, `source/`, optioneel `reference/`.

**Categorie A (bron + menselijk referentiedeck), streefgetal 4–6.** Zoeken via
web search naar paper+slides-paren, jaarverslag+investor deck (ASML/Adyen zijn
de sterkste kandidaten: strak gedefinieerde bron, objectief verifieerbare
cijfers), en een overheidsrapport (CBS/PBL) met publiekssamenvatting. Spreiding
in taal (NL/EN), lengte en domein.

**Categorie B (realistische bron zonder referentie), streefgetal 4–6.**
Wikipedia-artikel, technische engineering-blogpost, persbericht + onderliggend
rapport, en Deckyard's eigen README als meta-case.

PDF's worden naar tekst geconverteerd met `pdf-parse` (zit al in
`package.json`); het origineel blijft bewaard. Er is geen `pdftotext` of
`pandoc` op deze machine, dus de conversie gebeurt in Node.

## Fase 2 — Harness (`test-suite/runner/`)

- `run.js` — CLI: `--cases`, `--repeat`, `--dry-run`, `--judge-only`.
- Roept per case `generateDeckV2` aan met `vendor: 'claude'` en
  `CLAUDE_MODEL(_PLAN)=claude-opus-4-8`.
- Schrijft `test-suite/runs/<run-id>/<case-id>/deck.json` plus
  `run.json` met run-metadata: model-ID, effort, prompt-versiehash, timestamp,
  duur, token-usage en berekende kosten.
- Cache in `test-suite/.cache/` op inputhash, zodat herhaalde judge-calls en
  bron-extracties niet opnieuw betaald worden.

## Fase 3 — Evaluatie (`test-suite/eval/`)

**Deterministische metrics** — aantal slides, woorden per slide
(gemiddeld/max), bullets per slide, aanwezigheid titelslide, structuur
(intro → kern → afsluiting), en getalcontrole: elk getal in het deck moet
letterlijk of genormaliseerd terugvinden zijn in de bron (hallucinatiedetectie
zonder LLM-kosten).

**Dekking** — aparte extractiestap haalt kernonderwerpen uit de bron
(gecached); daarna wordt gemeten welk aandeel terugkomt in het deck.

**Vergelijking met referentiedeck (categorie A)** — structurele gelijkenis
(aantal slides, volgorde van onderwerpen), dekkingsoverlap, en slide-economie
(tekstdichtheid t.o.v. het menselijke deck).

**LLM-judge** — `claude-opus-4-8`, vast systeemprompt, `output_config.format`
met JSON-schema zodat de scores gegarandeerd parseerbaar zijn (geen
regex-geknutsel), `thinking: {type:'adaptive'}`, `effort` vastgelegd in de
metadata. Rubric 1–5 op: dekking, structuur, slide-economie, getrouwheid,
presenteerbaarheid. Bij categorie A een zesde dimensie: nabijheid tot het
menselijke deck. Elke score krijgt een korte motivering — dat is de
belangrijkste input voor Fase 4. Prompt caching op het systeemprompt + de bron
(de bron is per case identiek over runs heen), wat de judge-kosten fors drukt.

**Rapport** — `test-suite/runs/<run-id>/report.md`: scores per case en
dimensie, delta's t.o.v. de vorige run, judge-motiveringen bij de laagst
scorende dimensies, en de kosten van de run. `test-suite/history.json` houdt
de progressie over runs bij; regressies worden expliciet gemarkeerd.

## Fase 4 — Iteratielus

Minimaal 3, maximaal ~8 rondes. Per ronde:

1. Analyseer de laagst scorende dimensies + judge-motiveringen.
2. Herleid ze tot een concrete prompt in de app (zie tabel in §0).
3. Pas de prompt aan; documenteer in `test-suite/CHANGES.md`: welke prompt,
   wat veranderd, welke tekortkoming het adresseert.
4. Draai de subset opnieuw, vergelijk, let op regressies (een verbetering op
   dimensie X mag Y niet verslechteren — het rapport maakt dit zichtbaar).

Stoppen bij twee opeenvolgende rondes zonder significante verbetering op de
laagst scorende dimensies, of bij ronde 8.

## Randvoorwaarden en bewaking

- `npm test` blijft groen (nu: 586 pass, 0 fail — vastgelegd als baseline).
- `npm start` blijft werken.
- Eén commando: `npm run test:ai-suite`.
- Kostenteller per run in het rapport; richtbudget ~$50 voor het hele traject.
- Commit na elke fase en elke iteratieronde; push regelmatig naar `origin`.

## Oplevering

Branch pushen, PR naar `main` van `jaapstronks/deckyard` met aanpak,
nulmeting → eindmeting per dimensie, alle promptwijzigingen met motivering,
totale API-kosten en openstaande aanbevelingen. **Niet mergen.**
