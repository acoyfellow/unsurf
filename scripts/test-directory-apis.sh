#!/bin/bash

echo "🧪 Testing all directory APIs..."
echo ""

# Get all domains
domains=$(curl -s https://unsurf-api.coey.dev/d/ | grep -o '"domain": "[^"]*"' | cut -d'"' -f4)

blocked=""
working=""
broken=""

for domain in $domains; do
  response=$(curl -s -X POST https://unsurf-api.coey.dev/d/invoke \
    -H "Content-Type: application/json" \
    -d "{\"domain\": \"$domain\", \"method\": \"GET\", \"path\": \"/\"}" 2>&1)
  
  if echo "$response" | grep -q '"status": 403'; then
    echo "🚫 BLOCKED: $domain"
    blocked="$blocked $domain"
  elif echo "$response" | grep -q '"status": 200'; then
    echo "✅ WORKING: $domain"
    working="$working $domain"
  else
    status=$(echo "$response" | grep -o '"status": [0-9]*' | cut -d' ' -f2)
    echo "❌ BROKEN (${status:-unknown}): $domain"
    broken="$broken $domain"
  fi
done

echo ""
echo "=========================================="
echo "SUMMARY"
echo "=========================================="
echo "✅ Working: $(echo $working | wc -w)"
echo "🚫 Blocked: $(echo $blocked | wc -w)"
echo "❌ Broken: $(echo $broken | wc -w)"
echo ""

if [ -n "$blocked" ]; then
  echo "🚫 BLOCKED DOMAINS (remove from directory):"
  for d in $blocked; do
    echo "  curl -X DELETE https://unsurf-api.coey.dev/d/$d"
  done
fi

echo ""
