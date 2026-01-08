from sqlalchemy import Column, String, Float, Integer, DateTime, Text, ForeignKey
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
    # New columns for persistent status tracking
    status = Column(String, default='new', index=True)
    notes = Column(Text, nullable=True)
    assigned_to = Column(String, nullable=True)
    # Extra UI-friendly fields
    patient_name = Column(String, nullable=True)
    patient_age = Column(Integer, nullable=True)
    patient_contact = Column(String, nullable=True)
    address = Column(String, nullable=True)
    # Sensor metadata (for fire/IoT alerts)
    sensor_id = Column(String, nullable=True)
    sensor_type = Column(String, nullable=True)
    contact = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        """Convert model to dictionary for JSON serialization."""
        return {
            'id': self.id,
            'received_at': self.received_at.isoformat() if self.received_at else None,
            'type': self.type,
            'lat': self.lat,
            'lon': self.lon,
            'severity': self.severity,
            'status': self.status or 'new',
            'notes': self.notes,
            'patient_name': self.patient_name,
            'patient_age': self.patient_age,
            'patient_contact': self.patient_contact,
            'sensor_id': self.sensor_id,
            'sensor_type': self.sensor_type,
            'address': self.address,
            'contact': self.contact,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }


class Ambulance(Base):
    __tablename__ = 'ambulances'

    id = Column(String, primary_key=True, index=True)
    unit_name = Column(String, nullable=True)
    status = Column(String, default='idle', index=True)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    target_lat = Column(Float, nullable=True)
    target_lon = Column(Float, nullable=True)
    speed_kmh = Column(Float, nullable=True)
    eta = Column(DateTime, nullable=True)
    route = Column(Text, nullable=True)
    incident_id = Column(String, nullable=True, index=True)
    unit_type = Column(String, nullable=True, index=True)
    started_at = Column(DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'resource': 'ambulance',
            'ambulance_id': self.id,
            'unit_name': self.unit_name,
            'status': self.status,
            'lat': self.lat,
            'lon': self.lon,
            'target_lat': self.target_lat,
            'target_lon': self.target_lon,
            'speed_kmh': self.speed_kmh,
            'eta': self.eta.isoformat() if self.eta else None,
            'route': self.route,
            'unit_type': self.unit_type or ('fire' if (self.unit_name and self.unit_name.upper().startswith('FIR')) else 'ambulance'),
            'incident_id': self.incident_id,
            'started_at': self.started_at.isoformat() if self.started_at else None,
        }


class Closure(Base):
    __tablename__ = 'closures'

    id = Column(String, primary_key=True, index=True)
    # add a DB-level foreign key to incidents.id to allow joins at the DB level
    # Note: incidents uses a composite PK (id + received_at); this single-column FK
    # provides a helpful constraint for the common case where incident.id is unique
    incident_id = Column(String, ForeignKey('incidents.id'), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    closed_by = Column(String, nullable=True)
    summary = Column(Text, nullable=True)
    treatment_log = Column(Text, nullable=True)  # JSON-encoded or plaintext log
    disposition = Column(String, nullable=True)
    recommendations = Column(Text, nullable=True)
    billing_ref = Column(String, nullable=True)

    def to_dict(self):
        return {
            'id': self.id,
            'incident_id': self.incident_id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'closed_by': self.closed_by,
            'summary': self.summary,
            'treatment_log': self.treatment_log,
            'disposition': self.disposition,
            'recommendations': self.recommendations,
            'billing_ref': self.billing_ref,
        }
