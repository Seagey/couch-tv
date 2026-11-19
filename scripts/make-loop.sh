#!/bin/bash
# Make the Loop look's footage: one clip graded for four times of day, looping without a seam,
# with a tiny blurred copy of each for the glass and a poster of each (docs/LOOP.md).
#
#   scripts/make-loop.sh <input clip or photo> [--out <dir>] [--seconds <15 to 60>] [--slow <factor>]
#                        [--only <dawn|day|dusk|night>] [--still] [--matte <image with alpha>] [--dry-run]
#
#   --out      where the files go. Default tv-home/web/loop in this repo (git ignores it; the bridge
#              serves it at /tv/loop/ and lists it afresh on every read, so no restart afterwards).
#              Each run makes its files in a hidden folder inside it (.staging-<process id>, every
#              name in it starting with a dot, so neither the bridge nor the offline copy lists them)
#              and moves them into place only when every encode has worked, loop.json last. A run
#              that fails or is stopped removes that folder and leaves the files as they were.
#   --seconds  how long the loop is, 15 to 60, default 30. The clip must be at least one second
#              longer than that, divided by --slow (a 31 s loop at --slow 2 needs a 15.5 s clip).
#   --slow     slow the clip down: 2 plays a 60 fps clip at half speed, 1 (default) leaves it.
#   --only     make one variant instead of all four. loop.json is one file for all four, so this is
#              refused when the folder's loop.json says something else (another --seconds, --matte or
#              not, a clip instead of a photo): remake all four then.
#   --still    the input is a photo (a .jpg, .png or .webp is taken as one anyway): the loop is a slow
#              push into the picture and back out over its whole length, 6 percent at most, swaying a
#              little sideways, which starts and ends on the same frame, so it needs no seam.
#              A photo that is not 16:9 (a phone's 4:3, a portrait) is cut to its centre 16:9 band.
#              The home's own scenes work: tv-home/web/backgrounds/scene-night@2x.jpg is the lake peak
#              the design mockup used. Use the @2x file: the push crops into it. --slow is ignored.
#   --matte    a photo only: a copy of the photo, aligned with it and of the same shape (it is cut to
#              the same centre 16:9 band), that is transparent where the sky is
#              (tv-home/web/backgrounds/scene-night-fg@2x.webp for the lake peak). Each variant then gets
#              <variant>-fg.png, the part of the first frame in front of the sky around the clock, which
#              the home draws over the clock and moves with the push, so the clock sits behind the peak.
#   --dry-run  print every ffmpeg command and the loop.json it would write, and write nothing.
#
# Runs on the bridge computer with ffmpeg 7 (Debian: apt install ffmpeg). Per variant it writes
#   <variant>.mp4       1280x720, H.264 main level 4.0, yuv420p, 30 fps, GOP 30, crf 20, 4 Mbps cap
#   <variant>-blur.mp4  160x90, gblur sigma 2, 10 fps, crf 26, 300 kbps cap (the glass copy)
#   <variant>.jpg       960x540 poster, the first frame of the sharp file
#   <variant>-blur.jpg  960x540 poster, the first frame of the blurred file
#   <variant>-fg.png    with --matte: 640x212 RGBA, the cut-out over the clock (below, "The depth cut-out")
# and once, loop.json: the loop's length and motion for the home, which moves the cut-out with it:
#   {"still": true, "seconds": L, "fps": 30, "zoom": 0.06, "sway": 0.3, "fg": {"x": 480, "y": 162, "w": 960, "h": 318}}
#   (fg null without --matte; a clip is {"still": false, "seconds": L, "fps": 30, "zoom": 0, "sway": 0, "fg": null})
#
# Colour. Every encode is converted to and tagged as BT.709, limited range (the HD standard), so the
# TV's decoder and ffmpeg turn the same YUV into the same RGB. Untagged, a decoder guesses, and a guess
# of BT.601 shifts the colours by a few levels, which would show as a box around the cut-out. The
# posters are JPEG, which is BT.601 full range by definition, so they are converted to that.
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
#
# The depth cut-out (--matte, a photo only). The photo's loop moves by a formula, so the home can move a
# still cut-out with it. zoompan takes, for output frame on = 0 .. N-1 (N = 30 L), the window of width
# iw/z from
#   z = 1 + ZOOM*(1-cos(2*PI*on/N))/2,  x = (iw-iw/z)/2 * (1 + SWAY*sin(2*PI*on/N)),  y = (ih-ih/z)/2
# that is, centred, then moved sideways by SWAY of the room the zoom leaves on each side. zoompan clamps
# x into 0 .. iw - w, so the motion must never ask for more than that room: a drift in a share of the
# width did, for the first and last 4 s of a 34 s loop, and the video then left the formula by up to
# 2.2 screen pixels (the cut-out showed a doubled edge on the spire). With SWAY at most 1 it cannot.
# zoompan also makes x and y whole pixels (by truncation; even ones for 4:2:0 input) and the window's
# width int(iw/z), so the picture goes in as 4:4:4, each expression adds 0.5 to round, and x and y add
# half of what int() takes off the window, so the whole pixel window is centred on the formula's.
# Simulated over the 1020 frames of a 34 s loop at the cut-out's corners and on the peak, the video
# then stays within 0.43 screen pixels of the formula (it was 2.7 with the clamp and the even rounding).
# Frame 0 has z = 1 and x = 0: the whole picture, the neutral position. The cut-out is taken from it:
#   colour  the finished sharp file's first frame decoded to RGB as BT.709 limited (so its colours are
#           exactly the video's, grade and all), cropped to the screen rectangle FG (x 480, y 162,
#           w 960, h 318 on the 1920x1080 screen; multiples of 3, so on the 1280x720 frame it is
#           x 320, y 108, w 640, h 212 in whole pixels).
#   alpha   the matte scaled to cover 1280x720 and cut to its centre 16:9 band as the photo is, cropped
#           the same way, multiplied by min(1, d/24) with d
#           the distance in 720p pixels from the pixel's centre to the nearest crop edge, so a sub-pixel
#           mismatch at the crop's border fades in over 24 pixels instead of showing as a seam.
#   scrim   the home draws the cut-out above its scrim (two fixed gradients of the ink #0B0A10, in
#           app.css), so the scrim is baked into its colour: out = c*(1-a) + ink*a, with
#           a = 1-(1-top)*(1-bottom), top and bottom the two gradients at the row's screen y. A 720p row
#           Y of the crop covers screen y 1.5*(Y+108) to 1.5*(Y+108)+1.5, so its centre is
#           ys = 1.5*(Y+108) + 0.75.
# geq writes its result into 8 bit by truncation, so each expression adds 0.5 to round.

