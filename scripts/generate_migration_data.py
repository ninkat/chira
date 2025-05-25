import json
import random
from typing import Dict, List, Tuple

# state populations (approximates) to weight migration numbers
# placeholder data for 1960s - please update with accurate figures
STATE_POPULATIONS_1960S = {
    "CALIFORNIA": 15717204, "TEXAS": 9579677, "FLORIDA": 4951560, "NEW YORK": 16782304,
    "ILLINOIS": 10081158, "PENNSYLVANIA": 11319366, "OHIO": 9706397, "GEORGIA": 3943116,
    "MICHIGAN": 7823194, "NORTH CAROLINA": 4556155, "NEW JERSEY": 6066782, "VIRGINIA": 3966949,
    "WASHINGTON": 2853214, "ARIZONA": 1302161, "MASSACHUSETTS": 5148578, "TENNESSEE": 3567089,
    "INDIANA": 4662498, "MARYLAND": 3100689, "MISSOURI": 4319813, "WISCONSIN": 3951777,
    "COLORADO": 1753947, "MINNESOTA": 3413864, "SOUTH CAROLINA": 2382594, "ALABAMA": 3266740,
    "LOUISIANA": 3257022, "KENTUCKY": 3038156, "OREGON": 1768687, "OKLAHOMA": 2328284,
    "CONNECTICUT": 2535234, "UTAH": 890627, "IOWA": 2757537, "NEVADA": 285278,
    "ARKANSAS": 1786272, "MISSISSIPPI": 2178141, "KANSAS": 2178611, "NEW MEXICO": 951023,
    "NEBRASKA": 1411330, "IDAHO": 667191, "WEST VIRGINIA": 1860421, "HAWAII": 632772,
    "NEW HAMPSHIRE": 606921, "MAINE": 969265, "MONTANA": 674767, "RHODE ISLAND": 859488,
    "DELAWARE": 446292, "SOUTH DAKOTA": 680514, "NORTH DAKOTA": 632446, "ALASKA": 226167,
    "DISTRICT OF COLUMBIA": 763956, "VERMONT": 389881, "WYOMING": 330066
}

# placeholder data for 1990s - please update with accurate figures
STATE_POPULATIONS_1990S = {
    "CALIFORNIA": 29760021, "TEXAS": 16986510, "FLORIDA": 12937926, "NEW YORK": 17990455,
    "ILLINOIS": 11430602, "PENNSYLVANIA": 11881643, "OHIO": 10847115, "GEORGIA": 6478216,
    "MICHIGAN": 9295297, "NORTH CAROLINA": 6628637, "NEW JERSEY": 7730188, "VIRGINIA": 6187358,
    "WASHINGTON": 4866692, "ARIZONA": 3665228, "MASSACHUSETTS": 6016425, "TENNESSEE": 4877185,
    "INDIANA": 5544159, "MARYLAND": 4781468, "MISSOURI": 5117073, "WISCONSIN": 4891769,
    "COLORADO": 3294394, "MINNESOTA": 4375099, "SOUTH CAROLINA": 3486703, "ALABAMA": 4040587,
    "LOUISIANA": 4219973, "KENTUCKY": 3685296, "OREGON": 2842321, "OKLAHOMA": 3145585,
    "CONNECTICUT": 3287116, "UTAH": 1722850, "IOWA": 2776755, "NEVADA": 1201833,
    "ARKANSAS": 2350725, "MISSISSIPPI": 2573216, "KANSAS": 2477574, "NEW MEXICO": 1515069,
    "NEBRASKA": 1578385, "IDAHO": 1006749, "WEST VIRGINIA": 1793477, "HAWAII": 1108229,
    "NEW HAMPSHIRE": 1109252, "MAINE": 1227928, "MONTANA": 799065, "RHODE ISLAND": 1003464,
    "DELAWARE": 666168, "SOUTH DAKOTA": 696004, "NORTH DAKOTA": 638800, "ALASKA": 550043,
    "DISTRICT OF COLUMBIA": 606900, "VERMONT": 562758, "WYOMING": 453588
}

# state populations (2020 census approximates) to weight migration numbers
STATE_POPULATIONS_2020S = {
    "CALIFORNIA": 39538223, "TEXAS": 29145505, "FLORIDA": 21538187, "NEW YORK": 20201249,
    "ILLINOIS": 12801989, "PENNSYLVANIA": 12801989, "OHIO": 11799448, "GEORGIA": 10711908,
    "MICHIGAN": 10077331, "NORTH CAROLINA": 10439388, "NEW JERSEY": 9288994, "VIRGINIA": 8631393,
    "WASHINGTON": 7705281, "ARIZONA": 7151502, "MASSACHUSETTS": 7029917, "TENNESSEE": 6910840,
    "INDIANA": 6785528, "MARYLAND": 6177224, "MISSOURI": 6154913, "WISCONSIN": 5893718,
    "COLORADO": 5773714, "MINNESOTA": 5706494, "SOUTH CAROLINA": 5118425, "ALABAMA": 5024279,
    "LOUISIANA": 4657757, "KENTUCKY": 4505836, "OREGON": 4237256, "OKLAHOMA": 3959353,
    "CONNECTICUT": 3605944, "UTAH": 3271616, "IOWA": 3190369, "NEVADA": 3104614,
    "ARKANSAS": 3011524, "MISSISSIPPI": 2961279, "KANSAS": 2937880, "NEW MEXICO": 2117522,
    "NEBRASKA": 1961504, "IDAHO": 1839106, "WEST VIRGINIA": 1793716, "HAWAII": 1455271,
    "NEW HAMPSHIRE": 1377529, "MAINE": 1362359, "MONTANA": 1084225, "RHODE ISLAND": 1097379,
    "DELAWARE": 989948, "SOUTH DAKOTA": 886667, "NORTH DAKOTA": 779094, "ALASKA": 733391,
    "DISTRICT OF COLUMBIA": 689545, "VERMONT": 643077, "WYOMING": 576851
}

