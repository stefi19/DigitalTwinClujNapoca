import os
import asyncio
import threading
import json
import math
import uuid
from datetime import datetime, timedelta
from fastapi import FastAPI, Request, Query
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from typing import List, Optional

from .consumer import start_mqtt_listener, incidents_store, flush_kafka
from .db import SessionLocal
from .models import Incident as IncidentModel, Ambulance as AmbulanceModel
from .models import Closure as ClosureModel
from .broadcast import broadcaster
from .db import engine
from .models import Base as ModelsBase
from fastapi import Body
import random
import traceback
from .utils import enrich_incident


app = FastAPI(title="DERN - Backend")


class Incident(BaseModel):
    id: str
    type: str
    lat: float
    lon: float
    severity: int


class AssignRequest(BaseModel):
    unit_name: Optional[str] = 'Unit'
    start_lat: Optional[float]
    start_lon: Optional[float]
    speed_kmh: Optional[float] = 40.0
    unit_type: Optional[str] = 'ambulance'


def haversine_meters(lat1, lon1, lat2, lon2):
    # approximate radius of earth in meters
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2.0)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2.0)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return R * c


async def simulate_ambulance(amb_id: str):
    """Background coroutine to move ambulance towards its target and broadcast updates."""
    db = SessionLocal()
    try:
        amb: AmbulanceModel = db.query(AmbulanceModel).filter(AmbulanceModel.id == amb_id).first()
        if not amb:
            db.close()
            return

        # loop until arrival; if route geojson is present follow its coordinates sequentially
        # Use shorter ticks for snappier updates
        tick_s = 1.0
        try:
            route_points = None
            if amb.route:
                try:
                    route_obj = json.loads(amb.route)
                    # Mapbox geojson coordinates are [lon, lat]
                    coords = None
                    if isinstance(route_obj, dict):
                        # common GeoJSON shapes: either a LineString with 'coordinates'
                        # or a FeatureCollection/Feature with geometry.coordinates
                        if 'coordinates' in route_obj:
                            coords = route_obj.get('coordinates')
                        else:
                            # try to handle Feature / FeatureCollection
                            features = route_obj.get('features')
                            if features and isinstance(features, list):
                                geom = features[0].get('geometry') if isinstance(features[0], dict) else None
                                if geom and 'coordinates' in geom:
                                    coords = geom.get('coordinates')
                    # convert to [(lat, lon), ...] if coords is a list of [lon, lat]
                    if coords:
                        route_points = [(c[1], c[0]) for c in coords]
                    else:
                        route_points = None
                except Exception:
                    route_points = None

            # If we have route points, we follow them; otherwise fallback to linear interpolation
            if route_points:
                idx = 0
                while amb and amb.status == 'enroute' and idx < len(route_points):
                    next_lat, next_lon = route_points[idx]
                    dist_m = haversine_meters(amb.lat, amb.lon, next_lat, next_lon)
                    if dist_m <= 3.0:
                        # move to next point
                        amb.lat = next_lat
                        amb.lon = next_lon
                        idx += 1
                    else:
                        speed_m_s = (amb.speed_kmh or 80.0) * 1000.0 / 3600.0
                        move_m = speed_m_s * tick_s
                        frac = min(1.0, move_m / max(1.0, dist_m))
                        amb.lat = amb.lat + (next_lat - amb.lat) * frac
                        amb.lon = amb.lon + (next_lon - amb.lon) * frac

                    # recompute ETA using remaining route points distance
                    remaining = 0.0
                    curr_lat, curr_lon = amb.lat, amb.lon
                    for j in range(idx, len(route_points)):
                        p_lat, p_lon = route_points[j]
                        remaining += haversine_meters(curr_lat, curr_lon, p_lat, p_lon)
                        curr_lat, curr_lon = p_lat, p_lon

                    speed_m_s = (amb.speed_kmh or 80.0) * 1000.0 / 3600.0
                    eta_seconds = remaining / max(0.1, speed_m_s)
                    amb.eta = datetime.utcnow() + timedelta(seconds=eta_seconds)
                    db.commit()
                    try:
                        broadcaster.publish(amb.to_dict())
                    except Exception:
                        pass
                    amb = db.query(AmbulanceModel).filter(AmbulanceModel.id == amb_id).first()
                    await asyncio.sleep(tick_s)

                # arrival: set final position and mark arrived, then free the unit
                amb = db.query(AmbulanceModel).filter(AmbulanceModel.id == amb_id).first()
                if amb:
                    amb.lat = amb.target_lat
                    amb.lon = amb.target_lon
                    amb.status = 'arrived'
                    amb.eta = None
                    db.commit()
                    broadcaster.publish(amb.to_dict())
                    try:
                        # When ambulance arrives, mark the incident as resolved so it
                        # moves into the Doctor Closure workflow. Use the helper to
                        # ensure closures are created and broadcasts happen.
                        if amb.incident_id:
                            update_incident_status(amb.incident_id, 'resolved')
                            # Wait briefly to allow UIs to receive the 'arrived' event
                            # and react before we free the unit. This reduces races
                            # where the frontend never sees 'arrived' and cannot
                            # auto-resolve or show the arrived state.
                            try:
                                await asyncio.sleep(2)
                            except Exception:
                                pass
                            # After a short delay, free the ambulance so it returns
                            # to the available pool. Clear assignment-related fields
                            # and broadcast the updated ambulance state.
                            amb_ref = db.query(AmbulanceModel).filter(AmbulanceModel.id == amb_id).first()
                            if amb_ref:
                                amb_ref.status = 'idle'
                                amb_ref.incident_id = None
                                amb_ref.target_lat = None
                                amb_ref.target_lon = None
                                amb_ref.route = None
                                amb_ref.eta = None
                                # keep started_at for history or clear if you prefer
                                db.commit()
                                try:
                                    broadcaster.publish(amb_ref.to_dict())
                                except Exception:
                                    pass
                    except Exception as e:
                        print('Failed to mark incident resolved on arrival', e)

            else:
                # fallback linear movement
                while amb and amb.status == 'enroute':
                    dist_m = haversine_meters(amb.lat, amb.lon, amb.target_lat, amb.target_lon)
                    if dist_m <= 5.0:
                        amb.lat = amb.target_lat
                        amb.lon = amb.target_lon
                        amb.status = 'arrived'
                        db.commit()
                        payload = amb.to_dict()
                        broadcaster.publish(payload)

                        try:
                            # When close enough, resolve the incident and free the unit
                            if amb.incident_id:
                                update_incident_status(amb.incident_id, 'resolved')
                                # free ambulance
                                amb_ref = db.query(AmbulanceModel).filter(AmbulanceModel.id == amb_id).first()
                                if amb_ref:
                                    amb_ref.status = 'idle'
                                    amb_ref.incident_id = None
                                    amb_ref.target_lat = None
                                    amb_ref.target_lon = None
                                    amb_ref.route = None
                                    amb_ref.eta = None
                                    db.commit()
                                    try:
                                        broadcaster.publish(amb_ref.to_dict())
                                    except Exception:
                                        pass
                        except Exception:
                            db.rollback()

                        break

                    speed_m_s = (amb.speed_kmh or 80.0) * 1000.0 / 3600.0
                    move_m = speed_m_s * tick_s
                    frac = min(1.0, move_m / max(1.0, dist_m))
                    new_lat = amb.lat + (amb.target_lat - amb.lat) * frac
                    new_lon = amb.lon + (amb.target_lon - amb.lon) * frac
                    amb.lat = new_lat
                    amb.lon = new_lon
                    remaining_m = haversine_meters(amb.lat, amb.lon, amb.target_lat, amb.target_lon)
                    eta_seconds = remaining_m / max(0.1, speed_m_s)
                    amb.eta = datetime.utcnow() + timedelta(seconds=eta_seconds)
                    db.commit()
                    try:
                        broadcaster.publish(amb.to_dict())
                    except Exception:
                        pass
                    amb = db.query(AmbulanceModel).filter(AmbulanceModel.id == amb_id).first()
                    await asyncio.sleep(tick_s)
        except Exception as e:
            print('simulate_ambulance loop error', e)
    except Exception as e:
        print('simulate_ambulance error', e)
    finally:
        db.close()