set -eu

usage() { sed -n '2,/^#   --dry-run/p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../tv-home/web/loop"
SECONDS_LEN=30
SLOW=1
ONLY=""
STILL=0
DRY=0
INPUT=""
MATTE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --seconds) SECONDS_LEN="$2"; shift 2 ;;
    --slow) SLOW="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --still) STILL=1; shift ;;
    --matte) MATTE="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage ;;
    -*) echo "make-loop.sh: unknown option $1" >&2; usage ;;
    *) if [ -n "$INPUT" ]; then echo "make-loop.sh: one input clip only" >&2; usage; fi; INPUT="$1"; shift ;;
  esac
done

[ -n "$INPUT" ] || usage
case "$INPUT" in *.jpg|*.jpeg|*.JPG|*.JPEG|*.png|*.PNG|*.webp|*.WEBP) STILL=1 ;; esac
case "$SECONDS_LEN" in
  ''|*[!0-9]*) echo "make-loop.sh: --seconds must be a whole number from 15 to 60" >&2; exit 2 ;;
esac
# Leading zeros off: bash arithmetic reads 020 as octal (16), while ffmpeg and loop.json would take the
# text as it is, so the seam, the push's period and loop.json would disagree (and "020" is not JSON).
while :; do case "$SECONDS_LEN" in 0?*) SECONDS_LEN="${SECONDS_LEN#0}" ;; *) break ;; esac; done
# more than two digits is out of range anyway, and too many would overflow the test below
if [ "${#SECONDS_LEN}" -gt 2 ] || [ "$SECONDS_LEN" -lt 15 ] || [ "$SECONDS_LEN" -gt 60 ]; then
  echo "make-loop.sh: --seconds must be from 15 to 60" >&2; exit 2
