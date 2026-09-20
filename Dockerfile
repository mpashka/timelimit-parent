# The BFF of the web console. The web console itself is static and is built on the operator's
# machine; this image exists for the one part that has to run — see
# clone timelimit, docs/implementation/web-admin.md, "Устройство службы BFF".
FROM node:24-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json tsconfig*.json /usr/src/app/
COPY src/ /usr/src/app/src/
COPY scripts/ /usr/src/app/scripts/

# The web bundle is built here too and thrown away: `build` makes both, and splitting the script
# to save a second of build time would buy nothing.
RUN npm ci && npm run build && npm prune --omit=dev && rm -rf ./src ./dist/web

# Parent sessions live in a volume, not in the image.
VOLUME /data
ENV TIMELIMIT_BFF_DATABASE=/data/sessions.db
EXPOSE 5181
CMD [ "node", "dist/bff/main.js" ]