@app.on_event("startup")
async def startup_event():
    # ensure DB tables exist as a fallback
    try:
        ModelsBase.metadata.create_all(bind=engine)
    except Exception as e:
        print("DB table creation skipped or failed (migrations preferred)", e)

    # Load existing incidents from DB into in-memory store for backward compatibility
    try:
        db = SessionLocal()
        db_incidents = db.query(IncidentModel).order_by(IncidentModel.received_at.desc()).limit(500).all()
        for inc in db_incidents:
            incidents_store.append(inc.to_dict())
        db.close()
        print(f"Loaded {len(db_incidents)} incidents from database")
    except Exception as e:
        print("Failed to load incidents from DB", e)

    # start background mqtt listener
    loop = asyncio.get_event_loop()
    loop.create_task(start_mqtt_listener())

    # ensure a pool of default units (50 ambulances + 50 fire units)
    try:
        db = SessionLocal()
        count = db.query(AmbulanceModel).count()
        needed = max(0, 100 - count)
        if needed > 0:
            center_lat = float(os.getenv('CITY_CENTER_LAT', 46.7712))
            center_lon = float(os.getenv('CITY_CENTER_LON', 23.6236))
            created = 0
            for i in range(1, 51):
                # ambulances
                uid = f"AMB-{i:02d}"
                lat = center_lat + ((i % 7) - 3) * 0.005
                lon = center_lon + ((i % 11) - 5) * 0.005
                amb = AmbulanceModel(id=f"amb_{uid}", unit_name=uid, status='idle', lat=lat, lon=lon, target_lat=None, target_lon=None, speed_kmh=80.0)
                db.add(amb)
                created += 1
            for i in range(1, 51):
                uid = f"FIRE-{i:02d}"
                lat = center_lat + ((i % 5) - 2) * 0.007
                lon = center_lon + ((i % 9) - 4) * 0.007
                amb = AmbulanceModel(id=f"fire_{uid}", unit_name=uid, status='idle', lat=lat, lon=lon, target_lat=None, target_lon=None, speed_kmh=60.0)
                db.add(amb)
                created += 1
            db.commit()
            # broadcast initial units so frontends can see available pool
            units = db.query(AmbulanceModel).all()
            for u in units:
                try:
                    broadcaster.publish(u.to_dict())
                except Exception:
                    pass
        db.close()
    except Exception as e:
        print('failed to seed default units', e)
        traceback.print_exc()


@app.on_event("shutdown")
def shutdown_event():
    # flush any outstanding Kafka messages
    try:
        flush_kafka()
    except Exception as e:
        print("Error flushing kafka on shutdown", e)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/incidents")
def get_incidents(status: Optional[str] = Query(None, description="Filter by status (new, accepted, declined, resolved)")):
    """Return all incidents from database, optionally filtered by status."""
    try:
        db = SessionLocal()
        query = db.query(IncidentModel).order_by(IncidentModel.received_at.desc())
        if status:
            query = query.filter(IncidentModel.status == status)
        db_incidents = query.limit(500).all()
        result = [inc.to_dict() for inc in db_incidents]
        db.close()
        return result
    except Exception as e:
        print("Failed to fetch incidents from DB, falling back to in-memory", e)
        # fallback to in-memory store
        if status:
            return [inc for inc in incidents_store if inc.get('status') == status]
        return incidents_store


@app.get('/incidents/count')
def get_incidents_count():
    """Return total number of incidents in the database (best-effort).

    Useful for dashboards that want to show overall counts instead of the
    limited result set returned by /incidents (which is capped at 500).
    """
    try:
        db = SessionLocal()
        count = db.query(IncidentModel).count()
        db.close()
        return {'total': int(count)}
    except Exception as e:
        print('Failed to count incidents', e)
        traceback.print_exc()
        # fall back to in-memory store length
        return {'total': len(incidents_store)}



