"""Seed demo incidents and units with rich fields for UI display.

Run from backend container or virtualenv:
    python -m scripts.seed_demo_data
or
    python scripts/seed_demo_data.py
"""
from datetime import datetime, timedelta
import random
import uuid
import json
from app.db import SessionLocal
from app.models import Incident, Ambulance

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


def seed(num_medical=20, num_fire=10, num_units=20):
    db = SessionLocal()
    try:
        center_lat = 46.7712
        center_lon = 23.6236

        def haversine_meters(lat1, lon1, lat2, lon2):
            R = 6371000.0
            import math
            phi1 = math.radians(lat1)
            phi2 = math.radians(lat2)
            dphi = math.radians(lat2 - lat1)
            dlambda = math.radians(lon2 - lon1)
            a = math.sin(dphi/2.0)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2.0)**2
            c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
            return R * c

        # Create medical incidents (rich details)
        for i in range(num_medical):
            lat = center_lat + (random.random() - 0.5) * 0.08
            lon = center_lon + (random.random() - 0.5) * 0.08
            pid = f"med-{int(datetime.utcnow().timestamp())}-{i}-{random.randint(0,999)}"
            pname, page, pcontact = random_patient()

            # sample vitals to show in notes
            vitals = {
                'pulse': random.randint(50,120),
                'bp_sys': random.randint(90,160),
                'bp_dia': random.randint(60,100),
                'spo2': random.randint(85,100),
                'temp_c': round(36.0 + random.random() * 3.0, 1)
            }
            notes = f"Auto-seeded medical incident. Vitals: P={vitals['pulse']} bpm, BP={vitals['bp_sys']}/{vitals['bp_dia']} mmHg, SpO2={vitals['spo2']}%, T={vitals['temp_c']}C"

            # create incident
            inc = Incident(
                id=pid,
                type='medical',
                lat=lat,
                lon=lon,
                severity=random.randint(1,5),
                status='new',
                notes=notes,
                patient_name=pname,
                patient_age=page,
                patient_contact=pcontact,
                sensor_id=None,
                sensor_type=None,
                address=random.choice(ADDRESSES),
                contact=pcontact,
                received_at=(datetime.utcnow() - timedelta(minutes=random.randint(0,120)))
            )
            db.add(inc)

            # For a subset, assign an ambulance immediately to simulate 'assigned' state
            if random.random() < 0.25:
                amb_id = str(uuid.uuid4())
                unit_name = f"AMB-{random.randint(100,999)}"
                # start a bit away from incident
                start_lat = lat + (random.random() * 0.02 + 0.005)
                start_lon = lon + (random.random() * 0.02 + 0.005)
                speed_kmh = random.choice([60.0, 80.0])
                # compute simple ETA based on straight-line distance
                dist_m = haversine_meters(start_lat, start_lon, lat, lon)
                eta_seconds = dist_m / max(0.1, (speed_kmh * 1000.0 / 3600.0))
                eta = datetime.utcnow() + timedelta(seconds=eta_seconds)

                # create a simple LineString geojson route
                geom = {
                    'type': 'LineString',
                    'coordinates': [[start_lon, start_lat], [lon, lat]]
                }

                amb = Ambulance(
                    id=amb_id,
                    unit_name=unit_name,
                    status='enroute',
                    lat=float(start_lat),
                    lon=float(start_lon),
                    target_lat=float(lat),
                    target_lon=float(lon),
                    speed_kmh=speed_kmh,
                    eta=eta,
                    route=json.dumps(geom),
                    incident_id=pid,
                    unit_type='ambulance',
                    started_at=datetime.utcnow()
                )
                db.add(amb)

                # mark incident as assigned
                inc.status = 'assigned'
                inc.assigned_to = unit_name
                inc.updated_at = datetime.utcnow()

        # Create fire incidents
        for i in range(num_fire):
            lat = center_lat + (random.random() - 0.5) * 0.12
            lon = center_lon + (random.random() - 0.5) * 0.12
            pid = f"fire-{int(datetime.utcnow().timestamp())}-{i}-{random.randint(0,999)}"
            # assign a fake sensor id/type for fire alerts
            sid = f"F-{200 + i}"
            stype = random.choice(['Smoke + Temperature', 'Heat', 'CO + Smoke'])
            inc = Incident(
                id=pid,
                type='fire',
                lat=lat,
                lon=lon,
                severity=random.randint(2,5),
                status='new',
                notes='Auto-seeded fire alert',
                sensor_id=sid,
                sensor_type=stype,
                address=random.choice(ADDRESSES),
                contact=f"+40{random.randint(700000000,799999999)}",
                received_at=(datetime.utcnow() - timedelta(minutes=random.randint(0,240)))
            )
            db.add(inc)

        # Create some additional active units (ambulances and fire units)
        for i in range(num_units):
            is_fire = (i % 3 == 0)
            uid = f"FIRE-{i:02d}" if is_fire else f"AMB-{i:02d}"
            lat = center_lat + (random.random() - 0.5) * 0.06
            lon = center_lon + (random.random() - 0.5) * 0.06
            amb = Ambulance(
                id=str(uuid.uuid4()),
                unit_name=uid,
                status='idle',
                lat=lat,
                lon=lon,
                target_lat=None,
                target_lon=None,
                speed_kmh=60.0 if is_fire else 80.0,
                eta=None,
                route=None,
                incident_id=None,
                unit_type='fire' if is_fire else 'ambulance',
            )
            db.add(amb)

        db.commit()
        print('Seeding complete')
    except Exception as e:
        db.rollback()
        print('Seeding failed', e)
    finally:
        db.close()


if __name__ == '__main__':
    seed()
