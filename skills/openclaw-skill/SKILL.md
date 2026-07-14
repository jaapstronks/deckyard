# Deckyard — AI Presentation Engine

Create, modify, and share presentations using Deckyard's MCP API.

## Setup

1. Copy `.env.example` to `.env`
2. Set `DECKYARD_URL` to your Deckyard instance (e.g. `https://deckyard.example.com`)
3. Set `DECKYARD_API_KEY` to a Deckyard API key (`dk_live_...`)
   - Create one via: `node scripts/create-api-key.js --email you@example.com --name "Agent Key" --scopes read,write,ai`

## How to Use

You have access to a Deckyard presentation engine. You can create full presentations from text, modify them with natural language, and share links.

### Creating a Presentation

```bash
python3 SKILL_DIR/scripts/deckyard.py create \
  --content "Your raw content, meeting notes, bullet points, etc." \
  --title "Presentation Title" \
  --theme "default" \
  --lang "en-GB"
```

Returns: presentation ID, title, slide count, edit URL, and present URL.

**Content tips:** The AI works best with structured input — bullet points, sections, or paragraphs. It auto-detects the best slide types (KPIs, timelines, process diagrams, comparisons, etc.) from the content structure.

**Languages:** `en-GB` (English), `nl` (Dutch), or omit for auto-detect.

**Themes:** Use `list-themes` to see available themes. Default is `deckyard`.

### Listing Presentations

```bash
python3 SKILL_DIR/scripts/deckyard.py list
```

### Getting a Presentation

```bash
python3 SKILL_DIR/scripts/deckyard.py get --id PRESENTATION_ID
```

Returns full slide data including types and content.

### Modifying with Natural Language

```bash
python3 SKILL_DIR/scripts/deckyard.py iterate \
  --id PRESENTATION_ID \
  --command "Make slide 3 punchier and split the KPI slide into two"
```

The AI understands commands like:
- "Make it shorter" (compresses the whole deck)
- "Slide 3 needs more detail"
- "Convert the list to an icon card grid"
- "Add a timeline slide after slide 4"
- "Make the tone more professional"

### Getting Shareable URLs

```bash
python3 SKILL_DIR/scripts/deckyard.py url --id PRESENTATION_ID
```

Returns edit and present URLs. Share the present URL for viewing.

### Listing Themes

```bash
python3 SKILL_DIR/scripts/deckyard.py list-themes
```

### Validating a Presentation

```bash
python3 SKILL_DIR/scripts/deckyard.py validate --id PRESENTATION_ID
```

Checks for density issues, repetition, readability problems.

### Adding Slides from New Content

```bash
python3 SKILL_DIR/scripts/deckyard.py append \
  --id PRESENTATION_ID \
  --content "Additional content to generate slides from"
```

## Typical Workflow

1. User asks for a presentation → use `create` with their content
2. Share the **present URL** (not edit URL) for viewing
3. User wants changes → use `iterate` with their feedback
4. User wants more content → use `append`
5. Final check → use `validate`

## Important Notes

- Always share the **present URL** for viewing, **edit URL** for editing
- The `create` command uses AI and may take 10-30 seconds
- The `iterate` command modifies the presentation in-place
- Presentations persist on the Deckyard instance — they're not temporary
- Available slide types: title, content, list, image, chart, KPI, timeline, process, comparison, matrix, funnel, pyramid, cycle, gallery, quote, and more (36+ types)
