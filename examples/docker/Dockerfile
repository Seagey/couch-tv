# couch-tv bridge in Docker, for a NAS or any other always-on Docker host (x86_64 or arm64).
# The repo is mounted at /app, so the image only carries Python, the bridge's packages and LG's
# ares tools (used by LG TVs for the daily Developer Mode Extend). Build it from the repo root:
#   docker compose -f examples/docker/compose.yaml up -d --build
# Based on a setup by ChrisFWCB (issue #56).
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv openssh-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g @webos-tools/cli@3.2.6
COPY bridge/requirements.txt /tmp/requirements.txt
RUN python3 -m venv /venv && /venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt
COPY examples/docker/entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
WORKDIR /app
ENTRYPOINT ["/entrypoint.sh"]
