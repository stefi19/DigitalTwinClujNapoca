import React, { useEffect, useRef, useState } from 'react';
import { ReactComponent as DispatchRoute } from './fire-dispatch-route.svg';
import axios from 'axios';
import './style.css';

export default function InteractiveDispatchRoute({ incidentId = 'F-207' }) {
  const ref = useRef(null);
  const [status, setStatus] = useState('en-route');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const btnArrived = root.querySelector('#btn-arrived');
    const btnBackup = root.querySelector('#btn-backup');
    const btnSensors = root.querySelector('#btn-sensors');
    const btnClose = root.querySelector('#btn-close');

    [btnArrived, btnBackup, btnSensors, btnClose].forEach(b => { if (b) b.style.cursor = 'pointer'; });

    async function handleArrived() {
      if (busy) return;
      setBusy(true);
      try {
        await axios.post('/incidents/arrived', { id: incidentId });
        setStatus('arrived');
        alert('Marked as arrived');
      } catch (e) { console.error(e); alert('Failed to mark arrived'); } finally { setBusy(false); }
    }

    async function handleBackup() {
      try {
        await axios.post('/incidents/backup', { id: incidentId });
        alert('Backup requested');
      } catch (e) { console.error(e); alert('Backup request failed'); }
    }

    function handleSensors() {
      window.location.href = '/city/sensors';
    }

    function handleClose() { window.history.back(); }

    btnArrived?.addEventListener('click', handleArrived);
    btnArrived?.addEventListener('keydown', (e) => { if (e.key==='Enter' || e.key===' ') handleArrived(); });
    btnBackup?.addEventListener('click', handleBackup);
    btnBackup?.addEventListener('keydown', (e) => { if (e.key==='Enter' || e.key===' ') handleBackup(); });
    btnSensors?.addEventListener('click', handleSensors);
    btnClose?.addEventListener('click', handleClose);

    return () => {
      btnArrived?.removeEventListener('click', handleArrived);
      btnBackup?.removeEventListener('click', handleBackup);
      btnSensors?.removeEventListener('click', handleSensors);
      btnClose?.removeEventListener('click', handleClose);
    };
  }, [incidentId, busy]);

  return (
    <div ref={ref} style={{width: '100%', position: 'relative'}}>
      <DispatchRoute />
      <div style={{position: 'absolute', left: 420, top: 76, color: '#fff'}}>
        <div>Dispatch status: {status}</div>
      </div>
    </div>
  );
}
