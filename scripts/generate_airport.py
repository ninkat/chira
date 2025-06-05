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
    {"IATA": "ORD", "Airport Name": "O'Hare International Airport", "City": "Chicago", "Latitude": 40.9762, "Longitude": -87.9073},
    {"IATA": "DFW", "Airport Name": "Dallas/Fort Worth International Airport", "City": "Dallas", "Latitude": 32.8998, "Longitude": -97.0403},
    {"IATA": "BOS", "Airport Name": "Boston Logan International Airport", "City": "Boston", "Latitude": 42.3656, "Longitude": -71.0096},
    {"IATA": "DCA", "Airport Name": "Ronald Reagan Washington National Airport", "City": "Washington", "Latitude": 38.8512, "Longitude": -77.0402},
    
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
    {"IATA": "FCO", "Airport Name": "Leonardo da Vinci International Airport", "City": "Rome", "Latitude": 42.3601, "Longitude": 12.2429},
    {"IATA": "ARN", "Airport Name": "Stockholm Arlanda Airport", "City": "Stockholm", "Latitude": 59.6519, "Longitude": 17.9186},
    
    # middle east
    {"IATA": "DXB", "Airport Name": "Dubai International Airport", "City": "Dubai", "Latitude": 25.2532, "Longitude": 55.3657},
    {"IATA": "DOH", "Airport Name": "Hamad International Airport", "City": "Doha", "Latitude": 25.2731, "Longitude": 51.6080},
    {"IATA": "TLV", "Airport Name": "Ben Gurion Airport", "City": "Tel Aviv", "Latitude": 32.0004, "Longitude": 34.8706},
    
    # south america
    {"IATA": "GRU", "Airport Name": "São Paulo/Guarulhos International Airport", "City": "São Paulo", "Latitude": -23.4356, "Longitude": -46.4731},
    {"IATA": "EZE", "Airport Name": "Ezeiza International Airport", "City": "Buenos Aires", "Latitude": -34.8222, "Longitude": -58.5358},
    {"IATA": "BOG", "Airport Name": "El Dorado International Airport", "City": "Bogotá", "Latitude": 4.7016, "Longitude": -74.1469},
    {"IATA": "LIM", "Airport Name": "Jorge Chávez International Airport", "City": "Lima", "Latitude": -12.0219, "Longitude": -77.1143},
    {"IATA": "SCL", "Airport Name": "Arturo Merino Benítez International Airport", "City": "Santiago", "Latitude": -33.3928, "Longitude": -70.7856},
    {"IATA": "GIG", "Airport Name": "Rio de Janeiro/Galeão International Airport", "City": "Rio de Janeiro", "Latitude": -22.8099, "Longitude": -43.2506},
    
    # africa
    {"IATA": "CAI", "Airport Name": "Cairo International Airport", "City": "Cairo", "Latitude": 30.1219, "Longitude": 31.4056},
    {"IATA": "JNB", "Airport Name": "O.R. Tambo International Airport", "City": "Johannesburg", "Latitude": -26.1392, "Longitude": 28.2460},
    {"IATA": "CMN", "Airport Name": "Mohammed V International Airport", "City": "Casablanca", "Latitude": 33.3675, "Longitude": -7.5897},
    {"IATA": "NBO", "Airport Name": "Jomo Kenyatta International Airport", "City": "Nairobi", "Latitude": -1.3192, "Longitude": 36.9278},
    
    # asia
    {"IATA": "NRT", "Airport Name": "Narita International Airport", "City": "Tokyo", "Latitude": 35.7647, "Longitude": 140.3864},
    {"IATA": "ICN", "Airport Name": "Incheon International Airport", "City": "Seoul", "Latitude": 37.4602, "Longitude": 126.4407},
    {"IATA": "PEK", "Airport Name": "Beijing Capital International Airport", "City": "Beijing", "Latitude": 39.5098, "Longitude": 116.4105},
    {"IATA": "PVG", "Airport Name": "Shanghai Pudong International Airport", "City": "Shanghai", "Latitude": 31.1443, "Longitude": 121.8083},
    {"IATA": "SIN", "Airport Name": "Singapore Changi Airport", "City": "Singapore", "Latitude": 1.3644, "Longitude": 103.9915},
    {"IATA": "BKK", "Airport Name": "Suvarnabhumi Airport", "City": "Bangkok", "Latitude": 13.6900, "Longitude": 100.7501},
    {"IATA": "DEL", "Airport Name": "Indira Gandhi International Airport", "City": "New Delhi", "Latitude": 28.5562, "Longitude": 77.1000},
    {"IATA": "MNL", "Airport Name": "Ninoy Aquino International Airport", "City": "Manila", "Latitude": 14.5086, "Longitude": 121.0194},
    {"IATA": "HKG", "Airport Name": "Hong Kong International Airport", "City": "Hong Kong", "Latitude": 22.3080, "Longitude": 113.9185},
    {"IATA": "KUL", "Airport Name": "Kuala Lumpur International Airport", "City": "Kuala Lumpur", "Latitude": 2.7456, "Longitude": 101.7072},
    {"IATA": "CGK", "Airport Name": "Soekarno-Hatta International Airport", "City": "Jakarta", "Latitude": -6.1256, "Longitude": 106.6558},
    {"IATA": "BOM", "Airport Name": "Chhatrapati Shivaji Maharaj International Airport", "City": "Mumbai", "Latitude": 19.0896, "Longitude": 72.8656},
    {"IATA": "HAN", "Airport Name": "Noi Bai International Airport", "City": "Hanoi", "Latitude": 21.2187, "Longitude": 105.8047},
    {"IATA": "TPE", "Airport Name": "Taoyuan International Airport", "City": "Taipei", "Latitude": 25.0777, "Longitude": 121.2322},
    {"IATA": "IKA", "Airport Name": "Imam Khomeini International Airport", "City": "Tehran", "Latitude": 35.4161, "Longitude": 51.1522},
    {"IATA": "KIX", "Airport Name": "Kansai International Airport", "City": "Osaka", "Latitude": 34.4320, "Longitude": 135.2304},
    
    # australia
    {"IATA": "SYD", "Airport Name": "Sydney Kingsford Smith Airport", "City": "Sydney", "Latitude": -33.9399, "Longitude": 151.1753},
    {"IATA": "PER", "Airport Name": "Perth Airport", "City": "Perth", "Latitude": -31.9403, "Longitude": 115.9669},
    
    # new zealand
    {"IATA": "AKL", "Airport Name": "Auckland Airport", "City": "Auckland", "Latitude": -37.0082, "Longitude": 174.7850}
]

