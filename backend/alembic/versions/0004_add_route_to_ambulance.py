"""add route column to ambulances

Revision ID: 0004
Revises: 0003
Create Date: 2026-01-07 13:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('ambulances', sa.Column('route', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('ambulances', 'route')
