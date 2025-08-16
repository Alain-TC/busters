tmp=$(mktemp)
jq '.scripts += {
  "elo:inspect": "tsx scripts/elo-inspect.ts",
  "elo:inspect:explore": "PFSP_TARGET=0.5 PFSP_TEMP=0.2 tsx scripts/elo-inspect.ts"
}' package.json > "$tmp" && mv "$tmp" package.json
