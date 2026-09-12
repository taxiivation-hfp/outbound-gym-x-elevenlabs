"""
Retention Router — synthetic gym data generator

Generates three tables mirroring real gym-platform schemas (Mindbody/Glofox-style):
  members.csv, contracts.csv, checkins.csv

Cohort membership is GUARANTEED (not left to emerge from random distributions),
so the demo always has a known number of members in every category:
  - steady        : normal ongoing member, no red flags
  - new_joiner    : joined <=21 days ago, too early to read a trend
  - sliding       : was attending consistently, meaningfully dropped in last 4 weeks
  - sleeping_dog  : long-dormant (60+ days no visit) but still on an ACTIVE paying contract
  - winback       : contract has expired/is expiring, hasn't been back

These cohort labels are written to members.csv as ground truth for testing the
router/reasoning logic against — NOT as an input the model should see. Treat this
column as an answer key, not a feature.
"""

import numpy as np
import pandas as pd
from faker import Faker
from datetime import datetime, timedelta
import random
import os

SEED = 42
random.seed(SEED)
np.random.seed(SEED)
fake = Faker("en_AU")
Faker.seed(SEED)

TODAY = datetime(2026, 9, 12)  # "today" for the simulated gym
GYM_POSTCODE = 3006  # Southbank, Melbourne — used to simulate proximity effect

N_MEMBERS = 500

# Guaranteed cohort proportions (sum to N_MEMBERS)
COHORT_COUNTS = {
    "steady": 300,
    "new_joiner": 80,
    "sliding": 60,
    "sleeping_dog": 40,
    "winback": 20,
}
assert sum(COHORT_COUNTS.values()) == N_MEMBERS

CONTRACT_TYPES = ["month-to-month", "6-month", "12-month"]
CONTRACT_TYPE_WEIGHTS = [0.55, 0.30, 0.15]  # most gyms skew month-to-month

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "data")

members_rows = []
contracts_rows = []
checkins_rows = []

member_counter = 1


def new_member_id():
    global member_counter
    mid = f"M{member_counter:04d}"
    member_counter += 1
    return mid


def random_postcode(near_gym: bool) -> int:
    """Simulate the 'lives/works nearby' retention signal."""
    if near_gym:
        return GYM_POSTCODE + random.choice([-2, -1, 0, 0, 1, 2])
    return random.choice([3121, 3141, 3182, 3220, 3350, 3556])


def draw_weekly_rate() -> float:
    """Heavy-tailed weekly visit rate: most members low, a committed core high."""
    # Mixture: 70% low-attenders, 30% committed core
    if random.random() < 0.7:
        return max(0.1, np.random.exponential(scale=0.8))
    return max(0.5, np.random.normal(loc=3.0, scale=1.0))


def generate_checkins(member_id, start_date, end_date, weekly_rate, dropoff_date=None, dropoff_factor=0.0):
    """
    Generate check-in timestamps between start_date and end_date at ~weekly_rate/week.
    If dropoff_date is set, visit rate multiplies by dropoff_factor after that date
    (used for 'sliding' members — a real drop, not a hard stop).
    """
    rows = []
    current = start_date
    while current < end_date:
        rate = weekly_rate
        if dropoff_date and current >= dropoff_date:
            rate = weekly_rate * dropoff_factor
        # expected visits this week ~ Poisson(rate)
        n_visits_this_week = np.random.poisson(max(rate, 0.01))
        for _ in range(n_visits_this_week):
            day_offset = random.randint(0, 6)
            ts = current + timedelta(days=day_offset, hours=random.randint(6, 20), minutes=random.randint(0, 59))
            if ts < end_date:
                rows.append((member_id, ts))
        current += timedelta(days=7)
    return rows


# ---------------------------------------------------------------------------
# Cohort generators
# ---------------------------------------------------------------------------

def make_steady():
    mid = new_member_id()
    tenure_days = random.randint(90, 540)
    join_date = TODAY - timedelta(days=tenure_days)
    rate = draw_weekly_rate()
    near_gym = random.random() < 0.75  # steady members skew near the gym
    contract_type = random.choices(CONTRACT_TYPES, CONTRACT_TYPE_WEIGHTS)[0]
    expiry = TODAY + timedelta(days=random.randint(31, 300))
    checkins = generate_checkins(mid, join_date, TODAY, rate)
    return mid, join_date, near_gym, contract_type, "active", expiry, checkins, rate


def make_new_joiner():
    mid = new_member_id()
    tenure_days = random.randint(1, 21)
    join_date = TODAY - timedelta(days=tenure_days)
    rate = draw_weekly_rate()
    near_gym = random.random() < 0.6
    contract_type = random.choices(CONTRACT_TYPES, CONTRACT_TYPE_WEIGHTS)[0]
    expiry = TODAY + timedelta(days=random.randint(300, 365))
    checkins = generate_checkins(mid, join_date, TODAY, rate)
    return mid, join_date, near_gym, contract_type, "active", expiry, checkins, rate