@app.get('/ambulances')
def get_ambulances(status: Optional[str] = Query(None, description="Filter ambulances by status (idle,enroute,arrived)") ):
    try:
        db = SessionLocal()
        query = db.query(AmbulanceModel).order_by(AmbulanceModel.unit_name.asc())
        if status:
            query = query.filter(AmbulanceModel.status == status)
        rows = query.all()
        result = [r.to_dict() for r in rows]
        db.close()
        return result
    except Exception as e:
        print('Failed to fetch ambulances', e)
        traceback.print_exc()
        # fallback to scanning in-memory store for ambulance-like items
        return [it for it in incidents_store if it.get('resource') == 'ambulance']


@app.get('/stream/incidents')
async def stream_incidents(request: Request):
    """Server-Sent Events endpoint streaming incidents as JSON lines."""

    async def event_generator():
        async for item in broadcaster.subscribe():
            # if client disconnects, stop
            if await request.is_disconnected():
                break
            # yield the item as an SSE 'data' frame
            yield f"data: {json.dumps(item)}\n\n"

    return StreamingResponse(event_generator(), media_type='text/event-stream')


@app.post('/debug/publish')
def debug_publish(payload: dict = Body(...)):
    """Publish a new incident to SSE subscribers and persist to database."""
    try:
        # normalize and store the incident (enrich missing UI fields)
        item = dict(payload)
        item = enrich_incident(item)
        item.setdefault('severity', 1)

        # Parse received_at for DB
        received_at = datetime.fromisoformat(item['received_at']) if isinstance(item.get('received_at'), str) else datetime.utcnow()

        # Persist to DB
        db = SessionLocal()
        try:
            inc = IncidentModel(
                id=item.get('id'),
                type=item.get('type'),
                lat=float(item.get('lat', 0)),
                lon=float(item.get('lon', 0)),
                severity=int(item.get('severity', 1)),
                status=item.get('status', 'new'),
                notes=item.get('notes'),
                patient_name=item.get('patient_name'),
                patient_age=item.get('patient_age'),
                patient_contact=item.get('patient_contact'),
                address=item.get('address'),
                contact=item.get('contact'),
                sensor_id=item.get('sensor_id'),
                sensor_type=item.get('sensor_type'),
                received_at=received_at,
                updated_at=datetime.utcnow()
            )
            db.add(inc)
            db.commit()
            # Return the persisted item with all fields
            item = inc.to_dict()
            db.close()
        except Exception as e:
            db.rollback()
            db.close()
            print("DB write failed for debug publish", e)

        # Add to in-memory store for backward compatibility
        incidents_store.insert(0, item)

        broadcaster.publish(item)
        return {"published": True, "payload": item}
    except Exception as e:
        return {"published": False, "error": str(e)}


def update_incident_status(incident_id: str, new_status: str):
    """Helper to update incident status in DB and in-memory store, then broadcast."""
    db = SessionLocal()
    try:
        # Find incident in DB (may have multiple rows with same id due to composite key)
        db_inc = db.query(IncidentModel).filter(IncidentModel.id == incident_id).order_by(IncidentModel.received_at.desc()).first()
        if db_inc:
            db_inc.status = new_status
            db_inc.updated_at = datetime.utcnow()
            db.commit()
            result = db_inc.to_dict()
            db.close()
            
            # Update in-memory store
            for inc in incidents_store:
                if inc.get('id') == incident_id:
                    inc['status'] = new_status
                    inc['updated_at'] = result['updated_at']
                    break
            
            broadcaster.publish(result)
            # If the incident was resolved, create a Closure record so Doctor Closure UI
            # will show it in the closures list. We create a lightweight closure entry
            # with an auto-generated id and a short treatment_log indicating auto-resolve.
            try:
                if new_status == 'resolved':
                    db2 = SessionLocal()
                    existing = db2.query(ClosureModel).filter(ClosureModel.incident_id == incident_id).first()
                    if not existing:
                        closure_id = str(uuid.uuid4())
                        closure = ClosureModel(id=closure_id, incident_id=incident_id, closed_by='system', summary='Auto-resolved on ambulance arrival', treatment_log=json.dumps([{'time': datetime.utcnow().isoformat(), 'action': 'auto-resolve', 'details': 'Ambulance reported arrival and incident auto-resolved.'}]))
                        db2.add(closure)
                        db2.commit()
                        try:
                            # optionally broadcast closure creation for live UIs
                            broadcaster.publish({'resource': 'closure', 'closure': closure.to_dict()})
                        except Exception:
                            pass
                    db2.close()
            except Exception as e:
                print('Failed to create closure record after resolve', e)

            return {'ok': True, 'incident': result}
        else:
            db.close()
            # Try in-memory store only
            for inc in incidents_store:
                if inc.get('id') == incident_id:
                    inc['status'] = new_status
                    inc['updated_at'] = datetime.utcnow().isoformat()
                    broadcaster.publish(inc)
                    return {'ok': True, 'incident': inc}
            return None
    except Exception as e:
        db.rollback()
        db.close()
        print(f"Failed to update incident status: {e}")
        # Try in-memory fallback
        for inc in incidents_store:
            if inc.get('id') == incident_id:
                inc['status'] = new_status
                inc['updated_at'] = datetime.utcnow().isoformat()
                broadcaster.publish(inc)
                return {'ok': True, 'incident': inc}
        return None



