#!/usr/bin/env bash
# Build build/lg/app.couchtv.helper_<version>_arm.ipk. Needs Zig 0.14 (ZIG, or zig on the PATH)
# and LG's ares-package. Static musl binaries, the same target Clean Your TV ships on webOS 4 to 26.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
zig="${ZIG:-zig}"
stage="$root/build/lg/helper"
rm -rf "$stage" && mkdir -p "$stage"

cc -o "$root/build/lg/test_filter" "$here/test_filter.c" "$here/filter.c"
"$root/build/lg/test_filter"

for prog in "relay relay.c filter.c" "detach detach.c"; do
  set -- $prog
  out=$1; shift
  (cd "$here" && "$zig" cc -target arm-linux-musleabi -Os -static -s -o "$stage/$out" "$@")
done
cp "$here/helper.js" "$here/appinfo.json" "$here/LICENSE.cytv" "$stage/"
cp "$root/lg/app/icon.png" "$stage/icon.png"
ares-package --outdir "$root/build/lg" "$stage" >/dev/null
ls "$root"/build/lg/app.couchtv.helper_*.ipk
