# MCP Server Test Prompt for Claude Desktop

Copy-paste this prompt into Claude Desktop after connecting the Deckyard MCP server.
It exercises all major tool categories: reading, creating, modifying, analyzing.

---

## The Prompt

```
I want to test the Deckyard presentation tools step by step. Let's go through this workflow:

### Step 1: Explore
- First, list all available slide types and tell me how many there are. Group them by category (structural vs content).
- Then list available themes.

### Step 2: Create
Generate a presentation from this content:

"""
Brightwave Collective — Quarterly Update Q1

Brightwave, a fictional network for sustainable product design, had a strong first quarter. Our community grew from 200 to 340 members, driven by the launch of SPARK — our new program connecting designers with manufacturing partners.

Key achievements:
- SPARK program launched with 12 founding partners
- Studio cohort 4 selected: 8 projects from 67 applications
- Community platform migration completed
- New website launched with improved event registration

Financial highlights:
- Total budget utilization: 78% (on track)
- Partner contributions: €145K (target: €180K)
- Event revenue: €23K (above target of €18K)
- Operational costs: 12% below forecast

Upcoming milestones:
- SPARK Demo Day: March 15
- Studio mid-term review: April 2
- Annual event: April 16 (500+ expected attendees)
- Grant application deadline: May 1

The team expanded with two new hires: a community manager and a communications lead. Our advisory board met twice and endorsed the long-term strategy proposal.

Speaker: Alex de Vries, Marketing & Communications
"""

Use the "nl" language setting. After creating, show me:
- The edit URL
- A summary of each slide (index, type, title)

### Step 3: Review & Validate
- Get the full presentation data so I can see all slide content
- Run validation to check for any warnings
- Run the AI analysis for improvement suggestions

### Step 4: Iterate
Apply these changes using natural language commands (one at a time, show me the result after each):
1. "Make the financial slide more visual — use a KPI grid instead of a list"
2. "Slide 2 is too text-heavy, make it punchier"  
3. "Add more variety — too many content slides in a row"

### Step 5: Convert
Pick one list-slide and convert it to an icon-card-grid-slide. Show me the before and after content.

### Step 6: Compress
Run compression analysis in preview mode (don't apply yet). Tell me what it suggests.

### Step 7: Modify Structure
- Add a new quote-slide at position 3 with: quote "Innovation happens at the intersection of creativity and technology", attribution "Brightwave Manifesto"
- Reorder: move the last slide to position 2
- Then undo that reorder (move it back)

### Step 8: Duplicate & Clean Up
- Duplicate the presentation
- Delete the duplicate

### Step 9: Summary
Give me a summary of everything that worked and anything that failed or felt off. Be honest — this is a test run and I want to know about rough edges.

After each step, briefly confirm what happened before moving on.
```

---

## What This Tests

| Step | Tools Exercised |
|------|----------------|
| 1. Explore | `get_slide_types`, `list_themes` |
| 2. Create | `create_presentation`, `get_presentation_url` |
| 3. Review | `get_presentation`, `validate_presentation`, `analyze_presentation` |
| 4. Iterate | `iterate_presentation` (×3) |
| 5. Convert | `convert_slide` |
| 6. Compress | `compress_presentation` (preview) |
| 7. Modify | `add_slide`, `reorder_slides` (×2) |
| 8. Duplicate | `duplicate_presentation`, `delete_presentation` |
| 9. Summary | — (reflection) |

**Tools NOT tested:** `list_presentations`, `update_slide`, `remove_slide`, `append_slides`

## Quick Smoke Test (shorter)

If you just want to verify the connection works:

```
Use the Deckyard tools to:
1. List available slide types (just count them)
2. List my presentations
3. List available themes
Tell me the results.
```

## Troubleshooting

If Claude Desktop shows "Server disconnected":
- Check that `npm run mcp` works from the command line
- Verify `.env` has LLM vendor configured (needed for AI tools)
- Check stderr output: `node server/mcp/index.js 2>mcp-debug.log`
- Verify `DECKYARD_MCP_OWNER_EMAIL` is set in the config

If AI tools fail but read tools work:
- The LLM vendor config in `.env` is probably missing or invalid
- Non-AI tools (get_slide_types, list_presentations, etc.) work without LLM config