@app.post('/incidents/{incident_id}/assign')
def assign_incident(incident_id: str, payload: AssignRequest):
    """Assign an ambulance to an incident and start simulated movement toward the patient.

    Expected payload: { unit_name, start_lat, start_lon, speed_kmh }
    """
    try:
        db = SessionLocal()
        inc = db.query(IncidentModel).filter(IncidentModel.id == incident_id).order_by(IncidentModel.received_at.desc()).first()
        if not inc:
            db.close()
            return JSONResponse({'ok': False, 'detail': 'incident not found'}, status_code=404)

        # create ambulance
        amb_id = str(uuid.uuid4())
        # use provided start coords, fall back to a small offset from incident to simulate distance
        start_lat = payload.start_lat if payload.start_lat is not None else (inc.lat + 0.008)
        start_lon = payload.start_lon if payload.start_lon is not None else (inc.lon + 0.008)
        # prefer provided speed, otherwise use higher default for snappier movement
        speed_kmh = payload.speed_kmh or 80.0
        unit_name = payload.unit_name or f"Unit {amb_id[:6]}"

        # Try to compute route and ETA using Mapbox Directions API if token is present
        mapbox_token = os.getenv('MAPBOX_TOKEN') or os.getenv('REACT_APP_MAPBOX_TOKEN')
        route_json = None
        eta = None
        try:
            if mapbox_token:
                # Mapbox expects lon,lat pairs
                coords = f"{start_lon},{start_lat};{inc.lon},{inc.lat}"
                url = f"https://api.mapbox.com/directions/v5/mapbox/driving/{coords}?geometries=geojson&overview=full&access_token={mapbox_token}"
                import requests
                resp = requests.get(url, timeout=6)
                if resp.status_code == 200:
                    j = resp.json()
                    if j.get('routes'):
                        r = j['routes'][0]
                        duration = r.get('duration')  # seconds
                        if duration:
                            eta = datetime.utcnow() + timedelta(seconds=float(duration))
                        geom = r.get('geometry')
                        if geom:
                            # store geojson geometry as string
                            route_json = json.dumps(geom)
        except Exception as e:
            print('Mapbox directions failed', e)

        # fallback ETA if not computed
        if eta is None:
            dist_m = haversine_meters(start_lat, start_lon, inc.lat, inc.lon)
            eta_seconds = dist_m / max(0.1, (speed_kmh * 1000.0 / 3600.0))
            eta = datetime.utcnow() + timedelta(seconds=eta_seconds)

        amb = AmbulanceModel(
            id=amb_id,
            unit_name=unit_name,
            status='enroute',
            lat=float(start_lat),
            lon=float(start_lon),
            target_lat=float(inc.lat),
            target_lon=float(inc.lon),
            speed_kmh=float(speed_kmh),
            eta=eta,
            route=route_json,
            incident_id=str(inc.id),
            started_at=datetime.utcnow()
        )
        db.add(amb)

        # mark incident as assigned
        inc.status = 'assigned'
        inc.assigned_to = unit_name
        inc.updated_at = datetime.utcnow()
        db.commit()

        # update in-memory store
        for item in incidents_store:
            if item.get('id') == incident_id:
                item['status'] = 'assigned'
                item['assigned_to'] = unit_name
                item['updated_at'] = inc.updated_at.isoformat() if inc.updated_at else None
                break

        # Broadcast both incident update and ambulance record
        try:
            broadcaster.publish(inc.to_dict())
            broadcaster.publish(amb.to_dict())
        except Exception:
            pass

        # start background simulation (simulate following route if present)
        try:
            # run the coroutine in a separate thread to avoid event loop issues in sync path
            t = threading.Thread(target=lambda: asyncio.run(simulate_ambulance(amb_id)), daemon=True)
            t.start()
        except Exception as e:
            print('failed to start ambulance simulator thread', e)
            traceback.print_exc()

        db.close()
        return JSONResponse({'ok': True, 'incident': inc.to_dict(), 'ambulance': amb.to_dict()})

    except Exception as e:
        print('assign_incident error', e)
        traceback.print_exc()
        return JSONResponse({'ok': False, 'error': str(e)}, status_code=500)


@app.post('/incidents/{incident_id}/accept')
def accept_incident(incident_id: str):
    result = update_incident_status(incident_id, 'accepted')
    if result:
        return JSONResponse(result)
    return JSONResponse({'ok': False, 'detail': 'incident not found'}, status_code=404)


@app.post('/incidents/{incident_id}/decline')
def decline_incident(incident_id: str):
    result = update_incident_status(incident_id, 'declined')
    if result:
        return JSONResponse(result)
    return JSONResponse({'ok': False, 'detail': 'incident not found'}, status_code=404)


@app.post('/incidents/{incident_id}/resolve')
def resolve_incident(incident_id: str):
    result = update_incident_status(incident_id, 'resolved')
    if result:
        return JSONResponse(result)
    return JSONResponse({'ok': False, 'detail': 'incident not found'}, status_code=404)


@app.get('/cases/closures')
def get_closed_cases():
    """Return incidents that are considered closed/terminated for doctor reporting."""
    try:
        db = SessionLocal()
        # treat resolved/closed/confirmed as closed cases
        rows = db.query(IncidentModel).filter(IncidentModel.status.in_(['resolved', 'closed', 'confirmed'])).order_by(IncidentModel.updated_at.desc()).all()
        result = [r.to_dict() for r in rows]
        db.close()
        return result
    except Exception as e:
        print('Failed to fetch closed cases', e)
        traceback.print_exc()
        return []


@app.post('/cases/confirm')
def confirm_case(payload: dict = Body(...)):
    """Mark a case as confirmed/closed. Expects JSON: { id: <case id> }"""
    case_id = payload.get('id')
    if not case_id:
        return JSONResponse({'ok': False, 'detail': 'missing id'}, status_code=400)
    res = update_incident_status(case_id, 'closed')
    if res:
        return JSONResponse({'ok': True, 'case': res.get('incident')})
    return JSONResponse({'ok': False, 'detail': 'case not found'}, status_code=404)


