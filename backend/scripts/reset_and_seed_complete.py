"""Wipe incidents/ambulances and reseed with only complete demo data.

Use cautiously. This will DELETE all incidents and ambulances, then add a clean set of demo
incidents where required UI fields are present.

Run inside backend container or venv:
    python -m scripts.reset_and_seed_complete
"""
from app.db import SessionLocal
from app.models import Incident, Ambulance
from scripts import seed_demo_data as seeder
from datetime import datetime


def wipe_db():
    db = SessionLocal()
    try:
        # delete ambulances then incidents
        n1 = db.query(Ambulance).delete()
        n2 = db.query(Incident).delete()
        db.commit()
        print(f'Deleted {n1} ambulances and {n2} incidents')
    except Exception as e:
        db.rollback()
        print('Wipe failed', e)
    finally:
        db.close()


def reseed():
    print('Seeding fresh complete demo data...')
    # call the seeder's seed() function with defaults that create complete incidents
    try:
        # default seed() already creates full-record incidents for both medical and fire in our repo
        seeder.seed(num_medical=30, num_fire=20, num_units=30)
        print('Reseed complete')
    except Exception as e:
        print('Reseed failed', e)


if __name__ == '__main__':
    print('Reset started at', datetime.utcnow().isoformat())
    wipe_db()
    reseed()
    print('Reset finished at', datetime.utcnow().isoformat())