fi
case "$SLOW" in
  ''|*[!0-9.]*|.|*.*.*) echo "make-loop.sh: --slow must be a number, for example 1 or 2" >&2; exit 2 ;;
esac
# 0 passes the pattern: it would put every frame at timestamp 0 (setpts=0*PTS)
awk -v f="$SLOW" 'BEGIN { exit !(f > 0) }' || { echo "make-loop.sh: --slow must be more than 0" >&2; exit 2; }
if [ -n "$MATTE" ] && [ "$STILL" -eq 0 ]; then
  echo "make-loop.sh: --matte is for a photo only: a clip's own motion cannot be followed by a still cut-out" >&2; exit 2
fi
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

# The photo's push, used by zoompan and written into loop.json for the home, from these two numbers
# only, so the two can never differ: the zoom at its deepest (1 + ZOOM at the loop's middle) and the
# sideways sway as a share of the room the zoom leaves on each side (0 to 1, so zoompan never clamps
# it; 0.3 moves the picture at most 11 screen pixels, about what the earlier drift of 0.6 percent of
# the width did).
ZOOM=0.06
SWAY=0.3

# The cut-out's screen rectangle (1920x1080 design pixels, each a multiple of 3) and the same on the
# 1280x720 frame; the feather in 720p pixels; the ink and the scrim's two gradients as app.css draws
# them (percent of 1080: opacity). tests/test_make_loop.py checks these against app.css.
FG_X=480; FG_Y=162; FG_W=960; FG_H=318
FX=$((FG_X * 2 / 3)); FY=$((FG_Y * 2 / 3)); FW=$((FG_W * 2 / 3)); FH=$((FG_H * 2 / 3))
FEATHER=24
INK_R=11; INK_G=10; INK_B=16
SCRIM_TOP="0:0.66 28:0.56 37:0.20 43:0"
SCRIM_BOTTOM="44:0 55:0.55 64:0.74 76:0.84 100:0.84"

# Colour: to BT.709 limited range (scale's conversion) before the encode, and the tags on it. ffmpeg 7
# takes an encode's colour tags from its frames, so -color_primaries and -color_trc below are not
# enough after a filter (they came out "unknown"): setparams writes them on the frames themselves.
TO709="scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv"
TAGS709="-colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv"
# the posters are JPEG: BT.601 full range by definition
POSTER_VF="in_color_matrix=bt709:in_range=tv:out_color_matrix=bt601:out_range=pc,format=yuvj420p"

# A gradient as a geq expression of the screen y in ld(0): piecewise linear through its stops, flat
# before the first and after the last, the way a CSS linear-gradient is.
ramp() {
  printf '%s\n' "$1" | awk '{
    n = split($0, s, " ")
    for (i = 1; i <= n; i++) { split(s[i], kv, ":"); p[i] = kv[1] * 10.8; v[i] = kv[2] + 0 }
    e = sprintf("%g", v[n])
    for (i = n - 1; i >= 1; i--)
      e = sprintf("if(lt(ld(0),%g),%g+(%g)*(ld(0)-%g)/%g,%s)", p[i + 1], v[i], v[i + 1] - v[i], p[i], p[i + 1] - p[i], e)
    printf "if(lt(ld(0),%g),%g,%s)\n", p[1], v[1], e
  }'
}
# one colour channel of the cut-out with the scrim baked in: ld(0) the row's screen y, ld(3) the
# scrim's opacity there, then c*(1-a) + ink*a, rounded
scrim_channel() {
  echo "st(0,(Y+${FY})*1.5+0.75);st(1,$(ramp "$SCRIM_TOP"));st(2,$(ramp "$SCRIM_BOTTOM"));st(3,1-(1-ld(1))*(1-ld(2)));$1(X,Y)*(1-ld(3))+$2*ld(3)+0.5"
}

