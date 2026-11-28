# The couch-tv bridge as a Home Assistant app. Build it from the REPO ROOT (the app folder alone
# cannot build, so the app installs only from the prebuilt images .github/workflows/ha-app.yml pushes):
#   docker buildx build -f homeassistant/couch_tv/Dockerfile -t couch-tv-app .
# No Node, no Claude Code and no LG ares tools in the final image: LG TVs are not in the app yet.

# Stage 1: the phone remote (remote/dist), built the way scripts/build-apk.sh does.
FROM node:20-bookworm-slim AS remote
# (remote/src imports ../../tv-home/web/clearicon.js, so that folder sits beside it.)
WORKDIR /repo/remote
COPY remote/ ./
COPY tv-home/web/ ../tv-home/web/
RUN npm ci --no-audit --no-fund --loglevel=error && npm run build --silent

# Stage 2: Python, the bridge's packages and the files the bridge serves. The folder layout is the
# repo's own (/app/bridge, /app/remote/dist, ...), so the bridge finds everything where it expects.
FROM python:3.12-slim-bookworm
ARG BUILD_VERSION=0.13.17
ARG BUILD_ARCH=amd64
LABEL io.hass.type="addon" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.arch="${BUILD_ARCH}" \
      org.opencontainers.image.source="https://github.com/Seagey/couch-tv" \
      org.opencontainers.image.description="couch-tv bridge as a Home Assistant app"
COPY bridge/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt
WORKDIR /app
COPY bridge/ bridge/
COPY tv-home/web/ tv-home/web/
COPY on-tv/web/ on-tv/web/
COPY titan/ titan/
COPY lg/app/largeIcon.png lg/app/largeIcon.png
COPY config.example.json ./
COPY --from=remote /repo/remote/dist remote/dist
COPY homeassistant/couch_tv/run.sh /run.sh
RUN chmod 755 /run.sh
CMD ["/run.sh"]