@app.get('/cases/{case_id}/export')
def export_case_report(case_id: str):
    """Generate a simple filled SVG report for a closed case and return it as a downloadable file.

    This implementation performs text substitutions on the SVG template located in the frontend assets
    and fills in a few placeholders with incident data. It's a lightweight demo export (SVG)."""
    try:
        db = SessionLocal()
        inc = db.query(IncidentModel).filter(IncidentModel.id == case_id).order_by(IncidentModel.received_at.desc()).first()
        db.close()
        if not inc:
            return JSONResponse({'ok': False, 'detail': 'case not found'}, status_code=404)

        # locate the SVG template in the backend templates directory
        svg_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'templates', 'case-close-report.svg'))
        if not os.path.exists(svg_path):
            print('SVG template not found at', svg_path)
            return JSONResponse({'ok': False, 'detail': 'report template missing on server'}, status_code=500)

        with open(svg_path, 'r', encoding='utf-8') as f:
            svg = f.read()

        # Prepare replacements based on incident fields (best-effort)
        patient = inc.patient_name or 'Unknown'
        age = str(inc.patient_age) if inc.patient_age is not None else ''
        incident_label = inc.type or (inc.notes or 'Incident')
        address = inc.address or f"{inc.lat:.5f}, {inc.lon:.5f}"
        assigned = getattr(inc, 'assigned_to', None) or inc.assigned_to if hasattr(inc, 'assigned_to') else ''
        received = inc.received_at.isoformat() if getattr(inc, 'received_at', None) else ''
        updated = inc.updated_at.isoformat() if getattr(inc, 'updated_at', None) else ''

        # Basic string substitutions seen in the template
        svg = svg.replace('#1024', f'#{inc.id}')
        svg = svg.replace('Ioan Popescu, 64, M', f'{patient}, {age}')
        svg = svg.replace('Cardiac Arrest (OHCA)', incident_label)
        svg = svg.replace('Observatorului 15, Cluj-Napoca', address)
        svg = svg.replace('A-12', assigned or 'N/A')
        # replace a few times entries for timeline/notes
        svg = svg.replace('11:42 — Alert received', f'{received} — Alert received')
        svg = svg.replace('11:56 — ROSC', f'{updated} — Closed')
        svg = svg.replace('ER-2025-11-A12-1024', f'ER-{inc.id}')

        # return as SVG content with attachment headers so browser downloads it
        headers = {
            'Content-Disposition': f'attachment; filename="case-{inc.id}.svg"'
        }
        return StreamingResponse(iter([svg.encode('utf-8')]), media_type='image/svg+xml', headers=headers)

    except Exception as e:
        print('Failed to export case report', e)
        traceback.print_exc()
        return JSONResponse({'ok': False, 'error': str(e)}, status_code=500)


@app.get('/incidents/{incident_id}/export')
def export_incident_report(incident_id: str):
    """Generate a filled SVG report for an incident and return it as a downloadable file."""
    try:
        db = SessionLocal()
        inc = db.query(IncidentModel).filter(IncidentModel.id == incident_id).order_by(IncidentModel.received_at.desc()).first()
        db.close()
        if not inc:
            return JSONResponse({'ok': False, 'detail': 'incident not found'}, status_code=404)

        # locate the SVG template in the backend templates directory
        svg_path = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'templates', 'fire-post-incident-summary.svg'))
        if not os.path.exists(svg_path):
            return JSONResponse({'ok': False, 'detail': 'report template missing on server'}, status_code=500)

        with open(svg_path, 'r', encoding='utf-8') as f:
            svg = f.read()

        # Prepare replacements based on incident fields
        incident_id_display = inc.id
        status = inc.status.title() if inc.status else 'Unknown'
        duration = '00:38:21'  # placeholder for now
        sensor_info = f"Sensor {inc.sensor_id}" if inc.sensor_id else "Manual Report"
        location = inc.address or f"{inc.lat:.5f}, {inc.lon:.5f}" if inc.lat and inc.lon else "Unknown Location"
        severity = f"Severity {inc.severity}" if inc.severity else "Unknown Severity"
        timestamp = inc.received_at.strftime('%Y-%m-%d %H:%M:%S') if inc.received_at else 'Unknown Time'

        # Basic string substitutions
        svg = svg.replace('#F-207', f'#{incident_id_display}')
        svg = svg.replace('Contained', status)
        svg = svg.replace('00:38:21', duration)
        svg = svg.replace('Sensor F-207', sensor_info)
        svg = svg.replace('Strada Observator 7, Cluj-Napoca', location)
        svg = svg.replace('Severity 3', severity)
        svg = svg.replace('2025-01-08 10:15:23', timestamp)

        # return as SVG content with attachment headers
        headers = {
            'Content-Disposition': f'attachment; filename="incident-{incident_id}.svg"'
        }
        return StreamingResponse(iter([svg.encode('utf-8')]), media_type='image/svg+xml', headers=headers)

    except Exception as e:
        print('Failed to export incident report', e)
        traceback.print_exc()
        return JSONResponse({'ok': False, 'error': str(e)}, status_code=500)


@app.get('/cases/{case_id}')
def get_case(case_id: str):
    """Return a single case/incident by id."""
    try:
        db = SessionLocal()
        inc = db.query(IncidentModel).filter(IncidentModel.id == case_id).order_by(IncidentModel.received_at.desc()).first()
        db.close()
        if not inc:
            return JSONResponse({'ok': False, 'detail': 'case not found'}, status_code=404)
        return inc.to_dict()
    except Exception as e:
        print('Failed to fetch case', e)
        traceback.print_exc()
        return JSONResponse({'ok': False, 'error': str(e)}, status_code=500)


@app.get('/closure_reports')
def get_closure_reports():
    """Return all closure reports joined with their incident data."""
    try:
        db = SessionLocal()
        closures = db.query(ClosureModel).order_by(ClosureModel.created_at.desc()).all()
        out = []
        for c in closures:
            # find the corresponding incident (latest by received_at)
            inc = db.query(IncidentModel).filter(IncidentModel.id == c.incident_id).order_by(IncidentModel.received_at.desc()).first()
            row = {'closure': c.to_dict(), 'incident': inc.to_dict() if inc else None}
            out.append(row)
        db.close()
        return out
    except Exception as e:
        print('Failed to fetch closure reports', e)
        traceback.print_exc()
        return []


