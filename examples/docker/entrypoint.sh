#!/bin/sh
# For an LG: give LG's ares tools the TV's Developer Mode key, then start the bridge.
# Other TVs need none of this; leave TV_IP unset and the bridge just starts.
# Based on a setup by ChrisFWCB (issue #56).
set -e
ARES_DEVICE="${ARES_DEVICE:-lounge}"
KEY="/app/lg-key/${ARES_DEVICE}_webos"
if [ -n "$TV_IP" ]; then
  mkdir -p /root/.ssh
  if [ -f "$KEY" ]; then
    cp "$KEY" "/root/.ssh/${ARES_DEVICE}_webos"
    chmod 600 "/root/.ssh/${ARES_DEVICE}_webos"
  else
    echo "no Developer Mode key at $KEY (see docs/LG.md, step 2)"
  fi
  if ! ares-setup-device -l 2>/dev/null | grep -q "^${ARES_DEVICE} "; then
    ares-setup-device -a "$ARES_DEVICE" -i "username=prisoner" -i "host=${TV_IP}" -i "port=9922" \
      -i "privatekey=${ARES_DEVICE}_webos" -i "passphrase=${LG_PASSPHRASE}" >/dev/null \
      || echo "ares-setup-device failed"
  fi
fi
exec /venv/bin/python /app/bridge/server.py
