import React from "react";
import { ReactComponent as ClujMultiHazard } from "./cluj-multihazard-prediction.svg";
import "./style.css";

export const CityAdministrator = () => {
    return (
        <div className="city-administrator">
            <div className="cluj-multihazard">
                <ClujMultiHazard />
            </div>
        </div>
    );
};

export default CityAdministrator;
