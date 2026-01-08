"""Backfill missing fire incident fields used by the UI.

Fills sensor_id, sensor_type, address, contact, notes and severity for fire incidents
that are missing these fields. Run inside the backend container or in the project's venv:

    python -m scripts.backfill_fire_incidents

This is safe to run multiple times; it only updates incidents where fields are empty.
"""
from datetime import datetime
import random
from app.db import SessionLocal
from app.models import Incident

ADDRESSES = [
    'Strada Memorandum 12, Cluj-Napoca',
    'Bd. 21 Decembrie 1989 45, Cluj-Napoca',
    'Str. Napoca 3, Cluj-Napoca',
    'Str. Observator 7, Cluj-Napoca',
]

SENSOR_TYPES = ['Smoke + Temperature', 'Heat', 'CO + Smoke', 'Optical Smoke', 'Multi-sensor']

PHONES = [
    lambda: f"+40{random.randint(700000000,799999999)}",
    lambda: f"+40{random.randint(720000000,729999999)}",
]


def backfill():
    db = SessionLocal()
    try:
        q = db.query(Incident).filter(Incident.type == 'fire')
        candidates = q.all()
        updated = 0
        for inc in candidates:
            changed = False
            if not inc.sensor_id:
                inc.sensor_id = f"F-{random.randint(200,999)}"
                changed = True
            if not inc.sensor_type:
                inc.sensor_type = random.choice(SENSOR_TYPES)
                changed = True
            if not inc.address:
                inc.address = random.choice(ADDRESSES)
                changed = True
            if not inc.contact:
                inc.contact = random.choice(PHONES)()
                changed = True
            if not inc.notes:
                inc.notes = 'Auto-backfilled fire alert (synthetic)'
                changed = True
            if not inc.severity:
                inc.severity = random.randint(2,5)
                changed = True
            if not inc.received_at:
                inc.received_at = datetime.utcnow()
                changed = True
            if changed:
                inc.updated_at = datetime.utcnow()
                updated += 1
                db.add(inc)
        if updated:
            db.commit()
        print(f'Backfill complete, updated {updated} fire incidents')
    except Exception as e:
        db.rollback()
        print('Backfill failed', e)
    finally:
        db.close()


if __name__ == '__main__':
    backfill()
