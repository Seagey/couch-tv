#!/bin/bash
# Make the Loop look's footage: one clip graded for four times of day, looping without a seam,
# with a tiny blurred copy of each for the glass and a poster of each (docs/LOOP.md).
#
#   scripts/make-loop.sh <input clip> [--out <dir>] [--seconds <15 to 60>] [--slow <factor>]
#                        [--only <dawn|day|dusk|night>] [--dry-run]
#
#   --out      where the files go. Default tv-home/web/loop in this repo (git ignores it; the bridge
#              serves it at /tv/loop/ and reads it at start, so restart the bridge afterwards).
#   --seconds  how long the loop is, 15 to 60, default 30. The clip must be at least one second
#              longer than that, divided by --slow (a 31 s loop at --slow 2 needs a 15.5 s clip).
#   --slow     slow the clip down: 2 plays a 60 fps clip at half speed, 1 (default) leaves it.
#   --only     make one variant instead of all four.
#   --dry-run  print every ffmpeg command and write nothing, not even the folder.
#
# Runs on the bridge computer with ffmpeg 7 (Debian: apt install ffmpeg). Per variant it writes
#   <variant>.mp4       1280x720, H.264 main level 4.0, yuv420p, 30 fps, GOP 30, crf 20, 4 Mbps cap
#   <variant>-blur.mp4  160x90, gblur sigma 2, 10 fps, crf 26, 300 kbps cap (the glass copy)
#   <variant>.jpg       960x540 poster, the first frame of the sharp file
#   <variant>-blur.jpg  960x540 poster, the first frame of the blurred file
#
# Footage: your own clip, or a stock clip from Pexels or Pixabay whose licence allows this use
# (both do; search "aerial mountain lake reflection" or "drone alpine lake dusk"). A slow push over
# a still subject, 20 s or longer, 1080p or 4K, no people, the sky not blown out. Apple's aerial
# screensavers may not be used: they are Apple's, and not licensed for this.
#
# Grades: day is the clip as it is; dawn, dusk and night are the starting values from the design
# (colorbalance, eq and curves). Change them below if your clip wants it, and run the script again.
#
# The seam. The loop must play on from its last frame to its first with nothing repeated: a frame
# hold would replay half a second of the push at every wrap. So, with L the length in seconds:
#   base = the first L+1 seconds of the clip at 30 fps, frames 0 .. 30(L+1)-1
#   head = seconds 0 to 1 of base              (frames 0 .. 29)
#   body = seconds 1 to L+1 of base            (frames 30 .. 30L+29, that is L seconds, 30L frames)
#   out  = xfade(body, head, duration 1, offset L-1)
# xfade shows body alone for its first L-1 seconds, then body's last second dissolving into head,
# so out is L + 1 - 1 = L seconds, 30L frames. Its last frame is 29/30 head frame 29 and 1/30 of
# body's last frame; its first frame is body frame 0, which is base frame 30, the very frame the
# clip itself puts after frame 29. So frame 30L-1 flows into frame 0, and no frame is shown twice.
# The blurred copy is cut from the finished sharp file, so it has the same seam and length.

set -eu

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../tv-home/web/loop"
SECONDS_LEN=30
SLOW=1
ONLY=""
DRY=0
INPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --seconds) SECONDS_LEN="$2"; shift 2 ;;
    --slow) SLOW="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage ;;
    -*) echo "make-loop.sh: unknown option $1" >&2; usage ;;
    *) if [ -n "$INPUT" ]; then echo "make-loop.sh: one input clip only" >&2; usage; fi; INPUT="$1"; shift ;;
  esac
done

[ -n "$INPUT" ] || usage
case "$SECONDS_LEN" in
  ''|*[!0-9]*) echo "make-loop.sh: --seconds must be a whole number from 15 to 60" >&2; exit 2 ;;
esac
if [ "$SECONDS_LEN" -lt 15 ] || [ "$SECONDS_LEN" -gt 60 ]; then
  echo "make-loop.sh: --seconds must be from 15 to 60" >&2; exit 2
fi
case "$SLOW" in
  ''|*[!0-9.]*|.|*.*.*) echo "make-loop.sh: --slow must be a number, for example 1 or 2" >&2; exit 2 ;;
esac
# 0 passes the pattern: it would put every frame at timestamp 0 (setpts=0*PTS)
awk -v f="$SLOW" 'BEGIN { exit !(f > 0) }' || { echo "make-loop.sh: --slow must be more than 0" >&2; exit 2; }
VARIANTS="dawn day dusk night"
if [ -n "$ONLY" ]; then
  case " $VARIANTS " in
    *" $ONLY "*) VARIANTS="$ONLY" ;;
    *) echo "make-loop.sh: --only takes dawn, day, dusk or night" >&2; exit 2 ;;
  esac
fi

# The grade for each variant, a filter chain or "null" for the clip as it is.
grade() {
  case "$1" in
    day)   echo "null" ;;
    dawn)  echo "colorbalance=rh=0.12:bh=-0.08:bs=0.06" ;;
    dusk)  echo "colorbalance=rm=0.14:bm=-0.10,eq=brightness=-0.05" ;;
    night) echo "curves=master='0/0 0.5/0.36 1/0.82',eq=saturation=0.55,colorbalance=bs=0.16" ;;
  esac
}

