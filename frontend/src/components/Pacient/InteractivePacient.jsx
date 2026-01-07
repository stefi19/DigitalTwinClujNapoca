import React, { useEffect, useRef, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import './pacient-style.css';
import ambulanceSvg from './Ambulance15.svg';

// Simple haversine distance (meters)
function haversine([lon1, lat1], [lon2, lat2]) {
  function toRad(v) { return v * Math.PI / 180; }
  const R = 6371000; // metres
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export default function InteractivePacient() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const ambulanceMarkerRef = useRef(null);
  const routeLayerId = 'route-line';

  // Defaults inside Cluj-Napoca
  const [patientLng, setPatientLng] = useState(23.5889);
  const [patientLat, setPatientLat] = useState(46.7712);
  const [ambulanceLng, setAmbulanceLng] = useState(23.5659);
  const [ambulanceLat, setAmbulanceLat] = useState(46.7660);
  const [isRouting, setIsRouting] = useState(false);
  const [eta, setEta] = useState(null);
  const totalDurationRef = useRef(null); // seconds from Mapbox route
  const startDispatchRef = useRef(null);
  const [ambulances, setAmbulances] = useState([]);
  const [selectedAmb, setSelectedAmb] = useState(null);
  // keep per-ambulance progress animation state so we can resume when re-selecting
  const progressStatesRef = useRef({});
  const lastSetAmbUpdateRef = useRef(0);
  const [showOnlyEnroute, setShowOnlyEnroute] = useState(true);
  const [tick, setTick] = useState(0); // forces periodic re-render to update distances
  // multiplier for client-side animation speed (1 = real-time, >1 = faster)
  const ANIMATION_SPEED_MULT = 2.0;

  // speed in meters/second (will be multiplied by ANIMATION_SPEED_MULT)
  const speed = 13.9 * ANIMATION_SPEED_MULT; // ~50 km/h baseline

  // Mapbox token (may be injected at build time). Treat known placeholders as missing.
  const MAPBOX_TOKEN = process.env.REACT_APP_MAPBOX_TOKEN || '';
  const tokenMissing = !MAPBOX_TOKEN || MAPBOX_TOKEN === 'your_mapbox_token_here' || MAPBOX_TOKEN === 'REPLACE_ME';

  useEffect(() => {
    if (tokenMissing) {
      console.warn('Mapbox token missing or placeholder. Set REACT_APP_MAPBOX_TOKEN to a valid token to enable the embedded map.');
      return;
    }
    mapboxgl.accessToken = MAPBOX_TOKEN;
    if (mapRef.current) return; // already inited
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v11',
      center: [23.6, 46.77],
      zoom: 13
    });
    mapRef.current = map;

    map.on('load', () => {
      // add empty route source
      if (!map.getSource('route')) {
        map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
          id: routeLayerId,
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#1f7ed0', 'line-width': 6 }
        });
      }
    });

    return () => {
      try { map.remove(); } catch (e) { }
    };
  }, []);

  // load ambulances and listen for SSE updates
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch('/ambulances');
        const list = await res.json();
        if (mounted) setAmbulances(list || []);
        // prefill progressStatesRef with route geometries for accurate remaining distance calculations
        try {
          const states = progressStatesRef.current;
          (list || []).forEach(item => {
            try {
              if (item && item.route) {
                const geom = typeof item.route === 'string' ? JSON.parse(item.route) : item.route;
                if (geom && geom.type === 'LineString' && geom.coordinates) {
                  const { segLengths, total } = computeSegLengths(geom.coordinates.map(c => [c[0], c[1]]));
                  states[item.ambulance_id] = { ...(states[item.ambulance_id] || {}), coords: geom.coordinates, segLengths, total };
                }
              }
            } catch (e) { /* ignore per-item parse errors */ }
          });
        } catch (e) { /* ignore */ }
      } catch (e) { console.warn('Failed to load ambulances', e); }
    }
    load();

    let es;
    try {
      es = new EventSource('/stream/incidents');
      es.onmessage = (e) => {
        try {
          const it = JSON.parse(e.data);
          if (it && it.resource === 'ambulance') {
            setAmbulances(prev => {
              const idx = prev.findIndex(a => a.ambulance_id === it.ambulance_id);
              if (idx >= 0) {
                const copy = [...prev]; copy[idx] = { ...copy[idx], ...it }; return copy;
              }
              return [it, ...prev].slice(0,200);
            });
            // if server sent a route, store its coordinates and seg lengths for client-side projection
            try {
              if (it.route) {
                const states = progressStatesRef.current;
                const geom = typeof it.route === 'string' ? JSON.parse(it.route) : it.route;
                if (geom && geom.type === 'LineString' && geom.coordinates) {
                  const { segLengths, total } = computeSegLengths(geom.coordinates.map(c => [c[0], c[1]]));
                  states[it.ambulance_id] = { ...(states[it.ambulance_id] || {}), coords: geom.coordinates, segLengths, total };
                }
              }
            } catch (e) { /* ignore route parse errors */ }
            // if this is the currently selected ambulance, update marker immediately and sync animation
            if (selectedAmb && it.ambulance_id === selectedAmb) {
              setAmbulanceLng(Number(it.lon));
              setAmbulanceLat(Number(it.lat));
              // if backend provides eta we show it
              if (it.eta) {
                const rem = Math.max(0, (new Date(it.eta).getTime() - Date.now())/1000);
                setEta(Math.ceil(rem));
              }
              // if backend updated route, refresh route and restart progress animation
              if (it.route) {
                try { startProgressForRoute(it.route, it); } catch (e) { /*ignore*/ }
              }
              // if we already have a per-ambulance progress state for this route, update its startTime
              try {
                const st = progressStatesRef.current[it.ambulance_id];
                if (st && st.coords && it.lon != null && it.lat != null) {
                  const proj = projectPointAlongRoute(st.coords, [Number(it.lon), Number(it.lat)]);
                  const frac = Math.max(0, Math.min(1, proj.distanceAlong / st.total));
                  st.startTime = performance.now() - frac * st.duration;
                }
              } catch(e) { /* ignore projection errors */ }
            }
          }
        } catch (err) { console.warn('Malformed SSE', err); }
      };
      es.onerror = () => { console.warn('SSE error (pacient)'); };
    } catch (e) { console.warn('EventSource not available', e); }

    return () => { mounted = false; if (es) es.close(); };
  }, [selectedAmb]);

  // Listen for local test incident events from the sidebar
  useEffect(() => {
    function handler(e) {
      try {
        const payload = e.detail;
        if (!payload) return;
        if (payload.type === 'medical') {
          // set patient coordinates from payload
          if (typeof payload.lat === 'number' && typeof payload.lon === 'number') {
            setPatientLat(payload.lat);
            setPatientLng(payload.lon);
          }
          // small delay to let map/markers update, then call the latest startDispatch
          setTimeout(() => {
            if (startDispatchRef.current) startDispatchRef.current();
          }, 400);
        }
      } catch (err) {
        console.warn('test incident handler error', err);
      }
    }
    window.addEventListener('dern:test-incident', handler);
    return () => window.removeEventListener('dern:test-incident', handler);
  }, []);

  useEffect(() => {
    // keep ambulance and patient markers updated when map exists and style is loaded
    const map = mapRef.current;
    if (!map) return;

    const setupMarkers = () => {
      // create or update patient marker
      if (!map.getLayer('patient-point')) {
        if (!map.getSource('patient-point')) {
          map.addSource('patient-point', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: [patientLng, patientLat] } } });
        }
        map.addLayer({ id: 'patient-point', type: 'circle', source: 'patient-point', paint: { 'circle-radius': 8, 'circle-color': '#e11d48' } });
      } else {
        const s = map.getSource('patient-point');
        if (s) s.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [patientLng, patientLat] } });
      }

      // create or update ambulance marker (we use a DOM marker for easy rotation)
      if (!ambulanceMarkerRef.current) {
        const el = document.createElement('div');
        el.style.width = '32px';
        el.style.height = '32px';
        el.style.backgroundImage = `url(${ambulanceSvg})`;
        el.style.backgroundSize = 'contain';
        el.style.backgroundRepeat = 'no-repeat';
        ambulanceMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat([ambulanceLng, ambulanceLat]).addTo(map);
      } else {
        ambulanceMarkerRef.current.setLngLat([ambulanceLng, ambulanceLat]);
      }
    };

    if (map.isStyleLoaded && map.isStyleLoaded()) {
      setupMarkers();
    } else {
      map.once('load', setupMarkers);
    }

    // no cleanup here for markers (they live with the map)
  }, [patientLng, patientLat, ambulanceLng, ambulanceLat]);

  // perform routing and animate ambulance along route
  const startDispatch = useCallback(async () => {
    const map = mapRef.current;
    const token = process.env.REACT_APP_MAPBOX_TOKEN || '';
    if (!map || !token) {
      alert('Map or Mapbox token not ready');
      return;
    }

    setIsRouting(true);
    setEta(null);

    const start = `${ambulanceLng},${ambulanceLat}`;
    const end = `${patientLng},${patientLat}`;
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start};${end}?geometries=geojson&overview=full&access_token=${token}`;

    let data;
    try {
      console.debug('Directions URL', url);
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '<no-body>');
        throw new Error(`Directions API error ${res.status} ${res.statusText}: ${body}`);
      }
      data = await res.json();
      if (!data.routes || !data.routes[0]) throw new Error('No route in response');
    } catch (err) {
      console.error('Directions error', err);
      alert('Failed to fetch directions: ' + (err?.message || err));
      setIsRouting(false);
      return;
    }

    const coords = data.routes[0].geometry.coordinates; // array of [lng, lat]
    // prefer Mapbox-provided duration (seconds)
    // apply client-side speed multiplier so animation feels snappier
    totalDurationRef.current = data.routes[0].duration ? (data.routes[0].duration / ANIMATION_SPEED_MULT) : null;
    if (totalDurationRef.current) {
      setEta(Math.ceil(totalDurationRef.current));
    }

    // set route on map
    try {
      const src = map.getSource('route');
      src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }] });
    } catch (e) {
      console.warn('Could not set route source', e);
    }

    // precompute segment lengths
    const segLengths = [];
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const d = haversine(coords[i], coords[i+1]);
      segLengths.push(d);
      total += d;
    }

    // animate along route using requestAnimationFrame
    let startTime = null;

    function step(ts) {
      if (!startTime) startTime = ts;
      const elapsed = (ts - startTime) / 1000; // seconds

      if (totalDurationRef.current) {
        const totalDur = totalDurationRef.current;
        const frac = Math.min(1, elapsed / totalDur);
        // compute position by fraction along cumulative distances
        const targetDist = frac * total;
        let acc = 0;
        let idx = 0;
        while (idx < segLengths.length && acc + segLengths[idx] < targetDist) {
          acc += segLengths[idx];
          idx++;
        }
        if (idx >= segLengths.length) {
          const last = coords[coords.length - 1];
          ambulanceMarkerRef.current.setLngLat(last);
          setEta(0);
          setIsRouting(false);
          return;
        }
        const segStart = coords[idx];
        const segEnd = coords[idx + 1];
        const segDist = segLengths[idx];
        const segProgress = (targetDist - acc) / segDist;
        const curLng = segStart[0] + (segEnd[0] - segStart[0]) * segProgress;
        const curLat = segStart[1] + (segEnd[1] - segStart[1]) * segProgress;
        ambulanceMarkerRef.current.setLngLat([curLng, curLat]);

        const remaining = Math.max(0, totalDur - elapsed);
        setEta(Math.ceil(remaining));
        if (frac < 1) requestAnimationFrame(step); else { setIsRouting(false); }
      } else {
        // fallback to distance-based animation
        const distanceTraveled = Math.min(elapsed * speed, total);
        let acc = 0;
        let idx = 0;
        while (idx < segLengths.length && acc + segLengths[idx] < distanceTraveled) {
          acc += segLengths[idx];
          idx++;
        }
        if (idx >= segLengths.length) {
          const last = coords[coords.length - 1];
          ambulanceMarkerRef.current.setLngLat(last);
          setEta(0);
          setIsRouting(false);
          return;
        }
        const segStart = coords[idx];
        const segEnd = coords[idx + 1];
        const segDist = segLengths[idx];
        const segProgress = (distanceTraveled - acc) / segDist;
        const curLng = segStart[0] + (segEnd[0] - segStart[0]) * segProgress;
        const curLat = segStart[1] + (segEnd[1] - segStart[1]) * segProgress;
        ambulanceMarkerRef.current.setLngLat([curLng, curLat]);

        const remaining = Math.max(0, total - distanceTraveled);
        setEta(Math.ceil(remaining / speed));
        if (distanceTraveled < total) requestAnimationFrame(step); else { setIsRouting(false); }
      }
    }

    requestAnimationFrame(step);
  }, [ambulanceLng, ambulanceLat, patientLng, patientLat, speed]);

  // keep a ref to the latest startDispatch so event listener can call it
  useEffect(() => { startDispatchRef.current = startDispatch; }, [startDispatch]);

  // tick every second to force re-render so distances/ETAs recompute in real-time for all units
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // helper to compute segment lengths and start a smooth animation along given coordinates
  function computeSegLengths(coords) {
    const seg = [];
    let total = 0;
    for (let i=0;i<coords.length-1;i++) {
      const d = haversine(coords[i], coords[i+1]);
      seg.push(d);
      total += d;
    }
    return { segLengths: seg, total };
  }

  function stopProgressAnimation(ambulance_id) {
    const states = progressStatesRef.current;
    if (!ambulance_id) return;
    const st = states[ambulance_id];
    if (!st) return;
    if (st.raf) { cancelAnimationFrame(st.raf); st.raf = null; }
    st.startTime = null; st.duration = null; st.coords = null; st.segLengths = null; st.total = null;
  }

  function projectPointAlongRoute(coords, point) {
    // returns distanceAlongFromStart (meters) and nearest fraction
    let best = { dist: Infinity, along: 0 };
    let acc = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      const A = coords[i]; const B = coords[i+1];
      // project point P onto segment AB
      const x1 = A[0], y1 = A[1], x2 = B[0], y2 = B[1];
      const px = point[0], py = point[1];
      const dx = x2 - x1, dy = y2 - y1;
      const segLen2 = dx*dx + dy*dy;
      let t = 0;
      if (segLen2 > 0) t = ((px - x1) * dx + (py - y1) * dy) / segLen2;
      t = Math.max(0, Math.min(1, t));
      const projX = x1 + t * dx, projY = y1 + t * dy;
      const d = haversine([projX, projY], [px, py]);
      const distAlong = acc + haversine([x1, y1], [projX, projY]);
      if (d < best.dist) best = { dist: d, along: distAlong };
      acc += haversine([x1, y1], [x2, y2]);
    }
    return { distanceAlong: best.along };
  }

  function startProgressForRoute(routeGeom, ambObj, forceStart = false) {
    // routeGeom may be string or object; expect LineString geometry
    let geom = null;
    try { geom = typeof routeGeom === 'string' ? JSON.parse(routeGeom) : routeGeom; } catch(e) { geom = routeGeom; }
    if (!geom || !geom.coordinates || geom.type !== 'LineString') return;
    const coords = geom.coordinates; // [ [lon,lat], ... ]
  const { segLengths, total } = computeSegLengths(coords.map(c=>[c[0], c[1]]));
    // compute duration: prefer backend ETA if available and in the future; otherwise fallback to speed estimate
    let duration = null;
    if (ambObj && ambObj.eta) {
      try {
        const remSec = (new Date(ambObj.eta).getTime() - Date.now())/1000;
        // ignore stale or too-small ETA values (they cause instant arrival); require at least 3s
        if (remSec > 3) duration = remSec;
      } catch (e) { duration = null; }
    }
    if (!duration) {
      // fallback: use speed_kmh if available, and apply client-side speed multiplier
  const speedKmh = Number(ambObj?.speed_kmh) || 40;
  const speedMs = speedKmh * 1000/3600;
      duration = Math.max(1, total / Math.max(0.1, speedMs));
    }

    // set route on map (source 'route' exists)
    const map = mapRef.current;
    if (map && map.getSource) {
      try {
        const src = map.getSource('route');
        if (src) {
          src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }] });
        }
      } catch (e) { console.warn('Could not set route on select', e); }
    }

  // reset any previous animation for this ambulance and ETA
  stopProgressAnimation(ambObj?.ambulance_id);
  setEta(null);

    const states = progressStatesRef.current;
    const aid = ambObj?.ambulance_id || ('anon-' + Math.random().toString(36).slice(2,8));
    // create or update per-ambulance state
    const state = states[aid] = states[aid] || { raf: null, startTime: null, duration: null, coords: null, segLengths: null, total: null };
    state.coords = coords;
    state.segLengths = segLengths;
    state.total = total;
  state.duration = (duration * 1000) / ANIMATION_SPEED_MULT; // ms (apply multiplier)

    // compute current position along route using ambObj's lat/lon if available, and set startTime so we resume
    if (ambObj && ambObj.lon != null && ambObj.lat != null) {
      try {
        const proj = projectPointAlongRoute(coords, [Number(ambObj.lon), Number(ambObj.lat)]);
        const frac = Math.max(0, Math.min(1, proj.distanceAlong / total));
        state.startTime = performance.now() - frac * state.duration;
      } catch (e) {
        state.startTime = performance.now();
      }
    } else {
      state.startTime = performance.now();
    }

    // ensure marker exists
    if (!ambulanceMarkerRef.current && mapRef.current) {
      const el = document.createElement('div'); el.style.width='32px'; el.style.height='32px'; el.style.backgroundImage = `url(${ambulanceSvg})`; el.style.backgroundSize='contain'; el.style.backgroundRepeat='no-repeat';
      ambulanceMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat([Number(ambulanceLng), Number(ambulanceLat)]).addTo(mapRef.current);
    }

  function animate(now) {
      if (!state.startTime) state.startTime = now;
      const elapsed = now - state.startTime;
      const t = Math.min(1, elapsed / state.duration);
      const targetDist = t * state.total;
      // locate segment for targetDist
      let acc = 0; let idx = 0;
      while (idx < state.segLengths.length && acc + state.segLengths[idx] < targetDist) { acc += state.segLengths[idx]; idx++; }
      let pt = state.coords[state.coords.length-1];
      if (idx < state.segLengths.length) {
        const A = state.coords[idx]; const B = state.coords[idx+1]; const segLen = state.segLengths[idx] || 1;
        const segT = (targetDist - acc) / segLen;
        const lon = A[0] + (B[0]-A[0]) * segT; const lat = A[1] + (B[1]-A[1]) * segT;
        pt = [lon, lat];
      }
      try { ambulanceMarkerRef.current.setLngLat(pt); } catch(e) {}
      // update ETA display
      const remaining = Math.max(0, (1 - t) * (state.duration/1000));
      setEta(Math.ceil(remaining));
  // throttle updates to React state for the selected ambulance to ~200ms
      try {
        const nowMs = performance.now();
        if (aid && (nowMs - lastSetAmbUpdateRef.current) > 180) {
          lastSetAmbUpdateRef.current = nowMs;
          // update ambulances list with the moving position and ETA
          const isoEta = new Date(Date.now() + Math.ceil(remaining) * 1000).toISOString();
          setAmbulances(prev => {
            const idx2 = prev.findIndex(x => x.ambulance_id === aid);
            const updated = { ...(ambObj || {}), lon: pt[0], lat: pt[1], eta: isoEta };
            if (idx2 >= 0) {
              const copy = [...prev]; copy[idx2] = { ...copy[idx2], ...updated }; return copy;
            }
            return [updated, ...prev].slice(0,200);
          });
          // also update local marker coords state so other hooks/readers get sync
          try { setAmbulanceLng(Number(pt[0])); setAmbulanceLat(Number(pt[1])); } catch(e){}
        }
      } catch(e) { /* swallow animation-state update errors */ }
      if (t < 1) state.raf = requestAnimationFrame(animate); else { state.raf = null; }
    }

    // Only start the RAF animation for this ambulance if it's the currently selected one
    // or the caller explicitly requested forceStart (used when the user selects an ambulance)
    if (forceStart || aid === selectedAmb) {
      state.raf = requestAnimationFrame(animate);
    } else {
      state.raf = null; // keep state but don't animate until selected
    }
  }

  // handle selecting an ambulance from dropdown
  function handleSelectAmb(id) {
    setSelectedAmb(id);
    const amb = ambulances.find(a => a.ambulance_id === id);
    if (!amb) return;
    // place ambulance marker at its current coords
    setAmbulanceLng(Number(amb.lon));
    setAmbulanceLat(Number(amb.lat));
    // set ETA if provided
    if (amb.eta) {
      const rem = Math.max(0, (new Date(amb.eta).getTime() - Date.now())/1000);
      setEta(Math.ceil(rem));
    }
    // Always prefer computing a street route client-side when a Mapbox token is available.
    const token = process.env.REACT_APP_MAPBOX_TOKEN || '';
    const map = mapRef.current;
    const tokenMissing = !token || token === 'your_mapbox_token_here' || token === 'REPLACE_ME';
    if (!tokenMissing && map) {
      (async () => {
        try {
          const start = `${Number(amb.lon)},${Number(amb.lat)}`;
          const end = `${patientLng},${patientLat}`;
          const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start};${end}?geometries=geojson&overview=full&access_token=${token}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error('Directions fetch failed');
          const data = await res.json();
          if (data && data.routes && data.routes[0] && data.routes[0].geometry) {
            const geom = data.routes[0].geometry; // LineString
            // show on map and start progress animation
            try { map.getSource('route').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geom }] }); } catch(e){}
            // fit map to route bounds for automatic centering
            try {
              const coords = geom.coordinates;
              const lats = coords.map(c => c[1]); const lons = coords.map(c => c[0]);
              const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
              const minLon = Math.min(...lons); const maxLon = Math.max(...lons);
              map.fitBounds([[minLon, minLat],[maxLon, maxLat]], { padding: 60 });
            } catch (e) { /* ignore fit errors */ }
            const ambWithEta = { ...amb, eta: data.routes[0].duration ? (new Date(Date.now() + data.routes[0].duration*1000)).toISOString() : amb.eta };
            startProgressForRoute(geom, ambWithEta, true);
            return;
          }
        } catch (err) {
          console.warn('Could not compute client-side route', err);
          // fallthrough to try using backend route or SSE
        }
        // If we reach here, try to use backend-provided route if available, otherwise clear route and stop animation
        if (amb.route) {
          try { map.getSource('route').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: typeof amb.route === 'string' ? JSON.parse(amb.route) : amb.route }] }); } catch(e){}
          startProgressForRoute(amb.route, amb, true);
        } else {
          try { if (map && map.getSource) map.getSource('route').setData({ type: 'FeatureCollection', features: [] }); } catch(e){}
          stopProgressAnimation(amb.ambulance_id);
        }
      })();
    } else {
      // No Mapbox token or map unavailable: if backend provided a route, use it; otherwise fallback to SSE updates
      if (amb.route) {
        startProgressForRoute(amb.route, amb, true);
      } else {
        try { if (map && map.getSource) map.getSource('route').setData({ type: 'FeatureCollection', features: [] }); } catch(e){}
        stopProgressAnimation(amb.ambulance_id);
      }
    }
  }

  const renderEta = () => {
    if (eta === null) return '—';
    if (eta === 0) return 'Arrived';
    if (eta < 60) return '<1 min';
    return `${Math.ceil(eta / 60)} min`;
  };

  return (
    <div style={{width: '100%', height: '100%', position: 'relative'}}>
      <div style={{position: 'absolute', left: 16, top: 16, zIndex: 30}}>
        <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <label style={{color:'#fff',fontSize:12}}><input type="checkbox" checked={showOnlyEnroute} onChange={(e)=>setShowOnlyEnroute(e.target.checked)} /> Show only en-route units</label>
            </div>
            <div style={{background:'#fff',color:'#111',borderRadius:8,minWidth:320,maxHeight:260,overflowY:'auto',boxShadow:'0 4px 12px rgba(0,0,0,0.12)'}}>
              <div style={{display:'flex',padding:'8px 10px',fontWeight:700,borderBottom:'1px solid #eee',fontSize:13}}>
                <div style={{flex:1}}>Unit</div>
                <div style={{width:90,textAlign:'right'}}>Distance</div>
                <div style={{width:70,textAlign:'right'}}>ETA</div>
                <div style={{width:80,textAlign:'right'}}>Status</div>
              </div>
              {(
             (showOnlyEnroute ? ambulances.filter(a => a.status === 'enroute') : ambulances)
              ).map(a => {
                const isSelected = selectedAmb === a.ambulance_id;
                let distStr = '—';
                let etaStr = '—';
                try {
                  if (a.lat != null && a.lon != null) {
                    // compute remaining distance along route if available, otherwise straight haversine
                    let remainingMeters = null;
                    const aid = a.ambulance_id;
                    const states = progressStatesRef.current || {};
                    if (states[aid] && states[aid].coords && states[aid].total) {
                      // we have precomputed route state for this ambulance
                      const st = states[aid];
                      // project current position onto route to find distanceAlong
                      try {
                        const proj = projectPointAlongRoute(st.coords, [Number(a.lon), Number(a.lat)]);
                        remainingMeters = Math.max(0, st.total - proj.distanceAlong);
                      } catch (e) {
                        remainingMeters = Math.round(haversine([Number(a.lon),Number(a.lat)],[patientLng,patientLat]));
                      }
                    } else if (a.route) {
                      // route may be geometry or string
                      try {
                        const geom = typeof a.route === 'string' ? JSON.parse(a.route) : a.route;
                        if (geom && geom.type === 'LineString' && geom.coordinates) {
                          const proj = projectPointAlongRoute(geom.coordinates, [Number(a.lon), Number(a.lat)]);
                          // compute total length of route
                          const { total } = computeSegLengths(geom.coordinates.map(c => [c[0], c[1]]));
                          remainingMeters = Math.max(0, total - proj.distanceAlong);
                        }
                      } catch(e) {
                        remainingMeters = Math.round(haversine([Number(a.lon),Number(a.lat)],[patientLng,patientLat]));
                      }
                    }
                    if (remainingMeters == null) {
                      remainingMeters = Math.round(haversine([Number(a.lon),Number(a.lat)],[patientLng,patientLat]));
                    }
                    // format distance
                    distStr = remainingMeters >= 1000 ? (remainingMeters/1000).toFixed(1)+' km' : remainingMeters+' m';

                    // compute ETA from remaining distance and speed
                    const baseSpeedKmh = Number(a.speed_kmh) || 40;
                    const speedMs = baseSpeedKmh * 1000/3600 * ANIMATION_SPEED_MULT;
                    const etaSec = Math.max(0, Math.round(remainingMeters / Math.max(0.1, speedMs)));
                    if (etaSec <= 0) {
                      etaStr = 'Arrived';
                    } else if (etaSec < 60) {
                      etaStr = '<1m';
                    } else {
                      etaStr = Math.ceil(etaSec / 60) + 'm';
                    }
                    // if this ambulance is currently selected, show the same ETA as the main display
                    if (isSelected) {
                      etaStr = renderEta();
                    }
                  }
                } catch(e){}
                return (
                  <div key={a.ambulance_id} onClick={() => handleSelectAmb(a.ambulance_id)} role="button" tabIndex={0}
                    style={{display:'flex',padding:'8px 10px',alignItems:'center',cursor:'pointer',background:isSelected? '#eef2ff' : 'transparent',borderBottom:'1px solid #f3f4f6'}}>
                    <div style={{flex:1,fontSize:13}}>{a.unit_name || a.ambulance_id}<div style={{fontSize:11,color:'#666'}}>{a.unit_type || 'ambulance'}</div></div>
                    <div style={{width:90,textAlign:'right',fontSize:13}}>{distStr}</div>
                    <div style={{width:70,textAlign:'right',fontSize:13}}>{etaStr}</div>
                    <div style={{width:80,textAlign:'right',fontSize:13,color: a.status === 'enroute' ? '#06b6d4' : '#666'}}>{a.status || 'idle'}</div>
                  </div>
                );
              })}
            </div>
          </div>
          <button onClick={() => { fetch('/ambulances').then(r=>r.json()).then(d=>setAmbulances(d)).catch(()=>{}); }} style={{padding:'8px 10px'}}>Refresh</button>
        </div>
        <div style={{background: 'rgba(0,0,0,0.75)', color: '#fff', padding: 12, borderRadius: 12, minWidth: 120, textAlign: 'center', boxShadow: '0 4px 16px rgba(0,0,0,0.3)'}}>
          <div style={{fontSize: 12, opacity: 0.8}}>ETA</div>
          <div style={{fontSize: 28, fontWeight: 700, lineHeight: 1}}>{renderEta()}</div>
        </div>
      </div>

      {/* Map container - ensure it has stacking so overlays are visible */}
      <div ref={mapContainer} style={{width: '100%', height: '100%', position: 'relative', zIndex: 0}} />
      {tokenMissing && (
        <div style={{position:'absolute',left:16,top:16,zIndex:40,background:'rgba(0,0,0,0.7)',padding:12,borderRadius:8}}>
          <div style={{fontWeight:700}}>Map disabled</div>
          <div style={{fontSize:13,color:'#ccc',marginTop:6}}>No valid Mapbox token found. To enable the embedded map set <code>REACT_APP_MAPBOX_TOKEN</code> in your environment and rebuild the frontend.</div>
          <div style={{marginTop:8}}>
            <a href={`https://www.google.com/maps/search/?api=1&query=${patientLat},${patientLng}`} target="_blank" rel="noreferrer" style={{color:'#60A5FA'}}>Open location in Google Maps</a>
          </div>
        </div>
      )}
    </div>
  );
}