# define airlines with continental dominance
airlines = [
    {"code": "AA", "name": "American Airlines", "continent": "north america"},
    {"code": "LH", "name": "Lufthansa", "continent": "europe"},
    {"code": "LA", "name": "LATAM Airlines", "continent": "south america"},
    {"code": "ET", "name": "Ethiopian Airlines", "continent": "africa"},
    {"code": "SQ", "name": "Singapore Airlines", "continent": "asia"},
    {"code": "QF", "name": "Qantas", "continent": "australia"},
    {"code": "EK", "name": "Emirates", "continent": "middle east"},
    {"code": "AC", "name": "Air Canada", "continent": "north america"},
    {"code": "AF", "name": "Air France", "continent": "europe"},
    {"code": "NZ", "name": "Air New Zealand", "continent": "new zealand"}
]

# PUZZLE SCENARIO DEFINITION
PUZZLE_CONFIG = {
    "friend_a": {
        "origin": "YYZ",  # toronto
        "name": "User 1",
        "available_dates": ["2025-06-08", "2025-06-09", "2025-06-10", "2025-06-11", "2025-06-12"],
        "preferred_airlines": ["AA", "AC"],  # american airlines, air canada
        "max_budget": 1200,
        "description": "lives in toronto, available june 8-12, prefers american airlines or air canada, budget max $1200"
    },
    "friend_b": {
        "origin": "YYZ",  # toronto (same as friend_a now)
        "name": "User 2",
        "available_dates": ["2025-06-10", "2025-06-11", "2025-06-12", "2025-06-13", "2025-06-14"],
        "preferred_airlines": ["AC", "LH"],  # air canada, lufthansa
        "max_budget": 1500,
        "description": "lives in toronto, available june 10-14, prefers air canada or lufthansa, budget max $1500"
    },
    "destination_region": "europe",
    "common_airline": "AC",  # air canada
    "overlap_dates": ["2025-06-10", "2025-06-11", "2025-06-12"],  # when both are available
    "solution_destinations": [
        {"airport": "LHR", "date": "2025-06-10"},  # london
        {"airport": "ARN", "date": "2025-06-11"},  # stockholm  
        {"airport": "FRA", "date": "2025-06-12"}   # frankfurt
    ]
}

