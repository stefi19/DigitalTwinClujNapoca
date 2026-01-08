import React from "react";
import InteractiveDispatchRoute from './InteractiveDispatchRoute';
import FireDispatchDynamic from './FireDispatchDynamic';
import "./style.css";

export const FireDispatch = () => {
  return (
    <div className="fire">
      <div style={{width: '100%', display: 'flex', justifyContent: 'center'}}>
        <div style={{width: '100%', maxWidth: 1100}}>
          <FireDispatchDynamic />
        </div>
      </div>
    </div>
  );
};

export default FireDispatch;
