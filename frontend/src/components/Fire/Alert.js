import React from "react";
import InteractiveAlert from './InteractiveAlert';
import FireAlertDetailed from './FireAlertDetailed';
import "./style.css";

export const FireAlert = () => {
  return (
    <div className="fire">
      <div style={{width: '100%', display: 'flex', justifyContent: 'center'}}>
        <div style={{width: '100%', maxWidth: 1100}}>
          <FireAlertDetailed />
        </div>
      </div>
    </div>
  );
};
