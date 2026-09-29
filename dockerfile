FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Install packet capture tools
RUN apk add --no-cache \
    tcpdump \
    net-tools \
    iproute2 \
    procps

EXPOSE 3000 8080 8081

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/status', (r) => {if(r.statusCode!==200)process.exit(1)}).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]