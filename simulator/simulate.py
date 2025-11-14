import os
import time
import json
import random
from paho.mqtt import client as mqtt_client

MQTT_BROKER = os.getenv("MQTT_BROKER", "mosquitto")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
TOPIC = os.getenv("MQTT_TOPIC", "dern/incidents")

client = mqtt_client.Client()
client.connect(MQTT_BROKER, MQTT_PORT)

def random_incident(i):
    # centered around Cluj-Napoca coords (example)
    lat = 46.7667 + random.uniform(-0.02, 0.02)
    lon = 23.6 + random.uniform(-0.03, 0.03)
    return {
        "id": f"inc_{int(time.time())}_{i}",
        "type": random.choice(["medical", "fire", "police"]),
        "lat": lat,
        "lon": lon,
        "severity": random.randint(1, 5)
    }

def main():
    i = 0
    while True:
        inc = random_incident(i)
        payload = json.dumps(inc)
        print("Publishing", payload)
        client.publish(TOPIC, payload)
        i += 1
        time.sleep(3)

if __name__ == '__main__':
    main()
