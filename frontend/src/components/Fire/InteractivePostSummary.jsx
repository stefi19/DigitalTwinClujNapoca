import React, { useEffect, useRef, useState } from 'react';
import { ReactComponent as PostSummary } from './fire-post-incident-summary.svg';
import axios from 'axios';
import './style.css';

export default function InteractivePostSummary({ incidentId = 'F-207' }) {
  const ref = useRef(null);
  const [status, setStatus] = useState('contained');

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const btnAttach = root.querySelector('#btn-attach');
    const btnAnnotate = root.querySelector('#btn-annotate');
    const btnGen = root.querySelector('#btn-generate-report');
    const btnSend = root.querySelector('#btn-send-archive');
    const btnMark = root.querySelector('#btn-mark-closed');
    const btnNotify = root.querySelector('#btn-notify-invest');
    const btnAddNotes = root.querySelector('#btn-add-notes');
    const btnAnalytics = root.querySelector('#btn-open-analytics');

    [btnAttach, btnAnnotate, btnGen, btnSend, btnMark, btnNotify, btnAddNotes, btnAnalytics].forEach(b => { if (b) b.style.cursor = 'pointer'; });

    async function handleGenerate() {
      try {
        const res = await axios.get(`/incidents/${incidentId}/export`, { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const a = document.createElement('a'); a.href = url; a.download = `incident-${incidentId}-report.svg`; document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { console.error(e); alert('Export failed'); }
    }

    function handleAttach() { alert('Attach files functionality not implemented yet'); }
    function handleAnnotate() { alert('Annotation functionality not implemented yet'); }
    function handleSendArchive() { alert('Send to archive functionality not implemented yet'); }
    function handleMarkClosed() { setStatus('closed'); alert('Incident finalized successfully'); }
    function handleNotify() { alert('Investigation notification sent'); }
    function handleAddNotes() { alert('Notes editor not implemented yet'); }
    function handleAnalytics() { window.location.href = '/analytics/historical'; }

    btnGen?.addEventListener('click', handleGenerate);
    btnAttach?.addEventListener('click', handleAttach);
    btnAnnotate?.addEventListener('click', handleAnnotate);
    btnSend?.addEventListener('click', handleSendArchive);
    btnMark?.addEventListener('click', handleMarkClosed);
    btnNotify?.addEventListener('click', handleNotify);
    btnAddNotes?.addEventListener('click', handleAddNotes);
    btnAnalytics?.addEventListener('click', handleAnalytics);

    return () => {
      btnGen?.removeEventListener('click', handleGenerate);
      btnAttach?.removeEventListener('click', handleAttach);
      btnAnnotate?.removeEventListener('click', handleAnnotate);
      btnSend?.removeEventListener('click', handleSendArchive);
      btnMark?.removeEventListener('click', handleMarkClosed);
      btnNotify?.removeEventListener('click', handleNotify);
      btnAddNotes?.removeEventListener('click', handleAddNotes);
      btnAnalytics?.removeEventListener('click', handleAnalytics);
    };
  }, [incidentId]);

  return (
    <div ref={ref} style={{width: '100%', position: 'relative'}}>
      <PostSummary />
      <div style={{position: 'absolute', right: 40, top: 40, color: '#fff'}}>
        <div>Post status: {status}</div>
      </div>
    </div>
  );
}
