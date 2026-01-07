"""add status, notes, updated_at columns to incidents

Revision ID: 0002_add_status_notes_columns
Revises: 0001_create_incidents_table
Create Date: 2026-01-07 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '0002_add_status_notes_columns'
down_revision = '0001_create_incidents_table'
branch_labels = None
depends_on = None


def upgrade():
    # Add status column with default 'new'
    op.add_column('incidents', sa.Column('status', sa.String(), nullable=True, server_default='new'))
    # Add notes column (text, nullable)
    op.add_column('incidents', sa.Column('notes', sa.Text(), nullable=True))
    # Add updated_at column with default now()
    op.add_column('incidents', sa.Column('updated_at', sa.DateTime(), nullable=True, server_default=sa.func.now()))
    
    # Create index on status for faster filtering
    op.create_index('ix_incidents_status', 'incidents', ['status'])


def downgrade():
    op.drop_index('ix_incidents_status')
    op.drop_column('incidents', 'updated_at')
    op.drop_column('incidents', 'notes')
    op.drop_column('incidents', 'status')
