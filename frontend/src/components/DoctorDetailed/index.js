import React, { useEffect, useRef, useState } from 'react'
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

