import os
import json
import asyncio
from typing import List
from paho.mqtt import client as mqtt_client
from datetime import datetime

# simple in-memory store for incidents
incidents_store: List[dict] = []

MQTT_BROKER = os.getenv("MQTT_BROKER", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_TOPIC = os.getenv("MQTT_TOPIC", "dern/incidents")


def on_connect(client, userdata, flags, rc):
    print("MQTT connected with result code", rc)
    client.subscribe(MQTT_TOPIC)


def on_message(client, userdata, msg):
    try:
        payload = msg.payload.decode()
        data = json.loads(payload)
        data["received_at"] = datetime.utcnow().isoformat()
        print("Received incident", data)
        incidents_store.append(data)
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