@app.get('/ml/risk')
def get_ml_risk(grid_km: float = Query(3.0, description="half-extent of grid around city center in km"), cell_m: int = Query(500, description="grid cell size in meters"), hours_window: int = Query(168, description="hours window to weigh recent history (default 7 days)")):
    """Return a simple GeoJSON grid of risk scores computed from a hardcoded incident history.

    This is a lightweight server-side aggregation demo. It uses a small set of hardcoded
    historical incidents (latitude, longitude, timestamp) and aggregates them into a
    square grid centered on the configured city center. Each grid cell contains a
    normalized risk score (0..1) and raw counts. The frontend can consume this GeoJSON
    to draw choropleths or colored overlays.
    """
    try:
        # center and conversion helpers
        center_lat = float(os.getenv('CITY_CENTER_LAT', 46.7712))
        center_lon = float(os.getenv('CITY_CENTER_LON', 23.6236))
        now = datetime.utcnow()

        # Hardcoded historical incidents (example). In production replace with DB query / ML model.
        history = [
            {'lat': center_lat + 0.010, 'lon': center_lon + 0.006, 'ts': now - timedelta(hours=2)},
            {'lat': center_lat + 0.009, 'lon': center_lon + 0.004, 'ts': now - timedelta(hours=5)},
            {'lat': center_lat - 0.006, 'lon': center_lon - 0.003, 'ts': now - timedelta(days=1, hours=2)},
            {'lat': center_lat + 0.003, 'lon': center_lon - 0.010, 'ts': now - timedelta(days=3)},
            {'lat': center_lat - 0.012, 'lon': center_lon + 0.008, 'ts': now - timedelta(days=10)},
            {'lat': center_lat + 0.015, 'lon': center_lon + 0.012, 'ts': now - timedelta(hours=20)},
            {'lat': center_lat - 0.004, 'lon': center_lon + 0.002, 'ts': now - timedelta(hours=50)},
            {'lat': center_lat + 0.001, 'lon': center_lon - 0.002, 'ts': now - timedelta(hours=100)},
        ]

        # compute meters->degrees approximations at center latitude
        meters_per_deg_lat = 111111.0
        meters_per_deg_lon = 111111.0 * math.cos(math.radians(center_lat))

        # grid side in meters (full width = 2 * grid_km km)
        half_side_m = grid_km * 1000.0
        full_side_m = half_side_m * 2.0
        cells_per_side = max(1, int(full_side_m / float(cell_m)))

        # cell size in degrees
        cell_deg_lat = (cell_m / meters_per_deg_lat)
        cell_deg_lon = (cell_m / meters_per_deg_lon)

        # compute grid origin (south-west corner)
        origin_lat = center_lat - (cell_deg_lat * cells_per_side) / 2.0
        origin_lon = center_lon - (cell_deg_lon * cells_per_side) / 2.0

        # initialize counts
        grid = [[{'count': 0, 'weight': 0.0} for _ in range(cells_per_side)] for _ in range(cells_per_side)]

        # accumulate history into grid cells with a simple temporal weighting
        for h in history:
            lat = h['lat']
            lon = h['lon']
            ts = h.get('ts', now)
            # compute indices
            i = int((lat - origin_lat) / cell_deg_lat)
            j = int((lon - origin_lon) / cell_deg_lon)
            if 0 <= i < cells_per_side and 0 <= j < cells_per_side:
                hours_old = max(0.0, (now - ts).total_seconds() / 3600.0)
                # recency factor: points within hours_window contribute more (linear decay)
                recency = max(0.0, (hours_window - hours_old) / hours_window)
                weight = 1.0 + recency  # base 1.0 plus recency boost in [0..1]
                grid[i][j]['count'] += 1
                grid[i][j]['weight'] += weight

        # build GeoJSON FeatureCollection of cell polygons with computed score
        features = []
        max_score = 0.0
        # temporary store raw scores to normalize later
        raw_scores = [[0.0 for _ in range(cells_per_side)] for _ in range(cells_per_side)]
        for i in range(cells_per_side):
            for j in range(cells_per_side):
                cell = grid[i][j]
                raw = cell['weight']
                raw_scores[i][j] = raw
                if raw > max_score:
                    max_score = raw

        for i in range(cells_per_side):
            for j in range(cells_per_side):
                # polygon corners (lon, lat) order (GeoJSON)
                lat0 = origin_lat + i * cell_deg_lat
                lon0 = origin_lon + j * cell_deg_lon
                lat1 = lat0 + cell_deg_lat
                lon1 = lon0 + cell_deg_lon
                poly = [
                    [lon0, lat0],
                    [lon1, lat0],
                    [lon1, lat1],
                    [lon0, lat1],
                    [lon0, lat0]
                ]
                raw = raw_scores[i][j]
                score = (raw / max_score) if max_score > 0 else 0.0
                feat = {
                    'type': 'Feature',
                    'geometry': {
                        'type': 'Polygon',
                        'coordinates': [poly]
                    },
                    'properties': {
                        'count': grid[i][j]['count'],
                        'raw_score': raw,
                        'score': round(score, 4),
                        'i': i,
                        'j': j
                    }
                }
                features.append(feat)

        fc = {'type': 'FeatureCollection', 'features': features}
        return JSONResponse(fc)

    except Exception as e:
        print('Failed to compute ML risk', e)
        traceback.print_exc()
        return JSONResponse({'ok': False, 'error': str(e)}, status_code=500)


