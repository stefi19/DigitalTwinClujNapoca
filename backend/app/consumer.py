import os
import json
import asyncio
from typing import List
from paho.mqtt import client as mqtt_client
from datetime import datetime

from confluent_kafka import Producer
from .db import SessionLocal
from .models import Incident as IncidentModel
from .broadcast import broadcaster
from .utils import enrich_incident

# simple in-memory store for incidents (kept for backward compatibility)
incidents_store: List[dict] = []

MQTT_BROKER = os.getenv("MQTT_BROKER", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_TOPIC = os.getenv("MQTT_TOPIC", "dern/incidents")
KAFKA_BROKER = os.getenv("KAFKA_BROKER", "kafka:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC", "dern_incidents")

# create a module-level Kafka producer to reuse and allow flushing on shutdown
_producer = None
try:
    _producer = Producer({"bootstrap.servers": KAFKA_BROKER})
except Exception as e:
    print("Warning: could not create Kafka producer at import time", e)


def on_connect(client, userdata, flags, rc):
    print("MQTT connected with result code", rc)
    client.subscribe(MQTT_TOPIC)


def produce_to_kafka(payload_str: str):
    """Produce a string payload to Kafka using a shared producer instance.

    We avoid creating a new Producer per-message to reduce librdkafka 'terminating with
    X messages' log noise. The producer is polled briefly to serve delivery callbacks.
    """
    global _producer
    if _producer is None:
        try:
            _producer = Producer({"bootstrap.servers": KAFKA_BROKER})
        except Exception as e:
            print("Failed to create Kafka producer", e)
            return
    try:
        _producer.produce(KAFKA_TOPIC, payload_str)
        # serve delivery reports (non-blocking)
        _producer.poll(0)
    except Exception as e:
        print("Failed to produce to Kafka", e)


def flush_kafka(timeout: float = 5.0):
    """Flush outstanding messages on the shared producer. Safe to call on shutdown."""
    global _producer
    if _producer is None:
        return
    try:
        _producer.flush(timeout)
    except Exception as e:
        print("Error flushing Kafka producer", e)


def on_message(client, userdata, msg):
    try:
        payload = msg.payload.decode()
        data = json.loads(payload)
        # enrich incoming incident so UI has required fields
        data = enrich_incident(data)
        print("Received incident", data)

        # persist to DB
        try:
            db = SessionLocal()
            inc = IncidentModel(
                id=data.get("id"),
                type=data.get("type"),
                lat=float(data.get("lat") or 0),
                lon=float(data.get("lon") or 0),
                severity=int(data.get("severity") or 1),
                status=data.get("status", "new"),
                notes=data.get("notes"),
                patient_name=data.get("patient_name"),
                patient_age=data.get("patient_age"),
                patient_contact=data.get("patient_contact"),
                address=data.get("address"),
                contact=data.get("contact"),
                sensor_id=data.get("sensor_id"),
                sensor_type=data.get("sensor_type"),
                received_at=datetime.fromisoformat(data.get("received_at")),
                updated_at=datetime.utcnow()
            )
            db.add(inc)
            db.commit()
            # Get the persisted incident with all fields
            data = inc.to_dict()
            db.close()
        except Exception as e:
            print("DB write failed", e)

        # append to in-memory store
        incidents_store.insert(0, data)

        # produce to kafka for downstream processing
        try:
            produce_to_kafka(json.dumps(data))
        except Exception as e:
            print("Kafka produce failed", e)

        # broadcast to SSE subscribers
        try:
            broadcaster.publish(data)
        except Exception as e:
            print("Broadcast failed", e)

    except Exception as e:
        print("Failed to handle message", e)


async def start_mqtt_listener():
    loop = asyncio.get_event_loop()
    client = mqtt_client.Client()
    client.on_connect = on_connect
    client.on_message = on_message

    client.connect(MQTT_BROKER, MQTT_PORT)

    # run network loop in executor to not block asyncio
    await loop.run_in_executor(None, client.loop_forever)
