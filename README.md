# Distributed Emergency Response Network (DERN) — Starter Scaffold

This repository contains a minimal scaffold for the Distributed Emergency Response Network described in the project brief. It includes:

- Docker Compose to start: Kafka, Zookeeper, Mosquitto (MQTT), TimescaleDB/Postgres, backend, simulator, and frontend.
- A Python FastAPI backend that listens to MQTT incidents and exposes a simple `/incidents` endpoint.
- A simulator that publishes random incident messages to MQTT.
- A minimal React frontend that uses Mapbox to visualize incidents (placeholder Mapbox token in `.env.example`).

How to run

1. Copy `.env.example` to `.env` and set `MAPBOX_TOKEN` (replace the placeholder):

```bash
cp .env.example .env
# edit .env and add your MAPBOX_TOKEN
```

2. Start the services with Docker Compose:

```bash
docker compose up --build
```

3. Open the frontend at http://localhost:3000 and the backend API at http://localhost:8000/health

Notes
- The backend stores incidents in memory (simple demo). For production, switch to TimescaleDB and create proper schemas and migrations.
- The Mapbox token in `.env.example` is a placeholder — replace with a valid token.
