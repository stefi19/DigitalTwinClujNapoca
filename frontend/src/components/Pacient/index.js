import React from 'react';
import InteractivePacient from './InteractivePacient';
import './pacient-style.css';

export const Pacient = () => {
  return (
    <div style={{width: '100%', height: '100%'}}>
      <InteractivePacient />
    </div>
  );
};

export default Pacient;
