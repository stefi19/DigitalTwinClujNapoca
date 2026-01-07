"""create ambulances table and add assigned_to to incidents

Revision ID: 0003
Revises: 0002
Create Date: 2026-01-07 12:30:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0003'
down_revision = '0002_add_status_notes_columns'
branch_labels = None
depends_on = None


def upgrade():
    # Add assigned_to column to incidents
    op.add_column('incidents', sa.Column('assigned_to', sa.String(), nullable=True))

    # Create ambulances table
    op.create_table(
        'ambulances',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('unit_name', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('lat', sa.Float(), nullable=False),
        sa.Column('lon', sa.Float(), nullable=False),
        sa.Column('target_lat', sa.Float(), nullable=True),
        sa.Column('target_lon', sa.Float(), nullable=True),
        sa.Column('speed_kmh', sa.Float(), nullable=True),
        sa.Column('eta', sa.DateTime(), nullable=True),
        sa.Column('incident_id', sa.String(), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_ambulances_status', 'ambulances', ['status'])
    op.create_index('ix_ambulances_incident', 'ambulances', ['incident_id'])


def downgrade():
    op.drop_index('ix_ambulances_incident', table_name='ambulances')
    op.drop_index('ix_ambulances_status', table_name='ambulances')
    op.drop_table('ambulances')
    op.drop_column('incidents', 'assigned_to')
