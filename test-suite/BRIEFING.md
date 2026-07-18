# Briefing: Test suite voor Deckyard AI-slide-generatie

## Doel

Bouw een herhaalbare test suite die de AI-slide-generatie van Deckyard evalueert. De suite voert broninformatie (documenten) aan de generatie-pipeline, vergelijkt het resultaat met referentiemateriaal of kwaliteitscriteria, en produceert een rapport. Op basis van dat rapport worden de prompts in de applicatie (de logica die bepaalt hoe bronmateriaal wordt opgesplitst en verwerkt tot slides) aangepast, waarna de suite opnieuw draait. Dit iteratieve proces herhaalt zich totdat het resultaat naar wens is.

## Context

Deckyard is een open-source, web-based presentatieplatform in plain TypeScript/JavaScript met AI-gestuurde slide-generatie en een MCP-server. De AI-functie neemt willekeurige broninformatie en genereert daaruit een slide deck. De kwaliteit hangt sterk af van de prompts die in de app verwerkt zijn: hoe wordt bronmateriaal geanalyseerd, opgedeeld in secties, en per sectie omgezet naar slides (titel, bullets, tekstdichtheid, structuur, volgorde).

## Fase 1: Testmateriaal verzamelen

Verzamel testcases in twee categorieën en leg ze vast in een gestructureerde map, bijv. `test-suite/cases/<case-id>/` met daarin `source/` (broninformatie), optioneel `reference/` (menselijk referentiedeck), en `case.json` (metadata: titel, categorie, bron-URL's, verwachte kenmerken).

### Categorie A: bron + bestaand menselijk referentiedeck (ground truth)

Zoek en download per case zowel het brondocument als een door mensen gemaakte presentatie over dezelfde inhoud:

1. **Wetenschappelijk paper + conference slides.** ArXiv-papers waarvan de auteurs slides publiceerden (NeurIPS/ICLR publiceren slides en posters; auteurspagina's zijn een goede bron). Voorbeeld: "Attention Is All You Need" heeft meerdere presentatieversies online.
2. **Jaarverslag/earnings report + investor deck.** Beursgenoteerde bedrijven publiceren beide over dezelfde cijfers op hun investor relations-pagina's. Kandidaten: ASML, Philips, Adyen. Dit is de sterkste categorie: strak gedefinieerde bron, professioneel referentiedeck, objectief verifieerbare cijfers.
3. **Overheidsrapport + bijbehorende presentatie of publiekssamenvatting.** CBS, PBL, Algemene Rekenkamer; rijksoverheid.nl heeft soms een presentatie als bijlage bij een rapport.
4. **TED-talk transcript + de talk zelf.** Gebruik het transcript als bron; vergelijk de gegenereerde deckstructuur met de opbouw van de talk.
5. **Nationaal Groeifonds-voorstel + publieke pitch deck** (indien vindbaar).

Streef naar 4–6 cases in deze categorie, met spreiding in lengte, taal (NL en EN) en domein.

### Categorie B: realistische bron zonder referentiedeck

Content waarvan aannemelijk is dat gebruikers die als startpunt voor een presentatie zouden gebruiken:

1. Een goed gestructureerd Wikipedia-artikel over een afgebakend onderwerp
2. Een technische blogpost/whitepaper (bijv. een engineering-post van Stripe of Cloudflare)
3. Een persbericht plus het onderliggende rapport (test of de pipeline hoofdpunten uit lange context haalt)
4. De README van een open source-project — inclusief Deckyard's eigen README als meta-case

Streef naar 4–6 cases, met variatie in lengte (kort persbericht t/m lang rapport) en structuur (sterk gestructureerd vs. doorlopend proza).

### Praktische aandachtspunten bij verzamelen

- Sla bronnen op als tekst/markdown waar mogelijk; converteer PDF's naar tekst maar bewaar ook het origineel.
- Leg in `case.json` de herkomst-URL's vast, plus licentie-/gebruiksinformatie. Materiaal wordt alleen lokaal gebruikt voor evaluatie, niet herdistribueerd.
- Referentiedecks (PDF/PPTX) omzetten naar een gestructureerde representatie (per slide: titel, bullets/tekst, aantal woorden) zodat er programmatisch mee vergeleken kan worden.

## Fase 2: Test harness

Bouw een runner die:

1. Per case de broninformatie door de Deckyard-generatiepipeline haalt (bij voorkeur via de bestaande MCP-server of een directe aanroep van de generatielogica, zodat exact dezelfde prompts en code paths worden getest als in productie).
2. Het gegenereerde deck opslaat als artefact per run, met run-ID en timestamp: `test-suite/runs/<run-id>/<case-id>/deck.json`.
3. De actuele promptversies (hash of kopie van de prompt-bestanden) bij elke run vastlegt, zodat resultaten herleidbaar zijn tot promptwijzigingen.
4. Deterministisch genoeg is om runs te vergelijken: leg modelversie (en effort-instelling) vast in de run-metadata; draai elke case bij voorkeur 2–3× om variantie te zien.

## Fase 3: Evaluatie

### Automatische metrics (per gegenereerd deck)

- Aantal slides, woorden per slide (gemiddeld/max), bullets per slide
- Dekking: welk aandeel van de kernonderwerpen/secties uit de bron komt terug in het deck (bepaal kernonderwerpen via een aparte extractiestap op de bron)
- Feitelijke consistentie: cijfers en claims in het deck moeten letterlijk of parafraserend herleidbaar zijn naar de bron (geen gehallucineerde getallen)
- Structuur: aanwezigheid van titelslide, logische opbouw (intro → kern → afsluiting)

### Vergelijking met referentiedeck (alleen categorie A)

- Structurele gelijkenis: aantal slides, volgorde van onderwerpen, welke onderwerpen het menselijke deck wel/niet opnam
- Dekkingsoverlap: overlap in behandelde kernpunten tussen gegenereerd en menselijk deck
- Slide-economie: tekstdichtheid vergeleken met het menselijke deck

### LLM-as-judge

Gebruik een LLM-beoordelaar (via de Anthropic API) die per deck scoort op een rubric (schaal 1–5 per dimensie):

- **Dekking**: zijn de belangrijkste punten uit de bron aanwezig?
- **Structuur**: logische opbouw en volgorde?
- **Slide-economie**: juiste hoeveelheid tekst per slide, geen wall-of-text?
- **Getrouwheid**: geen verzinsels of verdraaiingen t.o.v. de bron?
- **Presenteerbaarheid**: zou een mens dit deck met lichte aanpassingen kunnen presenteren?

Bij categorie A krijgt de judge ook het menselijke referentiedeck te zien en scoort aanvullend: "hoe dicht komt het gegenereerde deck bij het menselijke deck qua keuzes en structuur?" Geef de judge een vast systeem-prompt en vraag om JSON-output zodat scores programmatisch verwerkt kunnen worden. Laat de judge per score een korte motivering geven; die motiveringen zijn de belangrijkste input voor promptverbetering.

### Rapportage

Genereer per run een rapport (markdown) met: scores per case en per dimensie, delta's t.o.v. de vorige run, en de judge-motiveringen bij de laagst scorende dimensies. Houd een `test-suite/history.md` of JSON-log bij zodat de progressie over runs zichtbaar is.

## Fase 4: Iteratielus

1. Draai de volledige suite → rapport.
2. Analyseer de laagst scorende dimensies en de judge-motiveringen; herleid ze tot specifieke prompts in de applicatie (splitsingslogica, slide-compositie, samenvattingsinstructies, etc.).
3. Pas de prompts aan. Documenteer per wijziging: welke prompt, wat veranderd, welke tekortkoming het adresseert.
4. Draai de suite opnieuw en vergelijk met de vorige run.
5. Herhaal tot de scores op alle dimensies op het gewenste niveau zijn en niet meer significant verbeteren. Let op regressies: een wijziging die dimensie X verbetert mag dimensie Y niet verslechteren; het rapport moet dit zichtbaar maken.

## Randvoorwaarden

- Alles in plain TypeScript/JavaScript, passend bij de bestaande Deckyard-codebase en tooling.
- De suite moet met één commando te draaien zijn (bijv. `npm run test:ai-suite`), met optionele flags voor een subset van cases en aantal herhalingen.
- API-kosten beheersen: cache bron-extracties en judge-beoordelingen waar de input identiek is; maak een `--dry-run` die alleen metrics zonder LLM-judge draait.
- Geen testmateriaal committen waarvan herdistributie niet is toegestaan; voeg in plaats daarvan een download-script toe dat de bronnen ophaalt op basis van de URL's in `case.json`.

## Opleverartefacten

1. `test-suite/` directory met cases, runner, evaluatie en rapportage
2. Download-/verzamelscript voor het testmateriaal
3. Eerste volledige run met rapport als nulmeting
4. Korte README in `test-suite/` die beschrijft hoe de suite gedraaid en uitgebreid wordt

---

## Operationeel addendum (uitvoering op dev-server-1)

Dit addendum hoort bij de uitvoering van bovenstaande briefing door een
autonome Claude Code-sessie op de dev-server. Het gaat vóór bij conflicten
over werkwijze (niet over inhoud).

### Autonomie

- Je werkt volledig autonoom; Jaap kijkt niet real-time mee en kan geen
  vragen beantwoorden. Kleine keuzes maak je zelf en documenteer je. Stop
  alleen bij echte blokkades (bijv. API-key werkt niet).
- Werk door tot en met de PR (zie Oplevering); "een plan opgeleverd" is geen
  eindpunt.

### Branch & repo-hygiëne

- Werk op branch `feat/ai-test-suite`, afgetakt van actuele `main`. Raak
  `main` niet aan, geen force-push.
- Commit vaak: minimaal na elke fase en na elke iteratieronde, met duidelijke
  messages. Push de branch regelmatig naar `origin` — Jaap volgt de voortgang
  via GitHub.
- Commit deze briefing als eerste commit op de branch.
- Bestaande tests (`npm test`) moeten blijven slagen; de app (`npm start`)
  moet blijven werken. Postgres draait al als Docker-container `deckyard-pg`;
  `.env` is compleet.

### Model & API

- Voor generatie én judge gebruik je **Claude Opus 4.8** via de Anthropic
  API: model-ID exact `claude-opus-4-8`. De key staat in `.env` als
  `ANTHROPIC_API_KEY` (en `CLAUDE_API` voor het bestaande app-pad).
- Let op (API-wijzigingen t.o.v. oudere modellen): `claude-opus-4-8`
  accepteert **geen** `temperature`/`top_p`/`top_k` en geen
  `budget_tokens`. Gebruik `thinking: {type: "adaptive"}` en optioneel
  `output_config: {effort: ...}`. Leg in de run-metadata vast: model-ID,
  effort, en promptversie-hash — dat vervangt de temperature-registratie
  uit de briefing.
- Gebruik de officiële `@anthropic-ai/sdk` (geen fetch naar de API).

### Kosten

- Opus 4.8 kost $5/M input, $25/M output. Richtbudget voor het hele traject:
  **circa $50**. Beheers dit met de cache- en `--dry-run`-maatregelen uit de
  briefing, en door iteratierondes op een subset van cases te draaien en
  alleen mijlpaal-runs op de volledige set.
- Houd een simpele kostenteller bij (usage-velden sommeren) en log die per
  run in het rapport. Bij dreigende overschrijding: kleinere subsets, niet
  stoppen.

### Iteratielus

- Doorloop **minimaal 3 en maximaal ~8 iteratierondes** (prompt-aanpassing →
  run → vergelijking), of stop eerder wanneer twee opeenvolgende rondes geen
  significante verbetering meer laten zien op de laagst scorende dimensies.
- Waak voor regressies zoals de briefing beschrijft; draai bij twijfel de
  vorige promptversie als controle.

### Oplevering

1. Push de branch met alles erop.
2. Open een PR naar `main` van `jaapstronks/deckyard` met `gh pr create`
   (gh is geïnstalleerd en ingelogd). PR-body: aanpak, nulmeting →
   eindmeting per dimensie (tabel), overzicht van alle promptwijzigingen met
   motivering, totale API-kosten, en openstaande aanbevelingen.
3. **Niet mergen** — de PR is het eindproduct; Jaap reviewt.
