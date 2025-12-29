import React from "react";
import InteractiveDispatchRoute from './InteractiveDispatchRoute';
import "./style.css";

export const FireDispatch = () => {
  return (
    <div className="fire">
      <div className="fire-dispatch-svg">
        <InteractiveDispatchRoute />
      </div>
    </div>
  );
};

export default FireDispatch;
