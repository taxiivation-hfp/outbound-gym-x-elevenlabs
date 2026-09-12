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
  - winback       : contract has already expired, hasn't been back

These cohort labels are written to members.csv as ground truth for testing the
router/reasoning logic against — NOT as an input the model should see. Treat this
column as an answer key, not a feature.

## auto_renew, and why it drives the expiry dates

`auto_renew` is the product's core rule: an auto-renewing member is never called,
however absent they are, because the call reminds them to cancel. It is modelled
as a property of the contract term — `month-to-month` rolls over, `6-month` and
`12-month` do not:

    auto_renew == (contract_type == "month-to-month")

That mapping then decides what `expiry_date` means, which matters more than it
looks. For an auto-renewing contract the expiry date is the *next rollover*, so
it is always within ~30 days; for a fixed-term contract it is the date the
membership actually lapses. The consequence is deliberate: roughly a quarter of
the member base permanently looks "about to expire" to any date-triggered
dialer, and every one of them must be excluded. That exclusion is the product.

An expired contract is therefore always fixed-term — an auto-renewing membership
does not lapse, it keeps billing until someone cancels it (cancellation is a
different event and is not modelled here).

## Guaranteed sub-slices

The three call types (renewal / reengagement / winback) fire on dates relative
to expiry, so each needs a population that sits in the right window on the
dataset's reference date. Those slices are allocated explicitly below rather
than hoped for from random expiry draws. This is synthetic data built to
exercise every path in the router; it is not a claim about any real gym's
distribution. See LIMITATIONS in the README.
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
    "steady": 245,
    "new_joiner": 50,
    "sliding": 55,
    "sleeping_dog": 60,
    "winback": 90,
}
assert sum(COHORT_COUNTS.values()) == N_MEMBERS

CONTRACT_TYPES = ["month-to-month", "6-month", "12-month"]
# Weights for members NOT in a guaranteed fixed-term slice. Tuned so that
# month-to-month (= auto-renew) lands at roughly a quarter of the whole base
# once the forced-fixed-term slices are accounted for.
CONTRACT_TYPE_WEIGHTS = [0.44, 0.33, 0.23]
FIXED_TERM_TYPES = ["6-month", "12-month"]
FIXED_TERM_WEIGHTS = [0.6, 0.4]

# How long one contract term runs, in days — used to derive the contract's own
# start_date, which is not the same thing as the member's join_date once a
# member has renewed at least once.
TERM_DAYS = {"month-to-month": 30, "6-month": 180, "12-month": 365}

# --- Guaranteed sub-slices, so every call type has a population -------------
# Steady members whose fixed term lapses within a fortnight while they are
# still training — the renewal call's audience.
NEAR_EXPIRY_STEADY = 40
# Dormant members whose fixed term also lapses within a fortnight — the
# reengagement call's near-expiry variant (expiry_line changes, prompt doesn't).
NEAR_EXPIRY_SLEEPING = 25
# Days since expiry for the three winback windows: ~1 month, ~3 months,
# ~6 months. Winback members are assigned round-robin across them.
WINBACK_WINDOWS = [(20, 45), (75, 105), (165, 195)]

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


def draw_contract_type(force_fixed_term: bool = False) -> str:
    if force_fixed_term:
        return random.choices(FIXED_TERM_TYPES, FIXED_TERM_WEIGHTS)[0]
    return random.choices(CONTRACT_TYPES, CONTRACT_TYPE_WEIGHTS)[0]


def rollover_expiry() -> datetime:
    """Next billing rollover for an auto-renewing (month-to-month) contract."""
    return TODAY + timedelta(days=random.randint(1, 30))


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
#
# Each takes the member's index within its cohort so the guaranteed sub-slices
# above are deterministic rather than left to a random draw.
# ---------------------------------------------------------------------------

def make_steady(i: int):
    mid = new_member_id()
    tenure_days = random.randint(90, 540)
    join_date = TODAY - timedelta(days=tenure_days)
    near_expiry = i < NEAR_EXPIRY_STEADY
    if near_expiry:
        # Still training and the fixed term lapses within a fortnight: this is
        # the renewal call. Rate is floored at 1x/week so "visited in the last
        # 28 days" holds — the renewal trigger requires it.
        contract_type = draw_contract_type(force_fixed_term=True)
        rate = max(1.0, np.random.normal(loc=2.5, scale=0.8))
        expiry = TODAY + timedelta(days=random.randint(3, 14))
    else:
        contract_type = draw_contract_type()
        rate = draw_weekly_rate()
        expiry = (
            rollover_expiry()
            if contract_type == "month-to-month"
            else TODAY + timedelta(days=random.randint(31, 300))
        )
    near_gym = random.random() < 0.75  # steady members skew near the gym
    checkins = generate_checkins(mid, join_date, TODAY, rate)
    return mid, join_date, near_gym, contract_type, "active", expiry, checkins, rate


