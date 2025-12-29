import React, { useEffect, useRef, useState } from 'react';
import { ReactComponent as FireIncidentAlert } from './fire-incident-alert.svg';
import axios from 'axios';
import './style.css';

export default function InteractiveAlert({ incidentId = 'F-207' }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState('unconfirmed');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const el = root.querySelector('#btn-verify');
    const dispatch = root.querySelector('#btn-dispatch');
    const ig = root.querySelector('#btn-ignore');
    const route = root.querySelector('#btn-route');

    if (el) el.style.cursor = 'pointer';
    if (dispatch) dispatch.style.cursor = 'pointer';
    if (ig) ig.style.cursor = 'pointer';
    if (route) route.style.cursor = 'pointer';

    async function handleVerify() {
      if (busy) return;
      setBusy(true);
      try {
        await axios.post('/incidents/verify', { id: incidentId });
        setStatus('verified');
        flash(el, '#FCD34D');
      } catch (e) {
        console.error(e);
        alert('Verify failed: ' + (e?.response?.data || e.message));
      } finally {
        setBusy(false);
      }
    }

    async function handleDispatch() {
      if (busy) return;
      setBusy(true);
      try {
        await axios.post('/incidents/dispatch', { id: incidentId, unit: 'Fire-Truck F-12' });
        setStatus('dispatched');
        flash(dispatch, '#F87171');
      } catch (e) {
        console.error(e);
        alert('Dispatch failed: ' + (e?.response?.data || e.message));
      } finally {
        setBusy(false);
      }
    }

    function handleIgnore() {
      setStatus('ignored');
      flash(ig, '#64748b');
    }

    function handleRoute() {
      // open route view — navigate to fire/dispatch page or open modal
      window.location.href = '/fire/dispatch';
    }

    function onKey(e, handler) {
      if (e.key === 'Enter' || e.key === ' ') handler();
    }

    if (el) {
      el.addEventListener('click', handleVerify);
      el.addEventListener('keydown', (e) => onKey(e, handleVerify));
    }
    if (dispatch) {
      dispatch.addEventListener('click', handleDispatch);
      dispatch.addEventListener('keydown', (e) => onKey(e, handleDispatch));
    }
    if (ig) {
      ig.addEventListener('click', handleIgnore);
      ig.addEventListener('keydown', (e) => onKey(e, handleIgnore));
    }
    if (route) {
      route.addEventListener('click', handleRoute);
      route.addEventListener('keydown', (e) => onKey(e, handleRoute));
    }

    return () => {
      if (el) {
        el.removeEventListener('click', handleVerify);
      }
      if (dispatch) {
        dispatch.removeEventListener('click', handleDispatch);
      }
      if (ig) {
        ig.removeEventListener('click', handleIgnore);
      }
      if (route) {
        route.removeEventListener('click', handleRoute);
      }
    };
  }, [incidentId, busy]);

  function flash(group, color) {
    try {
      const rect = group.querySelector('rect');
      const prev = rect.getAttribute('fill') || '';
      rect.setAttribute('fill', color);
      setTimeout(() => rect.setAttribute('fill', prev), 900);
    } catch (e) {
      // ignore
    }
  }

  return (
    <div ref={containerRef} style={{width: '100%', position: 'relative'}}>
      <FireIncidentAlert />
      <div style={{position: 'absolute', right: 400, top: 24, color: '#fff', fontSize: 12}}>
        <div>Status: {status}</div>
      </div>
    </div>
  );
}
