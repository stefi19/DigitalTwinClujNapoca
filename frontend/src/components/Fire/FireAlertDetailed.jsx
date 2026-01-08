import React, { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import '../Doctor/style.css'

export default function FireAlertDetailed() {
  const [incidents, setIncidents] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loadingAction, setLoadingAction] = useState(null)
  const [severityFilter, setSeverityFilter] = useState('all')
  const [sortBy, setSortBy] = useState('received_at')
  const [sortDir, setSortDir] = useState('desc')

  function useEventSource(url, onMessage) {
    const esRef = useRef(null)

    useEffect(() => {
      if (!url) return
      try {
        const es = new EventSource(url)
        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data)
            onMessage && onMessage(data)
          } catch (err) {
            console.warn('Malformed SSE message', e.data)
          }
        }
        es.onerror = (err) => { console.warn('SSE error', err) }
        esRef.current = es
        return () => es.close()
      } catch (err) {
        console.warn('EventSource not available', err)
      }
    }, [url, onMessage])
  }

  // consider a fire incident 'complete' for UI when it has sensor metadata,
  // contact and a location (address or coords)
  function isCompleteFire(inc) {
    if (!inc) return false
    const hasSensor = !!inc.sensor_id && !!inc.sensor_type
    const hasContact = !!inc.contact
    const hasLocation = !!inc.address || (!!inc.lat && !!inc.lon) || !!(inc.location && (inc.location.address || inc.location.lat || inc.location.lon))
    return hasSensor && hasContact && hasLocation
  }

  useEventSource('/stream/incidents', (inc) => {
    // ignore non-fire events; include incomplete fire incidents so UI can show missing data
    if (!inc || inc.type !== 'fire') return
    setIncidents((prev) => {
      const status = inc.status || 'new'
      if (status === 'new') {
        const exists = prev.find((p) => p.id === inc.id)
        if (exists) return prev.map((p) => (p.id === inc.id ? { ...p, ...inc } : p))
        return [inc, ...prev]
      }
      return prev.filter((p) => p.id !== inc.id)
    })
  })

  useEffect(() => {
    function onTest(e) {
      const inc = e.detail
      if (!inc || !inc.id) return
      if (inc.type === 'fire' && (inc.status === 'new' || !inc.status)) {
        setIncidents((prev) => [inc, ...prev])
      }
    }
    window.addEventListener('dern:test-incident', onTest)
    return () => window.removeEventListener('dern:test-incident', onTest)
  }, [])

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const res = await axios.get('/incidents')
        if (!mounted) return
        // include fire incidents even if incomplete; we'll surface missing fields in UI
      // include all fire incidents (don't filter by status here) so the UI shows
      // alerts regardless of server-side status values (some producers use
      // different status strings). We'll surface missing fields in the list.
      const items = (res.data || []).filter(i => i.type === 'fire')
        // normalize some fields for UI convenience
        const norm = items.map(i => ({
          ...i,
          received_at: i.received_at || i.timestamp || null,
        }))
        setIncidents(norm)
      } catch (err) { console.warn('Failed to load incidents', err) }
    }
    load()
    return () => { mounted = false }
  }, [])

  function applyFiltersAndSort(list) {
    if (!list) return []
    let out = list.slice()
    if (severityFilter && severityFilter !== 'all') {
      out = out.filter(i => String(i.severity) === severityFilter)
    }
    out.sort((a, b) => {
      let va = a[sortBy]
      let vb = b[sortBy]
      if (sortBy === 'received_at') {
        va = va ? new Date(va).getTime() : 0
        vb = vb ? new Date(vb).getTime() : 0
      } else {
        va = Number(va) || 0
        vb = Number(vb) || 0
      }
      if (va === vb) return 0
      return sortDir === 'asc' ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1)
    })
    return out
  }

  const selectIncident = (id) => setSelectedId(id)
  const selected = incidents.find((i) => i.id === selectedId) || incidents[0] || null

  // hydrants dataset (sample points around Cluj center). In a real app these would come from a
  // backend service or city dataset.
  const HYDRANTS = [
    { id: 'H-1', lon: 23.5985, lat: 46.7719 },
    { id: 'H-2', lon: 23.6210, lat: 46.7690 },
    { id: 'H-3', lon: 23.6102, lat: 46.7780 },
    { id: 'H-4', lon: 23.5900, lat: 46.7680 },
    { id: 'H-5', lon: 23.6055, lat: 46.7600 },
  ]

  // MiniHydrantMap: shows incident and nearest hydrants; draws simple lines and optionally uses Mapbox Directions for the nearest hydrant
  function MiniHydrantMap({ incident }) {
    const mapRef = useRef(null)
    const containerRef = useRef(null)
    const [status, setStatus] = useState('idle')

    useEffect(() => {
      const token = process.env.REACT_APP_MAPBOX_TOKEN || ''
      const tokenMissing = !token || token === 'your_mapbox_token_here' || token === 'REPLACE_ME'
      if (tokenMissing) return
      mapboxgl.accessToken = token
      if (mapRef.current) return
      try {
        const m = new mapboxgl.Map({ container: containerRef.current, style: 'mapbox://styles/mapbox/streets-v11', center: [23.6,46.77], zoom: 13 })
        mapRef.current = m
          m.on('load', () => {
          if (!m.getSource('hydrants')) {
            m.addSource('hydrants', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
            // larger, more visible hydrant marker with white stroke for contrast
            m.addLayer({ id: 'hydrant-point', type: 'circle', source: 'hydrants', paint: { 'circle-radius': 12, 'circle-color': '#06b6d4', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } })
          }
          if (!m.getSource('hydrant-lines')) {
            m.addSource('hydrant-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
            m.addLayer({ id: 'hydrant-lines', type: 'line', source: 'hydrant-lines', paint: { 'line-color': '#ff7a18', 'line-width': 3 } })
          }
          if (!m.getSource('incident-point')) {
            m.addSource('incident-point', { type: 'geojson', data: { type: 'Feature', geometry: null } })
            m.addLayer({ id: 'incident-point-layer', type: 'circle', source: 'incident-point', paint: { 'circle-radius': 10, 'circle-color': '#ef4444' } })
          }
        })
      } catch (e) { console.warn('MiniHydrantMap init failed', e) }
      return () => { try { if (mapRef.current) mapRef.current.remove() } catch (e) {} }
    }, [])

    useEffect(() => {
      if (!incident) return
      const map = mapRef.current
      const token = process.env.REACT_APP_MAPBOX_TOKEN || ''
      const tokenMissing = !token || token === 'your_mapbox_token_here' || token === 'REPLACE_ME'
      // pick nearest 3 hydrants by haversine
      const hx = HYDRANTS.map(h => ({ ...h, d: haversine([h.lon, h.lat], [incident.lon || incident.location?.lon || 0, incident.lat || incident.location?.lat || 0]) }))
        .sort((a,b) => a.d - b.d).slice(0,3)

      try {
        if (map) {
          const setDataOnMap = () => {
            try {
              const hydrFeatures = hx.map(h => ({ type: 'Feature', properties: { id: h.id, dist: Math.round(h.d) }, geometry: { type: 'Point', coordinates: [h.lon, h.lat] } }))
              if (map.getSource('hydrants')) map.getSource('hydrants').setData({ type: 'FeatureCollection', features: hydrFeatures })
              if (map.getSource('incident-point')) map.getSource('incident-point').setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [incident.lon || incident.location?.lon || 0, incident.lat || incident.location?.lat || 0] } })
              const lineFeatures = hx.map(h => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[h.lon, h.lat], [incident.lon || incident.location?.lon || 0, incident.lat || incident.location?.lat || 0]] } }))
              if (map.getSource('hydrant-lines')) map.getSource('hydrant-lines').setData({ type: 'FeatureCollection', features: lineFeatures })
              // fit to bounds of hydrants + incident (guard against degenerate bounds)
              const coords = [].concat(...lineFeatures.map(f => f.geometry.coordinates))
              const lats = coords.map(c => c[1]); const lons = coords.map(c => c[0])
              if (lats.length && lons.length) {
                const minLon = Math.min(...lons); const minLat = Math.min(...lats)
                const maxLon = Math.max(...lons); const maxLat = Math.max(...lats)
                if (!(minLon === maxLon && minLat === maxLat)) {
                  map.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 40 })
                } else {
                  map.setCenter([incident.lon || incident.location?.lon || 0, incident.lat || incident.location?.lat || 0])
                  map.setZoom(14)
                }
              }
            } catch (e) { console.warn('MiniHydrantMap set data failed', e) }
          }

          // If the map style isn't loaded yet, wait for it; otherwise set data immediately
          if (!map.isStyleLoaded || !map.isStyleLoaded()) {
            map.once('load', setDataOnMap)
          } else {
            setDataOnMap()
          }
        }
      } catch (e) { console.warn('MiniHydrantMap set data failed', e) }

      // optionally compute directions for nearest hydrant -> incident for street path (1 request)
      if (!tokenMissing && hx.length) {
        (async () => {
          try {
            const h = hx[0]
            const start = `${h.lon},${h.lat}`
            const end = `${incident.lon || incident.location?.lon || 0},${incident.lat || incident.location?.lat || 0}`
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start};${end}?geometries=geojson&overview=full&access_token=${token}`
            const r = await fetch(url)
            if (!r.ok) throw new Error('Directions failed')
            const data = await r.json()
            if (data && data.routes && data.routes[0] && data.routes[0].geometry) {
              const geom = data.routes[0].geometry
              // add as a special layer to highlight street route
              try {
                const setStreet = () => {
                  if (!map.getSource('hydrant-street')) {
                    map.addSource('hydrant-street', { type: 'geojson', data: geom })
                    map.addLayer({ id: 'hydrant-street-line', type: 'line', source: 'hydrant-street', paint: { 'line-color': '#06b6d4', 'line-width': 4 } })
                  } else {
                    map.getSource('hydrant-street').setData(geom)
                  }
                }
                if (!map.isStyleLoaded || !map.isStyleLoaded()) map.once('load', setStreet)
                else setStreet()
              } catch (e) { console.warn('Could not set hydrant street route', e) }
            }
          } catch (err) { console.warn('Hydrant directions failed', err) }
        })()
      }
    }, [incident && incident.id])

    const token = process.env.REACT_APP_MAPBOX_TOKEN || ''
    if (!token || token === 'your_mapbox_token_here' || token === 'REPLACE_ME') {
      return (<div className="mini-hydrant-empty">Map disabled — set REACT_APP_MAPBOX_TOKEN and rebuild to enable hydrant map</div>)
    }

    return (
      <div className="mini-hydrant-root">
        <div ref={containerRef} className="mini-hydrant-map" />
        <div className="mini-hydrant-note">Nearest hydrants highlighted</div>
      </div>
    )
  }

  function haversine([lon1, lat1], [lon2, lat2]) {
    function toRad(v){return v * Math.PI / 180}
    const R = 6371000
    const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1)
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); return R * c
  }

  function sensorSensitivityLabel(inc) {
    // derive a human-friendly sensitivity from severity or sensor_type
    if (!inc) return '—'
    const sev = Number(inc.severity) || 0
    if (sev >= 4) return 'High'
    if (sev === 3) return 'Medium'
    if (sev > 0) return 'Low'
    // fallback: if sensor type mentions temperature or CO, treat as Medium
    const st = (inc.sensor_type || '').toLowerCase()
    if (st.includes('temperature') || st.includes('co') || st.includes('smoke')) return 'Medium'
    return 'Unknown'
  }

  function missingFields(inc) {
    if (!inc) return []
    const need = []
    if (!inc.sensor_id) need.push('sensor_id')
    if (!inc.sensor_type) need.push('sensor_type')
    if (!inc.contact) need.push('contact')
    if (!inc.address && !(inc.lat && inc.lon) && !(inc.location && (inc.location.address || (inc.location.lat && inc.location.lon)))) need.push('location')
    return need
  }

  async function performAction(id, action) {
    setLoadingAction(action)
    const prevStatus = incidents.find((it) => it.id === id)?.status || 'new'
    setIncidents((prev) => prev.map((it) => (it.id === id ? { ...it, status: action } : it)))
    try {
      const url = `/incidents/${encodeURIComponent(id)}/${action}`
      const resp = await axios.post(url)
      if (resp && resp.data) {
        const data = resp.data.incident || resp.data.payload || resp.data
        if (action === 'accept') {
          setIncidents(prev => prev.filter(it => it.id !== id))
        } else {
          setIncidents((prev) => prev.map((it) => (it.id === id ? { ...it, ...data } : it)))
        }
      }
    } catch (err) {
      console.warn('Action failed', err)
      setIncidents((prev) => prev.map((it) => (it.id === id ? { ...it, status: prevStatus } : it)))
      alert(`Failed to ${action} incident ${id} (see console)`)
    } finally { setLoadingAction(null) }
  }

  return (
    <div className="fire-detailed-root">
      <header className="fire-detailed-header">
        <div>
          <h2>Fire Alerts</h2>
          <div className="muted">Real-time fire alerts. Accept to move to dispatch.</div>
        </div>
      </header>

      <div className="fire-detailed-content">
        <aside className="fire-list">
          <div className="filters">
            <label>Severity:
              <select value={severityFilter} onChange={(e)=>setSeverityFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
            </label>
            <label>Sort by:
              <select value={sortBy} onChange={(e)=>setSortBy(e.target.value)}>
                <option value="received_at">Received</option>
                <option value="severity">Severity</option>
              </select>
            </label>
            <label>Direction:
              <select value={sortDir} onChange={(e)=>setSortDir(e.target.value)}>
                <option value="desc">Newest / High→Low</option>
                <option value="asc">Oldest / Low→High</option>
              </select>
            </label>
          </div>
          {applyFiltersAndSort(incidents).length===0 ? (
            <div className="empty">No fire alerts</div>
          ) : (
            applyFiltersAndSort(incidents).map(inc => {
              const missing = missingFields(inc)
              return (
                <div key={inc.id} className={`fire-item ${selected && selected.id===inc.id ? 'selected' : ''}`} onClick={()=>selectIncident(inc.id)}>
                  <div className="row-top">
                    <div className="title">{inc.type}</div>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <div className={`pill ${inc.status || 'new'}`}>{inc.status || 'new'}</div>
                      {missing.length>0 && <div className="badge">Missing: {missing.join(', ')}</div>}
                    </div>
                  </div>
                  <div className="meta">{inc.received_at ? new Date(inc.received_at).toLocaleString() : ''}</div>
                  <div className="summary">{inc.notes || inc.summary || '—'}</div>
                  <div className="sensor-meta">
                    <small>Sensor: {inc.sensor_id || '—'} · {inc.sensor_type || 'Unknown'}</small>
                  </div>
                </div>
              )
            })
          )}
        </aside>

        <main className="fire-detail">
          {!selected && <div className="empty-main">Select an alert to see details</div>}
          {selected && (
            <div className="detail-card">
              <div className="detail-header">
                <h3>{selected.type}</h3>
                <div className="muted">Reported: {selected.received_at ? new Date(selected.received_at).toLocaleString() : '—'}</div>
              </div>

              <div className="detail-body">
                <p>{selected.details || selected.summary || 'No details'}</p>
                <dl>
                  <dt>Sensor</dt>
                  <dd>
                    <div><strong>ID:</strong> {selected.sensor_id || '—'}</div>
                    <div><strong>Type:</strong> {selected.sensor_type || '—'}</div>
                    <div><strong>Sensitivity:</strong> {sensorSensitivityLabel(selected)}</div>
                  </dd>

                  <dt>Location</dt>
                  <dd>
                    <div>{selected.address || selected.location?.address || '—'}</div>
                    {selected.lat && selected.lon ? (
                      <div className="coords">{Number(selected.lat).toFixed(5)}, {Number(selected.lon).toFixed(5)}</div>
                    ) : null}
                  </dd>

                  <dt>Contact</dt>
                  <dd>{selected.contact || '—'}</dd>
                  <dt>Severity</dt>
                  <dd>{selected.severity || '—'}</dd>
                </dl>
              </div>

                  {/* hydrant map */}
                  <div style={{marginTop:12}}>
                    <h4>Nearest Hydrants</h4>
                    <MiniHydrantMap incident={selected} />
                  </div>

              <div className="detail-actions">
                <button className="btn accept" onClick={()=>performAction(selected.id,'accept')} disabled={loadingAction!==null}>{loadingAction==='accept'?'Accepting…':'Accept'}</button>
                <button className="btn decline" onClick={()=>performAction(selected.id,'decline')} disabled={loadingAction!==null}>{loadingAction==='decline'?'Declining…':'Decline'}</button>
                <button className="btn resolve" onClick={()=>performAction(selected.id,'resolve')} disabled={loadingAction!==null}>{loadingAction==='resolve'?'Updating…':'Mark Resolved'}</button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