if [ "$STILL" -eq 1 ]; then
  if [ -n "$MATTE" ]; then FG_JSON="{\"x\": $FG_X, \"y\": $FG_Y, \"w\": $FG_W, \"h\": $FG_H}"; else FG_JSON="null"; fi
  LOOP_JSON="{\"still\": true, \"seconds\": $SECONDS_LEN, \"fps\": 30, \"zoom\": $ZOOM, \"sway\": $SWAY, \"fg\": $FG_JSON}"
else
  LOOP_JSON="{\"still\": false, \"seconds\": $SECONDS_LEN, \"fps\": 30, \"zoom\": 0, \"sway\": 0, \"fg\": null}"
fi
# loop.json is one file for all four variants, and the home moves every variant's cut-out by it. --only
# leaves the other variants' files as they are, so it may not change it: a 20 s loop.json over 34 s
# files would move their cut-outs on the wrong period. (This only reads, so a dry run checks it too.)
if [ -n "$ONLY" ] && [ -f "$OUT/loop.json" ] && [ "$(cat "$OUT/loop.json")" != "$LOOP_JSON" ]; then
  echo "make-loop.sh: --only $ONLY would change loop.json, which the other variants were made with:" >&2
  echo "  now:  $(cat "$OUT/loop.json")" >&2
  echo "  this: $LOOP_JSON" >&2
  echo "Run it again without --only to remake all four, or with the same --seconds and --matte as before." >&2
  exit 2
fi

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
  if [ -n "$MATTE" ]; then
    [ -f "$MATTE" ] || { echo "make-loop.sh: no such matte: $MATTE" >&2; exit 1; }
    if command -v ffprobe >/dev/null 2>&1; then
      PF=$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=nw=1:nk=1 "$MATTE" 2>/dev/null || echo "")
      case "$PF" in
        yuva*|rgba*|bgra*|argb|abgr|gbrap*|ya8|ya16*|pal8) ;;
        *) echo "make-loop.sh: the matte has no transparency (pixel format ${PF:-unknown}): it must be transparent where the sky is" >&2; exit 1 ;;
      esac
    fi
  fi
  if [ "$STILL" -eq 0 ] && command -v ffprobe >/dev/null 2>&1; then
    DUR=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$INPUT" 2>/dev/null || echo 0)
    NEED=$(awk -v s="$SECONDS_LEN" -v f="$SLOW" 'BEGIN { printf "%.2f", (s + 1) / f }')
    if awk -v d="$DUR" -v n="$NEED" 'BEGIN { exit !(d + 0 < n + 0) }'; then
      echo "make-loop.sh: the clip is ${DUR}s long and a ${SECONDS_LEN}s loop at --slow $SLOW needs ${NEED}s" >&2; exit 1
    fi
  fi
  mkdir -p "$OUT"
fi
# Everything is made in a hidden folder inside the output folder (so each move into place is a rename
# on the same disk, which the bridge sees all at once), every name in it starting with a dot, so the
# offline copy of the home, which skips dotfiles, never takes one. Nothing is moved until every encode
# has worked: the bridge lists the folder afresh on every read, and a half-written mp4 (no moov yet), or
# new files with an old loop.json, would otherwise be handed to a TV that loads the home mid-run.
STAGE="$OUT/.staging-$$"
if [ "$DRY" -eq 0 ]; then
  rm -rf "$STAGE"
  mkdir "$STAGE"
  trap 'rm -rf "$STAGE"' EXIT
  trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 129' HUP
else
  echo "# dry run: nothing is written. Output folder: $OUT, made in $STAGE first"
fi

