#!/usr/bin/env bash
# Generate quadrant + overview crops from a large rendered PNG so the
# critic loop can inspect at full effective resolution. Downsampling a
# 10000px+ canvas to a 1800px preview hides text-fitting and overlap bugs
# the critics need to catch.
#
# Usage:
#   bash .claude/skills/excalidraw/tools/sh/crops.sh <input.png> <output-dir>
#
# Produces in <output-dir>:
#   overview.png   — full canvas downsampled to ~1800px wide
#   nw.png         — top-left quadrant (full resolution, downsampled to ~1800px)
#   ne.png         — top-right quadrant
#   sw.png         — bottom-left quadrant
#   se.png         — bottom-right quadrant
#   center.png     — middle 50% of the canvas

set -euo pipefail

INPUT="${1:?missing input PNG path}"
OUTDIR="${2:?missing output dir}"

if ! [[ -f "$INPUT" ]]; then
  echo "error: input not found: $INPUT" >&2
  exit 1
fi

mkdir -p "$OUTDIR"

# Get dimensions via sips.
W=$(sips -g pixelWidth  "$INPUT" | awk '/pixelWidth/  { print $2 }')
H=$(sips -g pixelHeight "$INPUT" | awk '/pixelHeight/ { print $2 }')

HALF_W=$(( W / 2 ))
HALF_H=$(( H / 2 ))
QUARTER_W=$(( W / 4 ))
QUARTER_H=$(( H / 4 ))

# Overview: downsample full canvas.
sips -Z 1800 "$INPUT" --out "$OUTDIR/overview.png" >/dev/null

# Quadrants: crop, then downsample to 1800px wide if larger.
crop() {
  local name="$1" x="$2" y="$3" w="$4" h="$5"
  sips --cropToHeightWidth "$h" "$w" --cropOffset "$y" "$x" "$INPUT" --out "$OUTDIR/$name.png" >/dev/null
  # Downsample to 1800px wide if needed.
  local cw
  cw=$(sips -g pixelWidth "$OUTDIR/$name.png" | awk '/pixelWidth/ { print $2 }')
  if [[ "$cw" -gt 1800 ]]; then
    sips -Z 1800 "$OUTDIR/$name.png" --out "$OUTDIR/$name.png" >/dev/null
  fi
}

crop nw     0          0          "$HALF_W"    "$HALF_H"
crop ne     "$HALF_W"  0          "$HALF_W"    "$HALF_H"
crop sw     0          "$HALF_H"  "$HALF_W"    "$HALF_H"
crop se     "$HALF_W"  "$HALF_H"  "$HALF_W"    "$HALF_H"
crop center "$QUARTER_W" "$QUARTER_H" "$HALF_W" "$HALF_H"

echo "[crops] wrote 5 crops to $OUTDIR"
ls "$OUTDIR"
