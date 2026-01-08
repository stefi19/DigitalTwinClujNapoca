"""
Force-create a single medical Closure for the first available medical Incident.

Run inside the backend container:
    docker compose exec backend python -m scripts.force_medical_closure

This is a small helper to ensure the frontend Doctor Closure page has at least
one medical closure to display during development.
"""
from datetime import datetime
import json
import uuid

from app.db import SessionLocal
from app.models import Incident, Closure


def run():
    db = SessionLocal()
    try:
        med = db.query(Incident).filter(Incident.type == 'medical').order_by(Incident.received_at.desc()).first()
        if not med:
            print('No medical incidents found; nothing to do.')
            return

        # skip if a closure already exists for this incident
        exists = db.query(Closure).filter(Closure.incident_id == med.id).first()
        if exists:
            print('Medical closure already exists for', med.id)
            return

        closure = Closure(
            id=f"clos_{int(datetime.utcnow().timestamp())}_{uuid.uuid4().hex[:6]}",
            incident_id=med.id,
            created_at=datetime.utcnow(),
            closed_by='force-seeder',
            summary=f"Forced medical closure for incident {med.id}: {med.type} at {med.address or f'{med.lat:.5f},{med.lon:.5f}'}",
            treatment_log=json.dumps([{'time': med.received_at.isoformat() if med.received_at else datetime.utcnow().isoformat(), 'action': 'Auto closure', 'details': 'Forced for UI demo'}]),
            disposition='Refer to ED',
            recommendations='Forced demo closure. Verify details with source incident.',
            billing_ref=f'ER-{med.id}'
        )
        db.add(closure)
        db.commit()
        print('Forced medical closure created for', med.id)
    except Exception as e:
        db.rollback()
        print('Failed to create forced medical closure:', e)
    finally:
        db.close()


if __name__ == '__main__':
    run()
