# Live Data Sources — Testing Checklist

## Setup

1. Add to your `.env`:
   ```
   LIVE_DATA_ENABLED=true
   ```
   If testing with Notion, also ensure `NOTION_SECRET` and `NOTION_FEATURE=true` are set.

2. Run the migration (if using PostgreSQL):
   ```
   npm run migrate
   ```
   This adds the `data_source` column to `slide_library`.

3. Start the dev server:
   ```
   npm run dev
   ```

---

## What to test

### Feature flag gating

- [ ] With `LIVE_DATA_ENABLED=true`: open a KPI, table, chart, quote, content, or timeline slide in the editor. A "Connect data source" button should appear below the header.
- [ ] With `LIVE_DATA_ENABLED` unset or false: no data source UI should appear anywhere.
- [ ] `GET /api/data-sources/providers` should return 403 when the flag is off, 200 when on.

### Provider: CSV-URL

Easiest to test without any external account.

1. Create a public Google Sheet with some data (e.g., metric name + value columns).
2. Publish it: **File > Share > Publish to web > CSV**.
3. Open a **KPI Metrics** slide in the editor.
4. Click **Connect data source** > select **CSV / Google Sheets**.
5. Paste the published CSV URL.
6. Click **Preview data** — you should see rows with column names and values.
7. In the binding rows, map fields like:
   - `metrics[0].value` ← `A2` (or `row[0].Value` if using named columns)
   - `metrics[0].label` ← `B2` (or `row[0].Label`)
8. Click **Connect** — the slide content should update with the sheet values.
9. The data source bar should show "Snapshot from [today]" with a mode selector.

**Refresh test:**
- Change a value in the Google Sheet.
- Click **Pull latest** on the data source bar.
- The slide field should update.

**Mode switching:**
- Change the mode dropdown from "Snapshot" to "Manual refresh" — the status dot should turn green.
- Change to "Live (auto)" — same green dot.
- Change back to "Snapshot" — dot turns gray, shows "Snapshot from [date]".

**Disconnect:**
- Click **Disconnect** — the data source bar should revert to the "Connect data source" button.
- The slide content should retain the last-fetched values.

### Provider: Notion Database

Requires `NOTION_SECRET` with access to a Notion database.

1. Create a Notion database with columns: "Metric" (title), "Value" (number), "Delta" (text).
2. Add a few rows.
3. Share the database with your Notion integration.
4. Open a **KPI Metrics** slide > **Connect data source** > **Notion Database**.
5. Paste the database ID or URL.
6. Click **Preview data** — should show rows with property names and values.
7. Map bindings like:
   - `metrics[0].value` ← `row[0].Value`
   - `metrics[0].label` ← `row[0].Metric`
   - `metrics[0].delta` ← `row[0].Delta`
8. Connect and verify the slide updates.

### Provider: Notion Block

1. Create a Notion page with a quote block or heading.
2. Open a **Quote** slide > connect > **Notion Block / Page**.
3. Paste the page ID/URL.
4. Preview should show block content.
5. Map `quote` ← `block[0]` and optionally `attribution` ← `block[1]`.

### Slide types to test

| Slide type | What to bind | Source suggestion |
|---|---|---|
| `kpi-metrics-slide` | `metrics[N].value`, `.label`, `.delta` | CSV or Notion DB |
| `table-slide` | `rows[N].c1` through `.c10` | CSV |
| `chart-slide` | `csvData` | CSV URL |
| `quote-slide` | `quote`, `attribution` | Notion block |
| `content-slide` | `title`, `body` | Notion block |
| `timeline-slide` | `items[N].time`, `.title`, `.text` | Notion DB or CSV |

### API endpoints (manual testing)

```bash
# List providers (should return providers array + bindable slide types)
curl -b cookies.txt http://localhost:4177/api/data-sources/providers

# Preview CSV data
curl -b cookies.txt -X POST http://localhost:4177/api/data-sources/preview \
  -H 'Content-Type: application/json' \
  -d '{"provider":"csv-url","config":{"url":"YOUR_CSV_URL"}}'

# Refresh slide data
curl -b cookies.txt -X POST http://localhost:4177/api/data-sources/refresh \
  -H 'Content-Type: application/json' \
  -d '{"dataSource":{...},"content":{...}}'
```

### Edge cases

- [ ] Preview with invalid URL — should show error message in the modal
- [ ] Preview with unreachable Notion database — should show error
- [ ] Connect with no bindings filled in — Connect button should stay disabled
- [ ] Disconnect and reconnect — should work cleanly
- [ ] Save presentation with data source attached — reload and verify `dataSource` persists on the slide
- [ ] Non-bindable slide types (e.g., `title-slide`) — should not show data source UI at all

---

## Files involved

| Layer | Key files |
|---|---|
| Shared schema | `shared/data-source.js` |
| Feature flag | `server/config/features.js`, `server/config/feature-flags.js` |
| Provider engine | `server/utils/data-source/` (index, provider-base, bindings, providers/) |
| API routes | `server/routes/api/data-sources.js` |
| Migration | `server/db/migrations/036_live_data_sources.js` |
| SSE events | `server/services/comment-events.js` (DataSourceEventTypes) |
| Slide storage | `server/storage/presentations/slides.js` (normalizeSlides preserves dataSource) |
| Editor UI | `client/views/editor/data-source-panel.js`, `data-source-modal.js` |
| Editor form | `client/views/editor/editor-form.js` (wires in the indicator) |
| CSS | `client/styles/base/04-editor-and-misc/103-data-source.css` |
