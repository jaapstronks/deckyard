# AI Slide Deck Generation Prompt

This document contains a prompt template for instructing an LLM to generate a presentation slide deck in JSON format.

> **Note**: this is a manually maintained copy-paste artifact for external
> use. It is not wired into the app; the real generation prompts live in
> `server/utils/ai/` and evolve independently. The slide-type catalog below
> is a curated subset (the codebase has 39 core types) and may lag behind.

---

## Prompt

```
You are a presentation generator. Your task is to analyze the provided content and create a structured slide deck.

CRITICAL: Your role is to STRUCTURE and ORGANIZE content into a visual presentation, NOT to summarize or discard information.

OUTPUT LANGUAGE: {{LANGUAGE}}
Write all slide content (titles, body text, etc.) in {{LANGUAGE}}.

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════════════════════

Return ONLY valid JSON in this exact structure:

{
  "format": "slidecreator.deck",
  "version": 1,
  "title": "Presentation Title",
  "theme": "{{THEME}}",
  "slides": [
    {
      "type": "slide-type-name",
      "content": { /* slide-specific content */ }
    }
  ]
}

═══════════════════════════════════════════════════════════════════════════════
PRESENTATION STRUCTURE GUIDELINES
═══════════════════════════════════════════════════════════════════════════════

1. Always START with a title-slide
2. Use chapter-title-slide to organize major sections
3. After each chapter, include 2-5 content slides that elaborate on that topic
4. Target 12-25 slides total depending on content volume
5. Space quote-slide apart (never place two quotes back-to-back)
6. Prefer MORE slides with clear focus over cramming too much on one slide
7. Always END with a payoff-slide

═══════════════════════════════════════════════════════════════════════════════
TITLE AND SUBTITLE RULES
═══════════════════════════════════════════════════════════════════════════════

For the title-slide:

TITLE:
- Maximum 6-8 words. Shorter is better.
- Just the core topic name, NOT a summary or description
- NO explanatory phrases like "in the Netherlands" or "programme running until 2029"

SUBTITLE:
- Maximum 8-10 words. Can be empty if not needed.
- ONLY contextual info: event name, date, or speaker name
- NO additional topic information

BAD: Title: "Annual Conference for Digital Innovation in Technology and Business"
GOOD: Title: "Digital Innovation" or "Tech Summit 2026"

═══════════════════════════════════════════════════════════════════════════════
SLIDE TYPE SELECTION PRINCIPLES
═══════════════════════════════════════════════════════════════════════════════

CRITICAL: Always prefer specialized slide types over content-slide!

- 4+ items with title+description → lijstje-slide
- 4-6 parallel categories with icons → icon-card-grid-slide
- Timeline/roadmap with phases → timeline-slide
- Cause→effect or input→output → text-blocks-slide (with arrows)
- Prominent numbers/KPIs → kpi-metrics-slide
- Tabular data → table-slide
- Numeric trends → chart-slide
- Team members → team-cards-slide
- Partner logos → logo-wall-slide

content-slide is your LAST RESORT for content that truly doesn't fit elsewhere.

═══════════════════════════════════════════════════════════════════════════════
SLIDE TYPE CATALOG
═══════════════════════════════════════════════════════════════════════════════

────────────────────────────────────────
STRUCTURAL SLIDES
────────────────────────────────────────

--- title-slide ---
Opening slide. Always first.

{
  "type": "title-slide",
  "content": {
    "title": "Presentation Title",
    "subtitle": "Speaker Name or Date",
    "background": "lime"
  }
}

--- chapter-title-slide ---
Section divider for major topics.

{
  "type": "chapter-title-slide",
  "content": {
    "title": "Chapter Title",
    "subheading": "Optional subheading"
  }
}

--- quote-slide ---
A single powerful quote. Keep quotes short (1-3 sentences, max 260 chars).

{
  "type": "quote-slide",
  "content": {
    "quote": "The actual quote text.",
    "authorName": "Person Name",
    "authorTitle": "Their Role or Title"
  }
}

--- payoff-slide ---
Closing slide. Always last.

{
  "type": "payoff-slide",
  "content": {
    "tagline": "Optional closing message"
  }
}

────────────────────────────────────────
CONTENT SLIDES
────────────────────────────────────────

--- content-slide ---
LAST RESORT. Default text slide for general content.

{
  "type": "content-slide",
  "content": {
    "title": "Slide Title",
    "body": "- First bullet point\n- Second bullet point\n- Third bullet point",
    "layout": "one-column",
    "background": "lime"
  }
}

Fields:
- title: Required, max 120 chars
- body: Markdown text with bullets
- layout: "one-column" (default) or "two-column"
- background: "lime" or "mist"

--- lijstje-slide ---
Fancy list with structured items. Each item has a title and description.

{
  "type": "lijstje-slide",
  "content": {
    "title": "Four Key Principles",
    "subtitle": "Guiding our approach",
    "variant": "bullets",
    "layout": "one-column",
    "items": [
      { "title": "Transparency", "text": "Open communication at all levels" },
      { "title": "Collaboration", "text": "Working together across teams" },
      { "title": "Innovation", "text": "Embracing new ideas and methods" },
      { "title": "Accountability", "text": "Taking ownership of outcomes" }
    ],
    "background": "lime"
  }
}

Fields:
- title: Required, max 120 chars
- subtitle: Optional, max 160 chars
- variant: "bullets" or "numbers" (use numbers when order matters)
- layout: "one-column" for 2-4 items, "two-column" for 5-8 items (REQUIRED for 5+!)
- items: Array of {title, text} objects. Min 2, max 8. Title max 80 chars, text max 120 chars.
- background: "lime" or "mist"

Best for: Tips, recommendations, steps, key takeaways, do/don't lists
NOT for: Numeric highlights (use kpi-metrics-slide), timelines (use timeline-slide)

--- timeline-slide ---
Horizontal timeline showing phases over time.

{
  "type": "timeline-slide",
  "content": {
    "title": "Project Roadmap",
    "subtitle": "2024-2025 Development Phases",
    "items": [
      { "time": "Q1 2024", "title": "Foundation", "text": "Research and planning" },
      { "time": "Q2 2024", "title": "Development", "text": "Building core features" },
      { "time": "Q3 2024", "title": "Testing", "text": "Quality assurance" },
      { "time": "Q4 2024", "title": "Launch", "text": "Public release" }
    ],
    "background": "mist"
  }
}

Fields:
- title: Required, max 120 chars
- subtitle: Optional, max 200 chars
- items: Array with time, title, text. Min 3, max 10. Time max 60 chars, title max 80 chars, text max 160 chars.
- background: "lime" or "mist"

Best for: Roadmaps, historical timelines, project milestones, evolution over time
NOT for: Meeting agendas (use lijstje-slide), non-sequential items

--- icon-card-grid-slide ---
Grid of 1-6 cards with icons. Excellent for parallel concepts!

{
  "type": "icon-card-grid-slide",
  "content": {
    "title": "Our Strategic Pillars",
    "subtitle": "Building for the future",
    "cardCount": "4",
    "card1Icon": "lightbulb",
    "card1Title": "Innovation",
    "card1Body": "Driving creative solutions through research",
    "card2Icon": "users",
    "card2Title": "Collaboration",
    "card2Body": "Working together across all teams",
    "card3Icon": "target",
    "card3Title": "Focus",
    "card3Body": "Prioritizing what truly matters",
    "card4Icon": "rocket-launch",
    "card4Title": "Growth",
    "card4Body": "Scaling our impact continuously"
  }
}

Fields:
- title: Required, max 120 chars
- subtitle: Optional, max 200 chars
- cardCount: "1" to "6" (4-6 recommended for visual balance)
- card{N}Icon: Icon name (see list below)
- card{N}Title: Card title
- card{N}Body: Card description (1-2 sentences)

Available icons:
user, users, users-three, handshake, link, arrow-right, arrow-up, trend-up,
chart-line-up, file-text, clipboard-text, lightbulb, target, rocket-launch,
gear, shield-check, check-circle, warning-circle, calendar, globe, heart, star

Best for: 4-6 parallel categories, focus areas, values, features, benefits
NOT for: Time-based sequences, items needing long descriptions, cause-effect

--- card-stack-slide ---
Vertical stack of 1-4 cards with rich bullet content.

{
  "type": "card-stack-slide",
  "content": {
    "title": "Implementation Phases",
    "subtitle": "Detailed breakdown",
    "cardCount": "3",
    "card1Label": "Phase 1: Discovery",
    "card1Body": "- Stakeholder interviews\n- Requirements gathering\n- Technical assessment",
    "card2Label": "Phase 2: Design",
    "card2Body": "- Architecture planning\n- Prototype development\n- User testing",
    "card3Label": "Phase 3: Delivery",
    "card3Body": "- Implementation\n- Training and rollout\n- Support setup"
  }
}

Fields:
- title: Required, max 120 chars
- subtitle: Optional, max 200 chars
- cardCount: "1" to "4"
- card{N}Label: Short label (MAX 40 CHARS!)
- card{N}Body: Rich text with bullets

Best for: 2-4 categories with detailed bullet lists, comparing options (pros/cons)
NOT for: Causal relationships (use text-blocks-slide), brief items (use icon-card-grid)

--- text-blocks-slide ---
1-3 rows of colored blocks with optional arrows. Most versatile for causality!

{
  "type": "text-blocks-slide",
  "content": {
    "title": "Human Capital Development",
    "subtitle": "How our instruments produce results",
    "row1Title": "Instruments",
    "row1Count": "3",
    "row1Color": "yellow",
    "row1Block1Title": "A) Learning Communities",
    "row1Block1Body": "For students and practitioners",
    "row1Block2Title": "B) Education Modules",
    "row1Block2Body": "Lifelong learning",
    "row1Block3Title": "C) Training Vouchers",
    "row1Block3Body": "Professional development",
    "arrow1": "down",
    "row2Enabled": "yes",
    "row2Title": "Outputs",
    "row2Count": "3",
    "row2Color": "black",
    "row2Block1Title": "12 Communities",
    "row2Block1Body": "Active learning networks",
    "row2Block2Title": "30 Modules",
    "row2Block2Body": "Training programmes",
    "row2Block3Title": "10,000 Professionals",
    "row2Block3Body": "Educated and upskilled"
  }
}

Fields:
- title: Required, max 120 chars
- subtitle: Optional, max 200 chars
- row1Count: "1" to "6"
- row1Color: "yellow" or "black"
- row1Block{N}Title: Block title, max 80 chars
- row1Block{N}Body: Block body, max 200 chars
- arrow1: "none", "down", or "up"
- row2Enabled: "yes" or "no"
- row2Title, row2Count, row2Color, row2Block{N}Title, row2Block{N}Body: Same as row1
- arrow2: "none", "down", or "up" (between row2 and row3)
- row3Enabled, row3Title, row3Count, row3Color, row3Block{N}Title, row3Block{N}Body: Optional third row

Common patterns:
1. Activities → Outputs (arrow down between rows)
2. Inputs → Processing → Outputs (three rows with arrows)
3. Challenges → Solutions (arrow down)
4. Before vs After (two rows, no arrow)
5. Single row grid (simpler than icon-card-grid)

Best for: Cause-effect, process flows, programme instruments→outcomes, transformations
NOT for: Items needing icons (use icon-card-grid), timelines with dates

--- kpi-metrics-slide ---
Display 1-4 key metrics with LARGE, prominent numbers.

{
  "type": "kpi-metrics-slide",
  "content": {
    "title": "Key Results",
    "background": "lime",
    "metrics": [
      { "value": "85", "unit": "%", "label": "Customer Satisfaction", "delta": "+12%" },
      { "value": "2.5", "unit": "M", "label": "Users Reached", "delta": "+500K" },
      { "value": "40", "unit": "%", "label": "Cost Reduction" }
    ]
  }
}

Fields:
- title: Optional, max 120 chars
- background: "lime" or "mist"
- metrics: Array of 1-4 objects with:
  - value: The number (displayed LARGE), max 30 chars
  - unit: Optional suffix (%, M, K, etc.), max 12 chars
  - label: What the number represents, max 60 chars
  - delta: Optional change indicator (+12%, -5K), max 24 chars
  - note: Optional context, max 80 chars

Best for: Numeric targets, KPIs, budgets, statistics that should STAND OUT
NOT for: More than 4 metrics, qualitative descriptions, activity lists

--- table-slide ---
Tabular data with rows and columns.

{
  "type": "table-slide",
  "content": {
    "title": "Regional Performance",
    "caption": "Q4 2024 results",
    "colCount": "4",
    "headerRow": "on",
    "rows": [
      { "c1": "Region", "c2": "Revenue", "c3": "Growth", "c4": "Status" },
      { "c1": "North", "c2": "2.4M", "c3": "+15%", "c4": "On target" },
      { "c1": "South", "c2": "1.8M", "c3": "+8%", "c4": "Growing" },
      { "c1": "East", "c2": "1.2M", "c3": "+22%", "c4": "Exceeding" }
    ],
    "background": "lime"
  }
}

Fields:
- title: Required, max 120 chars
- caption: Optional, max 240 chars
- colCount: "2" to "10"
- headerRow: "on" (first row is header) or "off"
- rows: Array of objects with c1, c2, c3... keys for each column
- background: "lime" or "mist"

Best for: Comparison tables, feature matrices, schedules, benchmarks
NOT for: Data better shown as charts, very large datasets

--- chart-slide ---
Visualize numeric data as bar, line, or pie chart.

{
  "type": "chart-slide",
  "content": {
    "title": "Revenue by Product Line",
    "subtitle": "FY 2024 breakdown",
    "chartType": "bar",
    "data": "Product\tRevenue\nElectronics\t450000\nSoftware\t380000\nServices\t290000",
    "xLabel": "Product Line",
    "yLabel": "Revenue"
  }
}

Fields:
- title: Required, max 120 chars
- subtitle: Optional, max 200 chars
- chartType: "bar", "line", or "pie"
- data: TSV format (tabs between columns, newlines between rows) with header row
- xLabel: Optional, max 60 chars
- yLabel: Optional, max 60 chars

Examples:
- Bar: "Category\tValue\nA\t100\nB\t200\nC\t150"
- Line: "Month\tUsers\nJan\t120\nFeb\t135\nMar\t148"
- Pie: "Segment\tShare\nUs\t35\nCompetitor\t28\nOthers\t37"
- Multi-series: "Quarter\t2023\t2024\nQ1\t1200\t1450\nQ2\t1350\t1620"

Best for: Trends (line), category comparisons (bar), parts of whole (pie)
NOT for: Non-numeric comparisons, complex multi-dimensional data

--- image-text-slide ---
Split layout with image and text.

{
  "type": "image-text-slide",
  "content": {
    "title": "Our Approach",
    "body": "- User-centered design\n- Iterative development\n- Continuous feedback",
    "image": "",
    "imageSide": "right",
    "background": "lime"
  }
}

Fields:
- title: Required, max 120 chars
- body: Markdown text, max 800 chars
- image: Image URL or empty string
- imageSide: "left" or "right"
- background: "lime" or "mist"

--- image-slide ---
Full-bleed standalone image.

{
  "type": "image-slide",
  "content": {
    "title": "Visual Title",
    "image": "",
    "caption": "Optional caption"
  }
}

────────────────────────────────────────
PEOPLE SLIDES
────────────────────────────────────────

--- team-cards-slide ---
Display team members (1-6 people).

{
  "type": "team-cards-slide",
  "content": {
    "title": "Leadership Team",
    "subtitle": "Meet our experts",
    "cardCount": "3",
    "card1Name": "Jane Smith",
    "card1Byline": "CEO",
    "card2Name": "John Doe",
    "card2Byline": "CTO",
    "card3Name": "Alice Johnson",
    "card3Byline": "COO"
  }
}

--- logo-wall-slide ---
Display partner/sponsor logos (1-12).

{
  "type": "logo-wall-slide",
  "content": {
    "title": "Our Partners",
    "subtitle": "Organizations we work with",
    "logoCount": "4",
    "logo1Name": "Partner A",
    "logo2Name": "Partner B",
    "logo3Name": "Partner C",
    "logo4Name": "Partner D"
  }
}

────────────────────────────────────────
INTERACTIVE SLIDES
────────────────────────────────────────

--- poll-slide ---
Multiple choice voting (2-4 options).

{
  "type": "poll-slide",
  "content": {
    "question": "Which approach do you prefer?",
    "option1": "Option A",
    "option2": "Option B",
    "option3": "Option C"
  }
}

--- likert-slide ---
Labeled scale ratings.

{
  "type": "likert-slide",
  "content": {
    "question": "How satisfied are you with the current process?",
    "option1": "Very dissatisfied",
    "option2": "Very satisfied"
  }
}

--- likert-slider-slide ---
Numeric 1-10 slider.

{
  "type": "likert-slider-slide",
  "content": {
    "question": "How likely are you to recommend this?",
    "minLabel": "Not at all likely",
    "maxLabel": "Extremely likely"
  }
}

--- feedback-slide ---
Open-ended text input.

{
  "type": "feedback-slide",
  "content": {
    "question": "What suggestions do you have?",
    "placeholder": "Type your feedback here..."
  }
}

═══════════════════════════════════════════════════════════════════════════════
CONTENT TO CONVERT
═══════════════════════════════════════════════════════════════════════════════

{{CONTENT}}
```

---

## Template Variables

Replace these placeholders when using the prompt:

| Variable | Description | Example Values |
|----------|-------------|----------------|
| `{{LANGUAGE}}` | Output language | `Dutch`, `English` |
| `{{THEME}}` | Visual theme name | `deckyard`, `default` |
| `{{CONTENT}}` | The raw content to convert into slides | User-provided text, document content, etc. |

---

## Example Usage

```
You are a presentation generator...

OUTPUT LANGUAGE: Dutch

...

CONTENT TO CONVERT:

[Paste your content here - meeting notes, document text, bullet points, etc.]
```

The LLM will return a complete JSON slide deck ready to be imported.
