import React, { useEffect, useState, useRef } from "react";
import axios from 'axios';
import "../Doctor/style.css";

function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000.0;
    const toRad = (v) => v * Math.PI / 180.0;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function formatDistance(m) {
    if (m >= 1000) return (m/1000).toFixed(1) + ' km';
    return Math.round(m) + ' m';
}

function formatETA(date) {
    try {
        const d = new Date(date);
        return d.toLocaleTimeString();
    } catch (e) { return '-'; }
}

export default function DoctorAssignDynamic() {
    const [pending, setPending] = useState([]);
    const [loading, setLoading] = useState(true);
    const [assigningId, setAssigningId] = useState(null);
    const [ambulances, setAmbulances] = useState([]);
    const [selectedUnitFor, setSelectedUnitFor] = useState({});
    const esRef = useRef(null);

    useEffect(() => {
        let mounted = true;
        async function load() {
            try {
                setLoading(true);
                // Assign page should show incidents that were accepted by a doctor and need ambulance assignment
                const res = await axios.get('/incidents', { params: { status: 'accepted' } });
                if (!mounted) return;
                // show accepted incidents (doctors can accept different types). We keep filtering in the select per incident type.
                const items = (res.data || []);
                setPending(items);
                // fetch current ambulances pool
                try {
                    const a = await axios.get('/ambulances');
                    if (mounted) setAmbulances(a.data || []);
                } catch (e) { console.warn('failed to load ambulances', e) }
            } catch (err) {
                console.error('Failed to load pending incidents', err);
            } finally {
                if (mounted) setLoading(false);
            }
        }
        load();

        // SSE: listen to all incidents and ambulance updates and keep pending list updated
        try {
            const es = new EventSource('/stream/incidents');
            es.onmessage = (e) => {
                try {
                    const inc = JSON.parse(e.data);
                    if (!inc || !inc.id) return;

                    // ambulance events include resource === 'ambulance'
                    if (inc.resource === 'ambulance') {
                        setAmbulances(prev => {
                            const idx = prev.findIndex(a => a.ambulance_id === inc.ambulance_id);
                            // Always update or insert ambulance records (including 'arrived' or 'idle') so UI can show them and allow reuse.
                            if (idx >= 0) {
                                const copy = [...prev]; copy[idx] = { ...copy[idx], ...inc }; return copy;
                            }
                            return [inc, ...prev];
                        });
                        return;
                    }

                    setPending(prev => {
                        // Only care about medical incidents in this view
                        if (inc.type !== 'medical') return prev.filter(p => p.id !== inc.id);
                        // If an incident becomes accepted, add/update it in this list
                        if (inc.status === 'accepted') {
                            const idx = prev.findIndex(p => p.id === inc.id);
                            if (idx >= 0) {
                                const copy = [...prev]; copy[idx] = { ...copy[idx], ...inc }; return copy;
                            }
                            return [inc, ...prev];
                        }
                        // If status changed away from accepted, remove from this list
                        return prev.filter(p => p.id !== inc.id);
                    });
                } catch (err) {
                    console.warn('Malformed SSE', err);
                }
            };
            es.onerror = () => {
                // keep existing pending list; we will retry on next mount
                console.warn('SSE error');
            };
            esRef.current = es;
        } catch (err) {
            console.warn('EventSource not available', err);
        }

        return () => { mounted = false; if (esRef.current) esRef.current.close(); };
    }, []);

    async function refreshUnits() {
        try {
            const a = await axios.get('/ambulances');
            setAmbulances(a.data || []);
        } catch (e) {
            console.warn('failed to refresh units', e);
            alert('Failed to refresh units');
        }
    }

    async function assignIncident(id) {
        if (assigningId) return;
        setAssigningId(id);
        // optimistic remove
        setPending(prev => prev.filter(p => p.id !== id));
        try {
            // If user selected a specific unit, use its coordinates as start position
            const selectedAmbId = selectedUnitFor[id];
            if (selectedAmbId) {
                const amb = ambulances.find(a => a.ambulance_id === selectedAmbId);
                if (!amb) throw new Error('Selected unit not found');
                const res = await axios.post(`/incidents/${encodeURIComponent(id)}/assign`, {
                    unit_name: amb.unit_name || (`Unit ${selectedAmbId.slice(0,6)}`),
                    start_lat: Number(amb.lat),
                    start_lon: Number(amb.lon),
                    speed_kmh: amb.speed_kmh || 40
                });
                console.log('Assigned to existing unit', res.data);
            } else {
                // Build a quick default starting point a short distance from the incident
                const incident = pending.find(p => p.id === id) || {};
                const start_lat = (incident.lat ? Number(incident.lat) + 0.008 : 0);
                const start_lon = (incident.lon ? Number(incident.lon) + 0.008 : 0);
                const unitName = `Amb ${new Date().getTime().toString().slice(-4)}`;
                const res = await axios.post(`/incidents/${encodeURIComponent(id)}/assign`, {
                    unit_name: unitName,
                    start_lat,
                    start_lon,
                    speed_kmh: 40
                });
                console.log('Assigned (new unit)', res.data);
            }
        } catch (err) {
            console.error('Assign failed', err);
            alert('Assign failed: ' + (err?.response?.data?.detail || err.message));
            // reload pending list to resync
            try { const r = await axios.get('/incidents', { params: { status: 'new' } }); setPending(r.data || []); } catch(e){/*ignore*/}
        } finally {
            setAssigningId(null);
        }
    }

    return (
        <div style={{padding: 12}}>
            <h2>Assign Doctor / Ambulance</h2>
            <div style={{marginBottom: 12, color: '#94A3B8'}}>This view shows all pending incidents (status=new). It updates in real time.</div>

            {loading ? <div>Loading pending incidents…</div> : (
                <div style={{display: 'grid', gap: 8}}>
                    {pending.length === 0 ? <div>No pending incidents</div> : pending.map(inc => (
                        <div key={inc.id + (inc.received_at||'')} style={{padding: 12, border: '1px solid #e6e6e6', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                            <div>
                                <div style={{fontWeight: 700}}>{inc.type || 'Incident'} — sev {inc.severity}</div>
                                <div style={{fontSize: 12, color: '#666'}}>{inc.received_at ? new Date(inc.received_at).toLocaleString() : ''}</div>
                                <div style={{fontSize: 13}}>{inc.notes || (inc.lat && inc.lon ? `${Number(inc.lat).toFixed(5)}, ${Number(inc.lon).toFixed(5)}` : '—')}</div>
                            </div>
                                    <div style={{display:'flex',flexDirection:'column',gap:8,alignItems:'flex-end'}}>
                                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                                            <select style={{padding:6,minWidth:220}} value={selectedUnitFor[inc.id] || ''} onChange={(e)=>setSelectedUnitFor(prev=>({...prev,[inc.id]: e.target.value}))}>
                                                <option value="">-- choose unit (or create new) --</option>
                                                {ambulances
                                                    .filter(a => {
                                                        // show only appropriate unit types for this incident
                                                        if (inc.type === 'fire') return (a.unit_type === 'fire');
                                                        if (inc.type === 'medical') return (a.unit_type !== 'fire');
                                                        return true;
                                                    })
                                                    .map(a => {
                                                        // allow units that are 'arrived' to be reused: treat 'arrived' as available
                                                        const disabled = (a.status && a.status !== 'idle' && a.status !== 'arrived') || !!a.incident_id;
                                                        // compute distance and ETA relative to the incident if coords available
                                                        let extra = '';
                                                        try {
                                                            if (a.lat != null && a.lon != null && inc.lat != null && inc.lon != null) {
                                                                const dist = haversineMeters(Number(a.lat), Number(a.lon), Number(inc.lat), Number(inc.lon));
                                                                const speedKmh = Number(a.speed_kmh) || 40;
                                                                const speedMs = speedKmh * 1000.0 / 3600.0;
                                                                const etaSec = Math.max(0, dist / Math.max(0.1, speedMs));
                                                                const etaDate = new Date(Date.now() + etaSec*1000);
                                                                extra = ` — ${formatDistance(dist)} / ETA ${formatETA(etaDate)}`;
                                                            }
                                                        } catch (e) { extra = ''; }
                                                        return (
                                                            <option key={a.ambulance_id} value={a.ambulance_id} disabled={disabled}>
                                                                {a.unit_name || a.ambulance_id} — {a.unit_type || 'ambulance'}{disabled ? ` (busy: ${a.status || 'assigned'})` : ''}{extra}
                                                            </option>
                                                        );
                                                    })}
                                            </select>
                                            <button onClick={refreshUnits} style={{padding:'6px 10px'}}>Refresh units</button>
                                        </div>
                                        <button onClick={() => assignIncident(inc.id)} disabled={assigningId === inc.id} style={{padding: '8px 12px'}}>{assigningId === inc.id ? 'Assigning…' : 'Assign'}</button>
                                    </div>
                        </div>
                    ))}
                </div>
            )}

            <div style={{marginTop: 18}}>
                <h3>Active ambulances</h3>
                {ambulances.length === 0 ? <div style={{fontSize:13,color:'#666'}}>No ambulances active</div> : (
                    <div style={{display:'grid',gap:8}}>
                        {ambulances.map(a => (
                            <div key={a.ambulance_id} style={{Padding:10,padding:10,border:'1px solid #eee',borderRadius:8}}>
                                <div style={{fontWeight:700}}>{a.unit_name} — {a.status}</div>
                                <div style={{fontSize:13}}>{a.ambulance_id}</div>
                                <div style={{fontSize:13,color:'#555'}}>ETA: {a.eta ? new Date(a.eta).toLocaleTimeString() : '—'}</div>
                                <div style={{fontSize:12,color:'#666'}}>coords: {Number(a.lat).toFixed(5)}, {Number(a.lon).toFixed(5)}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
