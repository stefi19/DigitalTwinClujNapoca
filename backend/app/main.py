import os
import asyncio
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List

from .consumer import start_mqtt_listener, incidents_store

app = FastAPI(title="DERN - Backend")


class Incident(BaseModel):
    id: str
    type: str
    lat: float
    lon: float
    severity: int


@app.on_event("startup")
async def startup_event():
    # start background mqtt listener
    loop = asyncio.get_event_loop()
    loop.create_task(start_mqtt_listener())


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/incidents", response_model=List[Incident])
def get_incidents():
    # return stored incidents (in-memory for now)
    return incidents_store
