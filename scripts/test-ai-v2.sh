#!/bin/bash
# Quick test script for AI V2 deck generation
# Usage: ./scripts/test-ai-v2.sh

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "Testing AI V2 Deck Generation"
echo "=============================="
echo ""

# Test content
read -r -d '' TEST_CONTENT << 'EOF'
# Digitale Transformatie bij Organisatie X

## Introductie
We staan aan de vooravond van een grote digitale transformatie. Dit document beschrijft onze aanpak.

## Vier strategische pijlers
1. **Klantgerichtheid** - De klant staat centraal in alles wat we doen
2. **Data-gedreven besluitvorming** - We baseren onze keuzes op feiten
3. **Agile werken** - Snelle iteraties en continue verbetering
4. **Duurzaamheid** - Verantwoord ondernemen voor de lange termijn

## Onze roadmap

### 2024: Fundament
- Infrastructuur moderniseren
- Team opleiden
- Eerste pilots starten

### 2025: Versnelling
- Uitrol naar alle afdelingen
- Externe partnerships
- Eerste resultaten meten

### 2026: Opschaling
- Volledige implementatie
- Best practices documenteren
- Kennis delen met sector

## Quote van onze CEO
"Deze transformatie is niet optioneel - het is essentieel voor ons voortbestaan. Maar we gaan het samen doen, stap voor stap."
— Jan de Vries, CEO

## Kerngetallen
- 1.2M klanten bereikt (+15% YoY)
- 35% conversie (+3pp)
- NPS score: 42 (+5)
- ROI: 340%

## Volgende stappen
1. Kick-off bijeenkomst plannen
2. Projectteams samenstellen
3. Eerste sprint starten
EOF

echo "1. Testing outline generation (Phase 1 only)..."
echo ""

OUTLINE_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/ai/wizard-v2/outline" \
  -H "Content-Type: application/json" \
  -d "{\"raw\": $(echo "$TEST_CONTENT" | jq -Rs .), \"lang\": \"nl\"}")

if echo "$OUTLINE_RESPONSE" | jq -e '.slides' > /dev/null 2>&1; then
  SLIDE_COUNT=$(echo "$OUTLINE_RESPONSE" | jq '.slides | length')
  MESSAGE_COUNT=$(echo "$OUTLINE_RESPONSE" | jq '.statusMessages | length')
  echo "✓ Outline generated: $SLIDE_COUNT slides, $MESSAGE_COUNT status messages"
  echo ""
  echo "Status messages preview:"
  echo "$OUTLINE_RESPONSE" | jq -r '.statusMessages[:5][]' 2>/dev/null | head -5
else
  echo "✗ Outline generation failed"
  echo "$OUTLINE_RESPONSE" | jq '.' 2>/dev/null || echo "$OUTLINE_RESPONSE"
fi

echo ""
echo "2. Testing full generation (streaming disabled for this test)..."
echo ""

FULL_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/ai/wizard-v2" \
  -H "Content-Type: application/json" \
  -d "{\"raw\": $(echo "$TEST_CONTENT" | jq -Rs .), \"lang\": \"nl\", \"theme\": \"deckyard\"}")

if echo "$FULL_RESPONSE" | jq -e '.id' > /dev/null 2>&1; then
  PRES_ID=$(echo "$FULL_RESPONSE" | jq -r '.id')
  SLIDE_COUNT=$(echo "$FULL_RESPONSE" | jq '.slides | length')
  SLIDE_TYPES=$(echo "$FULL_RESPONSE" | jq -r '._generationMeta.slideTypeDistribution // {} | to_entries | map("\(.key): \(.value)") | join(", ")')
  echo "✓ Presentation created: $PRES_ID"
  echo "  Slides: $SLIDE_COUNT"
  echo "  Types: $SLIDE_TYPES"
else
  echo "✗ Full generation failed"
  echo "$FULL_RESPONSE" | jq '.' 2>/dev/null || echo "$FULL_RESPONSE"
fi

echo ""
echo "3. Testing streaming endpoint..."
echo ""

echo "Streaming test (first 10 events):"
curl -s -N -X POST "${BASE_URL}/api/ai/wizard-v2/stream" \
  -H "Content-Type: application/json" \
  -d "{\"raw\": \"Test content for streaming\", \"lang\": \"nl\"}" 2>&1 | head -30

echo ""
echo ""
echo "Done! Check server/logs/ai/ for detailed logs."
