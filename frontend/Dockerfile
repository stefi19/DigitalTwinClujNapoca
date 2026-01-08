FROM node:18-alpine
WORKDIR /app

# Allow injecting the Mapbox token at build time. If not provided, the
# frontend will behave the same but maps may be disabled if the token is missing.
ARG REACT_APP_MAPBOX_TOKEN=""
ENV REACT_APP_MAPBOX_TOKEN=${REACT_APP_MAPBOX_TOKEN}

COPY package.json ./
RUN npm install
COPY public ./public
COPY src ./src
ENV CHOKIDAR_USEPOLLING=true
CMD ["npm", "start"]
