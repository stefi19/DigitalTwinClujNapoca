import React, { useEffect, useState } from "react";
import axios from 'axios';
import InteractiveCaseClose from '../Doctor/InteractiveCaseClose';
import image from "./image.svg";
// import shared Doctor theme first, then local styles to allow overrides
import "../Doctor/style.css";
import "./style.css";
import vector2 from "./vector-2.svg";
import vector3 from "./vector-3.svg";
import vector4 from "./vector-4.svg";
import vector5 from "./vector-5.svg";
import vector6 from "./vector-6.svg";
import vector7 from "./vector-7.svg";
import vector8 from "./vector-8.svg";
import vector9 from "./vector-9.svg";
import vector10 from "./vector-10.svg";
import vector11 from "./vector-11.svg";
import vector12 from "./vector-12.svg";
import vector13 from "./vector-13.svg";
import vector14 from "./vector-14.svg";
import vector15 from "./vector-15.svg";
import vector16 from "./vector-16.svg";
import vector17 from "./vector-17.svg";
import vector18 from "./vector-18.svg";
import vector19 from "./vector-19.svg";
import vector20 from "./vector-20.svg";
import vector21 from "./vector-21.svg";
import vector22 from "./vector-22.svg";
import vector23 from "./vector-23.svg";
import vector24 from "./vector-24.svg";
import vector25 from "./vector-25.svg";
import vector26 from "./vector-26.svg";
import vector27 from "./vector-27.svg";
import vector28 from "./vector-28.svg";
import vector29 from "./vector-29.svg";
import vector30 from "./vector-30.svg";
import vector31 from "./vector-31.svg";
import vector32 from "./vector-32.svg";
import vector33 from "./vector-33.svg";
import vector34 from "./vector-34.svg";
import vector35 from "./vector-35.svg";
import vector36 from "./vector-36.svg";
import vector from "./vector.svg";

export const DoctorClosure = () => {
    const [reports, setReports] = useState([]);
    const [selectedId, setSelectedId] = useState(null);

    useEffect(() => {
        async function load() {
            try {
                const res = await axios.get('/closure_reports');
                // show only medical incident closures in the Doctor Closure view
                const all = res.data || [];
                const medicalOnly = all.filter(r => r.incident && r.incident.type === 'medical');
                setReports(medicalOnly);
                if (medicalOnly.length > 0) setSelectedId(medicalOnly[0].closure.incident_id);
            } catch (e) {
                console.error('Failed to load closure reports', e);
            }
        }
        load();
        // Listen for closure creation events from the SSE stream so the
        // Doctor Closure view updates live when new closures are auto-created.
        let es;
        try {
            if (typeof window !== 'undefined' && typeof window.EventSource !== 'undefined') {
                es = new EventSource('/stream/incidents');
                es.onmessage = (e) => {
                    try {
                        const data = JSON.parse(e.data);
                        if (data && data.resource === 'closure') {
                            // refresh list when a closure event arrives
                            load();
                        }
                    } catch (err) { /* ignore parse errors */ }
                };
                es.onerror = () => { try { es.close(); } catch(e){} };
            }
        } catch (err) { /* ignore SSE setup errors */ }
        return () => { try { if (es && typeof es.close === 'function') es.close(); } catch(e){} };
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
                            <div className="closure-sub">{r.incident?.type || '—'} • {r.incident?.patient_name || '—'}</div>
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

                            <h4 className="section-title">Patient</h4>
                            <div>
                                <div><strong>Patient:</strong> {selected.incident.patient_name || '—'}</div>
                                <div><strong>Age:</strong> {selected.incident.patient_age || '—'}</div>
                                <div><strong>Contact:</strong> {selected.incident.patient_contact || selected.incident.contact || '—'}</div>
                            </div>

                            {/* actions moved to footer so they sit at the bottom of the page */}
                            <div style={{height:8}} />
                        </div>

                        {/* Treatment log placed after details and incident so it can span full width */}
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

                        {/* Footer actions: placed at the very bottom of the closure reports view */}
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
    );
};