for v in $VARIANTS; do
  sharp="$STAGE/.$v.mp4"
  blur="$STAGE/.$v-blur.mp4"
  # The sharp file. One graph: the clip slowed, conformed to 1280x720 at 30 fps (scaled to cover,
  # then cropped, so a 4K or a 16:10 clip fills the frame), the grade, the first L+1 seconds split
  # into body and head, and the two dissolved as the header says.
  if [ "$STILL" -eq 1 ]; then
    # A photo. The picture is first scaled up to cover four times the output size, so the push moves
    # in quarter pixel steps and does not judder, made 4:4:4, so zoompan places the window to the
    # whole pixel and not to the even one, and cut to its centre 16:9 band (the whole picture when it
    # is 16:9 already; zoompan scales its window to 1280x720 whatever its shape, so a 4:3 or portrait
    # photo would otherwise be squashed). Then zoompan takes one 1280x720 window per frame: the
    # zoom eases from 1 to 1.06 and back over the N = 30 L frames of the loop (a raised cosine, so
    # the first and the last frame are the same window and the motion is still at both), while the
    # window sways sideways inside the room the zoom leaves and back on the same period (the header
    # has the formula and the rounding terms). No seam needed.
    N=$((30 * SECONDS_LEN))
    zx="(iw-iw/zoom)/2*(1+${SWAY}*sin(2*PI*on/${N}))+(iw/zoom-trunc(iw/zoom))/2+0.5"
    zy="(ih-ih/zoom)/2+(ih/zoom-trunc(ih/zoom))/2+0.5"
    graph="[0:v]scale=5120:2880:force_original_aspect_ratio=increase,format=yuv444p,crop=5120:2880,zoompan=z='1+${ZOOM}*(1-cos(2*PI*on/${N}))/2':x='${zx}':y='${zy}':d=1:s=1280x720:fps=30,${TO709},$(grade "$v"),${TO709},trim=duration=${SECONDS_LEN},setpts=PTS-STARTPTS[out]"
    IN_ARGS="-loop 1 -framerate 30 -t ${SECONDS_LEN}"
  else
    graph="[0:v]setpts=${SLOW}*PTS,fps=30,scale=1280:720:force_original_aspect_ratio=increase:out_color_matrix=bt709:out_range=tv,crop=1280:720,format=yuv420p,$(grade "$v"),${TO709},trim=duration=${BASE_LEN},setpts=PTS-STARTPTS,split=2[c0][c1];"
    # xfade wants both inputs at a constant frame rate and a trim leaves them marked variable, so fps=30 again on each
    graph="$graph[c0]trim=start=${BODY_START}:duration=${BODY_LEN},setpts=PTS-STARTPTS,fps=30[body];"
    graph="$graph[c1]trim=duration=1,setpts=PTS-STARTPTS,fps=30[head];"
    graph="$graph[body][head]xfade=transition=fade:duration=1:offset=${XFADE_OFFSET}[out]"
    IN_ARGS=""
  fi
  # -keyint_min and -sc_threshold hold the GOP at exactly 30 frames: x264 would otherwise put an
  # extra keyframe wherever it sees a cut, and the home's seek at the wrap counts on one second.
  # shellcheck disable=SC2086
  run ffmpeg -hide_banner -y $IN_ARGS -i "$INPUT" -filter_complex "$graph" -map "[out]" \
    -c:v libx264 -profile:v main -level 4.0 -pix_fmt yuv420p -preset slow -crf 20 \
    -maxrate 4M -bufsize 8M -r 30 -g 30 -keyint_min 30 -sc_threshold 0 $TAGS709 -an -movflags +faststart "$sharp"
  # The glass copy, from the finished sharp file: the same seam, the same length, a tenth of the
  # frames (measured on a Fire TV Cube: the blurred element dropped most of its frames anyway, and
  # behind a blur that does not show). GOP 10 is one second, the same seek grain as the sharp file.
  run ffmpeg -hide_banner -y -i "$sharp" -vf "scale=160:90,gblur=sigma=2,fps=10" \
    -c:v libx264 -profile:v main -level 4.0 -pix_fmt yuv420p -preset slow -crf 26 \
    -maxrate 300k -bufsize 600k -r 10 -g 10 -keyint_min 10 -sc_threshold 0 $TAGS709 -an -movflags +faststart "$blur"
  # The posters: the first frame of each, 960x540 JPEG (the home shows them until the video plays,
  # and the offline copy of the home has nothing else), converted to JPEG's own BT.601 full range so
  # they show the colours the video does.
  # shellcheck disable=SC2086
  run ffmpeg -hide_banner -y -i "$sharp" -frames:v 1 -vf "scale=960:540:${POSTER_VF}" -q:v 3 "$STAGE/.$v.jpg"
  # shellcheck disable=SC2086
  run ffmpeg -hide_banner -y -i "$blur" -frames:v 1 -vf "scale=960:540:flags=lanczos:${POSTER_VF}" -q:v 3 "$STAGE/.$v-blur.jpg"
  # The depth cut-out (the header has the formulas): the first frame's colour with the scrim baked in,
  # the matte's alpha feathered at the crop edges, merged into one 640x212 RGBA PNG.
  if [ -n "$MATTE" ]; then
    crop="crop=${FW}:${FH}:${FX}:${FY}"
    fgraph="[0:v]trim=end_frame=1,scale=in_color_matrix=bt709:in_range=tv:flags=bicubic+accurate_rnd+full_chroma_int,format=gbrp,${crop},"
    fgraph="${fgraph}geq=r='$(scrim_channel r "$INK_R")':g='$(scrim_channel g "$INK_G")':b='$(scrim_channel b "$INK_B")',format=gbrap[c];"
    # The matte is scaled to cover and cut to its centre 16:9 band as the photo was (at a quarter of the
    # size, so the same place to within half a 720p pixel), so the two stay in register whatever the
    # photo's shape. format=yuva444p right after the scale: without it ffmpeg 7.1 cannot settle a format
    # for alphaextract (seen on the bridge computer: "could not choose their formats: Parsed_alphaextract")
    fgraph="${fgraph}[1:v]scale=1280:720:force_original_aspect_ratio=increase:flags=area,format=yuva444p,crop=1280:720,${crop},alphaextract,"
    fgraph="${fgraph}geq=lum='p(X,Y)*min(1,min(min(X+0.5,W-X-0.5),min(Y+0.5,H-Y-0.5))/${FEATHER})+0.5'[m];"
    fgraph="${fgraph}[c][m]alphamerge,format=rgba[fg]"
    run ffmpeg -hide_banner -y -i "$sharp" -i "$MATTE" -filter_complex "$fgraph" -map "[fg]" -frames:v 1 "$STAGE/.$v-fg.png"
  fi
