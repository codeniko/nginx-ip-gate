# syntax=docker/dockerfile:1
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /opt/nginx-ip-gate

COPY package.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "index.js"]
