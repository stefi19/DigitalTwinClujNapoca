import React, { useEffect, useState, useRef } from "react";
import axios from 'axios';
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import "./style.css";

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

export default function FireDispatchDynamic() {
    const [pending, setPending] = useState([]);
    const [loading, setLoading] = useState(true);
    const [assigningId, setAssigningId] = useState(null);
    const [units, setUnits] = useState([]);
    const [selectedUnitFor, setSelectedUnitFor] = useState({});
    const mapRef = useRef(null)
    const mapContainerRef = useRef(null)
    const [focusedCoords, setFocusedCoords] = useState(null)
    const esRef = useRef(null);

    useEffect(() => {
        let mounted = true;
        async function load() {
            try {
                setLoading(true);
                // show accepted fire incidents waiting for dispatch
                const res = await axios.get('/incidents', { params: { status: 'accepted' } });
                if (!mounted) return;
                const items = (res.data || []).filter(i => i.type === 'fire' && i.status === 'accepted');
                setPending(items);
                // fetch current units pool (fire units)
                try {
                    const a = await axios.get('/ambulances');
                    if (mounted) setUnits((a.data || []).filter(u => u.unit_type === 'fire'));
                } catch (e) { console.warn('failed to load units', e) }
            } catch (err) {
                console.error('Failed to load pending fire incidents', err);
            } finally {
                if (mounted) setLoading(false);
            }
        }
        load();

        try {
            const es = new EventSource('/stream/incidents');
            es.onmessage = (e) => {
                try {
                    const inc = JSON.parse(e.data);
                    if (!inc || !inc.id) return;

                                        if (inc.resource === 'ambulance') {
                        // update units list when fire units change
                        setUnits(prev => {
                            const idx = prev.findIndex(a => a.ambulance_id === inc.ambulance_id);
                            if (idx >= 0) {
                                const copy = [...prev]; copy[idx] = { ...copy[idx], ...inc }; return copy;
                            }
                            // only insert if it's a fire unit
                            if (inc.unit_type === 'fire') return [inc, ...prev];
                            return prev;
                        });
                                                // auto-center map to updated unit if it has an incident
                                                try {
                                                    if (inc.incident_id && mapRef.current && mapRef.current.isStyleLoaded && mapRef.current.isStyleLoaded()) {
                                                        const lon = Number(inc.lon); const lat = Number(inc.lat)
                                                        if (!Number.isNaN(lon) && !Number.isNaN(lat)) {
                                                            mapRef.current.flyTo({ center: [lon, lat], zoom: 13, speed: 0.6 })
                                                        }
                                                    }
                                                } catch (e) { /* ignore */ }
                                                return;
                    }

                    setPending(prev => {
                        if (inc.type !== 'fire') return prev.filter(p => p.id !== inc.id);
                        if (inc.status === 'accepted') {
                            const idx = prev.findIndex(p => p.id === inc.id);
                            if (idx >= 0) {
                                const copy = [...prev]; copy[idx] = { ...copy[idx], ...inc }; return copy;
                            }
                            return [inc, ...prev];
                        }
                        return prev.filter(p => p.id !== inc.id);
                    });
                } catch (err) {
                    console.warn('Malformed SSE', err);
                }
            };
            es.onerror = () => { console.warn('SSE error (fire dispatch)'); };
            esRef.current = es;
        } catch (err) { console.warn('EventSource not available', err); }

        return () => { mounted = false; if (esRef.current) esRef.current.close(); };
    }, []);

    // initialize Mapbox map for dispatch view
    useEffect(() => {
        const token = process.env.REACT_APP_MAPBOX_TOKEN || ''
        const tokenMissing = !token || token === 'your_mapbox_token_here' || token === 'REPLACE_ME'
        if (tokenMissing) return
        if (mapRef.current || !mapContainerRef.current) return
        try {
            mapboxgl.accessToken = token
            const m = new mapboxgl.Map({ container: mapContainerRef.current, style: 'mapbox://styles/mapbox/streets-v11', center: [23.6,46.77], zoom: 12 })
            mapRef.current = m
            m.on('load', () => {
                try {
                    if (!m.getSource('dispatch-units')) m.addSource('dispatch-units', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
                    if (!m.getLayer('dispatch-units-layer')) m.addLayer({ id: 'dispatch-units-layer', type: 'circle', source: 'dispatch-units', paint: { 'circle-radius': 10, 'circle-color': '#10b981', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })
                    if (!m.getSource('dispatch-incidents')) m.addSource('dispatch-incidents', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
                    if (!m.getLayer('dispatch-incidents-layer')) m.addLayer({ id: 'dispatch-incidents-layer', type: 'circle', source: 'dispatch-incidents', paint: { 'circle-radius': 12, 'circle-color': '#ef4444', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })
                } catch (e) { console.warn('dispatch map init layers failed', e) }
            })
        } catch (e) { console.warn('Failed to init dispatch map', e) }
        return () => { try { if (mapRef.current) mapRef.current.remove(); mapRef.current = null } catch (e) {} }
    }, [mapContainerRef.current])

    // update map data when units or pending incidents change
    useEffect(() => {
        const map = mapRef.current
        if (!map || !map.getSource) return
        try {
            const unitFeatures = (units || []).map(u => ({ type: 'Feature', properties: { id: u.ambulance_id, name: u.unit_name, status: u.status }, geometry: { type: 'Point', coordinates: [Number(u.lon || 0), Number(u.lat || 0)] } }))
            if (map.getSource('dispatch-units')) map.getSource('dispatch-units').setData({ type: 'FeatureCollection', features: unitFeatures })

            const incFeatures = (pending || []).map(i => ({ type: 'Feature', properties: { id: i.id, severity: i.severity }, geometry: { type: 'Point', coordinates: [Number(i.lon || i.location?.lon || 0), Number(i.lat || i.location?.lat || 0)] } }))
            if (map.getSource('dispatch-incidents')) map.getSource('dispatch-incidents').setData({ type: 'FeatureCollection', features: incFeatures })

            // if we have a single focused coord set, fly to it
            if (focusedCoords && Array.isArray(focusedCoords) && focusedCoords.length === 2) {
                try { map.flyTo({ center: focusedCoords, zoom: 13, speed: 0.6 }) } catch (e) {}
            }
        } catch (e) { console.warn('Failed to update dispatch map sources', e) }
    }, [units, pending, focusedCoords])

    async function refreshUnits() {
        try {
            const a = await axios.get('/ambulances');
            setUnits((a.data || []).filter(u => u.unit_type === 'fire'));
        } catch (e) { console.warn('failed to refresh units', e); alert('Failed to refresh units'); }
    }

    async function assignIncident(id) {
        if (assigningId) return;
        setAssigningId(id);
        setPending(prev => prev.filter(p => p.id !== id));
        try {
            const selectedId = selectedUnitFor[id];
            if (selectedId) {
                const unit = units.find(a => a.ambulance_id === selectedId);
                if (!unit) throw new Error('Selected unit not found');
                const res = await axios.post(`/incidents/${encodeURIComponent(id)}/assign`, {
                    unit_name: unit.unit_name || (`Unit ${selectedId.slice(0,6)}`),
                    start_lat: Number(unit.lat),
                    start_lon: Number(unit.lon),
                    speed_kmh: unit.speed_kmh || 60,
                    unit_type: 'fire'
                });
                console.log('Assigned existing fire unit', res.data);
            } else {
                const incident = pending.find(p => p.id === id) || {};
                const start_lat = (incident.lat ? Number(incident.lat) + 0.008 : 0);
                const start_lon = (incident.lon ? Number(incident.lon) + 0.008 : 0);
                const unitName = `Fire-${new Date().getTime().toString().slice(-4)}`;
                const res = await axios.post(`/incidents/${encodeURIComponent(id)}/assign`, {
                    unit_name: unitName,
                    start_lat,
                    start_lon,
                    speed_kmh: 60,
                    unit_type: 'fire'
                });
                console.log('Assigned new fire unit', res.data);
            }
        } catch (err) {
            console.error('Assign failed', err);
            alert('Assign failed: ' + (err?.response?.data?.detail || err.message));
            try { const r = await axios.get('/incidents', { params: { status: 'accepted' } }); setPending((r.data || []).filter(i=>i.type==='fire')); } catch(e){}
        } finally {
            setAssigningId(null);
        }
    }

    return (
        <div className="fire-detailed-root">
            <header className="fire-detailed-header">
                <div>
                    <h2>Fire Dispatch</h2>
                    <div className="muted">Dispatch accepted fire incidents and manage units in real time.</div>
                </div>
            </header>

            <div className="fire-detailed-content">
                <aside className="fire-list">
                    {loading ? (
                        <div className="empty">Loading fire incidents…</div>
                    ) : pending.length === 0 ? (
                        <div className="empty">No fire incidents pending dispatch</div>
                        ) : (
                        pending.map(inc => (
                            <div key={inc.id + (inc.received_at||'')} className={`fire-item ${assigningId===inc.id ? 'selected' : ''}`} style={{cursor:'pointer'}} onClick={() => {
                                try {
                                    const lon = Number(inc.lon || inc.location?.lon || 0)
                                    const lat = Number(inc.lat || inc.location?.lat || 0)
                                    if (mapRef.current && !Number.isNaN(lon) && !Number.isNaN(lat)) mapRef.current.flyTo({ center: [lon, lat], zoom: 14, speed: 0.6 })
                                } catch (e) {}
                            }}>
                                <div>
                                    <div className="row-top">
                                        <div className="title">{inc.type || 'Incident'} — sev {inc.severity}</div>
                                        <div className={`pill ${inc.severity || 'low'}`}>sev {inc.severity || '-'}</div>
                                    </div>
                                    <div className="meta">{inc.received_at ? new Date(inc.received_at).toLocaleString() : ''}</div>
                                    <div className="summary">{inc.notes || (inc.lat && inc.lon ? `${Number(inc.lat).toFixed(5)}, ${Number(inc.lon).toFixed(5)}` : '—')}</div>
                                </div>
                                <div style={{marginTop:8}}>
                                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                                        <select className="unit-select" value={selectedUnitFor[inc.id] || ''} onChange={(e)=>setSelectedUnitFor(prev=>({...prev,[inc.id]: e.target.value}))}>
                                            <option value="">-- choose fire unit (or create new) --</option>
                                            {units.map(a => {
                                                const disabled = (a.status && a.status !== 'idle' && a.status !== 'arrived') || !!a.incident_id;
                                                let extra = '';
                                                try {
                                                    if (a.lat != null && a.lon != null && inc.lat != null && inc.lon != null) {
                                                        const dist = haversineMeters(Number(a.lat), Number(a.lon), Number(inc.lat), Number(inc.lon));
                                                        const speedKmh = Number(a.speed_kmh) || 60;
                                                        const speedMs = speedKmh * 1000.0 / 3600.0;
                                                        const etaSec = Math.max(0, dist / Math.max(0.1, speedMs));
                                                        const etaDate = new Date(Date.now() + etaSec*1000);
                                                        extra = ` — ${formatDistance(dist)} / ETA ${formatETA(etaDate)}`;
                                                    }
                                                } catch (e) { extra = ''; }
                                                return (
                                                    <option key={a.ambulance_id} value={a.ambulance_id} disabled={disabled}>
                                                        {a.unit_name || a.ambulance_id} — {a.unit_type || 'fire'}{disabled ? ` (busy: ${a.status || 'assigned'})` : ''}{extra}
                                                    </option>
                                                );
                                            })}
                                        </select>
                                        <button className="btn" onClick={refreshUnits} style={{padding:'6px 10px'}}>Refresh units</button>
                                    </div>
                                    <div style={{marginTop:8}}>
                                        <button className="btn accept" onClick={() => assignIncident(inc.id)} disabled={assigningId === inc.id}>{assigningId === inc.id ? 'Dispatching…' : 'Dispatch'}</button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </aside>

                <main className="fire-detail">
                    {/* dispatch map */}
                    <div className="detail-card" style={{marginBottom:12}}>
                        <div ref={mapContainerRef} className="dispatch-map" style={{width:'100%',height:320,borderRadius:8,overflow:'hidden'}} />
                    </div>

                    <div className="detail-card">
                        <h3>Active fire units</h3>
                        {units.length === 0 ? <div className="empty">No fire units active</div> : (
                            <div style={{display:'grid',gap:8}}>
                                {units.map(a => (
                                    <div key={a.ambulance_id} className="unit-card">
                                        <div style={{fontWeight:700}}>{a.unit_name} — {a.status}</div>
                                        <div style={{fontSize:13}}>{a.ambulance_id}</div>
                                        <div style={{fontSize:13,color:'#555'}}>ETA: {a.eta ? new Date(a.eta).toLocaleTimeString() : '—'}</div>
                                        <div style={{fontSize:12,color:'#666'}}>coords: {Number(a.lat || 0).toFixed(5)}, {Number(a.lon || 0).toFixed(5)}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </div>
    )
}
