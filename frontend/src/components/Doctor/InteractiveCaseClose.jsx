import React, { useEffect, useRef, useState } from 'react';
import { ReactComponent as CaseClose } from './case-close-report.svg';
import axios from 'axios';
import './style.css';

export default function InteractiveCaseClose({ caseId = '1024' }) {
  const ref = useRef(null);
  const [status, setStatus] = useState('draft');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const btnConfirm = root.querySelector('#btn-confirm');
    const btnCancel = root.querySelector('#btn-cancel');
    const btnExport = root.querySelector('#btn-export');
    const btnSend = root.querySelector('#btn-send');

    [btnConfirm, btnCancel, btnExport, btnSend].forEach(b => {
      if (b) b.style.cursor = 'pointer';
    });

    async function handleConfirm() {
      if (busy) return;
      setBusy(true);
      try {
        await axios.post('/cases/confirm', { id: caseId });
        setStatus('confirmed');
      } catch (e) {
        console.error(e);
        alert('Confirm failed: ' + (e?.response?.data || e.message));
      } finally { setBusy(false); }
    }

    function handleCancel() {
      setStatus('cancelled');
      // navigate back
      window.history.back();
    }

    async function handleExport() {
      try {
        const res = await axios.get(`/cases/${caseId}/export`, { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement('a');
        a.href = url;
        a.download = `case-${caseId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (e) {
        console.error(e);
        alert('Export failed');
      }
    }

    async function handleSend() {
      try {
        await axios.post('/cases/send-ehr', { id: caseId });
        alert('Sent to EHR');
      } catch (e) {
        console.error(e);
        alert('Send failed');
      }
    }

    btnConfirm?.addEventListener('click', handleConfirm);
    btnConfirm?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') handleConfirm(); });
    btnCancel?.addEventListener('click', handleCancel);
    btnCancel?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') handleCancel(); });
    btnExport?.addEventListener('click', handleExport);
    btnExport?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') handleExport(); });
    btnSend?.addEventListener('click', handleSend);
    btnSend?.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') handleSend(); });

    return () => {
      btnConfirm?.removeEventListener('click', handleConfirm);
      btnCancel?.removeEventListener('click', handleCancel);
      btnExport?.removeEventListener('click', handleExport);
      btnSend?.removeEventListener('click', handleSend);
    };
  }, [caseId, busy]);

  return (
    <div ref={ref} style={{width: '100%', position: 'relative'}}>
      <CaseClose />
      <div style={{position: 'absolute', right: 40, top: 40, color: '#fff'}}>
        <div>Case status: {status}</div>
      </div>
    </div>
  );
}
