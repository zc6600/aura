"""
Stanford Smallville 25-Agent Full Town Simulation Driver
"""
import os
import json
import time

def load_all_personas():
    personas_dir = os.path.join(os.getcwd(), "state", "personas")
    residents = []
    if os.path.exists(personas_dir):
        for f in os.listdir(personas_dir):
            if f.endswith(".json"):
                with open(os.path.join(personas_dir, f), "r", encoding="utf-8") as file:
                    data = json.load(file)
                    residents.append(data)
    return residents

def main():
    residents = load_all_personas()
    print("=" * 60)
    print(f"🏘️  Stanford Smallville Simulation (Full 25-Agent Scale)")
    print(f"📋 Loaded {len(residents)} resident personas from state/personas/")
    print("=" * 60)
    
    for idx, r in enumerate(residents, 1):
        name = r.get("name", r.get("id"))
        role = r.get("role", "Resident")
        print(f"  [{idx:02d}] {name:<25} ({role})")
    
    print("\n🚀 Simulation ready to execute day-by-day or multi-agent parallel steps.")
    print("Run via Aura CLI:\n  aura agent \"run 25-agent smallville simulation for Day 1\"")

if __name__ == "__main__":
    main()
