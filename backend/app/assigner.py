from math import radians, cos, sin, asin, sqrt
from typing import List, Dict, Tuple


def haversine(lat1, lon1, lat2, lon2):
    # return distance in kilometers
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a))
    km = 6367 * c
    return km


def assign_nearest(incident: Dict, resources: List[Dict]) -> Tuple[Dict, float]:
    """Return the nearest resource dict and distance (km)"""
    best = None
    best_dist = float("inf")
    for r in resources:
        d = haversine(incident["lat"], incident["lon"], r["lat"], r["lon"]) 
        if d < best_dist:
            best_dist = d
            best = r
    return best, best_dist


if __name__ == "__main__":
    # quick demo
    incident = {"lat": 46.7712, "lon": 23.6236}
    resources = [
        {"id": "A1", "lat": 46.770, "lon": 23.620},
        {"id": "A2", "lat": 46.780, "lon": 23.640},
    ]
    print(assign_nearest(incident, resources))
