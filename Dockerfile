# Debian (glibc), not Alpine: the graphics renderer ships a glibc binary.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY app ./app
# the data volume: records, artwork, uploads, the sign-in hash, pasted keys
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production PORT=8300 DATA_DIR=/data PUBLIC_URL=https://webinars.redcloudfs.com DISPLAY_TZ=America/Toronto
USER node
EXPOSE 8300
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:8300/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