def make_sliding():
    mid = new_member_id()
    tenure_days = random.randint(120, 400)
    join_date = TODAY - timedelta(days=tenure_days)
    rate = max(1.5, np.random.normal(loc=3.0, scale=0.8))  # was a committed attender
    dropoff_date = TODAY - timedelta(days=random.randint(21, 35))  # dropped in last ~4-5 weeks
    dropoff_factor = random.uniform(0.15, 0.45)  # 55-85% reduction, not a hard stop
    near_gym = random.random() < 0.6
    contract_type = random.choices(CONTRACT_TYPES, CONTRACT_TYPE_WEIGHTS)[0]
    expiry = TODAY + timedelta(days=random.randint(31, 300))
    checkins = generate_checkins(mid, join_date, TODAY, rate, dropoff_date, dropoff_factor)
    return mid, join_date, near_gym, contract_type, "active", expiry, checkins, rate


def make_sleeping_dog():
    mid = new_member_id()
    tenure_days = random.randint(200, 600)
    join_date = TODAY - timedelta(days=tenure_days)
    rate = max(1.0, np.random.normal(loc=2.5, scale=0.7))  # was reasonably active once
    dropoff_date = TODAY - timedelta(days=random.randint(65, 150))  # fully dormant 65+ days
    dropoff_factor = 0.0  # hard stop — this is the defining trait
    near_gym = random.random() < 0.4
    contract_type = random.choices(CONTRACT_TYPES, CONTRACT_TYPE_WEIGHTS)[0]
    # KEY: contract stays ACTIVE and still billing despite zero attendance
    expiry = TODAY + timedelta(days=random.randint(31, 300))
    checkins = generate_checkins(mid, join_date, TODAY, rate, dropoff_date, dropoff_factor)
    return mid, join_date, near_gym, contract_type, "active", expiry, checkins, rate


def make_winback():
    mid = new_member_id()
    tenure_days = random.randint(90, 500)
    join_date = TODAY - timedelta(days=tenure_days)
    rate = max(0.5, np.random.normal(loc=1.8, scale=0.6))
    dropoff_date = TODAY - timedelta(days=random.randint(45, 120))
    dropoff_factor = 0.0
    near_gym = random.random() < 0.5
    contract_type = random.choices(CONTRACT_TYPES, CONTRACT_TYPE_WEIGHTS)[0]
    # KEY: contract has already expired or expires very soon — nothing left to lose by calling
    expiry_offset = random.randint(-60, 5)  # negative = already expired
    expiry = TODAY + timedelta(days=expiry_offset)
    status = "expired" if expiry_offset < 0 else "expiring"
    checkins = generate_checkins(mid, join_date, TODAY, rate, dropoff_date, dropoff_factor)
    return mid, join_date, near_gym, contract_type, status, expiry, checkins, rate


COHORT_FUNCS = {
    "steady": make_steady,
    "new_joiner": make_new_joiner,
    "sliding": make_sliding,
    "sleeping_dog": make_sleeping_dog,
    "winback": make_winback,
}

# ---------------------------------------------------------------------------
# Generate
# ---------------------------------------------------------------------------

for cohort, count in COHORT_COUNTS.items():
    for _ in range(count):
        mid, join_date, near_gym, contract_type, status, expiry, checkins, rate = COHORT_FUNCS[cohort]()

        age = int(np.clip(np.random.normal(30, 8), 18, 65))
        gender = random.choice(["male", "female", "prefer_not_to_say"])
        postcode = random_postcode(near_gym)
        referred = random.random() < 0.22  # ~22% joined via referral (protective signal)

        members_rows.append({
            "member_id": mid,
            "name": fake.name(),
            "join_date": join_date.date().isoformat(),
            "age": age,
            "gender": gender,
            "postcode": postcode,
            "phone": fake.phone_number(),
            "referred_by_member": random.random() < 0.15,  # simple boolean, not a full graph
            "_true_cohort": cohort,  # ANSWER KEY — strip before feeding to the router blind
        })

        contracts_rows.append({
            "member_id": mid,
            "contract_type": contract_type,
            "start_date": join_date.date().isoformat(),
            "expiry_date": expiry.date().isoformat(),
            "monthly_fee": random.choice([59, 69, 79, 89, 99]),
            "status": status,
        })

        for cid, ts in checkins:
            checkins_rows.append({"member_id": cid, "timestamp": ts.isoformat()})

members_df = pd.DataFrame(members_rows)
contracts_df = pd.DataFrame(contracts_rows)
checkins_df = pd.DataFrame(checkins_rows).sort_values(["member_id", "timestamp"])

# Shuffle member order so cohorts aren't grouped in the file (avoids an obvious tell)
members_df = members_df.sample(frac=1, random_state=SEED).reset_index(drop=True)

os.makedirs(OUTPUT_DIR, exist_ok=True)
members_df.to_csv(os.path.join(OUTPUT_DIR, "members.csv"), index=False)
contracts_df.to_csv(os.path.join(OUTPUT_DIR, "contracts.csv"), index=False)
checkins_df.to_csv(os.path.join(OUTPUT_DIR, "checkins.csv"), index=False)

print(f"members: {len(members_df)} rows")
print(f"contracts: {len(contracts_df)} rows")
print(f"checkins: {len(checkins_df)} rows")
print("\nCohort breakdown (answer key, for testing only):")
print(members_df["_true_cohort"].value_counts())