@app.get('/stats/daily')
def get_daily_stats(date: Optional[str] = Query(None, description="YYYY-MM-DD date in UTC, defaults to today")):
    """Return simple daily statistics for incidents: total, counts by type, and hourly series (UTC).

    Useful for rendering a small summary and chart on the Dashboard.
    """
    try:
        if date:
            try:
                day = datetime.fromisoformat(date).date()
            except Exception:
                day = datetime.strptime(date.split('T')[0], '%Y-%m-%d').date()
        else:
            day = datetime.utcnow().date()

        start_dt = datetime.combine(day, datetime.min.time())
        end_dt = start_dt + timedelta(days=1)

        db = SessionLocal()
        rows = db.query(IncidentModel).filter(IncidentModel.received_at >= start_dt, IncidentModel.received_at < end_dt).all()
        total = len(rows)
        by_type = {}
        hourly = [0] * 24
        for r in rows:
            t = (r.type or 'unknown').lower()
            by_type[t] = by_type.get(t, 0) + 1
            if r.received_at:
                h = r.received_at.hour
            else:
                h = 0
            hourly[h] += 1
        db.close()
        return {
            'date': day.isoformat(),
            'total': total,
            'by_type': by_type,
            'hourly': hourly
        }
    except Exception as e:
        print('Failed to compute daily stats', e)
        traceback.print_exc()
        return {'date': None, 'total': 0, 'by_type': {}, 'hourly': [0]*24}


@app.get('/ml/risk/centroids')
def get_ml_risk_centroids(grid_km: float = Query(3.0, description="half-extent of grid around city center in km"), cell_m: int = Query(500, description="grid cell size in meters"), hours_window: int = Query(168, description="hours window to weigh recent history (default 7 days)")):
    """Return a lightweight GeoJSON FeatureCollection of POINT centroids for grid cells that have non-zero risk.

    Useful for map layers that only need points instead of full polygons.
    """
    try:
        # re-use same parameters and hardcoded history as /ml/risk for consistency
        center_lat = float(os.getenv('CITY_CENTER_LAT', 46.7712))
        center_lon = float(os.getenv('CITY_CENTER_LON', 23.6236))
        now = datetime.utcnow()

        history = [
            {'lat': center_lat + 0.010, 'lon': center_lon + 0.006, 'ts': now - timedelta(hours=2)},
            {'lat': center_lat + 0.009, 'lon': center_lon + 0.004, 'ts': now - timedelta(hours=5)},
            {'lat': center_lat - 0.006, 'lon': center_lon - 0.003, 'ts': now - timedelta(days=1, hours=2)},
            {'lat': center_lat + 0.003, 'lon': center_lon - 0.010, 'ts': now - timedelta(days=3)},
            {'lat': center_lat - 0.012, 'lon': center_lon + 0.008, 'ts': now - timedelta(days=10)},
            {'lat': center_lat + 0.015, 'lon': center_lon + 0.012, 'ts': now - timedelta(hours=20)},
            {'lat': center_lat - 0.004, 'lon': center_lon + 0.002, 'ts': now - timedelta(hours=50)},
            {'lat': center_lat + 0.001, 'lon': center_lon - 0.002, 'ts': now - timedelta(hours=100)},
        ]

        meters_per_deg_lat = 111111.0
        meters_per_deg_lon = 111111.0 * math.cos(math.radians(center_lat))
        half_side_m = grid_km * 1000.0
        full_side_m = half_side_m * 2.0
        cells_per_side = max(1, int(full_side_m / float(cell_m)))
        cell_deg_lat = (cell_m / meters_per_deg_lat)
        cell_deg_lon = (cell_m / meters_per_deg_lon)
        origin_lat = center_lat - (cell_deg_lat * cells_per_side) / 2.0
        origin_lon = center_lon - (cell_deg_lon * cells_per_side) / 2.0

        # accumulate weights like /ml/risk
        grid_weights = [[0.0 for _ in range(cells_per_side)] for _ in range(cells_per_side)]
        grid_counts = [[0 for _ in range(cells_per_side)] for _ in range(cells_per_side)]
        for h in history:
            lat = h['lat']; lon = h['lon']; ts = h.get('ts', now)
            i = int((lat - origin_lat) / cell_deg_lat)
            j = int((lon - origin_lon) / cell_deg_lon)
            if 0 <= i < cells_per_side and 0 <= j < cells_per_side:
                hours_old = max(0.0, (now - ts).total_seconds() / 3600.0)
                recency = max(0.0, (hours_window - hours_old) / hours_window)
                weight = 1.0 + recency
                grid_weights[i][j] += weight
                grid_counts[i][j] += 1

        # find max for normalization
        max_raw = 0.0
        for i in range(cells_per_side):
            for j in range(cells_per_side):
                if grid_weights[i][j] > max_raw:
                    max_raw = grid_weights[i][j]

        features = []
        for i in range(cells_per_side):
            for j in range(cells_per_side):
                raw = grid_weights[i][j]
                if raw <= 0.0:
                    continue
                # centroid of cell
                lat0 = origin_lat + i * cell_deg_lat
                lon0 = origin_lon + j * cell_deg_lon
                center_lat_cell = lat0 + cell_deg_lat / 2.0
                center_lon_cell = lon0 + cell_deg_lon / 2.0
                score = (raw / max_raw) if max_raw > 0 else 0.0
                feat = {
                    'type': 'Feature',
                    'geometry': {'type': 'Point', 'coordinates': [round(center_lon_cell, 6), round(center_lat_cell, 6)]},
                    'properties': {
                        'count': grid_counts[i][j],
                        'raw_score': round(raw, 3),
                        'score': round(score, 4),
                        'i': i,
                        'j': j
                    }
                }
                features.append(feat)

        return JSONResponse({'type': 'FeatureCollection', 'features': features})

    except Exception as e:
        print('Failed to compute centroids', e)
        traceback.print_exc()
        return JSONResponse({'ok': False, 'error': str(e)}, status_code=500)