# The seam arithmetic from the header, as numbers.
BASE_LEN=$((SECONDS_LEN + 1))      # seconds of the clip used
BODY_START=1                       # the body begins one second in
BODY_LEN=$SECONDS_LEN              # the body is the whole loop long
XFADE_OFFSET=$((SECONDS_LEN - 1))  # the dissolve fills the body's last second

# Print a command the way a shell would take it (an argument with spaces or filter punctuation in
# single quotes), and run it unless this is a dry run.
shq() {
  case "$1" in
    *[!A-Za-z0-9_./:=+@%-]*|'') printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")" ;;
    *) printf '%s' "$1" ;;
  esac
}
run() {
  local a line=""
  for a in "$@"; do line="$line$(shq "$a") "; done
  printf '%s\n' "${line% }"
  if [ "$DRY" -eq 0 ]; then "$@"; fi
}

if [ "$DRY" -eq 0 ]; then
  command -v ffmpeg >/dev/null 2>&1 || { echo "make-loop.sh: ffmpeg is not installed (Debian: sudo apt install ffmpeg)" >&2; exit 1; }
  [ -f "$INPUT" ] || { echo "make-loop.sh: no such clip: $INPUT" >&2; exit 1; }
  if command -v ffprobe >/dev/null 2>&1; then
    DUR=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$INPUT" 2>/dev/null || echo 0)
    NEED=$(awk -v s="$SECONDS_LEN" -v f="$SLOW" 'BEGIN { printf "%.2f", (s + 1) / f }')
    if awk -v d="$DUR" -v n="$NEED" 'BEGIN { exit !(d + 0 < n + 0) }'; then
      echo "make-loop.sh: the clip is ${DUR}s long and a ${SECONDS_LEN}s loop at --slow $SLOW needs ${NEED}s" >&2; exit 1
    fi
  fi
  mkdir -p "$OUT"
else
  echo "# dry run: nothing is written. Output folder: $OUT"
fi

for v in $VARIANTS; do
  sharp="$OUT/$v.mp4"
  blur="$OUT/$v-blur.mp4"
  # The sharp file. One graph: the clip slowed, conformed to 1280x720 at 30 fps (scaled to cover,
  # then cropped, so a 4K or a 16:10 clip fills the frame), the grade, the first L+1 seconds split
  # into body and head, and the two dissolved as the header says.
  graph="[0:v]setpts=${SLOW}*PTS,fps=30,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p,$(grade "$v"),trim=duration=${BASE_LEN},setpts=PTS-STARTPTS,split=2[c0][c1];"
  # xfade wants both inputs at a constant frame rate and a trim leaves them marked variable, so fps=30 again on each
  graph="$graph[c0]trim=start=${BODY_START}:duration=${BODY_LEN},setpts=PTS-STARTPTS,fps=30[body];"
  graph="$graph[c1]trim=duration=1,setpts=PTS-STARTPTS,fps=30[head];"
  graph="$graph[body][head]xfade=transition=fade:duration=1:offset=${XFADE_OFFSET}[out]"
  # -keyint_min and -sc_threshold hold the GOP at exactly 30 frames: x264 would otherwise put an
  # extra keyframe wherever it sees a cut, and the home's seek at the wrap counts on one second.
  run ffmpeg -hide_banner -y -i "$INPUT" -filter_complex "$graph" -map "[out]" \
    -c:v libx264 -profile:v main -level 4.0 -pix_fmt yuv420p -preset slow -crf 20 \
    -maxrate 4M -bufsize 8M -r 30 -g 30 -keyint_min 30 -sc_threshold 0 -an -movflags +faststart "$sharp"
  # The glass copy, from the finished sharp file: the same seam, the same length, a tenth of the
  # frames (measured on a Fire TV Cube: the blurred element dropped most of its frames anyway, and
  # behind a blur that does not show). GOP 10 is one second, the same seek grain as the sharp file.
  run ffmpeg -hide_banner -y -i "$sharp" -vf "scale=160:90,gblur=sigma=2,fps=10" \
    -c:v libx264 -profile:v main -level 4.0 -pix_fmt yuv420p -preset slow -crf 26 \
    -maxrate 300k -bufsize 600k -r 10 -g 10 -keyint_min 10 -sc_threshold 0 -an -movflags +faststart "$blur"
  # The posters: the first frame of each, 960x540 JPEG (the home shows them until the video plays,
  # and the offline copy of the home has nothing else).
  run ffmpeg -hide_banner -y -i "$sharp" -frames:v 1 -vf "scale=960:540" -q:v 3 "$OUT/$v.jpg"
  run ffmpeg -hide_banner -y -i "$blur" -frames:v 1 -vf "scale=960:540:flags=lanczos" -q:v 3 "$OUT/$v-blur.jpg"
done

if [ "$DRY" -eq 0 ]; then
  echo "done: $(ls "$OUT" | wc -l | tr -d ' ') files in $OUT. Restart the bridge so it sees them, then pick the Loop look."
fi
