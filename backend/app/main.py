import os
import asyncio
import json
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List

from .consumer import start_mqtt_listener, incidents_store, flush_kafka
from .broadcast import broadcaster
from .db import engine
from .models import Base as ModelsBase
from fastapi import Body


app = FastAPI(title="DERN - Backend")


class Incident(BaseModel):
    id: str
    type: str
    lat: float
    lon: float
    severity: int


@app.on_event("startup")
async def startup_event():
    # ensure DB tables exist as a fallback
    try:
        ModelsBase.metadata.create_all(bind=engine)
    except Exception as e:
        print("DB table creation skipped or failed (migrations preferred)", e)

    # start background mqtt listener
    loop = asyncio.get_event_loop()
    loop.create_task(start_mqtt_listener())


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


@app.get("/incidents", response_model=List[Incident])
def get_incidents():
    # return stored incidents (in-memory for now)
    return incidents_store


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
    """Temporary debug endpoint: publish a payload to SSE subscribers."""
    try:
        broadcaster.publish(payload)
        return {"published": True, "payload": payload}
    except Exception as e:
        return {"published": False, "error": str(e)}
