import React, { useEffect, useRef, useState } from 'react';
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

  // speed in meters/second
  const speed = 13.9; // ~50 km/h average moving speed

  useEffect(() => {
    const token = process.env.REACT_APP_MAPBOX_TOKEN || '';
    if (!token) {
      console.warn('No Mapbox token found in REACT_APP_MAPBOX_TOKEN');
      return;
    }
    mapboxgl.accessToken = token;
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

  // Listen for local test incident events from the sidebar
  useEffect(() => {
    function handler(e) {
      try {
        const payload = e.detail;
        if (!payload) return;
        if (payload.type === 'medical') {
          // set patient coordinates from payload and start dispatch after map is ready
          if (typeof payload.lat === 'number' && typeof payload.lon === 'number') {
            setPatientLat(payload.lat);
            setPatientLng(payload.lon);
          }
          // small delay to let map/markers update
          setTimeout(() => startDispatch(), 400);
        }
      } catch (err) {
        console.warn('test incident handler error', err);
      }
    }
    window.addEventListener('dern:test-incident', handler);
    return () => window.removeEventListener('dern:test-incident', handler);
  }, [mapRef.current, ambulanceLat, ambulanceLng, patientLat, patientLng]);

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
  const startDispatch = async () => {
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
    let distanceTraveled = 0;

    function step(ts) {
      if (!startTime) startTime = ts;
      const elapsed = (ts - startTime) / 1000; // seconds
      distanceTraveled = Math.min(elapsed * speed, total);

      // find which segment we are on
      let acc = 0;
      let idx = 0;
      while (idx < segLengths.length && acc + segLengths[idx] < distanceTraveled) {
        acc += segLengths[idx];
        idx++;
      }

      if (idx >= segLengths.length) {
        // arrived
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

      requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  };

  return (
    <div style={{width: '100%', height: '100%', position: 'relative'}}>
      <div style={{position: 'absolute', right: 12, top: 12, zIndex: 20, background: 'rgba(255,255,255,0.9)', padding: 8, borderRadius: 8}}>
        <div style={{display: 'flex', gap: 8, alignItems: 'center'}}>
          <div>
            <div style={{fontSize: 12}}>Patient</div>
            <div style={{display: 'flex', gap: 6}}>
              <input style={{width: 100}} value={patientLat} onChange={e => setPatientLat(Number(e.target.value))} />
              <input style={{width: 100}} value={patientLng} onChange={e => setPatientLng(Number(e.target.value))} />
            </div>
          </div>

          <div>
            <div style={{fontSize: 12}}>Ambulance</div>
            <div style={{display: 'flex', gap: 6}}>
              <input style={{width: 100}} value={ambulanceLat} onChange={e => setAmbulanceLat(Number(e.target.value))} />
              <input style={{width: 100}} value={ambulanceLng} onChange={e => setAmbulanceLng(Number(e.target.value))} />
            </div>
          </div>

          <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
            <button className="pacient-control-button" onClick={startDispatch} disabled={isRouting}>Start dispatch</button>
            <div style={{fontSize: 12}}>ETA: {eta === null ? '—' : (eta === 0 ? 'Arrived' : `${eta}s`)}</div>
          </div>
        </div>
      </div>

      <div ref={mapContainer} style={{width: '100%', height: '100%'}} />
    </div>
  );
}