done

# loop.json: the loop's length and motion, which the home reads (through the bridge) to move the cut-out
if [ "$DRY" -eq 0 ]; then
  printf '%s\n' "$LOOP_JSON" > "$STAGE/.loop.json"
else
  echo "# would write $OUT/loop.json: $LOOP_JSON"
fi

# Every encode has worked: into place. A full run takes the old loop.json away first, so while the files
# change over the home is never handed new files with the old motion (no loop.json: no cut-out, the clock
# stays up). --only keeps it: it was checked above to be the same. Each variant's companions go before
# its .mp4, which is what makes the bridge list the variant at all.
if [ -z "$ONLY" ]; then run rm -f "$OUT/loop.json"; fi
for v in $VARIANTS; do
  run mv -f "$STAGE/.$v-blur.mp4" "$OUT/$v-blur.mp4"
  run mv -f "$STAGE/.$v.jpg" "$OUT/$v.jpg"
  run mv -f "$STAGE/.$v-blur.jpg" "$OUT/$v-blur.jpg"
  if [ -n "$MATTE" ]; then
    run mv -f "$STAGE/.$v-fg.png" "$OUT/$v-fg.png"
  else
    run rm -f "$OUT/$v-fg.png"   # an older run's cut-out would not match this loop
  fi
  run mv -f "$STAGE/.$v.mp4" "$OUT/$v.mp4"
done
run mv -f "$STAGE/.loop.json" "$OUT/loop.json"

if [ "$DRY" -eq 0 ]; then
  rmdir "$STAGE"
  echo "done: $(ls "$OUT" | wc -l | tr -d ' ') files in $OUT. Pick the Loop look, or press Home to reload it: the bridge lists them as they are now."
fi
