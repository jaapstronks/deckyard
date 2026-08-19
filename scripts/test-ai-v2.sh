#!/bin/bash
# Quick smoke test for the AI V2 streaming deck generator, the one live
# wizard-v2 path (the non-streaming and outline-only endpoints were retired
# in B97).
# Usage: ./scripts/test-ai-v2.sh

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "Testing AI V2 Deck Generation"
echo "=============================="
echo ""

echo "Streaming generation (first 10 events):"
echo ""

curl -s -N -X POST "${BASE_URL}/api/ai/wizard-v2/stream" \
  -H "Content-Type: application/json" \
  -d "{\"raw\": \"Test content for streaming\", \"lang\": \"nl\"}" 2>&1 | head -30

echo ""
echo ""
echo "Done! Check server/logs/ai/ for detailed logs."