# european airports for the puzzle
EUROPEAN_AIRPORTS = ["LHR", "CDG", "AMS", "FRA", "MAD", "ZRH", "LIS", "VIE", "PRG", "WAW", "BUD", "SVO", "FCO", "ARN"]

# define points of interest (routes that should have many flights)
POINTS_OF_INTEREST = {
    "YYZ": EUROPEAN_AIRPORTS,  # toronto to all european cities
}

def calculate_distance(lat1, lon1, lat2, lon2):
    """calculate the great-circle distance between two points on earth using the haversine formula."""
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    r = 6371  # earth's radius in kilometers
    return c * r

def calculate_flight_time(distance_km):
    """calculate realistic flight time based on distance."""
    base_speed = 800 if distance_km > 2000 else 600
    base_time = distance_km / base_speed
    deviation = random.uniform(-0.15, 0.15)
    flight_time = base_time * (1 + deviation)
    return max(1.0, round(flight_time, 1))

def calculate_flight_price(distance_km, flight_time, is_solution=False):
    """calculate flight price, with special handling for solution flights."""
    # base price calculation with diminishing returns for longer distances
    base_price_per_km = 0.15 * (1 - min(0.5, distance_km / 10000))
    base_price = distance_km * base_price_per_km
    
    # time-based adjustments (longer flights have higher operational costs)
    time_multiplier = 1 + (flight_time / 12)  # reduced impact of flight time
    
    # market variation (random factor)
    variation = random.uniform(-0.15, 0.20)  # slightly asymmetric to favor price increases
    
    # calculate initial price
    final_price = base_price * time_multiplier * (1 + variation)
    
    # distance-based tapering for long-haul flights
    if distance_km > 5000:
        tapering_factor = 1 - min(0.25, (distance_km - 5000) / 20000)
        final_price *= tapering_factor
    
    # minimum price floor based on distance
    min_price = max(150, distance_km * 0.08)
    
    # special pricing for solution flights to ensure they fit budget constraints
    if is_solution:
        # ensure friend a's flight is under $1200 and friend b's is under $1500
        if final_price > 1100:  # leave some buffer
            final_price = random.uniform(900, 1100)
        elif final_price < 600:  # ensure it's not suspiciously cheap
            final_price = random.uniform(600, 800)
    
    # cap at 2000 but make it rare
    return round(max(min_price, min(2000, final_price)), 2)

def get_airline_for_route(origin, destination, force_airline=None):
    """get airline for a route, with option to force specific airline."""
    if force_airline:
        return next(a for a in airlines if a["code"] == force_airline)
    
    # for puzzle routes, prefer the relevant airlines
    if origin == "YYZ" and destination in EUROPEAN_AIRPORTS:
        return random.choice([a for a in airlines if a["code"] in ["AA", "AC", "LH"]])
    
    # fallback to random airline
    return random.choice(airlines)

def generate_solution_flights():
    """generate multiple solution flights that satisfy the puzzle constraints."""
    flights = []
    flight_id = 1
    
    config = PUZZLE_CONFIG
    airport_dict = {a["IATA"]: a for a in airports}
    
    # generate solution flights for each destination
    for solution in config["solution_destinations"]:
        destination = solution["airport"]
        date = solution["date"]
        
        # solution flight for friend a (toronto to destination on air canada)
        origin_a = airport_dict[config["friend_a"]["origin"]]
        dest = airport_dict[destination]
        distance_a = calculate_distance(origin_a["Latitude"], origin_a["Longitude"], 
                                       dest["Latitude"], dest["Longitude"])
        flight_time_a = calculate_flight_time(distance_a)
        price_a = calculate_flight_price(distance_a, flight_time_a, is_solution=True)
        
        flights.append({
            "id": flight_id,
            "origin": config["friend_a"]["origin"],
            "destination": destination,
            "price": price_a,
            "duration": flight_time_a,
            "date": date,
            "distance_km": round(distance_a, 1),
            "airline": {"code": "AC", "name": "Air Canada", "continent": "north america"}
        })
        flight_id += 1
        
        # solution flight for friend b (toronto to destination on air canada)
        origin_b = airport_dict[config["friend_b"]["origin"]]
        distance_b = calculate_distance(origin_b["Latitude"], origin_b["Longitude"], 
                                       dest["Latitude"], dest["Longitude"])
        flight_time_b = calculate_flight_time(distance_b)
        price_b = calculate_flight_price(distance_b, flight_time_b, is_solution=True)
        
        flights.append({
            "id": flight_id,
            "origin": config["friend_b"]["origin"],
            "destination": destination,
            "price": price_b,
            "duration": flight_time_b,
            "date": date,
            "distance_km": round(distance_b, 1),
            "airline": {"code": "AC", "name": "Air Canada", "continent": "north america"}
        })
        flight_id += 1
    
    return flights, flight_id

