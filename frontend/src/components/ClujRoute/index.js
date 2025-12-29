import React from "react";
import { ReactComponent as ClujRouteSVG } from "./cluj-route-traffic-ambulance.svg";
import "./style.css";

export const ClujRoute = () => {
  return (
    <div className="cluj-route" style={{padding:12}}>
      <ClujRouteSVG />
    </div>
  );
};

export default ClujRoute;