def make_new_joiner(i: int):
    mid = new_member_id()
    tenure_days = random.randint(1, 21)
    join_date = TODAY - timedelta(days=tenure_days)
    rate = draw_weekly_rate()
    near_gym = random.random() < 0.6
    contract_type = draw_contract_type()
    expiry = (
        rollover_expiry()
        if contract_type == "month-to-month"
        else TODAY + timedelta(days=random.randint(300, 365))
    )
    checkins = generate_checkins(mid, join_date, TODAY, rate)
    return mid, join_date, near_gym, contract_type, "active", expiry, checkins, rate


def make_sliding(i: int):
    mid = new_member_id()
    tenure_days = random.randint(120, 400)
    join_date = TODAY - timedelta(days=tenure_days)
    rate = max(1.5, np.random.normal(loc=3.0, scale=0.8))  # was a committed attender
    dropoff_date = TODAY - timedelta(days=random.randint(21, 35))  # dropped in last ~4-5 weeks
    dropoff_factor = random.uniform(0.15, 0.45)  # 55-85% reduction, not a hard stop
    near_gym = random.random() < 0.6
    contract_type = draw_contract_type()
    expiry = (
        rollover_expiry()
        if contract_type == "month-to-month"
        else TODAY + timedelta(days=random.randint(31, 300))
    )
    checkins = generate_checkins(mid, join_date, TODAY, rate, dropoff_date, dropoff_factor)
    return mid, join_date, near_gym, contract_type, "active", expiry, checkins, rate


def make_sleeping_dog(i: int):
    mid = new_member_id()
    tenure_days = random.randint(200, 600)
    join_date = TODAY - timedelta(days=tenure_days)
    rate = max(1.0, np.random.normal(loc=2.5, scale=0.7))  # was reasonably active once
    dropoff_date = TODAY - timedelta(days=random.randint(65, 150))  # fully dormant 65+ days
    dropoff_factor = 0.0  # hard stop — this is the defining trait
    near_gym = random.random() < 0.4
    near_expiry = i < NEAR_EXPIRY_SLEEPING
    if near_expiry:
        # Absent AND the fixed term lapses within a fortnight: same
        # reengagement prompt, different expiry_line.
        contract_type = draw_contract_type(force_fixed_term=True)
        expiry = TODAY + timedelta(days=random.randint(3, 14))
    else:
        contract_type = draw_contract_type()
        # KEY: contract stays ACTIVE and still billing despite zero attendance
        expiry = (
            rollover_expiry()
            if contract_type == "month-to-month"
            else TODAY + timedelta(days=random.randint(31, 300))
        )
    checkins = generate_checkins(mid, join_date, TODAY, rate, dropoff_date, dropoff_factor)
    return mid, join_date, near_gym, contract_type, "active", expiry, checkins, rate


def make_winback(i: int):
    mid = new_member_id()
    # Round-robin across the ~1-month / ~3-month / ~6-month windows so all
    # three winback call moments have an audience.
    low, high = WINBACK_WINDOWS[i % len(WINBACK_WINDOWS)]
    days_expired = random.randint(low, high)
    expiry = TODAY - timedelta(days=days_expired)
    # An expired contract is always fixed-term: auto-renewing memberships do
    # not lapse, they keep billing until cancelled.
    contract_type = draw_contract_type(force_fixed_term=True)
    tenure_days = days_expired + random.randint(120, 500)
    join_date = TODAY - timedelta(days=tenure_days)
    rate = max(0.5, np.random.normal(loc=1.8, scale=0.6))
    # They drifted off at or before the expiry rather than on the day of it.
    dropoff_date = expiry - timedelta(days=random.randint(0, 45))
    dropoff_factor = 0.0
    near_gym = random.random() < 0.5
    checkins = generate_checkins(mid, join_date, TODAY, rate, dropoff_date, dropoff_factor)
    return mid, join_date, near_gym, contract_type, "expired", expiry, checkins, rate


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
    for i in range(count):
        mid, join_date, near_gym, contract_type, status, expiry, checkins, rate = COHORT_FUNCS[cohort](i)

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

        # The contract's own term, which is not the member's whole history: a
        # member who has renewed twice has one contract row per term in a real
        # system, and only the current one is here.
        term_days = TERM_DAYS[contract_type]
        contract_start = max(join_date, expiry - timedelta(days=term_days))
        monthly_fee = random.choice([59, 69, 79, 89, 99])
        # What renewing actually costs this member today. ~25% of members are on
        # a legacy rate the gym has since raised, and Charlie quotes the new
        # number out loud when asked — the gym needs to know that.
        renewal_fee = monthly_fee + (10 if random.random() < 0.25 else 0)

        contracts_rows.append({
            "member_id": mid,
            "contract_type": contract_type,
            "auto_renew": contract_type == "month-to-month",
            "start_date": contract_start.date().isoformat(),
            "expiry_date": expiry.date().isoformat(),
            "monthly_fee": monthly_fee,
            "renewal_fee": renewal_fee,
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

auto_renew_count = int(contracts_df["auto_renew"].sum())
print(
    f"\nauto_renew: {auto_renew_count} of {len(contracts_df)} "
    f"({auto_renew_count / len(contracts_df):.0%}) — never called, by design"
)
print("\nContract type mix:")
print(contracts_df["contract_type"].value_counts())
