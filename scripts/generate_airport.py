import json
import random
import os
import math
from datetime import datetime, timedelta

# Step 1: Define airports with lat/lon
airports = [
    # north america
    {"IATA": "YYZ", "Airport Name": "Toronto Pearson International Airport", "City": "Toronto", "Latitude": 43.6777, "Longitude": -79.6248},
    {"IATA": "YVR", "Airport Name": "Vancouver International Airport", "City": "Vancouver", "Latitude": 49.1947, "Longitude": -123.1792},
    {"IATA": "JFK", "Airport Name": "John Fortnite Kennedy International Airport", "City": "New York", "Latitude": 40.6413, "Longitude": -73.7781},
    {"IATA": "LAX", "Airport Name": "Los Angeles International Airport", "City": "Los Angeles", "Latitude": 33.9416, "Longitude": -118.4085},
    
    # europe
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
    {"IATA": "BUD", "Airport Name": "Budapest Ferenc Liszt International", "City": "Budapest", "Latitude": 47.4298, "Longitude": 19.2610},
    {"IATA": "SVO", "Airport Name": "Sheremetyevo International Airport", "City": "Moscow", "Latitude": 55.9728, "Longitude": 37.4147},
    
    # south america
    {"IATA": "GRU", "Airport Name": "São Paulo/Guarulhos International Airport", "City": "São Paulo", "Latitude": -23.4356, "Longitude": -46.4731},
    {"IATA": "EZE", "Airport Name": "Ezeiza International Airport", "City": "Buenos Aires", "Latitude": -34.8222, "Longitude": -58.5358},
    {"IATA": "BOG", "Airport Name": "El Dorado International Airport", "City": "Bogotá", "Latitude": 4.7016, "Longitude": -74.1469},
    
    # africa
    {"IATA": "CAI", "Airport Name": "Cairo International Airport", "City": "Cairo", "Latitude": 30.1219, "Longitude": 31.4056},
    {"IATA": "JNB", "Airport Name": "O.R. Tambo International Airport", "City": "Johannesburg", "Latitude": -26.1392, "Longitude": 28.2460},
    {"IATA": "CMN", "Airport Name": "Mohammed V International Airport", "City": "Casablanca", "Latitude": 33.3675, "Longitude": -7.5897},
    
    # asia
    {"IATA": "NRT", "Airport Name": "Narita International Airport", "City": "Tokyo", "Latitude": 35.7647, "Longitude": 140.3864},
    {"IATA": "ICN", "Airport Name": "Incheon International Airport", "City": "Seoul", "Latitude": 37.4602, "Longitude": 126.4407},
    {"IATA": "PEK", "Airport Name": "Beijing Capital International Airport", "City": "Beijing", "Latitude": 39.5098, "Longitude": 116.4105},
    {"IATA": "PVG", "Airport Name": "Shanghai Pudong International Airport", "City": "Shanghai", "Latitude": 31.1443, "Longitude": 121.8083},
    {"IATA": "SIN", "Airport Name": "Singapore Changi Airport", "City": "Singapore", "Latitude": 1.3644, "Longitude": 103.9915},
    {"IATA": "BKK", "Airport Name": "Suvarnabhumi Airport", "City": "Bangkok", "Latitude": 13.6900, "Longitude": 100.7501},
    {"IATA": "DEL", "Airport Name": "Indira Gandhi International Airport", "City": "New Delhi", "Latitude": 28.5562, "Longitude": 77.1000},
    
    # australia
    {"IATA": "SYD", "Airport Name": "Sydney Kingsford Smith Airport", "City": "Sydney", "Latitude": -33.9399, "Longitude": 151.1753},
    {"IATA": "PER", "Airport Name": "Perth Airport", "City": "Perth", "Latitude": -31.9403, "Longitude": 115.9669}
]

