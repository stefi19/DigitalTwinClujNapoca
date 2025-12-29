import React from "react";
import InteractivePostSummary from './InteractivePostSummary';
import "./style.css";

export const FirePost = () => {
  return (
    <div className="fire">
      <div className="fire-post-svg">
        <InteractivePostSummary />
      </div>
    </div>
  );
};

export default FirePost;
