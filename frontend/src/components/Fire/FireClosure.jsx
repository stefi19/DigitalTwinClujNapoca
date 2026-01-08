import React, { useEffect, useState } from "react";
import axios from 'axios';
// reuse Doctor styles and the DoctorClosure specific styles for identical UI
import "../Doctor/style.css";
import "../DoctorClosure/style.css";

export const FireClosure = () => {
    const [reports, setReports] = useState([]);
    const [selectedId, setSelectedId] = useState(null);

    useEffect(() => {
        async function load() {
            try {
                const res = await axios.get('/closure_reports');
                const all = res.data || [];
                // show only fire incident closures in the Fire Closure view
                const fireOnly = all.filter(r => r.incident && r.incident.type === 'fire');
                setReports(fireOnly);
                if (fireOnly.length > 0) setSelectedId(fireOnly[0].closure.incident_id);
            } catch (e) {
                console.error('Failed to load closure reports', e);
            }
        }
        load();
    }, []);

    const selected = reports.find(r => r.closure.incident_id === selectedId);

    return (
        <div className="doctor closure-page">
            <aside className="closure-sidebar">
                <h3 className="closure-title">Closure reports</h3>
                {reports.length === 0 && <div className="muted">No closure reports found.</div>}
                <ul className="closure-list">
                    {reports.map(r => (
                        <li key={r.closure.id} onClick={() => setSelectedId(r.closure.incident_id)} className={`closure-item ${selectedId === r.closure.incident_id ? 'selected' : ''}`}>
                            <div className="closure-key">{r.closure.billing_ref || r.closure.id}</div>
                            <div className="closure-sub">{r.incident?.type || '—'} • {r.incident?.patient_name || r.incident?.sensor_id || '—'}</div>
                            <div className="closure-loc">{r.incident?.address || (r.incident?.lat ? `${r.incident?.lat.toFixed(4)}, ${r.incident?.lon.toFixed(4)}` : '—')}</div>
                        </li>
                    ))}
                </ul>
            </aside>

            <main className="closure-main">
                {!selected && <div className="muted">Select a closure from the left to view details.</div>}
                {selected && (
                    <div className="closure-grid">
                        <div className="closure-details">
                            <h2 className="closure-heading">{selected.closure.billing_ref || selected.closure.id}</h2>
                            <p className="muted"><strong>Summary:</strong> {selected.closure.summary}</p>
                            <p className="muted"><strong>Disposition:</strong> {selected.closure.disposition}</p>
                            <p className="muted"><strong>Recommendations:</strong> {selected.closure.recommendations}</p>
                        </div>

                        <div className="closure-incident">
                            <h3 className="section-title">Incident</h3>
                            <div><strong>ID:</strong> {selected.incident.id}</div>
                            <div><strong>Type:</strong> {selected.incident.type}</div>
                            <div><strong>Status:</strong> {selected.incident.status}</div>
                            <div><strong>Severity:</strong> {selected.incident.severity}</div>
                            <div><strong>Address:</strong> {selected.incident.address || `${selected.incident.lat}, ${selected.incident.lon}`}</div>

                            <h4 className="section-title">Sensor / Contact</h4>
                            <div>
                                <div><strong>Sensor ID:</strong> {selected.incident.sensor_id || '—'}</div>
                                <div><strong>Sensor Type:</strong> {selected.incident.sensor_type || '—'}</div>
                                <div><strong>Contact:</strong> {selected.incident.contact || '—'}</div>
                            </div>

                            <div style={{height:8}} />
                        </div>

                        <div className="treatment-log">
                            <h3 className="section-title">Treatment Log</h3>
                            {(() => {
                                try {
                                    const events = JSON.parse(selected.closure.treatment_log || '[]');
                                    return events.map((ev, i) => (
                                        <div key={i} className="treatment-event">
                                            <div className="event-time">{ev.time}</div>
                                            <div className="event-body"><strong>{ev.action}</strong> — {ev.details}</div>
                                        </div>
                                    ));
                                } catch (e) {
                                    return <pre className="muted" style={{whiteSpace:'pre-wrap'}}>{selected.closure.treatment_log}</pre>;
                                }
                            })()}
                        </div>

                        <div className="closure-actions-footer">
                            <div className="actions">
                                <button className="btn primary" onClick={async () => {
                                    try { const res = await axios.get(`/cases/${selected.incident.id}/export`, { responseType: 'blob' }); const url=window.URL.createObjectURL(new Blob([res.data], {type:'image/svg+xml'})); const a=document.createElement('a'); a.href=url; a.download=`case-${selected.incident.id}.svg`; document.body.appendChild(a); a.click(); a.remove(); } catch(e){alert('Export failed')}
                                }}>Export Report</button>
                                <button className="btn" onClick={async () => { try { await axios.post('/cases/confirm', {id: selected.incident.id}); alert('Closure finalized successfully'); } catch(e){alert('Failed to finalize closure')} }}>Finalize Closure</button>
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    )
}

export default FireClosure;