@app.get('/ml/risk/clusters')
def get_ml_risk_clusters(grid_km: float = Query(3.0, description="half-extent of grid around city center in km"), cell_m: int = Query(500, description="grid cell size in meters"), hours_window: int = Query(168, description="hours window to weigh recent history (default 7 days)")):
    """Return simple clusters by merging adjacent non-empty grid cells into cluster centroids.

    This is a cheap server-side clustering suitable for map markers representing hotspots.
    """
    try:
        # reuse same grid computation and history
        center_lat = float(os.getenv('CITY_CENTER_LAT', 46.7712))
        center_lon = float(os.getenv('CITY_CENTER_LON', 23.6236))
        now = datetime.utcnow()

        history = [
            {'lat': center_lat + 0.010, 'lon': center_lon + 0.006, 'ts': now - timedelta(hours=2)},
            {'lat': center_lat + 0.009, 'lon': center_lon + 0.004, 'ts': now - timedelta(hours=5)},
            {'lat': center_lat - 0.006, 'lon': center_lon - 0.003, 'ts': now - timedelta(days=1, hours=2)},
            {'lat': center_lat + 0.003, 'lon': center_lon - 0.010, 'ts': now - timedelta(days=3)},
            {'lat': center_lat - 0.012, 'lon': center_lon + 0.008, 'ts': now - timedelta(days=10)},
            {'lat': center_lat + 0.015, 'lon': center_lon + 0.012, 'ts': now - timedelta(hours=20)},
            {'lat': center_lat - 0.004, 'lon': center_lon + 0.002, 'ts': now - timedelta(hours=50)},
            {'lat': center_lat + 0.001, 'lon': center_lon - 0.002, 'ts': now - timedelta(hours=100)},
        ]

        meters_per_deg_lat = 111111.0
        meters_per_deg_lon = 111111.0 * math.cos(math.radians(center_lat))
        half_side_m = grid_km * 1000.0
        full_side_m = half_side_m * 2.0
        cells_per_side = max(1, int(full_side_m / float(cell_m)))
        cell_deg_lat = (cell_m / meters_per_deg_lat)
        cell_deg_lon = (cell_m / meters_per_deg_lon)
        origin_lat = center_lat - (cell_deg_lat * cells_per_side) / 2.0
        origin_lon = center_lon - (cell_deg_lon * cells_per_side) / 2.0

        grid_weights = [[0.0 for _ in range(cells_per_side)] for _ in range(cells_per_side)]
        grid_counts = [[0 for _ in range(cells_per_side)] for _ in range(cells_per_side)]
        for h in history:
            lat = h['lat']; lon = h['lon']; ts = h.get('ts', now)
            i = int((lat - origin_lat) / cell_deg_lat)
            j = int((lon - origin_lon) / cell_deg_lon)
            if 0 <= i < cells_per_side and 0 <= j < cells_per_side:
                hours_old = max(0.0, (now - ts).total_seconds() / 3600.0)
                recency = max(0.0, (hours_window - hours_old) / hours_window)
                weight = 1.0 + recency
                grid_weights[i][j] += weight
                grid_counts[i][j] += 1

        # simple BFS clustering on 8-neighbors for cells with raw>0
        visited = [[False for _ in range(cells_per_side)] for _ in range(cells_per_side)]
        clusters = []
        for i in range(cells_per_side):
            for j in range(cells_per_side):
                if visited[i][j] or grid_weights[i][j] <= 0.0:
                    continue
                # start a new cluster
                queue = [(i, j)]
                visited[i][j] = True
                cells = []
                while queue:
                    ci, cj = queue.pop(0)
                    cells.append((ci, cj))
                    # explore neighbors
                    for di in (-1, 0, 1):
                        for dj in (-1, 0, 1):
                            ni, nj = ci + di, cj + dj
                            if ni < 0 or nj < 0 or ni >= cells_per_side or nj >= cells_per_side:
                                continue
                            if visited[ni][nj]:
                                continue
                            if grid_weights[ni][nj] <= 0.0:
                                continue
                            visited[ni][nj] = True
                            queue.append((ni, nj))
                # aggregate cluster
                total_raw = 0.0
                total_count = 0
                weighted_lat = 0.0
                weighted_lon = 0.0
                for (ci, cj) in cells:
                    raw = grid_weights[ci][cj]
                    total_raw += raw
                    total_count += grid_counts[ci][cj]
                    lat0 = origin_lat + ci * cell_deg_lat
                    lon0 = origin_lon + cj * cell_deg_lon
                    center_lat_cell = lat0 + cell_deg_lat / 2.0
                    center_lon_cell = lon0 + cell_deg_lon / 2.0
                    weighted_lat += center_lat_cell * raw
                    weighted_lon += center_lon_cell * raw
                if total_raw > 0:
                    centroid_lat = weighted_lat / total_raw
                    centroid_lon = weighted_lon / total_raw
                else:
                    centroid_lat = origin_lat + (i * cell_deg_lat) + cell_deg_lat / 2.0
                    centroid_lon = origin_lon + (j * cell_deg_lon) + cell_deg_lon / 2.0
                clusters.append({'centroid': (centroid_lat, centroid_lon), 'total_raw': total_raw, 'total_count': total_count, 'cells': len(cells)})

        # normalize cluster scores by max raw among clusters
        max_cluster_raw = max([c['total_raw'] for c in clusters], default=0.0)
        features = []
        for c in clusters:
            score = (c['total_raw'] / max_cluster_raw) if max_cluster_raw > 0 else 0.0
            feat = {
                'type': 'Feature',
                'geometry': {'type': 'Point', 'coordinates': [round(c['centroid'][1], 6), round(c['centroid'][0], 6)]},
                'properties': {
                    'cluster_cells': c['cells'],
                    'total_count': c['total_count'],
                    'total_raw': round(c['total_raw'], 3),
                    'score': round(score, 4)
                }
            }
            features.append(feat)

        return JSONResponse({'type': 'FeatureCollection', 'features': features})

    except Exception as e:
        print('Failed to compute clusters', e)
        traceback.print_exc()
        return JSONResponse({'ok': False, 'error': str(e)}, status_code=500)
