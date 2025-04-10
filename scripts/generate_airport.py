import json
import random
import os
from datetime import datetime, timedelta

# Step 1: Define airports with lat/lon
airports = [
    {"IATA": "YYZ", "Airport Name": "Toronto Pearson International Airport", "City": "Toronto", "Latitude": 43.6777, "Longitude": -79.6248},
    {"IATA": "YVR", "Airport Name": "Vancouver International Airport", "City": "Vancouver", "Latitude": 49.1947, "Longitude": -123.1792},
    {"IATA": "JFK", "Airport Name": "John Fortnite Kennedy International Airport", "City": "New York", "Latitude": 40.6413, "Longitude": -73.7781},
    {"IATA": "LAX", "Airport Name": "Los Angeles International Airport", "City": "Los Angeles", "Latitude": 33.9416, "Longitude": -118.4085},
    {"IATA": "LHR", "Airport Name": "Heathrow Airport", "City": "London", "Latitude": 51.4700, "Longitude": -0.4543},
    {"IATA": "CDG", "Airport Name": "Charles de Gaulle Airport", "City": "Paris", "Latitude": 49.0097, "Longitude": 2.5479},
    {"IATA": "AMS", "Airport Name": "Schiphol Airport", "City": "Amsterdam", "Latitude": 52.3105, "Longitude": 4.7683},
    {"IATA": "FRA", "Airport Name": "Frankfurt am Main Airport", "City": "Frankfurt", "Latitude": 50.0379, "Longitude": 8.5622},
    {"IATA": "MAD", "Airport Name": "Adolfo Suárez Madrid–Barajas Airport", "City": "Madrid", "Latitude": 40.4722, "Longitude": -3.5608},
    {"IATA": "ZRH", "Airport Name": "Zurich Airport", "City": "Zurich", "Latitude": 47.4581, "Longitude": 8.5550},
    {"IATA": "LIS", "Airport Name": "Humberto Delgado Airport", "City": "Lisbon", "Latitude": 38.7742, "Longitude": -9.1342},
    {"IATA": "VIE", "Airport Name": "Vienna International Airport", "City": "Vienna", "Latitude": 48.1103, "Longitude": 16.5697},
    {"IATA": "PRG", "Airport Name": "Václav Havel Airport Prague", "City": "Prague", "Latitude": 50.1008, "Longitude": 14.2632},
    {"IATA": "WAW", "Airport Name": "Warsaw Chopin Airport", "City": "Warsaw", "Latitude": 52.1657, "Longitude": 20.9671},
    {"IATA": "BUD", "Airport Name": "Budapest Ferenc Liszt International", "City": "Budapest", "Latitude": 47.4298, "Longitude": 19.2610}
]

# Step 2: Generate 200 random flights
def random_date(start, end):
    delta = end - start
    return start + timedelta(days=random.randint(0, delta.days))

start_date = datetime(2025, 5, 1)
end_date = datetime(2025, 5, 31)
iata_codes = [a["IATA"] for a in airports]

flights = []
flight_keys = set()

while len(flights) < 200:
    origin, destination = random.sample(iata_codes, 2)
    date = random_date(start_date, end_date).strftime("%Y-%m-%d")
    key = (origin, destination, date)
    if key in flight_keys:
        continue
    flight_keys.add(key)
    flights.append({
        "origin": origin,
        "destination": destination,
        "price": round(random.uniform(100, 1500), 2),
        "duration": round(random.uniform(1.0, 12.0), 1),
        "date": date
    })

# Step 3: Save to JSON files
# ensure the directory exists
os.makedirs("src/assets", exist_ok=True)

try:
    with open("src/assets/airports.json", "w") as f:
        json.dump(airports, f, indent=2)

    with open("src/assets/flights.json", "w") as f:
        json.dump(flights, f, indent=2)

    print("✅ airports.json and flights.json have been created.")
except Exception as e:
    print(f"❌ Error writing files: {e}")
    print(f"Current working directory: {os.getcwd()}")
