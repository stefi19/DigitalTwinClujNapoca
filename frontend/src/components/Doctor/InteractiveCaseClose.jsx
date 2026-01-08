import React, { useEffect, useRef, useState } from 'react';
import { ReactComponent as CaseClose } from './case-close-report.svg';
import axios from 'axios';
import './style.css';

export default function InteractiveCaseClose({ caseId = '1024' }) {
  const ref = useRef(null);
  const [status, setStatus] = useState('draft');
  const [busy, setBusy] = useState(false);
  const [caseData, setCaseData] = useState(null);

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
        const url = window.URL.createObjectURL(new Blob([res.data], { type: 'image/svg+xml' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = `case-${caseId}.svg`;
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


  // Load case data and populate SVG template text nodes
  useEffect(() => {
    async function loadCase() {
      if (!caseId) return;
      try {
        const res = await axios.get(`/cases/${caseId}`);
        const data = res.data;
        setCaseData(data);
        // perform simple substitutions in the inline SVG
        const root = ref.current;
        if (!root) return;
        // find all text elements inside the SVG
        const svg = root.querySelector('svg');
        if (!svg) return;
        const texts = svg.querySelectorAll('text');
        texts.forEach(t => {
          const txt = t.textContent || '';
          let replaced = txt;
          // placeholder matches from template
          replaced = replaced.replace('#1024', `#${data.id}`);
          replaced = replaced.replace('Ioan Popescu, 64, M', `${data.patient_name || 'Unknown'}, ${data.patient_age || ''}`);
          replaced = replaced.replace('Cardiac Arrest (OHCA)', data.type || (data.notes || 'Incident'));
          replaced = replaced.replace('Observatorului 15, Cluj-Napoca', data.address || `${data.lat?.toFixed(5)}, ${data.lon?.toFixed(5)}`);
          replaced = replaced.replace('A-12', data.assigned_to || data.assigned_to || 'N/A');
          replaced = replaced.replace('11:42 — Alert received', `${data.received_at || ''} — Alert received`);
          replaced = replaced.replace('11:56 — ROSC', `${data.updated_at || ''} — Closed`);
          replaced = replaced.replace('ER-2025-11-A12-1024', `ER-${data.id}`);
          if (replaced !== txt) t.textContent = replaced;
        });
      } catch (e) {
        console.error('Failed to load case', e);
      }
    }
    loadCase();
  }, [caseId]);

  return (
    <div ref={ref} style={{width: '100%', position: 'relative'}}>
      <CaseClose />
      <div style={{position: 'absolute', right: 40, top: 40, color: '#fff'}}>
        <div>Case status: {status}</div>
      </div>
    </div>
  );
}
