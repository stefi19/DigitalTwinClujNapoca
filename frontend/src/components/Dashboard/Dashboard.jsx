import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import axios from 'axios';
import './style.css';

export default function Dashboard() {
  const mapRef = useRef(null);
  const containerRef = useRef(null);
  const [ambulances, setAmbulances] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dailyStats, setDailyStats] = useState(null);
  const [totalIncidentsCount, setTotalIncidentsCount] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [aRes, iRes] = await Promise.all([
          axios.get('/ambulances').catch(() => ({ data: [] })),
          axios.get('/incidents').catch(() => ({ data: [] }))
        ]);
        setAmbulances(aRes.data || []);
        setIncidents(iRes.data || []);
        // fetch daily stats for the Dashboard panel
        try {
          const sRes = await axios.get('/stats/daily');
          setDailyStats(sRes.data || null);
        } catch (e) { console.warn('Failed to load daily stats', e); }
        // fetch total incidents count (uncapped)
        try {
          const cRes = await axios.get('/incidents/count');
          setTotalIncidentsCount(cRes.data?.total ?? null);
        } catch (e) { console.warn('Failed to load incidents count', e); }
      } catch (err) {
        console.warn('Dashboard load failed', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // compute counts
  const fireTrucks = ambulances.filter(u => (u.unit_type || '').toLowerCase() === 'fire' || (u.unit_type || '').toLowerCase() === 'fire-truck');
  const fireTrucksAvailable = fireTrucks.filter(u => !u.status || ['available','idle','ready'].includes((u.status||'').toLowerCase())).length;
  const medicalAmbulances = ambulances.filter(u => (u.unit_type || '').toLowerCase() === 'ambulance' || (u.unit_type || '').toLowerCase() === 'ems' || (u.unit_type || '').toLowerCase() === 'medical');
  const medicalAvailable = medicalAmbulances.filter(u => !u.status || ['available','idle','ready'].includes((u.status||'').toLowerCase())).length;

  // build simple risk grid by rounding coords to 3 decimals
  const grid = {};
  incidents.forEach(inc => {
    const lat = Number(inc.lat);
    const lon = Number(inc.lon);
    if (!lat || !lon) return;
    const key = `${lat.toFixed(3)}_${lon.toFixed(3)}`;
    grid[key] = grid[key] || { lat, lon, count: 0, hours: {} };
    grid[key].count += 1;
    const h = inc.received_at ? new Date(inc.received_at).getHours() : 0;
    grid[key].hours[h] = (grid[key].hours[h]||0) + 1;
  });

  // derive risk score (0-1) per grid cell using normalized counts and hour-match boost
  const nowHour = new Date().getHours();
  const cells = Object.values(grid).map(c => {
    const hourCount = c.hours[nowHour] || 0;
    const score = c.count + hourCount * 0.8; // boost for same-hour patterns
    return { ...c, score };
  });
  const maxScore = cells.reduce((m, c) => Math.max(m, c.score || 0), 0) || 1;

  useEffect(() => {
    const token = process.env.REACT_APP_MAPBOX_TOKEN || '';
    console.log('Dashboard: REACT_APP_MAPBOX_TOKEN present?', !!token);
    // expose token value length (don't leak token) for debugging if needed
    try { console.log('Dashboard: token length', token ? token.length : 0); } catch(e){}
    if (!token || token === 'your_mapbox_token_here' || token === 'REPLACE_ME') return;
    mapboxgl.accessToken = token;
    if (mapRef.current) return;
    // ensure container has an explicit height and is positioned so mapbox can size the canvas
    try {
      if (containerRef.current) {
        console.log('Dashboard: container before init', containerRef.current.clientWidth, containerRef.current.clientHeight, containerRef.current.style.cssText);
        containerRef.current.style.position = containerRef.current.style.position || 'relative';
        if (!containerRef.current.style.height) containerRef.current.style.height = '520px';
        console.log('Dashboard: container after ensure height', containerRef.current.clientWidth, containerRef.current.clientHeight, containerRef.current.style.cssText);
      }
    } catch (e) { console.warn('Dashboard: container style error', e); }

    // Ensure we create a dedicated inner container element for Mapbox. In some
    // environments the outer ref node may be managed by React or affected by
    // other styles; creating a fresh child div guarantees Mapbox has a plain
    // DOM node to attach its canvas to.
    let innerContainer = null;
    try {
      if (containerRef.current) {
        innerContainer = document.createElement('div');
        innerContainer.style.width = '100%';
        innerContainer.style.height = '100%';
        // give it a class so we can inspect it in DevTools
        innerContainer.className = 'dern-dash-map-inner';
        // clear any previous children and append the inner container
        try { while (containerRef.current.firstChild) containerRef.current.removeChild(containerRef.current.firstChild); } catch(e){}
        containerRef.current.appendChild(innerContainer);
      }
    } catch(e) { console.warn('Dashboard: failed to create inner container', e); }

    const m = new mapboxgl.Map({ container: innerContainer || containerRef.current, style: 'mapbox://styles/mapbox/streets-v11', center: [23.6, 46.77], zoom: 11 });
    mapRef.current = m;
    console.log('Dashboard: created map instance', !!mapRef.current);

    // helper: create or update the risk source and layer in a safe way
    const addRiskSourceAndLayer = (mapInstance, featuresData, maxScoreVal) => {
      try {
        if (!mapInstance) return;
        // if a previous layer exists, remove it first
        try { if (mapInstance.getLayer && mapInstance.getLayer('risk-circles')) { mapInstance.removeLayer('risk-circles'); } } catch(e){}
        try { if (mapInstance.getSource && mapInstance.getSource('risk-points')) { mapInstance.removeSource('risk-points'); } } catch(e){}
        mapInstance.addSource('risk-points', { type: 'geojson', data: { type: 'FeatureCollection', features: featuresData } });
        mapInstance.addLayer({
          id: 'risk-circles',
          type: 'circle',
          source: 'risk-points',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 0, 6, maxScoreVal, 30],
            'circle-color': ['interpolate', ['linear'], ['get', 'score'], 0, 'rgba(59,130,246,0.4)', maxScoreVal*0.5, 'rgba(250,204,21,0.6)', maxScoreVal, 'rgba(239,68,68,0.8)'],
            'circle-stroke-color': 'rgba(0,0,0,0.2)',
            'circle-stroke-width': 1
          }
        });
      } catch (e) { console.warn('addRiskSourceAndLayer failed', e); }
    };

    m.on('load', () => {
      try { console.log('Dashboard: map loaded; container size', containerRef.current?.clientWidth, containerRef.current?.clientHeight); } catch(e){}

      try {
        const features = cells.map(c => ({ type: 'Feature', properties: { score: c.score }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } }));
        addRiskSourceAndLayer(m, features, maxScore);
      } catch (e) { console.warn('Error while initializing risk-points source on load', e); }

      // add simple popup on hover
      try {
        m.on('mouseenter', 'risk-circles', (e) => {
          const cv = m.getCanvas && m.getCanvas(); if (cv) cv.style.cursor = 'pointer';
        });
        m.on('mouseleave', 'risk-circles', () => { const cv = m.getCanvas && m.getCanvas(); if (cv) cv.style.cursor = ''; });
        m.on('click', 'risk-circles', (e) => {
          if (!e.features || !e.features.length) return;
          const f = e.features[0];
          const score = f.properties.score;
          new mapboxgl.Popup().setLngLat(e.lngLat).setHTML(`<div>Risk score: ${Number(score).toFixed(2)}</div>`).addTo(m);
        });
      } catch(e) { console.warn('Dashboard: popup handlers registration failed', e); }

      try { window.__DERN_DASH_MAP = m; } catch (e) {}

      // try to ensure canvas exists and style is loaded; if not, re-apply the style and re-init layers
      setTimeout(() => {
        try {
          const canvas = m.getCanvas && m.getCanvas();
          const styleLoaded = m.isStyleLoaded && m.isStyleLoaded();
          console.log('Dashboard: post-load check canvas?', !!canvas, 'styleLoaded', !!styleLoaded);
          try { console.log('Dashboard: current style', m.getStyle && m.getStyle()); } catch(e){}
          if (!canvas || !styleLoaded) {
            console.warn('Dashboard: style or canvas missing; attempting to re-set style and re-init layers');
            const styleUrl = 'mapbox://styles/mapbox/streets-v11';
            try { m.setStyle(styleUrl); } catch(e) { console.warn('Dashboard: setStyle failed', e); }
            // when style data arrives, re-add our sources and layers
            m.once('styledata', () => {
              try { console.log('Dashboard: styledata received after re-set'); } catch(e){}
              try { m.resize(); } catch(e){}
              try {
                const features = cells.map(c => ({ type: 'Feature', properties: { score: c.score }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } }));
                addRiskSourceAndLayer(m, features, maxScore);
              } catch(e) { console.warn('Dashboard: re-init layers after styledata failed', e); }
            });
          }
        } catch (e) { console.warn('Dashboard: post-load self-check failed', e); }
        try { m.resize(); } catch(e){}
      }, 700);

      // ensure the canvas is sized/positioned to fill our container
      try {
        const canvas = m.getCanvas && m.getCanvas();
        if (canvas) {
          canvas.style.position = canvas.style.position || 'absolute';
          canvas.style.top = '0'; canvas.style.left = '0';
          canvas.style.width = '100%'; canvas.style.height = '100%';
          console.log('Dashboard: adjusted canvas styles', canvas.clientWidth, canvas.clientHeight);
        } else {
          console.log('Dashboard: map.getCanvas() returned no canvas at immediate post-load');
        }
      } catch (e) { console.warn('Dashboard: error adjusting canvas style', e); }

      // listen for runtime errors
      try { m.on && m.on('error', (err) => { console.warn('Dashboard: map error', err); }); } catch(e) {}
    });

    // ensure map resizes when window resizes or when sidebar opens/closes
    const onWin = () => { try { if (mapRef.current) mapRef.current.resize(); } catch(e){} };
    window.addEventListener('resize', onWin);

    return () => {
      try { window.removeEventListener('resize', onWin); } catch(e){}
      try { m.remove(); } catch(e){}
      // clear the ref so a future effect run will recreate the map
      try { if (mapRef) mapRef.current = null; } catch(e){}
      try { if (innerContainer && innerContainer.parentNode) innerContainer.parentNode.removeChild(innerContainer); } catch(e){}
    };
  }, [cells, maxScore]);

  return (
    <div className="dashboard-root" style={{width: '100%', height: '100%', display: 'flex', flexDirection: 'column'}}>
      <div className="dashboard-header">
        <h2>Dashboard</h2>
        <div className="muted">Overview of available units and incident risk map</div>
      </div>

      <div className="dashboard-cards">
        <div className="card">
          <div className="card-title">Available Ambulances</div>
          <div className="card-value">{medicalAvailable} / {medicalAmbulances.length}</div>
        </div>
        <div className="card">
          <div className="card-title">Available Fire Trucks</div>
          <div className="card-value">{fireTrucksAvailable} / {fireTrucks.length}</div>
        </div>
        <div className="card">
          <div className="card-title">Total Incidents (history)</div>
          <div className="card-value">{totalIncidentsCount !== null ? totalIncidentsCount : incidents.length}</div>
        </div>
      </div>

      {/* Daily stats panel: totals and small hourly chart */}
      <div className="dashboard-stats" style={{display:'flex',gap:12,alignItems:'stretch',padding:'12px 14px'}}>
        <div style={{flex:'0 0 260px',background:'var(--panel)',padding:12,borderRadius:8}}>
          <div style={{fontSize:12,color:'var(--muted)'}}>Incidents Today</div>
          <div style={{fontSize:28,fontWeight:700}}>{dailyStats ? dailyStats.total : '—'}</div>
          <div style={{marginTop:8,fontSize:13}}>
            {dailyStats && dailyStats.by_type ? Object.entries(dailyStats.by_type).map(([k,v]) => (
              <div key={k} style={{display:'flex',justifyContent:'space-between'}}><div style={{textTransform:'capitalize'}}>{k}</div><div>{v}</div></div>
            )) : <div className="muted">No data</div>}
          </div>
        </div>
        <div style={{flex:1,background:'var(--panel)',padding:12,borderRadius:8}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div style={{fontSize:13,fontWeight:700}}>Incidents by hour (UTC)</div>
            <div style={{fontSize:12,color:'var(--muted)'}}>{dailyStats ? dailyStats.date : ''}</div>
          </div>
          <div style={{height:84,marginTop:8}}>
            {dailyStats ? (
              <svg width="100%" height="84" viewBox="0 0 800 84" preserveAspectRatio="none">
                {(() => {
                  const hourly = dailyStats.hourly || Array(24).fill(0);
                  const max = Math.max(1, ...hourly);
                  const w = 800 / 24;
                  return hourly.map((v, i) => {
                    const h = Math.round((v / max) * 72);
                    const x = i * w;
                    return <rect key={i} x={x+2} y={84 - h - 6} width={Math.max(4, w-4)} height={h} fill="#60a5fa" opacity={0.9} />
                  });
                })()}
              </svg>
            ) : <div className="muted">Daily stats not available</div>}
          </div>
        </div>
      </div>

  <div className="dashboard-map" style={{display: 'flex', flexDirection: 'column', flex: 1}}>
        {(!process.env.REACT_APP_MAPBOX_TOKEN || process.env.REACT_APP_MAPBOX_TOKEN === 'REPLACE_ME') ? (
          <div className="map-placeholder">Map disabled — set REACT_APP_MAPBOX_TOKEN to enable interactive map</div>
        ) : (
          <div className="mini-route-root">
            <div ref={containerRef} className="mini-route-map" />
          </div>
        )}
      </div>

      <div className="dashboard-legend">
        <div className="legend-item"><span className="dot low" /> Low</div>
        <div className="legend-item"><span className="dot med" /> Medium</div>
        <div className="legend-item"><span className="dot high" /> High</div>
      </div>

      {loading && <div className="loading">Loading...</div>}
    </div>
  )
}
