import json
import random
from typing import Dict, List, Tuple

# state populations (2020 census approximates) to weight migration numbers
STATE_POPULATIONS = {
    "CALIFORNIA": 39538223,
    "TEXAS": 29145505,
    "FLORIDA": 21538187,
    "NEW YORK": 20201249,
    "ILLINOIS": 12801989,
    "PENNSYLVANIA": 12801989,
    "OHIO": 11799448,
    "GEORGIA": 10711908,
    "MICHIGAN": 10077331,
    "NORTH CAROLINA": 10439388,
    "NEW JERSEY": 9288994,
    "VIRGINIA": 8631393,
    "WASHINGTON": 7705281,
    "ARIZONA": 7151502,
    "MASSACHUSETTS": 7029917,
    "TENNESSEE": 6910840,
    "INDIANA": 6785528,
    "MARYLAND": 6177224,
    "MISSOURI": 6154913,
    "WISCONSIN": 5893718,
    "COLORADO": 5773714,
    "MINNESOTA": 5706494,
    "SOUTH CAROLINA": 5118425,
    "ALABAMA": 5024279,
    "LOUISIANA": 4657757,
    "KENTUCKY": 4505836,
    "OREGON": 4237256,
    "OKLAHOMA": 3959353,
    "CONNECTICUT": 3605944,
    "UTAH": 3271616,
    "IOWA": 3190369,
    "NEVADA": 3104614,
    "ARKANSAS": 3011524,
    "MISSISSIPPI": 2961279,
    "KANSAS": 2937880,
    "NEW MEXICO": 2117522,
    "NEBRASKA": 1961504,
    "IDAHO": 1839106,
    "WEST VIRGINIA": 1793716,
    "HAWAII": 1455271,
    "NEW HAMPSHIRE": 1377529,
    "MAINE": 1362359,
    "MONTANA": 1084225,
    "RHODE ISLAND": 1097379,
    "DELAWARE": 989948,
    "SOUTH DAKOTA": 886667,
    "NORTH DAKOTA": 779094,
    "ALASKA": 733391,
    "DISTRICT OF COLUMBIA": 689545,
    "VERMONT": 643077,
    "WYOMING": 576851
}

# define neighboring states for more realistic migration patterns
NEIGHBORING_STATES = {
    "ALABAMA": ["FLORIDA", "GEORGIA", "TENNESSEE", "MISSISSIPPI"],
    "ALASKA": ["WASHINGTON"],  # not actually neighboring but closest
    "ARIZONA": ["CALIFORNIA", "NEVADA", "NEW MEXICO", "UTAH"],
    "ARKANSAS": ["LOUISIANA", "MISSISSIPPI", "MISSOURI", "OKLAHOMA", "TENNESSEE", "TEXAS"],
    "CALIFORNIA": ["ARIZONA", "NEVADA", "OREGON"],
    "COLORADO": ["KANSAS", "NEBRASKA", "NEW MEXICO", "OKLAHOMA", "UTAH", "WYOMING"],
    "CONNECTICUT": ["MASSACHUSETTS", "NEW YORK", "RHODE ISLAND"],
    "DELAWARE": ["MARYLAND", "NEW JERSEY", "PENNSYLVANIA"],
    "DISTRICT OF COLUMBIA": ["MARYLAND", "VIRGINIA"],
    "FLORIDA": ["ALABAMA", "GEORGIA"],
    "GEORGIA": ["ALABAMA", "FLORIDA", "NORTH CAROLINA", "SOUTH CAROLINA", "TENNESSEE"],
    "HAWAII": ["CALIFORNIA"],  # not actually neighboring but closest
    "IDAHO": ["MONTANA", "NEVADA", "OREGON", "UTAH", "WASHINGTON", "WYOMING"],
    "ILLINOIS": ["INDIANA", "IOWA", "KENTUCKY", "MISSOURI", "WISCONSIN"],
    "INDIANA": ["ILLINOIS", "KENTUCKY", "MICHIGAN", "OHIO"],
    "IOWA": ["ILLINOIS", "MINNESOTA", "MISSOURI", "NEBRASKA", "SOUTH DAKOTA", "WISCONSIN"],
    "KANSAS": ["COLORADO", "MISSOURI", "NEBRASKA", "OKLAHOMA"],
    "KENTUCKY": ["ILLINOIS", "INDIANA", "MISSOURI", "OHIO", "TENNESSEE", "VIRGINIA", "WEST VIRGINIA"],
    "LOUISIANA": ["ARKANSAS", "MISSISSIPPI", "TEXAS"],
    "MAINE": ["NEW HAMPSHIRE"],
    "MARYLAND": ["DELAWARE", "PENNSYLVANIA", "VIRGINIA", "WEST VIRGINIA"],
    "MASSACHUSETTS": ["CONNECTICUT", "NEW HAMPSHIRE", "NEW YORK", "RHODE ISLAND", "VERMONT"],
    "MICHIGAN": ["INDIANA", "OHIO", "WISCONSIN"],
    "MINNESOTA": ["IOWA", "NORTH DAKOTA", "SOUTH DAKOTA", "WISCONSIN"],
    "MISSISSIPPI": ["ALABAMA", "ARKANSAS", "LOUISIANA", "TENNESSEE"],
    "MISSOURI": ["ARKANSAS", "ILLINOIS", "IOWA", "KANSAS", "KENTUCKY", "NEBRASKA", "OKLAHOMA", "TENNESSEE"],
    "MONTANA": ["IDAHO", "NORTH DAKOTA", "SOUTH DAKOTA", "WYOMING"],
    "NEBRASKA": ["COLORADO", "IOWA", "KANSAS", "MISSOURI", "SOUTH DAKOTA", "WYOMING"],
    "NEVADA": ["ARIZONA", "CALIFORNIA", "IDAHO", "OREGON", "UTAH"],
    "NEW HAMPSHIRE": ["MAINE", "MASSACHUSETTS", "VERMONT"],
    "NEW JERSEY": ["DELAWARE", "NEW YORK", "PENNSYLVANIA"],
    "NEW MEXICO": ["ARIZONA", "COLORADO", "OKLAHOMA", "TEXAS", "UTAH"],
    "NEW YORK": ["CONNECTICUT", "MASSACHUSETTS", "NEW JERSEY", "PENNSYLVANIA", "VERMONT"],
    "NORTH CAROLINA": ["GEORGIA", "SOUTH CAROLINA", "TENNESSEE", "VIRGINIA"],
    "NORTH DAKOTA": ["MINNESOTA", "MONTANA", "SOUTH DAKOTA"],
    "OHIO": ["INDIANA", "KENTUCKY", "MICHIGAN", "PENNSYLVANIA", "WEST VIRGINIA"],
    "OKLAHOMA": ["ARKANSAS", "COLORADO", "KANSAS", "MISSOURI", "NEW MEXICO", "TEXAS"],
    "OREGON": ["CALIFORNIA", "IDAHO", "NEVADA", "WASHINGTON"],
    "PENNSYLVANIA": ["DELAWARE", "MARYLAND", "NEW JERSEY", "NEW YORK", "OHIO", "WEST VIRGINIA"],
    "RHODE ISLAND": ["CONNECTICUT", "MASSACHUSETTS"],
    "SOUTH CAROLINA": ["GEORGIA", "NORTH CAROLINA"],
    "SOUTH DAKOTA": ["IOWA", "MINNESOTA", "MONTANA", "NEBRASKA", "NORTH DAKOTA", "WYOMING"],
    "TENNESSEE": ["ALABAMA", "ARKANSAS", "GEORGIA", "KENTUCKY", "MISSISSIPPI", "MISSOURI", "NORTH CAROLINA", "VIRGINIA"],
    "TEXAS": ["ARKANSAS", "LOUISIANA", "NEW MEXICO", "OKLAHOMA"],
    "UTAH": ["ARIZONA", "COLORADO", "IDAHO", "NEVADA", "NEW MEXICO", "WYOMING"],
    "VERMONT": ["MASSACHUSETTS", "NEW HAMPSHIRE", "NEW YORK"],
    "VIRGINIA": ["KENTUCKY", "MARYLAND", "NORTH CAROLINA", "TENNESSEE", "WEST VIRGINIA"],
    "WASHINGTON": ["IDAHO", "OREGON"],
    "WEST VIRGINIA": ["KENTUCKY", "MARYLAND", "OHIO", "PENNSYLVANIA", "VIRGINIA"],
    "WISCONSIN": ["ILLINOIS", "IOWA", "MICHIGAN", "MINNESOTA"],
    "WYOMING": ["COLORADO", "IDAHO", "MONTANA", "NEBRASKA", "SOUTH DAKOTA", "UTAH"]
}

