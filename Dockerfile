FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
# the data volume holds the password hash; owned by the app user so a fresh volume inherits it
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=8300 DATA_DIR=/data PUBLIC_URL=https://webinars.redcloudfs.com
USER node
EXPOSE 8300
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8300/health >/dev/null || exit 1
CMD ["node", "src/server.mjs"]
