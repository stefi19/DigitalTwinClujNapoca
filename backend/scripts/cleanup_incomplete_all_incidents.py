"""Delete all incidents that are missing required UI fields.

This script will remove any medical incident missing patient_name, patient_contact or address,
and any fire incident missing sensor_id, sensor_type, contact or address/coords.

Use cautiously. Run inside backend container or virtualenv:
    python -m scripts.cleanup_incomplete_all_incidents
"""
from app.db import SessionLocal
from app.models import Incident

REQUIRED_MED = ['patient_name', 'patient_contact', 'address']
REQUIRED_FIRE = ['sensor_id', 'sensor_type', 'contact']


def is_missing_med(inc):
    return any(getattr(inc, f) in (None, '') for f in REQUIRED_MED)


def is_missing_fire(inc):
    # location accepted if address or lat/lon present
    loc_ok = bool(inc.address) or (inc.lat is not None and inc.lon is not None)
    missing_fields = any(getattr(inc, f) in (None, '') for f in REQUIRED_FIRE)
    return missing_fields or (not loc_ok)


def cleanup_all():
    db = SessionLocal()
    try:
        all_inc = db.query(Incident).all()
        to_delete = []
        for inc in all_inc:
            try:
                if inc.type == 'medical' and is_missing_med(inc):
                    to_delete.append(inc)
                elif inc.type == 'fire' and is_missing_fire(inc):
                    to_delete.append(inc)
            except Exception:
                # conservative: skip problematic rows
                continue

        if not to_delete:
            print('No incomplete incidents found')
            return

        ids = [i.id for i in to_delete]
        print(f'Deleting {len(ids)} incomplete incidents:')
        print(ids)
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
    cleanup_all()
