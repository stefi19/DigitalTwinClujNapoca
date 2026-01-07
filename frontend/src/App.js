import React, { useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import axios from 'axios';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import { Pacient } from './components/Pacient';
import DoctorAssign from './components/DoctorAssign/DoctorAssignDynamic';
import DoctorDetailed from './components/DoctorDetailed';
import { DoctorClosure } from './components/DoctorClosure';
import { FireAlert } from './components/Fire/Alert';
import { FireDispatch } from './components/Fire/Dispatch';
import { FirePost } from './components/Fire/Post';
import AdminIncidents from './components/CityAdministrator/AdminIncidents';

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN || '';

function App() {
  const [map, setMap] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [ambulances, setAmbulances] = useState([]);
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [testType, setTestType] = useState('medical');
  const [testLat, setTestLat] = useState(46.77);
  const [testLon, setTestLon] = useState(23.6);
  const [testSeverity, setTestSeverity] = useState(3);

  useEffect(() => {
    // Only initialize Mapbox when the '#map' container exists on the page.
    // This avoids runtime errors when rendering non-map routes (eg. /pacient).
    const container = document.getElementById('map');
    if (!container) return;

    const m = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v11',
      center: [23.6, 46.77],
      zoom: 12
    });
    setMap(m);
    return () => {
      try {
        m.remove();
      } catch (err) {
        console.warn('Error removing map', err);
      }
      // clear map state so other effects don't try to use a removed map
      setMap(null);
    };
  }, []);

  useEffect(() => {
    // Use Server-Sent Events for live updates
    const es = new EventSource('/stream/incidents');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        // ambulance events use resource:'ambulance'
        if (data && data.resource === 'ambulance') {
          setAmbulances(prev => {
            const idx = prev.findIndex(a => a.ambulance_id === data.ambulance_id);
            if (idx >= 0) {
              const copy = [...prev]; copy[idx] = { ...copy[idx], ...data }; return copy;
            }
            return [data, ...prev].slice(0, 200);
          });
        } else {
          setIncidents(prev => [data, ...prev].slice(0, 200));
        }
      } catch (err) {
        console.warn('Failed to parse SSE message', err);
      }
    };
    es.onerror = (err) => {
      console.warn('SSE error', err);
      es.close();
    };
    // fallback initial load
    async function load() {
      try {
        const res = await axios.get('/incidents');
        setIncidents(res.data || []);
        // fetch existing ambulances so map has full pool
        try {
          const a = await axios.get('/ambulances');
          setAmbulances(a.data || []);
        } catch (err) {
          // ignore if endpoint missing
        }
      } catch (e) {
        console.warn('Failed to load incidents', e);
      }
    }
    load();
    return () => es.close();
  }, []);

  useEffect(() => {
    if (!map) return;
    // ensure map container still exists (map may have been removed during navigation/hot-reload)
    try {
      const container = typeof map.getContainer === 'function' ? map.getContainer() : null;
      if (!container) return;
    } catch (err) {
      // map is in an invalid state
      console.warn('Map is not ready for markers', err);
      return;
    }

    // remove existing incident markers and re-create (we keep ambulance markers separate)
    if (map._dernMarkers) {
      map._dernMarkers.forEach(mk => { try { mk.remove(); } catch (err) { console.warn('Error removing marker', err); } });
    }
    map._dernMarkers = incidents.map(inc => {
      const el = document.createElement('div');
      el.style.width = '14px';
      el.style.height = '14px';
      el.style.background = inc.type === 'medical' ? 'red' : (inc.type === 'fire' ? 'orange' : 'blue');
      el.style.borderRadius = '50%';
      try {
        const mk = new mapboxgl.Marker(el).setLngLat([inc.lon, inc.lat]).addTo(map);
        return mk;
      } catch (err) {
        console.warn('Failed to add marker to map', err);
        return null;
      }
    }).filter(Boolean);

  // Manage ambulance markers: create if missing, otherwise animate to new position
    if (!map._dernAmbMarkers) map._dernAmbMarkers = {};
    if (!map._dernAmbAnims) map._dernAmbAnims = {};
  if (!map._dernRouteLayers) map._dernRouteLayers = {};
  if (!map._dernRouteProgress) map._dernRouteProgress = {};

    function animateMarker(marker, from, to, duration = 1800) {
      const start = performance.now();
      const frame = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const lat = from[1] + (to[1] - from[1]) * t;
        const lon = from[0] + (to[0] - from[0]) * t;
        try { marker.setLngLat([lon, lat]); } catch (e) {}
        if (t < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }

    ambulances.forEach(a => {
      const key = a.ambulance_id;
      if (!key) return;
      const lngLat = [Number(a.lon), Number(a.lat)];
      if (!map._dernAmbMarkers[key]) {
        const el = document.createElement('div');
        el.style.width = '20px';
        el.style.height = '20px';
        el.style.background = (a.unit_type === 'fire') ? '#F97316' : '#06b6d4';
        el.style.border = '2px solid #fff';
        el.style.borderRadius = '50%';
        el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.3)';
        try {
          const mk = new mapboxgl.Marker(el).setLngLat(lngLat).addTo(map);
          map._dernAmbMarkers[key] = mk;
        } catch (err) {
          console.warn('Failed to add ambulance marker', err);
        }
      } else {
        const mk = map._dernAmbMarkers[key];
        // animate from current marker pos to new pos
        try {
          const curr = mk.getLngLat();
          const from = [curr.lng, curr.lat];
          const to = lngLat;
          animateMarker(mk, from, to, 1800);
        } catch (err) {
          try { mk.setLngLat(lngLat); } catch(e){}
        }
      }

      // Draw route polyline if backend provided it
      try {
        if (a.route) {
          let geom = null;
          try {
            geom = typeof a.route === 'string' ? JSON.parse(a.route) : a.route;
          } catch (e) {
            geom = a.route;
          }
          // expect geometry object like { type: 'LineString', coordinates: [[lon,lat], ...] }
            if (geom && geom.type && geom.coordinates) {
            const srcId = `route-src-${key}`;
            const layerId = `route-layer-${key}`;
            const feature = { type: 'Feature', geometry: geom };
            try {
              if (map.getSource && map.getSource(srcId)) {
                map.getSource(srcId).setData(feature);
              } else {
                map.addSource(srcId, { type: 'geojson', data: feature });
                map.addLayer({
                  id: layerId,
                  type: 'line',
                  source: srcId,
                  layout: { 'line-join': 'round', 'line-cap': 'round' },
                  paint: { 'line-color': '#06b6d4', 'line-width': 4, 'line-opacity': 0.9 }
                });
                map._dernRouteLayers[key] = { srcId, layerId };
              }
            } catch (e) {
              // style may not be loaded yet or source exists; ignore
            }
          }
        } else {
          // remove any previous route for this unit
          const existing = map._dernRouteLayers[key];
          if (existing) {
            try {
              if (map.getLayer && map.getLayer(existing.layerId)) map.removeLayer(existing.layerId);
              if (map.getSource && map.getSource(existing.srcId)) map.removeSource(existing.srcId);
            } catch (e) {}
            delete map._dernRouteLayers[key];
          }
        }
        // If unit arrived, remove any route overlay
        if (a.status === 'arrived') {
          const existing = map._dernRouteLayers[key];
          if (existing) {
            try {
              if (map.getLayer && map.getLayer(existing.layerId)) map.removeLayer(existing.layerId);
              if (map.getSource && map.getSource(existing.srcId)) map.removeSource(existing.srcId);
            } catch (e) {}
            delete map._dernRouteLayers[key];
          }
        }
      } catch (err) {
        // ignore route drawing errors
      }
      // create/update a smooth progress marker that animates along the provided route geometry
      try {
        const progKey = `prog-${key}`;
        // remove any existing progress animation when route is missing
        if (!a.route || a.status === 'arrived') {
          const prev = map._dernRouteProgress[key];
          if (prev) {
            if (prev.raf) cancelAnimationFrame(prev.raf);
            try { prev.marker.remove(); } catch (e) {}
            delete map._dernRouteProgress[key];
          }
        } else {
          // ensure geom parsed
          let geom = null;
          try { geom = typeof a.route === 'string' ? JSON.parse(a.route) : a.route; } catch(e){ geom = a.route; }
          if (geom && geom.type === 'LineString' && Array.isArray(geom.coordinates) && geom.coordinates.length > 1) {
            const coords = geom.coordinates.map(c => [Number(c[0]), Number(c[1])]); // [lon,lat]
            // helper: compute length of segment in meters
            const segDist = (p1, p2) => {
              const toRad = v => v * Math.PI / 180;
              const R = 6371000; const lat1 = p1[1], lon1 = p1[0], lat2 = p2[1], lon2 = p2[0];
              const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
              const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); return R*c;
            };
            // compute cumulative distances
            const cum = [0];
            for (let i=1;i<coords.length;i++) cum[i] = cum[i-1] + segDist(coords[i-1], coords[i]);
            const total = cum[cum.length-1] || 0;

            // find nearest distance along route to current unit pos
            let nearestIdx = 0; let nearestDist = Infinity; let nearestAlong = 0;
            try {
              const ux = Number(a.lon), uy = Number(a.lat);
              for (let i=0;i<coords.length-1;i++) {
                // project point U onto segment AB
                const A = coords[i], B = coords[i+1];
                const Axy = [A[0], A[1]]; const Bxy = [B[0], B[1]];
                // simple approach: sample segment midpoint and endpoints distances (cheap)
                const samples = [A, [(A[0]+B[0])/2, (A[1]+B[1])/2], B];
                for (let s=0;s<samples.length;s++) {
                  const d = segDist([ux,uy], samples[s]);
                  if (d < nearestDist) { nearestDist = d; nearestIdx = i; nearestAlong = cum[i] + (s===0?0:(s===1?segDist(A,samples[1]):segDist(A,B))); }
                }
              }
            } catch(e) { /* ignore */ }

            // determine remaining distance along route from nearestAlong
            const remaining = Math.max(0, total - (nearestAlong || 0));
            const speedKmh = Number(a.speed_kmh) || 40; const speedMs = speedKmh * 1000/3600;
            const duration = Math.max(1, remaining / Math.max(0.1, speedMs)) * 1000; // ms

            // create or update progress marker
            let state = map._dernRouteProgress[key];
            if (!state) {
              const el = document.createElement('div');
              el.style.width = '12px'; el.style.height = '12px'; el.style.borderRadius = '50%'; el.style.background = '#fff'; el.style.border = '3px solid #06b6d4'; el.style.boxShadow='0 1px 3px rgba(0,0,0,0.3)';
              const pm = new mapboxgl.Marker(el).setLngLat([coords[0][0], coords[0][1]]).addTo(map);
              state = { marker: pm, raf: null, start: null, duration, coords, cum, total };
              map._dernRouteProgress[key] = state;
            } else {
              // update parameters
              state.duration = duration; state.coords = coords; state.cum = cum; state.total = total;
            }

            // start animation from nearestAlong to end
            if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
            const startOffset = Math.max(0, (nearestAlong || 0));
            const animStart = performance.now();
            const anim = (now) => {
              const elapsed = now - animStart;
              const t = Math.min(1, elapsed / Math.max(1, state.duration));
              const distAlong = startOffset + t * (state.total - startOffset);
              // get point at distAlong
              let pt = state.coords[state.coords.length-1];
              for (let i=1;i<state.cum.length;i++) {
                if (state.cum[i] >= distAlong) {
                  const segLen = state.cum[i] - state.cum[i-1] || 1;
                  const segT = (distAlong - state.cum[i-1]) / segLen;
                  const A = state.coords[i-1], B = state.coords[i];
                  const lon = A[0] + (B[0]-A[0]) * segT; const lat = A[1] + (B[1]-A[1]) * segT;
                  pt = [lon, lat];
                  break;
                }
              }
              try { state.marker.setLngLat(pt); } catch(e){}
              if (t < 1) state.raf = requestAnimationFrame(anim); else state.raf = null;
            };
            state.raf = requestAnimationFrame(anim);
          }
        }
      } catch(err) { /* ignore progress animation errors */ }
    });
  }, [map, incidents, ambulances]);

  return (
    <Router>
      <div style={{height: '100vh', display: 'flex'}}>
        <main style={{height: '100%', flex: 1, position: 'relative'}}>
          <Routes>
            <Route path="/" element={<div id="map" style={{height: '100%', width: '100%'}} />} />
            <Route path="/pacient" element={<Pacient />} />
            <Route path="/doctor/assign" element={<DoctorAssign />} />
            <Route path="/doctor/detailed" element={<DoctorDetailed />} />
            <Route path="/doctor/closure" element={<DoctorClosure />} />
            <Route path="/fire/alert" element={<FireAlert />} />
            <Route path="/fire/dispatch" element={<FireDispatch />} />
            <Route path="/fire/post" element={<FirePost />} />
            <Route path="/admin/incidents" element={<AdminIncidents />} />
          </Routes>
        </main>

        <aside style={{width: 360, maxWidth: '36%', padding: 12, background: 'rgba(255,255,255,0.95)', overflow: 'auto'}}>
          <div style={{display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap'}}>
            <NavLink to="/" style={({isActive}) => ({padding: '6px 8px', background: isActive? '#111827' : '#eef2ff', color: isActive? '#fff' : '#111', textDecoration: 'none'})} end>Dashboard</NavLink>
            <NavLink to="/pacient" style={({isActive}) => ({padding: '6px 8px', background: isActive? '#111827' : '#eef2ff', color: isActive? '#fff' : '#111', textDecoration: 'none'})}>Pacient</NavLink>
            <NavLink to="/doctor/assign" style={({isActive}) => ({padding: '6px 8px', background: isActive? '#111827' : '#eef2ff', color: isActive? '#fff' : '#111', textDecoration: 'none'})}>Doctor Assign</NavLink>
            <NavLink to="/doctor/detailed" style={({isActive}) => ({padding: '6px 8px', background: isActive? '#111827' : '#eef2ff', color: isActive? '#fff' : '#111', textDecoration: 'none'})}>Doctor Detailed</NavLink>
            <NavLink to="/doctor/closure" style={({isActive}) => ({padding: '6px 8px', background: isActive? '#111827' : '#eef2ff', color: isActive? '#fff' : '#111', textDecoration: 'none'})}>Doctor Closure</NavLink>
            <NavLink to="/fire/alert" style={({isActive}) => ({padding: '6px 8px', background: isActive? '#111827' : '#eef2ff', color: isActive? '#fff' : '#111', textDecoration: 'none'})}>Fire Alert</NavLink>
            <NavLink to="/fire/dispatch" style={({isActive}) => ({padding: '6px 8px', background: isActive? '#111827' : '#eef2ff', color: isActive? '#fff' : '#111', textDecoration: 'none'})}>Fire Dispatch</NavLink>
            <NavLink to="/fire/post" style={({isActive}) => ({padding: '6px 8px', background: isActive? '#111827' : '#eef2ff', color: isActive? '#fff' : '#111', textDecoration: 'none'})}>Fire Post</NavLink>
            <NavLink to="/admin/incidents" style={({isActive}) => ({padding: '6px 8px', background: isActive? '#EF4444' : '#fee2e2', color: isActive? '#fff' : '#991b1b', textDecoration: 'none', fontWeight: 600})}>🚨 Admin Incidents</NavLink>
          </div>

          <div style={{marginBottom: 12}}>
            <h3>Latest incidents</h3>
            <div style={{marginBottom: 12}}>
              <div style={{fontSize: 13, color: '#444'}}>To create new incidents use the Admin panel: <a href="/admin/incidents">Admin Incidents</a></div>
            </div>
          </div>

          <ul style={{listStyle: 'none', padding: 0}}>
            {incidents.map((inc, idx) => (
              <li key={inc.id + '_' + idx} style={{padding: '6px 0', borderBottom: '1px solid #eee'}}>
                <div><strong>{inc.type}</strong> — severity {inc.severity}</div>
                <div style={{fontSize: 12, color: '#666'}}>{inc.received_at || ''}</div>
                <div style={{fontSize: 12}}>{Number(inc.lat).toFixed(5)}, {Number(inc.lon).toFixed(5)}</div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </Router>
  );
}

export default App;
