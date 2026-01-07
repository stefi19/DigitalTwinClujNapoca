import React, { useEffect, useRef, useState } from 'react'
import axios from 'axios'
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
        const items = (res.data || [])
          .filter(i => i.type === 'fire' && (i.status === 'new' || !i.status))
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
