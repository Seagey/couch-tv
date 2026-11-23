#!/bin/sh
# Makes a 3 minute test video with ffmpeg's testsrc picture (a running time counter in the middle) and a 1 kHz beep every second,
# keyframe every 2 s (so a coarse seek lands visibly away from a frame accurate one). For the
# emulator test player and for a phone camera check. Needs ffmpeg.
#   sync/make-test-video.sh [out.mp4]
set -eu
out="${1:-$(dirname "$0")/build/sync-test.mp4}"
mkdir -p "$(dirname "$out")"
ffmpeg -y -loglevel error \
  -f lavfi -i "testsrc=size=1280x720:rate=30:duration=180" \
  -f lavfi -i "sine=frequency=1000:sample_rate=48000:duration=180" \
  -af "volume='if(lt(mod(t,1),0.05),0.8,0)':eval=frame" \
  -c:v libx264 -preset veryfast -g 60 -keyint_min 60 -sc_threshold 0 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -shortest "$out"
echo "$out"