def calculate_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the great-circle distance between two points on Earth using the Haversine formula.
    Returns distance in kilometers.
    """
    # Convert latitude and longitude from degrees to radians
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    
    # Haversine formula
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    r = 6371  # Earth's radius in kilometers
    return c * r

def calculate_flight_time(distance_km):
    """
    Calculate realistic flight time based on distance.
    Assumes average speed of 800 km/h for long-haul flights and 600 km/h for short-haul.
    Adds random deviation and minimum flight time.
    """
    # Base speed in km/h (varies by distance)
    base_speed = 800 if distance_km > 2000 else 600
    
    # Calculate base time in hours
    base_time = distance_km / base_speed
    
    # Add random deviation (±15%)
    deviation = random.uniform(-0.15, 0.15)
    flight_time = base_time * (1 + deviation)
    
    # Ensure minimum flight time of 1 hour
    return max(1.0, round(flight_time, 1))

def calculate_flight_price(distance_km, flight_time):
    """
    Calculate realistic flight price based on distance and flight time.
    Base price per km decreases with distance and tapers off for very long flights.
    """
    # Base price per km with stronger tapering for longer distances
    base_price_per_km = 0.15 * (1 - min(0.5, distance_km / 8000))
    
    # Calculate base price with distance tapering
    base_price = distance_km * base_price_per_km
    
    # Add premium for longer flights with diminishing returns
    # The premium increases more slowly for longer flights
    time_multiplier = 1 + (flight_time / 15)  # Reduced from 10 to 15 for slower increase
    
    # Add random variation (±15%)
    variation = random.uniform(-0.15, 0.15)
    
    # Calculate final price with additional tapering for very long flights
    final_price = base_price * time_multiplier * (1 + variation)
    
    # Apply additional tapering for very long flights
    if distance_km > 4000:
        # Reduce price for very long flights
        tapering_factor = 1 - min(0.3, (distance_km - 4000) / 10000)
        final_price *= tapering_factor
    
    # Ensure minimum price of $100 and maximum of $1200
    return round(max(100, min(1200, final_price)), 2)

# Step 2: Generate 5000 random flights
def random_date(start, end):
    delta = end - start
    return start + timedelta(days=random.randint(0, delta.days))

start_date = datetime(2025, 6, 1)
end_date = datetime(2025, 6, 14)
iata_codes = [a["IATA"] for a in airports]
airport_dict = {a["IATA"]: a for a in airports}

flights = []
flight_keys = set()
flight_id = 1  # initialize flight id counter

while len(flights) < 5000:
    origin, destination = random.sample(iata_codes, 2)
    date = random_date(start_date, end_date).strftime("%Y-%m-%d")
    key = (origin, destination, date)
    if key in flight_keys:
        continue
    flight_keys.add(key)
    
    # Get coordinates for both airports
    origin_airport = airport_dict[origin]
    dest_airport = airport_dict[destination]
    
    # Calculate distance and flight time
    distance = calculate_distance(
        origin_airport["Latitude"],
        origin_airport["Longitude"],
        dest_airport["Latitude"],
        dest_airport["Longitude"]
    )
    flight_time = calculate_flight_time(distance)
    price = calculate_flight_price(distance, flight_time)
    
    flights.append({
        "id": flight_id,  # add unique flight id
        "origin": origin,
        "destination": destination,
        "price": price,
        "duration": flight_time,
        "date": date,
        "distance_km": round(distance, 1)  # Add distance for reference
    })
    flight_id += 1  # increment flight id counter

# Step 3: Save to JSON files
# ensure the directory exists
os.makedirs("assets", exist_ok=True)

try:
    with open("assets/airports.json", "w") as f:
        json.dump(airports, f, indent=2)

    with open("assets/flights.json", "w") as f:
        json.dump(flights, f, indent=2)

    print("✅ airports.json and flights.json have been created.")
except Exception as e:
    print(f"❌ Error writing files: {e}")
    print(f"Current working directory: {os.getcwd()}")
