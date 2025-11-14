import React, { useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import axios from 'axios';

mapboxgl.accessToken = process.env.REACT_APP_MAPBOX_TOKEN || '';

function App() {
  const [map, setMap] = useState(null);
  const [incidents, setIncidents] = useState([]);

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
    async function load() {
      try {
        const res = await axios.get('/incidents');
        setIncidents(res.data || []);
      } catch (e) {
        console.warn('Failed to load incidents', e);
      }
    }
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
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
    <div style={{height: '100vh'}}>
      <div id="map" style={{height: '100%'}} />
    </div>
  );
}

export default App;
