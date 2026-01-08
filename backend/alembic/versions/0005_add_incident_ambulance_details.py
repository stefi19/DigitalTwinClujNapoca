"""add more UI fields to incidents and ambulances

Revision ID: 0005
Revises: 0004
Create Date: 2026-01-07 13:30:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade():
    # incidents
    op.add_column('incidents', sa.Column('patient_name', sa.String(), nullable=True))
    op.add_column('incidents', sa.Column('patient_age', sa.Integer(), nullable=True))
    op.add_column('incidents', sa.Column('patient_contact', sa.String(), nullable=True))
    op.add_column('incidents', sa.Column('address', sa.String(), nullable=True))
    op.add_column('incidents', sa.Column('contact', sa.String(), nullable=True))

    # ambulances
    op.add_column('ambulances', sa.Column('unit_type', sa.String(), nullable=True))


def downgrade():
    op.drop_column('ambulances', 'unit_type')
    op.drop_column('incidents', 'contact')
    op.drop_column('incidents', 'address')
    op.drop_column('incidents', 'patient_contact')
    op.drop_column('incidents', 'patient_age')
    op.drop_column('incidents', 'patient_name')
