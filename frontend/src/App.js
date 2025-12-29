import React, { useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import axios from 'axios';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import { Pacient } from './components/Pacient';
import { DoctorAssign } from './components/DoctorAssign';
import { DoctorDetailed } from './components/DoctorDetailed';
import { DoctorClosure } from './components/DoctorClosure';
import { FireAlert } from './components/Fire/Alert';
import { FireDispatch } from './components/Fire/Dispatch';
import { FirePost } from './components/Fire/Post';

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN || '';

function App() {
  const [map, setMap] = useState(null);
  const [incidents, setIncidents] = useState([]);
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
          </div>

          <div style={{marginBottom: 12}}>
            <h3>Latest incidents</h3>

            <div style={{marginBottom: 12}}>
              <div style={{marginBottom: 6}}>Send a test incident</div>
              <div style={{display: 'flex', gap: 6, marginBottom: 6}}>
                <select value={testType} onChange={e => setTestType(e.target.value)} style={{flex: 1}}>
                  <option value="medical">Medical emergency</option>
                  <option value="fire">Fire emergency</option>
                </select>
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
                    setIncidents(prev => [payload, ...prev].slice(0, 200));
                    // Emit a client-side event so local pages (Pacient) can react immediately
                    try {
                      window.dispatchEvent(new CustomEvent('dern:test-incident', { detail: payload }));
                    } catch (err) {
                      console.warn('Could not dispatch local test event', err);
                    }
                  } catch (err) {
                    console.error('publish failed', err);
                    alert('Publish failed: ' + (err?.response?.data?.detail || err.message));
                  }
                }}>Send test</button>
              </div>
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
