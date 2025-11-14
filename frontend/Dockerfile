FROM node:18-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY public ./public
COPY src ./src
ENV CHOKIDAR_USEPOLLING=true
CMD ["npm", "start"]
