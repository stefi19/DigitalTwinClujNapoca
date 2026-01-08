import random
from datetime import datetime

FIRST_NAMES = ['Maria','Ioan','Elena','Andrei','Ana','Mihai','Gabriela','Cristian','Oana','Radu']
LAST_NAMES = ['Popescu','Ionescu','Georgescu','Dumitru','Paun','Marinescu','Stan','Tudor']
ADDRESSES = [
    'Strada Memorandum 12, Cluj-Napoca',
    'Bd. 21 Decembrie 1989 45, Cluj-Napoca',
    'Str. Napoca 3, Cluj-Napoca',
    'Str. Observator 7, Cluj-Napoca'
]

def random_patient():
    name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
    age = random.randint(1, 95)
    contact = f"+40{random.randint(700000000,799999999)}"
    return name, age, contact


def enrich_incident(data: dict) -> dict:
    """Fill common missing UI fields for incoming incidents so frontends always see
    patient/contact/sensor/address where sensible.
    This mutates and returns the same dict.
    """
    if not isinstance(data, dict):
        return data
    now = datetime.utcnow().isoformat()
    data.setdefault('received_at', now)
    data.setdefault('status', data.get('status', 'new'))

    typ = (data.get('type') or '').lower()
    if typ == 'medical':
        if not data.get('patient_name'):
            name, age, contact = random_patient()
            data['patient_name'] = name
            data['patient_age'] = data.get('patient_age') or age
            data['patient_contact'] = data.get('patient_contact') or contact
        # ensure a contact field for UI convenience
        data['contact'] = data.get('contact') or data.get('patient_contact')
        data['address'] = data.get('address') or random.choice(ADDRESSES)
        if not data.get('notes'):
            data['notes'] = 'Auto-enriched medical incident (server)'

    if typ == 'fire':
        if not data.get('sensor_id'):
            data['sensor_id'] = f"F-{random.randint(200,999)}"
        if not data.get('sensor_type'):
            data['sensor_type'] = random.choice(['Smoke + Temperature', 'Heat', 'CO + Smoke'])
        data['contact'] = data.get('contact') or f"+40{random.randint(700000000,799999999)}"
        data['address'] = data.get('address') or random.choice(ADDRESSES)
        if not data.get('notes'):
            data['notes'] = 'Auto-enriched fire incident (server)'

    return data
