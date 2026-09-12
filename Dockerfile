FROM node:22-slim

WORKDIR /app

# Salin file dependensi
COPY package*.json tsconfig.json ./

# Pasang seluruh dependensi termasuk dev untuk build (deterministik via npm ci)
RUN npm ci

# Salin kode sumber
COPY src ./src
COPY sql ./sql

# Build aplikasi TypeScript
RUN npm run build

# Port opsional jika dibutuhkan
EXPOSE 7860

# Jalankan WhatsApp bot 24 jam nonstop
CMD ["node", "dist/whatsapp_baileys.js"]
