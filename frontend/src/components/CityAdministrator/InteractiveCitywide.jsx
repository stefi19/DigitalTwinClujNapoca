import React, { useState } from 'react';
import axios from 'axios';
import './citywide-style.css';

export default function InteractiveCitywide() {
  const [busy, setBusy] = useState(false);

  async function handleDispatch() {
    if (busy) return;
    setBusy(true);
    try {
      const payload = { message: 'Emergency: please evacuate area X', channels: ['sms', 'app'] };
      await axios.post('/alerts/broadcast', payload);
      alert('Alert broadcast requested');
    } catch (e) {
      console.error(e);
      alert('Broadcast failed');
    } finally {
      setBusy(false);
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleDispatch();
    }
  }

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      <svg id="Citywide-Alert-Console" width="1440" height="900" viewBox="0 0 1440 900" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bgDark" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#0B1226" />
            <stop offset="100%" stopColor="#1B0F3B" />
          </linearGradient>
          <style>{`
            .ui { font-family:'Montserrat', Arial, sans-serif; }
            .title { fill:#E5E7EB; font-weight:700; }
            .text { fill:#A7B0C0; }
            .panel { fill:rgba(10,17,37,.95); stroke:#EF4444; stroke-opacity:.35; }
            .divider { stroke:#273244; stroke-width:1; opacity:.7; }
            .btn { rx:10; stroke-width:1.4; font-weight:600; }
            .btn-label { fill:#E6F3FF; font-size:14px; font-weight:600; text-anchor:middle; }
            .dropdown { fill:rgba(15,23,42,.8); stroke:#334155; stroke-width:1.2; }
            .checkbox { fill:#1E293B; stroke:#334155; stroke-width:1; }
            .checkbox-checked { fill:#EF4444; stroke:#991B1B; stroke-width:1; }
          `}</style>
        </defs>

        {/* Background */}
        <rect width="1440" height="900" fill="url(#bgDark)" />

        {/* Header */}
        <g className="ui">
          <rect x="24" y="24" width="1392" height="64" rx="16" fill="#0F172A" stroke="#334155" strokeWidth="1.2" />
          <text x="48" y="66" className="title" style={{ fontSize: 22 }}>Citywide Alert Console — Cluj County Operations Center</text>
          <text x="1160" y="66" className="text" style={{ fontSize: 14 }}>Last Sync: 12:44 EET</text>
        </g>

        {/* Main panel */}
        <g transform="translate(72,120)" className="ui">
          <rect width="1296" height="700" rx="22" className="panel" />
          <text x="32" y="56" className="title" style={{ fontSize: 20 }}>Broadcast Configuration</text>
          <line x1="24" y1="64" x2="1260" y2="64" className="divider" />

          {/* Message input box */}
          <rect x="40" y="100" width="1220" height="200" rx="10" fill="#0F172A" stroke="#334155" strokeWidth="1.2" />
          <text x="60" y="140" className="text" style={{ fontSize: 14 }}>Alert message content:</text>
          <text x="60" y="170" fill="#64748B" style={{ fontSize: 14 }}>Type your emergency message here... (e.g. “Flood warning in Gheorgheni and Mărăști”)</text>

          {/* Channels */}
          <text x="60" y="340" className="title" style={{ fontSize: 16 }}>Select Alert Channels</text>
          <g transform="translate(60,360)">
            <rect className="checkbox-checked" width="16" height="16" rx="3" />
            <text x="26" y="13" className="text" style={{ fontSize: 14 }}>SMS Broadcast</text>

            <rect x="200" className="checkbox" width="16" height="16" rx="3" />
            <text x="226" y="13" className="text" style={{ fontSize: 14 }}>Mobile App Push</text>

            <rect x="440" className="checkbox" width="16" height="16" rx="3" />
            <text x="466" y="13" className="text" style={{ fontSize: 14 }}>Radio / TV Relay</text>

            <rect x="670" className="checkbox" width="16" height="16" rx="3" />
            <text x="696" y="13" className="text" style={{ fontSize: 14 }}>Local Sirens</text>
          </g>

          {/* District dropdown */}
          <text x="60" y="420" className="title" style={{ fontSize: 16 }}>Target Districts</text>
          <rect x="60" y="440" width="380" height="46" rx="8" className="dropdown" />
          <text x="80" y="468" className="text" style={{ fontSize: 14 }}>Select districts...</text>
          <polygon points="410,456 420,468 410,480" fill="#94A3B8" />

          {/* Expanded dropdown list */}
          <g transform="translate(60,494)">
            <rect width="380" height="260" rx="8" fill="rgba(15,23,42,.95)" stroke="#334155" strokeWidth="1.2" />
            <g transform="translate(20,20)">
              <rect className="checkbox-checked" width="16" height="16" rx="3" />
              <text x="26" y="13" className="text" style={{ fontSize: 14 }}>Mănăștur</text>

              <rect y="28" className="checkbox" width="16" height="16" rx="3" />
              <text x="26" y="41" className="text" style={{ fontSize: 14 }}>Centru</text>

              <rect y="56" className="checkbox-checked" width="16" height="16" rx="3" />
              <text x="26" y="69" className="text" style={{ fontSize: 14 }}>Gheorgheni</text>

              <rect y="84" className="checkbox-checked" width="16" height="16" rx="3" />
              <text x="26" y="97" className="text" style={{ fontSize: 14 }}>Mărăști</text>

              <rect y="112" className="checkbox" width="16" height="16" rx="3" />
              <text x="26" y="125" className="text" style={{ fontSize: 14 }}>Zorilor</text>

              <rect y="140" className="checkbox" width="16" height="16" rx="3" />
              <text x="26" y="153" className="text" style={{ fontSize: 14 }}>Grigorescu</text>

              <rect y="168" className="checkbox" width="16" height="16" rx="3" />
              <text x="26" y="181" className="text" style={{ fontSize: 14 }}>Iris</text>

              <rect y="196" className="checkbox" width="16" height="16" rx="3" />
              <text x="26" y="209" className="text" style={{ fontSize: 14 }}>Mărășești</text>

              <rect y="224" className="checkbox" width="16" height="16" rx="3" />
              <text x="26" y="237" className="text" style={{ fontSize: 14 }}>Bulgaria</text>
            </g>
          </g>

          {/* Dispatch Button (now React-handled) */}
          <g id="btn-dispatch-alert" tabIndex={0} role="button" onClick={handleDispatch} onKeyDown={handleKey} style={{ cursor: busy ? 'wait' : 'pointer' }}>
            <rect x="980" y="620" width="260" height="64" rx="10" fill="none" stroke="#EF4444" strokeWidth="2" />
            <text x="1110" y="662" fill="#FCA5A5" style={{ fontSize: 18, fontWeight: 700 }}>Confirm & Dispatch Alert</text>
          </g>
        </g>
      </svg>
    </div>
  );
}
