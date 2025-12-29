import React from "react";
import InteractiveCitywide from './InteractiveCitywide';
import "./citywide-style.css";

export const CitywideAlert = () => {
    return (
        <div className="city-administrator">
            <div className="citywide-alert-svg">
                <InteractiveCitywide />
            </div>
        </div>
    );
};

export default CitywideAlert;
