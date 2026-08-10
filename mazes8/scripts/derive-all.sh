#!/usr/bin/env bash
# Derive junction hints for all eight from their verified routes. No AI calls: this
# is arithmetic over routes build-solutions already checked are walkable.
#
#   bash mazes8/scripts/derive-all.sh
set -u
cd "$(dirname "$0")/../.."
for n in 1 2 3 4 5 6 7 8; do
  if [ ! -s "public/mazes8/solutions/maze-$n.json" ]; then
    echo "maze-$n: no solutions file — run build-solutions.mjs first"
    continue
  fi
  node mazes/scripts/derive-hints.mjs "maze-$n" --set=mazes8 2>&1 \
    | grep -vE "MODULE_TYPELESS|Reparsing|To eliminate|trace-warnings"
done
