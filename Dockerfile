FROM node:20-slim

# Dependencias de Puppeteer (Chrome headless)
# Nota: python3/pip y notebooklm-py se eliminaron junto con la integracion
# NotebookLM (ver AI_CHANGELOG 08/06/2026) — imagen mas liviana y build mas rapido.
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=7860

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/

# Crear carpeta de auth y dar permisos para compatibilidad con el usuario no-root de Hugging Face
RUN mkdir -p /app/.wwebjs_auth && chmod -R 777 /app

CMD ["node", "src/launcher.js"]
