FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production PORT=8300
USER node
EXPOSE 8300
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8300/health >/dev/null || exit 1
CMD ["node", "src/server.mjs"]
