import React from "react";
import InteractiveAlert from './InteractiveAlert';
import "./style.css";

export const FireAlert = () => {
  return (
    <div className="fire">
      <div className="svg-ui-flux-pacient">
        {/* Render the interactive Fire Alert component */}
        <InteractiveAlert />
      </div>
    </div>
  );
};
