FROM python:3.11-slim
WORKDIR /app

# Install build deps for librdkafka (used by confluent-kafka)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    librdkafka-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY alembic.ini ./alembic.ini
COPY alembic ./alembic
COPY scripts ./scripts
COPY templates ./templates

# run alembic migrations on container start then start uvicorn
CMD alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000
