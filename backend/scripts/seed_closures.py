"""
Seed the database with Closure records for resolved/closed incidents.

This script will find incidents with status in (resolved, closed, confirmed)
and create a Closure record for each one that doesn't already have one. The
Closure contains a simple summary, a treatment_log (JSON string), disposition,
recommendations and a billing reference. Each Closure.incident_id references
the incident.id so you can join closures -> incidents.

Run inside the backend container:
    docker compose exec backend python -m scripts.seed_closures
"""
from datetime import datetime
import json
import uuid
import os

from app.db import SessionLocal
from app.models import Incident, Closure


def make_treatment_log(inc):
    # Minimal example: construct a few timestamped events based on received_at
    base = inc.received_at.isoformat() if inc.received_at else datetime.utcnow().isoformat()
    events = [
        {'time': base, 'action': 'Alert received', 'details': inc.notes or ''},
        {'time': base, 'action': 'First response', 'details': inc.assigned_to or 'auto'},
        {'time': base, 'action': 'On scene', 'details': 'On-scene actions logged'},
        {'time': base, 'action': 'Disposition', 'details': 'See closure summary'}
    ]
    return json.dumps(events)


def seed_closures():
    db = SessionLocal()
    try:
        rows = db.query(Incident).filter(Incident.status.in_(['resolved', 'closed', 'confirmed'])).all()
        created = 0
        created_medical = 0
        for inc in rows:
            # skip if a closure for this incident already exists
            exists = db.query(Closure).filter(Closure.incident_id == inc.id).first()
            if exists:
                continue

            closure = Closure(
                id=f"clos_{int(datetime.utcnow().timestamp())}_{uuid.uuid4().hex[:6]}",
                incident_id=inc.id,
                created_at=datetime.utcnow(),
                closed_by='auto-seeder',
                summary=f"Auto-generated closure for incident {inc.id}: {inc.type} at {inc.address or f'{inc.lat:.5f},{inc.lon:.5f}'}",
                treatment_log=make_treatment_log(inc),
                disposition=('Admit to Hospital' if (inc.type == 'medical' or (inc.severity and inc.severity >= 3)) else 'Observe / Discharge'),
                recommendations='Follow local protocols. Consider ICU transfer if indicated.',
                billing_ref=f'ER-{inc.id}'
            )
            db.add(closure)
            created += 1
            if inc.type == 'medical':
                created_medical += 1

        db.commit()
        print(f"Seeded {created} closure(s) for {len(rows)} resolved incidents")

        # Ensure at least one medical closure exists. If none were created above,
        # try to find any medical incident (even if not resolved) and create a closure
        # so the Doctor Closure UI has something to display.
        med_count = db.query(Closure).join(Incident, Closure.incident_id == Incident.id).filter(Incident.type == 'medical').count()
        if med_count == 0:
            med = db.query(Incident).filter(Incident.type == 'medical').first()
            if med:
                print('No medical closures found, creating one from a medical incident (status may be non-resolved).')
                try:
                    forced = Closure(
                        id=f"clos_{int(datetime.utcnow().timestamp())}_{uuid.uuid4().hex[:6]}",
                        incident_id=med.id,
                        created_at=datetime.utcnow(),
                        closed_by='auto-seeder-forced-medical',
                        summary=f"Auto-generated medical closure for incident {med.id}: {med.type} at {med.address or f'{med.lat:.5f},{med.lon:.5f}'}",
                        treatment_log=make_treatment_log(med),
                        disposition='Refer to ED',
                        recommendations='Auto-generated: follow triage and admit if necessary',
                        billing_ref=f'ER-{med.id}'
                    )
                    db.add(forced)
                    db.commit()
                    print('Forced medical closure created.')
                except Exception as e:
                    db.rollback()
                    print('Failed to create forced medical closure', e)
    except Exception as e:
        db.rollback()
        print('Failed to seed closures', e)
    finally:
        db.close()


if __name__ == '__main__':
    seed_closures()
