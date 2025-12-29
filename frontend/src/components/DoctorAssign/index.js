import React from "react";
import "./style.css";

export const DoctorAssign = () => {
    return (
        <div className="doctor-assign-svg" style={{padding: 12}}>
            <svg id="Assign-Ambulance-Modal" width="100%" height="720" viewBox="0 0 1440 900" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="bgDark" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#0B1226"/>
                        <stop offset="100%" stopColor="#1B0F3B"/>
                    </linearGradient>
                    <radialGradient id="glowCyan" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.7"/>
                        <stop offset="100%" stopColor="#22D3EE" stopOpacity="0"/>
                    </radialGradient>
                    <radialGradient id="glowPurple" cx="50%" cy="50%" r="60%">
                        <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.7"/>
                        <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0"/>
                    </radialGradient>
                </defs>
                <style>{`
                    @font-face { font-family: 'Montserrat'; src: local('Montserrat'); }
                    .ui { font-family: 'Montserrat', Arial, sans-serif; }
                    .title { fill:#E5E7EB; font-weight:700; }
                    .text { fill:#A7B0C0; }
                    .chip { fill:#0F172A; stroke:#334155; stroke-width:1.2; }
                    .tag { fill:#0B1327; stroke:#334155; stroke-width:1; }
                    .btn { rx:14; fill:#0B1327; stroke-width:1.6; }
                    .divider { stroke:#243045; stroke-width:1; opacity:.7; }
                    .row { fill:rgba(12,18,39,.75); stroke:#26324A; }
                    .row-active { fill:rgba(12,18,39,.9); stroke:#22D3EE; }
                    .badge-free { fill:#16A34A; }
                    .badge-busy { fill:#DC2626; }
                    .badge-enroute { fill:#F59E0B; }
                `}</style>

                <rect width="1440" height="900" fill="url(#bgDark)"/>
                <circle cx="320" cy="160" r="240" fill="url(#glowCyan)" opacity=".35"/>
                <circle cx="1120" cy="720" r="300" fill="url(#glowPurple)" opacity=".40"/>
                <rect width="1440" height="900" fill="#0B1226" opacity=".55"/>

                <g id="Modal" className="ui" transform="translate(360,210)">
                    <rect width="720" height="480" rx="24" className="chip" fill="rgba(15,23,42,.9)" stroke="#3B82F6" strokeOpacity=".35"/>
                    <text x="28" y="54" className="title" style={{fontSize:24}}>Assign Ambulance</text>
                    <text x="28" y="80" className="text" style={{fontSize:14}}>Select an available unit based on ETA and equipment.</text>

                    <g transform="translate(28,96)">
                        <rect width="664" height="44" rx="10" fill="#0B1327" stroke="#334155"/>
                        <circle cx="18" cy="22" r="6" fill="#22D3EE"/>
                        <rect x="30" y="18" width="10" height="2" fill="#22D3EE" transform="rotate(45 35 19)"/>
                        <text x="54" y="28" className="text" style={{fontSize:14}}>Search units, gear, or district…</text>
                    </g>

                    <g transform="translate(28,150)">
                        <text x="0" y="0" className="text" style={{fontSize:12, opacity:.7}}>UNIT</text>
                        <text x="180" y="0" className="text" style={{fontSize:12, opacity:.7}}>STATUS</text>
                        <text x="260" y="0" className="text" style={{fontSize:12, opacity:.7}}>ETA</text>
                        <text x="328" y="0" className="text" style={{fontSize:12, opacity:.7}}>CAPABILITIES</text>
                        <line x1="0" y1="8" x2="664" y2="8" className="divider"/>
                    </g>

                    <g id="Row-A12" transform="translate(28,166)">
                        <rect className="row-active" width="664" height="68" rx="12"/>
                        <circle cx="14" cy="34" r="10" fill="none" stroke="#22D3EE" strokeWidth="2"/>
                        <path d="M9 34 l4 4 l8 -10" fill="none" stroke="#22D3EE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <text x="36" y="39" className="title" style={{fontSize:16}}>Ambulance A-12</text>
                        <g transform="translate(180,18)">
                            <rect width="64" height="32" rx="8" fill="#0B1327" stroke="#1E293B"/>
                            <circle cx="14" cy="16" r="6" className="badge-enroute"/>
                            <text x="28" y="22" className="text" style={{fontSize:12}}>En-route</text>
                        </g>
                        <text x="260" y="39" className="title" style={{fontSize:16}}>3 min</text>
                        <g transform="translate(328,14)">
                            <g transform="translate(0,0)"><rect className="tag" width="112" height="28" rx="8"/><text x="12" y="19" className="text" style={{fontSize:12}}>Defibrillator</text></g>
                            <g transform="translate(124,0)"><rect className="tag" width="104" height="28" rx="8"/><text x="12" y="19" className="text" style={{fontSize:12}}>ALS Kit</text></g>
                            <g transform="translate(240,0)"><rect className="tag" width="88" height="28" rx="8"/><text x="12" y="19" className="text" style={{fontSize:12}}>O₂ Tank</text></g>
                        </g>
                    </g>

                    <g id="Row-B07" transform="translate(28,242)">
                        <rect className="row" width="664" height="68" rx="12"/>
                        <circle cx="14" cy="34" r="10" fill="none" stroke="#334155" strokeWidth="2"/>
                        <text x="36" y="39" className="title" style={{fontSize:16}}>Ambulance B-07</text>
                        <g transform="translate(180,18)">
                            <rect width="56" height="32" rx="8" fill="#0B1327" stroke="#1E293B"/>
                            <circle cx="14" cy="16" r="6" className="badge-free"/>
                            <text x="28" y="22" className="text" style={{fontSize:12}}>Free</text>
                        </g>
                        <text x="260" y="39" className="title" style={{fontSize:16}}>7 min</text>
                        <g transform="translate(328,14)">
                            <g><rect className="tag" width="112" height="28" rx="8"/><text x="12" y="19" className="text" style={{fontSize:12}}>Defibrillator</text></g>
                            <g transform="translate(124,0)"><rect className="tag" width="120" height="28" rx="8"/><text x="12" y="19" className="text" style={{fontSize:12}}>Trauma Kit</text></g>
                        </g>
                    </g>

                    <g id="Row-C21" transform="translate(28,318)">
                        <rect className="row" width="664" height="68" rx="12"/>
                        <circle cx="14" cy="34" r="10" fill="none" stroke="#334155" strokeWidth="2"/>
                        <text x="36" y="39" className="title" style={{fontSize:16}}>Ambulance C-21</text>
                        <g transform="translate(180,18)">
                            <rect width="64" height="32" rx="8" fill="#0B1327" stroke="#1E293B"/>
                            <circle cx="14" cy="16" r="6" className="badge-busy"/>
                            <text x="28" y="22" className="text" style={{fontSize:12}}>Busy</text>
                        </g>
                        <text x="260" y="39" className="title" style={{fontSize:16}}>—</text>
                        <g transform="translate(328,14)">
                            <g><rect className="tag" width="104" height="28" rx="8"/><text x="12" y="19" className="text" style={{fontSize:12}}>ALS Kit</text></g>
                            <g transform="translate(116,0)"><rect className="tag" width="100" height="28" rx="8"/><text x="12" y="19" className="text" style={{fontSize:12}}>Ventilator</text></g>
                        </g>
                    </g>

                    <g transform="translate(28,408)">
                        <rect className="btn" width="160" height="48" stroke="#22D3EE"/>
                        <text x="20" y="31" className="title" style={{fontSize:16}}>Assign</text>
                        <rect x="176" className="btn" width="140" height="48" stroke="#334155"/>
                        <text x="196" y="31" className="text" style={{fontSize:16}}>Cancel</text>
                    </g>
                </g>
            </svg>
        </div>
    );
};
