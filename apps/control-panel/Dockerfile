FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build          # builds the PWA to web/dist
EXPOSE 8088
CMD ["npm", "start"]       # tsx runs the BFF, which serves web/dist + proxies HA
