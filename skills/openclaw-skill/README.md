# Deckyard Skill for OpenClaw

Create AI-powered presentations from any OpenClaw agent.

## What it does

Connects your OpenClaw agent to a [Deckyard](https://deckyard.eu) instance, giving it the ability to:

- **Create presentations** from text, meeting notes, or bullet points using AI
- **Modify presentations** with natural language ("make slide 3 punchier")
- **Share links** — edit URLs for collaborators, present URLs for viewers
- **Validate** presentations for quality issues
- **Append** new content to existing decks

## Requirements

- A running Deckyard instance (self-hosted or cloud)
- A Deckyard API key (`dk_live_...`)
- Python 3 (no external dependencies)

## Setup

1. Copy `.env.example` to `.env`
2. Set your Deckyard URL and API key
3. The agent reads SKILL.md automatically

## How it works

The skill uses Deckyard's MCP SSE transport (`POST /mcp`) — a JSON-RPC 2.0 API authenticated with API keys. The Python script wraps this into simple CLI commands that OpenClaw agents can call.

No MCP SDK or Node.js required. Pure Python, zero dependencies.

## Example conversation

> **User:** Maak een presentatie over onze Q1 resultaten: omzet +15%, 3 nieuwe klanten, team gegroeid van 8 naar 12

> **Agent:** *calls `deckyard.py create`*
> ✅ Presentatie aangemaakt: "Q1 2026 Results" (5 slides)
> 🔗 Bekijk: https://deckyard.example.com/present/abc123
> Wil je dat ik iets aanpas?

> **User:** Slide 3 moet korter en voeg een timeline toe

> **Agent:** *calls `deckyard.py iterate`*
> Done! Slide 3 ingekort en timeline toegevoegd na slide 4.

## License

MIT
