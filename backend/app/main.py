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
from .broadcast import broadcaster
from .db import engine
from .models import Base as ModelsBase
from fastapi import Body
import random
import traceback


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
        tick_s = 2.0
        try:
            route_points = None
            if amb.route:
                try:
                    route_obj = json.loads(amb.route)
                    # Mapbox geojson coordinates are [lon, lat]
                    coords = route_obj.get('coordinates') if isinstance(route_obj, dict) else None
                    if coords:
                        # convert to [(lat, lon), ...]
                        route_points = [(c[1], c[0]) for c in coords]
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
                        speed_m_s = (amb.speed_kmh or 40.0) * 1000.0 / 3600.0
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

                    speed_m_s = (amb.speed_kmh or 40.0) * 1000.0 / 3600.0
                    eta_seconds = remaining / max(0.1, speed_m_s)
                    amb.eta = datetime.utcnow() + timedelta(seconds=eta_seconds)
                    db.commit()
                    try:
                        broadcaster.publish(amb.to_dict())
                    except Exception:
                        pass
                    amb = db.query(AmbulanceModel).filter(AmbulanceModel.id == amb_id).first()
                    await asyncio.sleep(tick_s)

                # arrival: set final position and mark arrived
                amb = db.query(AmbulanceModel).filter(AmbulanceModel.id == amb_id).first()
                if amb:
                    amb.lat = amb.target_lat
                    amb.lon = amb.target_lon
                    amb.status = 'arrived'
                    amb.eta = None
                    db.commit()
                    broadcaster.publish(amb.to_dict())
                    try:
                        inc = db.query(IncidentModel).filter(IncidentModel.id == amb.incident_id).order_by(IncidentModel.received_at.desc()).first()
                        if inc:
                            inc.status = 'in_progress'
                            inc.updated_at = datetime.utcnow()
                            db.commit()
                            broadcaster.publish(inc.to_dict())
                    except Exception:
                        db.rollback()

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
                            inc = db.query(IncidentModel).filter(IncidentModel.id == amb.incident_id).order_by(IncidentModel.received_at.desc()).first()
                            if inc:
                                inc.status = 'in_progress'
                                inc.updated_at = datetime.utcnow()
                                db.commit()
                                broadcaster.publish(inc.to_dict())
                        except Exception:
                            db.rollback()

                        break

                    speed_m_s = (amb.speed_kmh or 40.0) * 1000.0 / 3600.0
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
                amb = AmbulanceModel(id=f"amb_{uid}", unit_name=uid, status='idle', lat=lat, lon=lon, target_lat=None, target_lon=None, speed_kmh=40.0)
                db.add(amb)
                created += 1
            for i in range(1, 51):
                uid = f"FIRE-{i:02d}"
                lat = center_lat + ((i % 5) - 2) * 0.007
                lon = center_lon + ((i % 9) - 4) * 0.007
                amb = AmbulanceModel(id=f"fire_{uid}", unit_name=uid, status='idle', lat=lat, lon=lon, target_lat=None, target_lon=None, speed_kmh=35.0)
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
        # normalize and store the incident
        item = dict(payload)
        item.setdefault('status', 'new')
        item.setdefault('received_at', datetime.utcnow().isoformat())
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
        speed_kmh = payload.speed_kmh or 40.0
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