# popular destination states get a bonus multiplier
DESTINATION_MULTIPLIERS = {
    "FLORIDA": 1.5,
    "TEXAS": 1.4,
    "CALIFORNIA": 1.3,
    "ARIZONA": 1.2,
    "NORTH CAROLINA": 1.2,
    "COLORADO": 1.2,
    "WASHINGTON": 1.1,
    "OREGON": 1.1,
    "NEVADA": 1.1,
    "TENNESSEE": 1.1
}

def generate_migration_value(origin: str, destination: str) -> int:
    """Generate a synthetic migration value based on various factors."""
    if origin == destination:
        return 0
    
    # base value from population sizes
    origin_pop = STATE_POPULATIONS[origin]
    dest_pop = STATE_POPULATIONS[destination]
    
    # calculate base migration value
    base_value = int((origin_pop * dest_pop) ** 0.5 / 1000)
    
    # apply neighboring state multiplier
    if destination in NEIGHBORING_STATES[origin]:
        base_value *= random.uniform(1.5, 2.0)
    
    # apply destination state multiplier if applicable
    if destination in DESTINATION_MULTIPLIERS:
        base_value *= DESTINATION_MULTIPLIERS[destination]
    
    # add some randomness
    base_value *= random.uniform(0.8, 1.2)
    
    # ensure minimum value of 100
    return max(100, int(base_value))

def generate_migration_data() -> List[Dict]:
    """Generate complete migration data for all state pairs."""
    migrations = []
    states = list(STATE_POPULATIONS.keys())
    
    for origin in states:
        for destination in states:
            if origin != destination:  # exclude same-state migration
                value = generate_migration_value(origin, destination)
                migrations.append({
                    "origin": origin,
                    "destination": destination,
                    "value": value
                })
    
    return migrations

def main():
    """Generate and save migration data."""
    migrations = generate_migration_data()
    
    # sort by value in descending order for easier inspection
    migrations.sort(key=lambda x: x["value"], reverse=True)
    
    data = {"migrations": migrations}
    
    with open("src/assets/migration.json", "w") as f:
        json.dump(data, f, indent=2)
    
    print(f"Generated {len(migrations)} migration records")
    print("Data saved to src/assets/migration.json")

if __name__ == "__main__":
    main() 