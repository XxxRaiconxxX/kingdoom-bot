FROM node:20-slim

# Dependencias de Puppeteer (Chrome headless)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY src/ ./src/

# Crear carpeta de auth y dar permisos para compatibilidad con el usuario no-root de Hugging Face
RUN mkdir -p /app/.wwebjs_auth && chmod -R 777 /app

CMD ["node", "src/index.js"]
