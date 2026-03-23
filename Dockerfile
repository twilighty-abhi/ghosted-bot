FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/
COPY public/ ./public/

# Create logs directory
RUN mkdir -p logs

EXPOSE 3000

CMD ["node", "src/server.js"]
