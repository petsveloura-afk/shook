# ============================================================
#  Pashpashuk Bot — Hugging Face Spaces (Docker SDK) / Railway
#  ריצה מתמדת 24/7 בחינם, ללא כרטיס אשראי.
# ============================================================
FROM node:20-alpine

ENV NODE_ENV=production \
    MODE=polling \
    PORT=7860

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# Hugging Face Spaces מריץ כמשתמש לא-root ומצפה לפורט 7860
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app

EXPOSE 7860

CMD ["node", "src/index.js"]
