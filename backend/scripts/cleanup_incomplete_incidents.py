"""Cleanup incomplete/old incidents.

Deletes medical incidents older than a threshold that don't have required UI fields
(populated patient_name, patient_contact and address).

Run inside backend container or virtualenv:
    python -m scripts.cleanup_incomplete_incidents
"""
from datetime import datetime, timedelta
from app.db import SessionLocal
from app.models import Incident

# Threshold: incidents older than this are considered "old" (default 1 hour)
THRESHOLD_MINUTES = 60

REQUIRED_FIELDS = ['patient_name', 'patient_contact', 'address']


def cleanup(threshold_minutes=THRESHOLD_MINUTES):
    db = SessionLocal()
    cutoff = datetime.utcnow() - timedelta(minutes=threshold_minutes)
    try:
        # Find incidents that are medical, older than cutoff, and missing any required field
        q = db.query(Incident).filter(Incident.type == 'medical', Incident.received_at < cutoff)
        candidates = q.all()
        to_delete = []
        for inc in candidates:
            missing = any(getattr(inc, f) in (None, '') for f in REQUIRED_FIELDS)
            if missing:
                to_delete.append(inc)

        if not to_delete:
            print('No incomplete old medical incidents found to delete')
            return

        ids = [inc.id for inc in to_delete]
        print(f'Deleting {len(ids)} incomplete incidents:', ids)
        for inc in to_delete:
            db.delete(inc)
        db.commit()
        print('Deletion complete')
    except Exception as e:
        db.rollback()
        print('Cleanup failed', e)
    finally:
        db.close()


if __name__ == '__main__':
    cleanup()
