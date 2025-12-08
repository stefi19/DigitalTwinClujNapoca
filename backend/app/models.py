from sqlalchemy import Column, String, Float, Integer, DateTime
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime

Base = declarative_base()


class Incident(Base):
    __tablename__ = 'incidents'

    # Composite primary key including the time column to match the hypertable migration
    id = Column(String, primary_key=True, index=True)
    received_at = Column(DateTime, primary_key=True, nullable=False, default=datetime.utcnow)
    type = Column(String, index=True)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    severity = Column(Integer, nullable=False)
