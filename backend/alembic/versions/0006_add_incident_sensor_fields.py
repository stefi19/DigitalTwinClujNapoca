"""add sensor fields to incidents

Revision ID: 0006
Revises: 0005
Create Date: 2026-01-07 14:05:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('incidents', sa.Column('sensor_id', sa.String(), nullable=True))
    op.add_column('incidents', sa.Column('sensor_type', sa.String(), nullable=True))


def downgrade():
    op.drop_column('incidents', 'sensor_type')
    op.drop_column('incidents', 'sensor_id')