def generate_interest_flights(start_flight_id):
    """generate many flights for points of interest (origin cities to european destinations)."""
    flights = []
    flight_id = start_flight_id
    airport_dict = {a["IATA"]: a for a in airports}
    
    # generate dates from june 1 to june 14
    all_dates = []
    for i in range(14):  # june 1 to june 14
        date = datetime(2025, 6, 1) + timedelta(days=i)
        all_dates.append(date.strftime("%Y-%m-%d"))
    
    # generate many flights for each interest route
    for origin in POINTS_OF_INTEREST:
        for destination in POINTS_OF_INTEREST[origin]:
            # generate 25-40 flights per route to make search more interesting
            num_flights = random.randint(25, 40)
            
            # track which dates we've used for solution routes to avoid duplicates
            solution_dates_used = set()
            
            # check if this route matches any solution routes
            for solution in PUZZLE_CONFIG["solution_destinations"]:
                if ((origin == PUZZLE_CONFIG["friend_a"]["origin"] and 
                     destination == solution["airport"]) or 
                    (origin == PUZZLE_CONFIG["friend_b"]["origin"] and 
                     destination == solution["airport"])):
                    solution_dates_used.add(solution["date"])
            
            for _ in range(num_flights):
                origin_airport = airport_dict[origin]
                dest_airport = airport_dict[destination]
                distance = calculate_distance(origin_airport["Latitude"], origin_airport["Longitude"],
                                            dest_airport["Latitude"], dest_airport["Longitude"])
                flight_time = calculate_flight_time(distance)
                price = calculate_flight_price(distance, flight_time)
                
                # ensure we don't duplicate the exact solution flight
                date = random.choice(all_dates)
                
                # avoid duplicating any solution flights
                attempts = 0
                while date in solution_dates_used and attempts < 10:
                    date = random.choice(all_dates)
                    attempts += 1
                
                airline = get_airline_for_route(origin, destination)
                
                flights.append({
                    "id": flight_id,
                    "origin": origin,
                    "destination": destination,
                    "price": price,
                    "duration": flight_time,
                    "date": date,
                    "distance_km": round(distance, 1),
                    "airline": airline
                })
                flight_id += 1
    
    return flights, flight_id

def generate_filler_flights(start_flight_id, target_total=5000):
    """generate filler flights for other routes with limited quantities."""
    flights = []
    flight_id = start_flight_id
    airport_dict = {a["IATA"]: a for a in airports}
    iata_codes = [a["IATA"] for a in airports]
    
    # generate dates from june 1 to june 14
    all_dates = []
    for i in range(14):  # june 1 to june 14
        date = datetime(2025, 6, 1) + timedelta(days=i)
        all_dates.append(date.strftime("%Y-%m-%d"))
    
    # track routes we've already covered
    covered_routes = set()
    for origin in POINTS_OF_INTEREST:
        for destination in POINTS_OF_INTEREST[origin]:
            covered_routes.add((origin, destination))
    
    # add solution routes
    for solution in PUZZLE_CONFIG["solution_destinations"]:
        covered_routes.add((PUZZLE_CONFIG["friend_a"]["origin"], solution["airport"]))
        covered_routes.add((PUZZLE_CONFIG["friend_b"]["origin"], solution["airport"]))
    
    while len(flights) < (target_total - start_flight_id + 1):
        origin, destination = random.sample(iata_codes, 2)
        route = (origin, destination)
        
        # skip if already covered or if we've generated enough for this route
        existing_count = sum(1 for f in flights if f["origin"] == origin and f["destination"] == destination)
        if route in covered_routes or existing_count >= 5:
            continue
        
        origin_airport = airport_dict[origin]
        dest_airport = airport_dict[destination]
        distance = calculate_distance(origin_airport["Latitude"], origin_airport["Longitude"],
                                    dest_airport["Latitude"], dest_airport["Longitude"])
        flight_time = calculate_flight_time(distance)
        price = calculate_flight_price(distance, flight_time)
        date = random.choice(all_dates)
        airline = get_airline_for_route(origin, destination)
        
        flights.append({
            "id": flight_id,
            "origin": origin,
            "destination": destination,
            "price": price,
            "duration": flight_time,
            "date": date,
            "distance_km": round(distance, 1),
            "airline": airline
        })
        flight_id += 1
    
    return flights