ALL_STATE_POPULATIONS = {
    "1960s": STATE_POPULATIONS_1960S,
    "1990s": STATE_POPULATIONS_1990S,
    "2020s": STATE_POPULATIONS_2020S,
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
# placeholder data for 1960s - please update with historical trends
DESTINATION_MULTIPLIERS_1960S = {
    "CALIFORNIA": 1.6, "NEW YORK": 1.3, "ILLINOIS": 1.2, # historically strong magnets
    "FLORIDA": 1.2, "TEXAS": 1.1, "OHIO": 1.1,
    "MICHIGAN": 1.1, "NEW JERSEY": 1.0,
}

# placeholder data for 1990s - please update with historical trends
DESTINATION_MULTIPLIERS_1990S = {
    "FLORIDA": 1.4, "TEXAS": 1.3, "CALIFORNIA": 1.3, # sun belt rising
    "GEORGIA": 1.2, "NORTH CAROLINA": 1.2, "ARIZONA": 1.2,
    "WASHINGTON": 1.1, "COLORADO": 1.1, "NEVADA": 1.1,
}

DESTINATION_MULTIPLIERS_2020S = {
    "FLORIDA": 1.5, "TEXAS": 1.4, "CALIFORNIA": 1.3, "ARIZONA": 1.2,
    "NORTH CAROLINA": 1.2, "COLORADO": 1.2, "WASHINGTON": 1.1,
    "OREGON": 1.1, "NEVADA": 1.1, "TENNESSEE": 1.1
}

ALL_DESTINATION_MULTIPLIERS = {
    "1960s": DESTINATION_MULTIPLIERS_1960S,
    "1990s": DESTINATION_MULTIPLIERS_1990S,
    "2020s": DESTINATION_MULTIPLIERS_2020S,
}

def generate_migration_value(origin: str, destination: str, era: str) -> int:
    """generate a synthetic migration value based on various factors for a specific era."""
    if origin == destination:
        return 0
    
    current_state_populations = ALL_STATE_POPULATIONS[era]
    current_destination_multipliers = ALL_DESTINATION_MULTIPLIERS[era]

    # base value from population sizes
    origin_pop = current_state_populations[origin]
    dest_pop = current_state_populations[destination]
    
    # calculate base migration value
    base_value = int((origin_pop * dest_pop) ** 0.5 / 1000)
    
    # apply neighboring state multiplier
    if destination in NEIGHBORING_STATES[origin]:
        base_value *= random.uniform(1.5, 2.0)
    
    # apply destination state multiplier if applicable
    if destination in current_destination_multipliers:
        base_value *= current_destination_multipliers[destination]
    
    # add some randomness
    base_value *= random.uniform(0.8, 1.2)
    
    # ensure minimum value of 100
    return max(100, int(base_value))

def generate_migration_data(era: str) -> List[Dict]:
    """generate complete migration data for all state pairs for a specific era."""
    migrations = []
    # use the keys from the 2020s population data as the canonical list of states,
    # assuming all states exist in all eras for simplicity here.
    # if statehood changes significantly, this would need adjustment.
    states = list(STATE_POPULATIONS_2020S.keys())
    
    for origin in states:
        for destination in states:
            if origin != destination:  # exclude same-state migration
                # ensure both origin and destination exist in the era's population data
                if origin in ALL_STATE_POPULATIONS[era] and destination in ALL_STATE_POPULATIONS[era]:
                    value = generate_migration_value(origin, destination, era)
                    migrations.append({
                        "origin": origin,
                        "destination": destination,
                        "value": value
                    })
                # else:
                #     print(f"Warning: Skipping {origin} to {destination} for era {era} due to missing population data.")
    
    return migrations

def main():
    """generate and save migration data for multiple eras."""
    eras = ["1960s", "1990s", "2020s"]
    
    for era in eras:
        print(f"generating migration data for {era}...")
        migrations = generate_migration_data(era)
        
        # sort by value in descending order for easier inspection
        migrations.sort(key=lambda x: x["value"], reverse=True)
        
        data = {"migrations": migrations}
        
        output_filename = f"src/assets/migration_{era}.json"
        with open(output_filename, "w") as f:
            json.dump(data, f, indent=2)
        
        print(f"generated {len(migrations)} migration records for {era}")
        print(f"data saved to {output_filename}")
        print("-" * 30)

if __name__ == "__main__":
    main() 