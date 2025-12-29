import React from "react";
import "./style.css";

export const DoctorDetailed = () => {
    return (
        <div className="doctor-detailed-svg" style={{padding: 12}}>
            {/* Inline SVG mockup provided by the user */}
            <svg id="Doctor-Alert-UI" width="100%" height="720" viewBox="0 0 1440 900" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="bgDark" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#0B1226"/>
                        <stop offset="100%" stopColor="#1B0F3B"/>
                    </linearGradient>
                    <radialGradient id="glowCyan" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.7"/>
                        <stop offset="100%" stopColor="#22D3EE" stopOpacity="0"/>
                    </radialGradient>
                    <radialGradient id="glowPurple" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.7"/>
                        <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0"/>
                    </radialGradient>
                    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="12"/>
                    </filter>
                </defs>

                <style>{`
                    @font-face { font-family: 'Montserrat'; src: local('Montserrat'); }
                    .ui { font-family:'Montserrat', Arial, sans-serif; }
                    .title { fill:#E5E7EB; font-weight:700; letter-spacing:.5px; }
                    .text { fill:#A7B0C0; }
                    .chip { fill:#0F172A; stroke:#334155; stroke-width:1.2; }
                    .panel { fill:rgba(10,17,37,0.75); stroke:#3B82F6; stroke-opacity:.35; }
                    .btn { rx:16; fill:rgba(15,23,42,0.8); stroke-width:1.5; }
                    .btn-label { fill:#E6F3FF; font-weight:600; }
                    .divider { stroke:#273244; stroke-width:1; opacity:.6; }
                `}</style>

                {/* Background */}
                <rect width="1440" height="900" fill="url(#bgDark)"/>
                <circle cx="320" cy="140" r="220" fill="url(#glowCyan)" opacity="0.35"/>
                <circle cx="1160" cy="740" r="260" fill="url(#glowPurple)" opacity="0.4"/>

                {/* Header */}
                <g id="Header" className="ui">
                    <rect x="24" y="24" width="1392" height="72" rx="16" className="chip"/>
                    <text x="48" y="72" className="title" style={{fontSize:24}}>🚨 Emergency Alert — Cardiac Arrest Detected</text>
                    <text x="1180" y="72" className="text" style={{fontSize:16}}>11:42:08 • UTC+02</text>
                </g>

                {/* Left: Alert details */}
                <g id="AlertPanel" className="ui" transform="translate(24,116)">
                    <rect width="820" height="540" rx="24" className="panel"/>
                    <text x="28" y="56" className="title" style={{fontSize:22}}>Patient</text>
                    <line x1="24" y1="72" x2="796" y2="72" className="divider"/>
                    <text x="28" y="110" className="text" style={{fontSize:18}}>Name: <tspan fill="#E5E7EB">Ioan Popescu</tspan> • Age: <tspan fill="#E5E7EB">64</tspan> • Sex: <tspan fill="#E5E7EB">M</tspan></text>
                    <text x="28" y="144" className="text" style={{fontSize:18}}>Address: <tspan fill="#E5E7EB">Observatorului Street 15, Cluj-Napoca</tspan></text>
                    <text x="28" y="178" className="text" style={{fontSize:18}}>Triggered by: <tspan fill="#E5E7EB">Wearable ECG</tspan> • Time since detection: <tspan fill="#E5E7EB">02:14</tspan></text>

                    <text x="28" y="230" className="title" style={{fontSize:22}}>Alert</text>
                    <line x1="24" y1="246" x2="796" y2="246" className="divider"/>
                    <g transform="translate(28,264)">
                        <rect width="220" height="40" rx="10" fill="#1E293B" stroke="#F43F5E" strokeOpacity=".6"/>
                        <text x="16" y="26" className="btn-label" style={{fontSize:16}}>Cardiac Arrest</text>
                    </g>
                    <g transform="translate(260,264)">
                        <rect width="220" height="40" rx="10" fill="#1E293B" stroke="#22D3EE" strokeOpacity=".6"/>
                        <text x="16" y="26" className="btn-label" style={{fontSize:16}}>Priority: Critical</text>
                    </g>
                    <g transform="translate(492,264)">
                        <rect width="220" height="40" rx="10" fill="#1E293B" stroke="#8B5CF6" strokeOpacity=".6"/>
                        <text x="16" y="26" className="btn-label" style={{fontSize:16}}>Assigned: —</text>
                    </g>

                    <text x="28" y="336" className="title" style={{fontSize:22}}>Actions</text>
                    <line x1="24" y1="352" x2="796" y2="352" className="divider"/>
                    <g transform="translate(28,372)">
                        <rect className="btn" width="200" height="56" stroke="#22D3EE"/>
                        <text x="20" y="36" className="btn-label" style={{fontSize:18}}>Accept Case</text>
                    </g>
                    <g transform="translate(248,372)">
                        <rect className="btn" width="200" height="56" stroke="#8B5CF6"/>
                        <text x="20" y="36" className="btn-label" style={{fontSize:18}}>Forward</text>
                    </g>
                    <g transform="translate(468,372)">
                        <rect className="btn" width="200" height="56" stroke="#F43F5E"/>
                        <text x="20" y="36" className="btn-label" style={{fontSize:18}}>Ignore</text>
                    </g>

                    <text x="28" y="458" className="title" style={{fontSize:22}}>Notes</text>
                    <line x1="24" y1="474" x2="796" y2="474" className="divider"/>
                    <rect x="28" y="490" width="768" height="44" rx="10" fill="#0B1327" stroke="#334155"/>
                    <text x="42" y="518" className="text" style={{fontSize:16}}>Add a quick note for the team…</text>
                </g>

                {/* Right: Mini-map */}
                <g id="MapPanel" className="ui" transform="translate(864,116)">
                    <rect width="552" height="540" rx="24" className="panel"/>
                    <text x="24" y="52" className="title" style={{fontSize:20}}>Incident Map</text>
                    <line x1="24" y1="64" x2="528" y2="64" className="divider"/>
                    <rect x="24" y="84" width="504" height="404" rx="18" fill="#0A1228" stroke="#22D3EE" strokeOpacity=".45"/>
                    <g transform="translate(40,100)">
                        <circle cx="60" cy="60" r="60" fill="url(#glowCyan)" opacity=".35"/>
                        <circle cx="380" cy="300" r="80" fill="url(#glowPurple)" opacity=".4"/>
                        <rect x="180" y="160" width="24" height="24" rx="6" fill="#22D3EE"/>
                        <text x="212" y="178" className="text" style={{fontSize:14}}>Ambulance A-12</text>
                        <rect x="280" y="220" width="14" height="14" rx="3" fill="#F59E0B"/>
                        <text x="300" y="232" className="text" style={{fontSize:14}}>Traffic light</text>
                    </g>
                    <g transform="translate(24,504)">
                        <rect width="240" height="28" rx="8" className="chip"/>
                        <text x="12" y="20" className="text" style={{fontSize:14}}>ETA: <tspan fill="#E5E7EB">3 min</tspan></text>
                        <rect x="260" width="244" height="28" rx="8" className="chip"/>
                        <text x="272" y="20" className="text" style={{fontSize:14}}>Route: <tspan fill="#E5E7EB">Unirii → UBB → Bastion</tspan></text>
                    </g>
                </g>

                {/* Bottom bar */}
                <g id="StatusBar" className="ui" transform="translate(24,676)">
                    <rect width="1392" height="200" rx="20" className="chip"/>
                    <g transform="translate(24,20)">
                        <text x="0" y="26" className="title" style={{fontSize:18}}>Live Status</text>
                        <line x1="0" y1="34" x2="1344" y2="34" className="divider"/>
                        <g transform="translate(0,48)">
                            <rect width="240" height="56" rx="12" className="panel"/>
                            <text x="16" y="36" className="text" style={{fontSize:16}}>Heart Rate: <tspan fill="#E5E7EB">102 bpm</tspan></text>
                        </g>
                        <g transform="translate(256,48)">
                            <rect width="240" height="56" rx="12" className="panel"/>
                            <text x="16" y="36" className="text" style={{fontSize:16}}>SpO₂: <tspan fill="#E5E7EB">93%</tspan></text>
                        </g>
                        <g transform="translate(512,48)">
                            <rect width="240" height="56" rx="12" className="panel"/>
                            <text x="16" y="36" className="text" style={{fontSize:16}}>Blood Pressure: <tspan fill="#E5E7EB">140/85</tspan></text>
                        </g>
                        <g transform="translate(768,48)">
                            <rect width="240" height="56" rx="12" className="panel"/>
                            <text x="16" y="36" className="text" style={{fontSize:16}}>Ambulance ETA: <tspan fill="#E5E7EB">3 min</tspan></text>
                        </g>
                        <g transform="translate(1024,48)">
                            <rect width="240" height="56" rx="12" className="panel"/>
                            <text x="16" y="36" className="text" style={{fontSize:16}}>Connection: <tspan fill="#22D3EE">LIVE</tspan></text>
                        </g>
                    </g>
                </g>
            </svg>
        </div>
    );
};
