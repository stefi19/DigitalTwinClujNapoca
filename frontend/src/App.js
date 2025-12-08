import React, { useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import axios from 'axios';

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN || '';

function App() {
  const [map, setMap] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [testType, setTestType] = useState('test');
  const [testLat, setTestLat] = useState(46.77);
  const [testLon, setTestLon] = useState(23.6);
  const [testSeverity, setTestSeverity] = useState(3);

  useEffect(() => {
    const m = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v11',
      center: [23.6, 46.77],
      zoom: 12
    });
    setMap(m);
    return () => m.remove();
  }, []);

  useEffect(() => {
    // Use Server-Sent Events for live updates
    const es = new EventSource('/stream/incidents');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setIncidents(prev => [data, ...prev].slice(0, 200));
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
      } catch (e) {
        console.warn('Failed to load incidents', e);
      }
    }
    load();
    return () => es.close();
  }, []);

  useEffect(() => {
    if (!map) return;
    // remove existing markers
    if (map._dernMarkers) {
      map._dernMarkers.forEach(m => m.remove());
    }
    map._dernMarkers = incidents.map(inc => {
      const el = document.createElement('div');
      el.style.width = '14px';
      el.style.height = '14px';
      el.style.background = inc.type === 'medical' ? 'red' : (inc.type === 'fire' ? 'orange' : 'blue');
      el.style.borderRadius = '50%';
      const mk = new mapboxgl.Marker(el).setLngLat([inc.lon, inc.lat]).addTo(map);
      return mk;
    });
  }, [map, incidents]);

  return (
    <div style={{height: '100vh', display: 'flex'}}>
      <div id="map" style={{height: '100%', flex: 1}} />
      <aside style={{width: 320, maxWidth: '35%', padding: 12, background: 'rgba(255,255,255,0.95)', overflow: 'auto'}}>
        <h3>Latest incidents</h3>

        <div style={{marginBottom: 12}}>
          <div style={{marginBottom: 6}}>Send a test incident</div>
          <div style={{display: 'flex', gap: 6, marginBottom: 6}}>
            <input value={testType} onChange={e => setTestType(e.target.value)} style={{flex: 1}} />
            <input type="number" value={testSeverity} onChange={e => setTestSeverity(Number(e.target.value))} style={{width: 64}} />
          </div>
          <div style={{display: 'flex', gap: 6, marginBottom: 6}}>
            <input type="number" step="0.00001" value={testLat} onChange={e => setTestLat(Number(e.target.value))} style={{flex: 1}} />
            <input type="number" step="0.00001" value={testLon} onChange={e => setTestLon(Number(e.target.value))} style={{flex: 1}} />
          </div>
          <div>
            <button onClick={async () => {
              try {
                const payload = { id: `ui-${Date.now()}`, type: testType, lat: testLat, lon: testLon, severity: testSeverity };
                const res = await axios.post('/debug/publish', payload);
                console.log('published', res.data);
                // optimistic UI add
                setIncidents(prev => [payload, ...prev].slice(0, 200));
              } catch (err) {
                console.error('publish failed', err);
                alert('Publish failed: ' + (err?.response?.data?.detail || err.message));
              }
            }}>Send test</button>
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
  );
}

export default App;
