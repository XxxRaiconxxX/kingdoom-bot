FROM node:20-slim

# Dependencias de Puppeteer (Chrome headless)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    python3 \
    python3-pip \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Instalar notebooklm-py para el Game Master
RUN pip3 install notebooklm-py --break-system-packages

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=7860

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY src/ ./src/

# Crear carpeta de auth y dar permisos para compatibilidad con el usuario no-root de Hugging Face
RUN mkdir -p /app/.wwebjs_auth && chmod -R 777 /app

CMD ["node", "src/index.js"]