# generate all flights
print("🔍 generating puzzle flights...")
solution_flights, next_id = generate_solution_flights()
print(f"✅ generated {len(solution_flights)} solution flights")

interest_flights, next_id = generate_interest_flights(next_id)
print(f"✅ generated {len(interest_flights)} interest flights")

filler_flights = generate_filler_flights(next_id, 5000)
print(f"✅ generated {len(filler_flights)} filler flights")

all_flights = solution_flights + interest_flights + filler_flights
print(f"📊 total flights generated: {len(all_flights)}")

# create puzzle description
puzzle_description = {
    "title": "Travel Rendezvous Challenge",
    "description": "Two users want to meet for a vacation. Help them find flights that work for both!",
    "friends": {
        "user_1": {
            "name": "User 1",
            "description": "lives in toronto, available june 8-12, prefers american airlines or air canada, budget max $1200",
            "origin_airport": "YYZ",
            "available_dates": ["2025-06-08", "2025-06-09", "2025-06-10", "2025-06-11", "2025-06-12"],
            "preferred_airlines": ["AA", "AC"],
            "max_budget": 1200
        },
        "user_2": {
            "name": "User 2", 
            "description": "lives in toronto, available june 10-14, prefers air canada or lufthansa, budget max $1500",
            "origin_airport": "YYZ",
            "available_dates": ["2025-06-10", "2025-06-11", "2025-06-12", "2025-06-13", "2025-06-14"],
            "preferred_airlines": ["AC", "LH"],
            "max_budget": 1500
        }
    },
    "constraints": {
        "must_arrive_same_day": True,
        "both_must_afford": True,
        "both_must_be_available": True,
        "overlap_dates": ["2025-06-10", "2025-06-11", "2025-06-12"]
    },
    "evaluation_criteria": {
        "valid_solution": {
            "same_destination": "flights must go to the same destination airport",
            "same_date": "flights must be on the same date", 
            "within_budgets": "user_1's flight <= $1200, user_2's flight <= $1500",
            "date_availability": "date must be in both users' available dates",
            "airline_preferences": "each user must use one of their preferred airlines"
        }
    },
    "hints": {
        "overlap_dates": "look for dates when both users are available (june 10-12)",
        "budget_consideration": "both users need to stay within their budgets",
        "airline_preferences": "each user must use one of their preferred airlines",
        "multiple_solutions": "there may be several valid combinations - any that meet all criteria work!"
    }
}

# save to json files
os.makedirs("assets", exist_ok=True)

try:
    with open("assets/airports.json", "w") as f:
        json.dump(airports, f, indent=2)

    with open("assets/airlines.json", "w") as f:
        json.dump(airlines, f, indent=2)

    with open("assets/flights.json", "w") as f:
        json.dump(all_flights, f, indent=2)
    
    with open("assets/puzzle_description.json", "w") as f:
        json.dump(puzzle_description, f, indent=2)

    print("✅ all files created successfully!")
    print("\n🎯 PUZZLE SCENARIO:")
    print("=" * 50)
    print(f"🏠 User 1 {puzzle_description['friends']['user_1']['description']}")
    print(f"🏠 User 2 {puzzle_description['friends']['user_2']['description']}")
    print(f"🎯 Goal: Meet for a vacation")
    print(f"✈️  Must arrive same day, each using preferred airlines")
    print(f"💡 Hint: User 1 prefers {puzzle_description['friends']['user_1']['preferred_airlines']}, User 2 prefers {puzzle_description['friends']['user_2']['preferred_airlines']}")
    print(f"🎲 Multiple solutions exist - any valid combination works!")
    print("=" * 50)
    
except Exception as e:
    print(f"❌ error writing files: {e}")
    print(f"current working directory: {os.getcwd()}")
