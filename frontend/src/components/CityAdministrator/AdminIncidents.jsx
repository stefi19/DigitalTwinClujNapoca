import React, { useEffect, useState, useRef, useCallback } from 'react';
import axios from 'axios';
import './admin-incidents.css';

/**
 * AdminIncidents - Real-time incident monitoring panel for administrators
 * Features:
 * - Fetches all incidents from database on mount
 * - Subscribes to SSE for real-time updates (new incidents, status changes)
 * - Shows incident counts by status
 * - Filterable by status
 * - Updates automatically without page refresh
 */
export default function AdminIncidents() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, new, accepted, declined, resolved
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);

  // Fetch initial incidents from API
  const fetchIncidents = useCallback(async () => {
    try {
      setLoading(true);
      const resp = await axios.get('/incidents');
      setIncidents(resp.data || []);
    } catch (err) {
      console.error('Failed to fetch incidents', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // SSE subscription for real-time updates
  useEffect(() => {
    fetchIncidents();

    // Subscribe to SSE
    try {
      const es = new EventSource('/stream/incidents');
      
      es.onopen = () => {
        setConnected(true);
      };

      es.onmessage = (e) => {
        try {
          const inc = JSON.parse(e.data);
          if (!inc || !inc.id) return;
          
          setIncidents((prev) => {
            // Check if incident exists
            const existingIndex = prev.findIndex((p) => p.id === inc.id);
            if (existingIndex >= 0) {
              // Update existing incident
              const updated = [...prev];
              updated[existingIndex] = { ...updated[existingIndex], ...inc };
              return updated;
            }
            // Add new incident at the beginning
            return [inc, ...prev];
          });
        } catch (err) {
          console.warn('Failed to parse SSE message', e.data);
        }
      };

      es.onerror = () => {
        setConnected(false);
      };

      esRef.current = es;

      return () => {
        es.close();
        esRef.current = null;
      };
    } catch (err) {
      console.error('EventSource not available', err);
    }
  }, [fetchIncidents]);

  // Compute counts by status
  const counts = {
    all: incidents.length,
    new: incidents.filter((i) => i.status === 'new' || !i.status).length,
    accepted: incidents.filter((i) => i.status === 'accepted').length,
    declined: incidents.filter((i) => i.status === 'declined').length,
    resolved: incidents.filter((i) => i.status === 'resolved').length,
  };

  // Filter incidents
  const filteredIncidents = filter === 'all'
    ? incidents
    : incidents.filter((i) => {
        if (filter === 'new') return i.status === 'new' || !i.status;
        return i.status === filter;
      });

  // Format timestamp
  const formatTime = (ts) => {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  // Create new incident form state and handler
  const [newType, setNewType] = useState('medical');
  const [newSeverity, setNewSeverity] = useState(3);
  const [newLat, setNewLat] = useState(46.7712);
  const [newLon, setNewLon] = useState(23.6236);
  const [newNotes, setNewNotes] = useState('');
  const [creating, setCreating] = useState(false);

  async function handleCreate(e) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    const payload = {
      id: `ui-${Date.now()}`,
      type: newType,
      severity: Number(newSeverity) || 1,
      lat: Number(newLat),
      lon: Number(newLon),
      notes: newNotes,
      status: 'new',
      received_at: new Date().toISOString()
    };
    try {
      const res = await axios.post('/debug/publish', payload);
      // backend will broadcast and SSE subscription will update UI
      // make sure we have canonical object merged
      const serverInc = res?.data?.payload || res?.data;
      if (serverInc && serverInc.id) {
        setIncidents(prev => {
          const found = prev.find(p => p.id === serverInc.id);
          if (found) return prev.map(p => p.id === serverInc.id ? { ...p, ...serverInc } : p);
          return [serverInc, ...prev];
        });
      }
      // reset form
      setNewNotes('');
    } catch (err) {
      console.error('Failed to create incident', err);
      alert('Create failed: ' + (err?.response?.data?.detail || err.message));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="admin-incidents">
      <header className="admin-header">
        <h1>Incident Management</h1>
        <div className="connection-status">
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          {connected ? 'Live' : 'Disconnected'}
        </div>
      </header>

      {/* Create new incident form */}
      <div style={{marginTop: 12, marginBottom: 12}}>
        <form onSubmit={handleCreate} style={{display: 'flex', gap: 8, alignItems: 'center'}}>
          <select value={newType} onChange={e => setNewType(e.target.value)} style={{padding: '8px 10px'}}>
            <option value="medical">Medical</option>
            <option value="fire">Fire</option>
            <option value="other">Other</option>
          </select>
          <input type="number" value={newSeverity} onChange={e => setNewSeverity(e.target.value)} min={1} max={5} style={{width: 80, padding: '8px 10px'}} />
          <input type="number" step="0.00001" value={newLat} onChange={e => setNewLat(e.target.value)} style={{width: 140, padding: '8px 10px'}} />
          <input type="number" step="0.00001" value={newLon} onChange={e => setNewLon(e.target.value)} style={{width: 140, padding: '8px 10px'}} />
          <input placeholder="notes" value={newNotes} onChange={e => setNewNotes(e.target.value)} style={{flex: 1, padding: '8px 10px'}} />
          <button type="submit" disabled={creating} style={{padding: '8px 12px'}}>{creating ? 'Creating…' : 'Create Incident'}</button>
        </form>
      </div>

      {/* Status filter tabs with counts */}
      <nav className="filter-tabs">
        {['all', 'new', 'accepted', 'declined', 'resolved'].map((s) => (
          <button
            key={s}
            className={`tab ${filter === s ? 'active' : ''}`}
            onClick={() => setFilter(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            <span className="count">{counts[s]}</span>
          </button>
        ))}
        <button className="refresh-btn" onClick={fetchIncidents} title="Refresh from server">
          ↻
        </button>
      </nav>

      {/* Incidents table */}
      <div className="incidents-table-wrapper">
        {loading ? (
          <div className="loading">Loading incidents...</div>
        ) : filteredIncidents.length === 0 ? (
          <div className="empty">No incidents found</div>
        ) : (
          <table className="incidents-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Location</th>
                <th>Status</th>
                <th>Received</th>
                <th>Updated</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {filteredIncidents.map((inc) => (
                <tr key={inc.id + (inc.received_at || '')} className={`status-${inc.status || 'new'}`}>
                  <td className="id-cell" title={inc.id}>{inc.id}</td>
                  <td>{inc.type || '—'}</td>
                  <td className="severity">{inc.severity || '—'}</td>
                  <td className="location">
                    {inc.lat && inc.lon ? `${inc.lat.toFixed(4)}, ${inc.lon.toFixed(4)}` : '—'}
                  </td>
                  <td>
                    <span className={`status-badge ${inc.status || 'new'}`}>
                      {inc.status || 'new'}
                    </span>
                  </td>
                  <td className="time">{formatTime(inc.received_at)}</td>
                  <td className="time">{formatTime(inc.updated_at)}</td>
                  <td className="notes">{inc.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Summary footer */}
      <footer className="admin-footer">
        <div className="summary">
          Total: <strong>{counts.all}</strong> | 
          Active: <strong>{counts.new + counts.accepted}</strong> | 
          Resolved: <strong>{counts.resolved}</strong>
        </div>
      </footer>
    </div>
  );
}
