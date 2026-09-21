# One image, one process: the BFF of the web console plus the sync server it talks to.
#
# The build context is the directory that holds BOTH clones side by side, the way a developer
# checks them out — `docker build -f timelimit-parent/Dockerfile .` one level above this file.
# The layout is not decoration: `npm run build` here checks the generated protocol types against
# ../timelimit-server/docs/schema, so the check runs for real instead of falling back to the
# committed file.
#
# Why one image at all: clone timelimit, docs/implementation/web-admin.md, "Один бинарь".
FROM node:24-alpine

# --- the sync server: an upstream clone, built as its own package, untouched ------------------
WORKDIR /usr/src/timelimit-server
COPY timelimit-server/package.json timelimit-server/package-lock.json timelimit-server/tsconfig.json timelimit-server/eslint.config.mjs timelimit-server/Readme.md ./
COPY timelimit-server/src/ ./src/
COPY timelimit-server/scripts/ ./scripts/
COPY timelimit-server/other/ ./other/
RUN mkdir -p docs/schema && npm install --exclude=optional && npm run build && npm prune --omit=dev && rm -rf ./src

# --- the console: BFF and the web bundle -----------------------------------------------------
WORKDIR /usr/src/timelimit-parent
COPY timelimit-parent/package.json timelimit-parent/package-lock.json timelimit-parent/tsconfig*.json ./
COPY timelimit-parent/src/ ./src/
COPY timelimit-parent/scripts/ ./scripts/
# The web bundle is built here too and thrown away: `build` makes both, and splitting the script
# to save a second of build time would buy nothing.
RUN npm ci && npm run build && npm prune --omit=dev && rm -rf ./src ./dist/web

# Set, so the image runs merged; unset it and the BFF runs alone against TIMELIMIT_SERVER.
ENV TIMELIMIT_SERVER_ENTRY=/usr/src/timelimit-server/build/index.js
# Parent sessions live in a volume, not in the image.
VOLUME /data
ENV TIMELIMIT_BFF_DATABASE=/data/sessions.db
EXPOSE 8080 5181
CMD [ "node", "dist/bff/main.js" ]
