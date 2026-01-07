import React, { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import axios from 'axios'
import './style.css'

// DoctorDetailed: responsive, real-time incident viewer for a doctor
// - subscribes to SSE at /stream/incidents (backend) and to local debug events
// - maintains an incidents list, shows selected incident details
// - buttons: Accept, Decline, Resolve with optimistic UI and placeholder backend calls

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
      es.onerror = (err) => {
        console.warn('SSE error', err)
      }
      esRef.current = es
      return () => {
        es.close()
      }
    } catch (err) {
      console.warn('EventSource not available', err)
    }
  }, [url, onMessage])
}

export default function DoctorDetailed() {
  const [incidents, setIncidents] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loadingAction, setLoadingAction] = useState(null)
  const [severityFilter, setSeverityFilter] = useState('all')
  const [sortBy, setSortBy] = useState('received_at')
  const [sortDir, setSortDir] = useState('desc')

  // Required UI fields for a medical incident to be considered "complete"
  function isCompleteIncident(inc) {
    if (!inc) return false
    // patient name required, plus either patient_contact or contact, and an address or coords
    const hasName = !!inc.patient_name || !!(inc.person && inc.person.name)
    const hasContact = !!inc.patient_contact || !!inc.contact || !!(inc.person && inc.person.phone)
    const hasLocation = !!inc.address || (!!inc.lat && !!inc.lon) || !!(inc.location && (inc.location.address || inc.location.lat || inc.location.lon))
    return hasName && hasContact && hasLocation
  }

  // SSE subscription (assumes CRA proxy or same-origin backend)
  useEventSource('/stream/incidents', (inc) => {
    // Only care about medical incidents in this view; include incomplete incidents
    if (!inc || inc.type !== 'medical') return
    setIncidents((prev) => {
      // if incoming incident is still new, add/update it; otherwise remove it (it moved to assign/resolved/etc.)
      const status = inc.status || 'new'
      if (status === 'new') {
        const exists = prev.find((p) => p.id === inc.id)
        if (exists) return prev.map((p) => (p.id === inc.id ? { ...p, ...inc } : p))
        return [inc, ...prev]
      }
      // remove incidents that are no longer new
      return prev.filter((p) => p.id !== inc.id)
    })
  })

  // local test event (from App.js debug publish)
  useEffect(() => {
    function onTest(e) {
      const inc = e.detail
      if (!inc || !inc.id) return
      if (inc.type === 'medical' && (inc.status === 'new' || !inc.status)) {
        setIncidents((prev) => [inc, ...prev])
      }
    }
    window.addEventListener('dern:test-incident', onTest)
    return () => window.removeEventListener('dern:test-incident', onTest)
  }, [])

  // initial load: fetch medical incidents with status new
  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const res = await axios.get('/incidents')
        if (!mounted) return
        // Show medical incidents that are "new" (include incomplete ones; UI will indicate missing fields)
        const items = (res.data || [])
          .filter(i => i.type === 'medical' && (i.status === 'new' || !i.status))
        setIncidents(items)
      } catch (err) {
        console.warn('Failed to load incidents', err)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  // apply UI filters and sorting to incidents list
  function applyFiltersAndSort(list) {
    if (!list) return []
    let out = list.slice()
    // severity filter: allow 'all' or numeric/severity strings
    if (severityFilter && severityFilter !== 'all') {
      const sf = severityFilter
      out = out.filter(i => String(i.severity) === sf)
    }
    // sorting
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

  const selectIncident = (id) => {
    setSelectedId(id)
  }

  const selected = incidents.find((i) => i.id === selectedId) || incidents[0] || null

  // --- Vitals simulation state (per selected patient) ---
  const [vitals, setVitals] = useState(null)
  const vitalsTimerRef = useRef(null)

  // start/stop vitals simulation when selection changes
  useEffect(() => {
    // stop any previous timer
    if (vitalsTimerRef.current) { clearInterval(vitalsTimerRef.current); vitalsTimerRef.current = null }
    if (!selected) { setVitals(null); return }
    // seed vitals from incident data if present, otherwise use defaults
    const seed = {
      hr: selected.vitals?.hr || 88,
      spo2: selected.vitals?.spo2 || 96,
      rr: selected.vitals?.rr || 18,
      sys: selected.vitals?.sys || 120,
      dia: selected.vitals?.dia || 78,
    }
    setVitals(seed)
    // simulate small random walk every 1s
    vitalsTimerRef.current = setInterval(() => {
      setVitals((prev) => {
        if (!prev) return seed
        const jitter = (v, min, max) => Math.max(min, Math.min(max, Math.round(v + (Math.random() - 0.5) * (v * 0.06))))
        return {
          hr: jitter(prev.hr, 40, 160),
          spo2: jitter(prev.spo2, 80, 100),
          rr: jitter(prev.rr, 8, 40),
          sys: jitter(prev.sys, 70, 220),
          dia: jitter(prev.dia, 40, 130),
        }
      })
    }, 1000)
    return () => { if (vitalsTimerRef.current) { clearInterval(vitalsTimerRef.current); vitalsTimerRef.current = null } }
  }, [selected && selected.id])

  // helper for optimistic actions
  async function performAction(id, action) {
    setLoadingAction(action)
    // capture previous status for rollback
    const prevStatus = incidents.find((it) => it.id === id)?.status || 'new'
    // optimistic local update: keep incident visible and set new status
    setIncidents((prev) => prev.map((it) => (it.id === id ? { ...it, status: action } : it)))
    try {
      // placeholder endpoint - adjust to your backend routes
      const url = `/incidents/${encodeURIComponent(id)}/${action}`
      const resp = await axios.post(url)
      // if backend returns updated incident, merge or remove depending on action
      if (resp && resp.data) {
        // backend returns {'ok': True, 'incident': {...}} sometimes
        const data = resp.data.incident || resp.data.payload || resp.data
        if (action === 'accept') {
          // accepted incidents move to assign view, remove from this list
          setIncidents(prev => prev.filter(it => it.id !== id))
        } else {
          setIncidents((prev) => prev.map((it) => (it.id === id ? { ...it, ...data } : it)))
        }
      }
    } catch (err) {
      console.warn('Action failed', err)
      // rollback optimistic update to previous status but keep the incident visible
      setIncidents((prev) => prev.map((it) => (it.id === id ? { ...it, status: prevStatus } : it)))
      // show quick feedback - a real app would show toast
      alert(`Failed to ${action} incident ${id} (see console)`)
    } finally {
      setLoadingAction(null)
    }
  }

  return (
    <div className="doctor-detailed-root">
      <aside className="incident-list">
        <h3>Incidents</h3>
        <div className="filters">
          <label>Severity:
            <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>
          </label>
          <label>Sort by:
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="received_at">Received</option>
              <option value="severity">Severity</option>
            </select>
          </label>
          <label>Direction:
            <select value={sortDir} onChange={(e) => setSortDir(e.target.value)}>
              <option value="desc">Newest / High→Low</option>
              <option value="asc">Oldest / Low→High</option>
            </select>
          </label>
        </div>
        <div className="list-scroll">
          {applyFiltersAndSort(incidents).length === 0 && <div className="empty">No incidents yet</div>}
          {applyFiltersAndSort(incidents).map((inc) => (
            <div
              key={inc.id}
              className={`incident-item ${selected && selected.id === inc.id ? 'selected' : ''}`}
              onClick={() => selectIncident(inc.id)}
            >
              <div className="meta">
                <div className="type">{inc.type || 'unknown'}</div>
                <div className="time">{inc.received_at ? new Date(inc.received_at).toLocaleString() : ''}</div>
              </div>
              <div className="summary">{inc.summary || inc.details || inc.address || formatLatLon({ lat: inc.lat, lon: inc.lon }) || '—'}</div>
              <div className={`status ${inc.status || 'new'}`}>{inc.status || 'new'}</div>
            </div>
          ))}
        </div>
      </aside>

      <main className="incident-detail">
        {!selected && <div className="no-selection">Select an incident to see details</div>}

        {selected && (
          <div className="detail-card">
            <header className="detail-header">
              <div>
                <h2>{selected.type || 'Incident'}</h2>
                <div className="sub">Reported: {selected.received_at ? new Date(selected.received_at).toLocaleString() : '—'}</div>
              </div>
              <div className="right">
                <div className="severity">Severity: {selected.severity || 'N/A'}</div>
                <div className={`pill status-pill ${selected.status || 'new'}`}>{selected.status || 'new'}</div>
              </div>
            </header>

            <section className="detail-body">
              <div className="row">
                <div className="label">Location</div>
                <div className="value">{selected.address || formatLatLon({ lat: selected.lat, lon: selected.lon })}</div>
              </div>

              <div className="row">
                <div className="label">Patient / Subject</div>
                <div className="value">{selected.patient_name || selected.person?.name || '—'}{selected.patient_age ? `, ${selected.patient_age} yrs` : ''}</div>
              </div>

              <div className="row">
                <div className="label">Details</div>
                <div className="value">{selected.details || selected.summary || 'No extra details'}</div>
              </div>

              <div className="row">
                <div className="label">Contact</div>
                <div className="value">{selected.patient_contact || selected.contact || (selected.person && selected.person.phone) || '—'}</div>
              </div>

              <div className="row">
                <div className="label">Notes</div>
                <div className="value">
                  <textarea
                    className="notes"
                    defaultValue={selected.notes || ''}
                    placeholder="Add quick notes (local only)"
                    onBlur={(e) => {
                      // save locally
                      const v = e.target.value
                      setIncidents((prev) => prev.map((it) => (it.id === selected.id ? { ...it, notes: v } : it)))
                    }}
                  />
                </div>
              </div>
            </section>

            {/* Vitals simulator panel (live-updating) */}
            <section className="detail-vitals">
              <h4>Live Vitals (simulated)</h4>
              {!vitals && <div className="v-empty">No vitals available</div>}
              {vitals && (
                <div className="v-grid">
                  <div className="v-item"><div className="v-label">HR</div><div className="v-value">{vitals.hr} bpm</div></div>
                  <div className="v-item"><div className="v-label">SpO₂</div><div className="v-value">{vitals.spo2}%</div></div>
                  <div className="v-item"><div className="v-label">RR</div><div className="v-value">{vitals.rr} /min</div></div>
                  <div className="v-item"><div className="v-label">BP</div><div className="v-value">{vitals.sys}/{vitals.dia} mmHg</div></div>
                </div>
              )}
            </section>

            {/* Small route/map panel: draws Mapbox directions (streets) between nearest ambulance and patient */}
            <section className="detail-route">
              <h4>Route to patient</h4>
              <MiniRouteMap incident={selected} />
            </section>

            <footer className="detail-actions">
              <button
                className="btn accept"
                disabled={loadingAction !== null}
                onClick={() => performAction(selected.id, 'accept')}
              >
                {loadingAction === 'accept' ? 'Accepting…' : 'Accept'}
              </button>

              <button
                className="btn decline"
                disabled={loadingAction !== null}
                onClick={() => performAction(selected.id, 'decline')}
              >
                {loadingAction === 'decline' ? 'Declining…' : 'Decline'}
              </button>

              <button
                className="btn resolve"
                disabled={loadingAction !== null}
                onClick={() => performAction(selected.id, 'resolve')}
              >
                {loadingAction === 'resolve' ? 'Updating…' : 'Mark Treated'}
              </button>
            </footer>
          </div>
        )}
      </main>
    </div>
  )
}

function formatLatLon(loc) {
  if (!loc) return '—'
  if (loc.address) return loc.address
  if (loc.lat && loc.lon) return `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}`
  if (loc.latitude && loc.longitude) return `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`
  return '—'
}

// MiniRouteMap: small embedded map that computes Mapbox Directions between the nearest ambulance and the incident
function MiniRouteMap({ incident }) {
  const mapRef = useRef(null)
  const containerRef = useRef(null)
  const routeLayer = 'doctor-route'
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    const token = process.env.REACT_APP_MAPBOX_TOKEN || ''
    const tokenMissing = !token || token === 'your_mapbox_token_here' || token === 'REPLACE_ME'
    if (tokenMissing) return
    mapboxgl.accessToken = token
    if (mapRef.current) return
    try {
      const m = new mapboxgl.Map({ container: containerRef.current, style: 'mapbox://styles/mapbox/streets-v11', center: [23.6,46.77], zoom: 12 })
      mapRef.current = m
      m.on('load', () => {
        if (!m.getSource('doctor-route')) {
          m.addSource('doctor-route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
          m.addLayer({ id: routeLayer, type: 'line', source: 'doctor-route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ff7a18', 'line-width': 5 } })
        }
      })
    } catch (e) { console.warn('MiniRouteMap init failed', e) }
    return () => { try { if (mapRef.current) mapRef.current.remove() } catch (e) {} }
  }, [])

  // when incident changes, fetch nearest ambulance and request directions
  useEffect(() => {
    if (!incident) return
    const token = process.env.REACT_APP_MAPBOX_TOKEN || ''
    const tokenMissing = !token || token === 'your_mapbox_token_here' || token === 'REPLACE_ME'
    if (tokenMissing) { setStatus('token-missing'); return }
    const map = mapRef.current
    if (!map) { setStatus('no-map'); return }

    let cancelled = false
    setStatus('computing')
    ;(async () => {
      try {
        // fetch ambulances from backend and pick the nearest to the incident
        const res = await fetch('/ambulances')
        const list = await res.json()
        if (cancelled) return
        const patientPt = [(incident.lon || incident.location?.lon || 0), (incident.lat || incident.location?.lat || 0)]
        // fallback: if no coords present, try parsing address won't be attempted here
        const withCoords = (list || []).filter(a => a.lon != null && a.lat != null)
        if (!withCoords.length) { setStatus('no-units'); return }
        const nearest = withCoords.reduce((best, cur) => {
          const dcur = haversine([Number(cur.lon), Number(cur.lat)], patientPt)
          if (!best || dcur < best.d) return { item: cur, d: dcur }
          return best
        }, null)
        if (!nearest) { setStatus('no-units'); return }
        const amb = nearest.item
        const start = `${Number(amb.lon)},${Number(amb.lat)}`
        const end = `${Number(patientPt[0])},${Number(patientPt[1])}`
        const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start};${end}?geometries=geojson&overview=full&access_token=${token}`
        const r = await fetch(url)
        if (!r.ok) throw new Error('Directions fetch failed')
        const data = await r.json()
        if (!data.routes || !data.routes[0]) throw new Error('No route returned')
        const geom = data.routes[0].geometry
        if (cancelled) return
        try { map.getSource('doctor-route').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geom }] }) } catch (e) { console.warn('setData failed', e) }
        // fit bounds
        try {
          const coords = geom.coordinates
          const lats = coords.map(c => c[1]); const lons = coords.map(c => c[0])
          const minLat = Math.min(...lats); const maxLat = Math.max(...lats)
          const minLon = Math.min(...lons); const maxLon = Math.max(...lons)
          map.fitBounds([[minLon, minLat],[maxLon, maxLat]], { padding: 40 })
        } catch (e) { /* ignore fit errors */ }
        setStatus('ok')
      } catch (err) {
        console.warn('MiniRouteMap error', err)
        setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [incident && incident.id])

  const token = process.env.REACT_APP_MAPBOX_TOKEN || ''
  if (!token || token === 'your_mapbox_token_here' || token === 'REPLACE_ME') {
    return (<div className="mini-route-empty">Map disabled — set REACT_APP_MAPBOX_TOKEN and rebuild to enable route</div>)
  }

  return (
    <div className="mini-route-root">
      <div ref={containerRef} className="mini-route-map" />
      <div className="mini-route-status">{status === 'computing' ? 'Computing route…' : status === 'no-units' ? 'No available units' : status === 'token-missing' ? 'Token missing' : status === 'error' ? 'Route failed' : ''}</div>
    </div>
  )
}

// small haversine helper (meters)
function haversine([lon1, lat1], [lon2, lat2]) {
  function toRad(v) { return v * Math.PI / 180 }
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

