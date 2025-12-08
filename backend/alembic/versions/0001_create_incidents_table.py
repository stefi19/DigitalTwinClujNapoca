"""create incidents table

Revision ID: 0001_create_incidents_table
Revises: 
Create Date: 2025-11-14 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0001_create_incidents_table'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # create extension if not exists
    op.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;")

    # Create table with a composite primary key including the partitioning column
    op.create_table(
        'incidents',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('type', sa.String(), nullable=True),
        sa.Column('lat', sa.Float(), nullable=False),
        sa.Column('lon', sa.Float(), nullable=False),
        sa.Column('severity', sa.Integer(), nullable=False),
        sa.Column('received_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id', 'received_at', name='pk_incidents_id_received_at')
    )

    # convert to hypertable on the time column (received_at)
    # Note: hypertable requires that any unique constraint or primary key include the time column
    op.execute("SELECT create_hypertable('incidents', 'received_at', if_not_exists => TRUE);")


def downgrade():
    op.drop_table('incidents')
