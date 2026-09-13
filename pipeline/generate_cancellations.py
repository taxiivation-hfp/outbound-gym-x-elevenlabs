"""
Retention Router — cancellation requests for the synthetic gym

Adds a `cancellation_requested` column to pipeline/data/members.csv: the local
time a member asked to cancel, or blank for no request. Runs after
generate_gym_data.py and before build_scores.py (see `npm run data:build`).

It reads the generated tables rather than being part of the generator so that
adding it changed nothing else: every existing column, row and check-in is
byte-for-byte what it was, and the random draws that produced them are not
disturbed. It has its own seeded RNG.

## Who asks to cancel

About 5% of 500 members — 25 — distributed the way cancellations actually
happen: someone stops going, then something unrelated (a bank statement, a
partner asking about the direct debit) makes them notice they're paying.

| Shape                                             | Count |
|---------------------------------------------------|-------|
| Auto-renewing, absent 8+ weeks                    | 12    |
| Fixed-term, term ends within 14 days, says so     | 5     |
| Recent joiner (2 weeks to 3 months) churning early| 5     |
| Long-tenured (a year+) and still active           | 3     |

Two rules across all of them: **nobody who checked in within the last week, and
nobody currently visiting more than twice a week** (more than 8 visits in the
last 28 days). Those people don't cancel, and a flag on a four-times-a-week
member makes the whole dataset look fabricated.

This is data and visibility only. Nothing routes on it yet: an auto-renewing
member who has asked to cancel is still never called (lib/callType.ts), and a
guard pins that until the pass that builds the path for them.
"""

import os
import random
from datetime import datetime, timedelta

import pandas as pd

SEED = 42 + 505  # its own stream; the generator's draws are untouched
TODAY = datetime(2026, 9, 12)  # matches generate_gym_data.py and build_scores.py

SHAPES = [
    ("auto_renew_absent_8_weeks", 12),
    ("fixed_term_near_expiry", 5),
    ("recent_joiner", 5),
    ("long_tenured_active", 3),
]

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
MEMBERS = os.path.join(DATA_DIR, "members.csv")

rng = random.Random(SEED)

members = pd.read_csv(MEMBERS, dtype=str, keep_default_na=False)
contracts = pd.read_csv(os.path.join(DATA_DIR, "contracts.csv"), dtype=str, keep_default_na=False)
checkins = pd.read_csv(os.path.join(DATA_DIR, "checkins.csv"), parse_dates=["timestamp"])

if "cancellation_requested" in members.columns:
    members = members.drop(columns=["cancellation_requested"])

contract_by_member = contracts.set_index("member_id")
visits = checkins.groupby("member_id")["timestamp"]
last_visit = visits.max()
recent_visits = checkins[checkins["timestamp"] >= TODAY - timedelta(days=28)].groupby("member_id").size()


def facts(member_id, join_date):
    c = contract_by_member.loc[member_id]
    last = last_visit.get(member_id)
    last = None if last is None or pd.isna(last) else last.to_pydatetime()
    joined = datetime.fromisoformat(join_date)
    expiry = datetime.fromisoformat(c["expiry_date"])
    return {
        "member_id": member_id,
        "joined": joined,
        "tenure_days": (TODAY - joined).days,
        "auto_renew": c["auto_renew"] == "True",
        "active": c["status"] == "active",
        "days_to_expiry": (expiry - TODAY).days,
        "last_visit": last,
        "days_since_visit": (TODAY - last).days if last else (TODAY - joined).days,
        "visits_last_28": int(recent_visits.get(member_id, 0)),
    }


everyone = [facts(m, j) for m, j in zip(members["member_id"], members["join_date"])]


def may_request(f):
    """The two rules that hold for every shape."""
    visited_this_week = f["last_visit"] is not None and f["last_visit"] >= TODAY - timedelta(days=7)
    more_than_twice_a_week = f["visits_last_28"] > 8
    return not visited_this_week and not more_than_twice_a_week


def shape_of(f, shape):
    if not f["active"]:
        return False
    if shape == "auto_renew_absent_8_weeks":
        return f["auto_renew"] and f["days_since_visit"] >= 56
    if shape == "fixed_term_near_expiry":
        return not f["auto_renew"] and 0 <= f["days_to_expiry"] <= 14
    if shape == "recent_joiner":
        return 14 <= f["tenure_days"] <= 90
    if shape == "long_tenured_active":
        return f["tenure_days"] >= 365 and f["days_since_visit"] < 56
    raise ValueError(shape)


def request_time(f):
    """After they stopped coming (and after they joined), before today."""
    after = max(
        f["joined"] + timedelta(days=1),
        (f["last_visit"] + timedelta(days=1)) if f["last_visit"] else f["joined"] + timedelta(days=1),
        TODAY - timedelta(days=21),
    )
    after = after.replace(hour=0, minute=0, second=0, microsecond=0)
    span = max((TODAY - after).days, 1)
    day = after + timedelta(days=rng.randrange(span))
    stamp = day.replace(hour=rng.randint(8, 20), minute=rng.randint(0, 59))
    return stamp if stamp < TODAY else TODAY - timedelta(hours=3)


chosen = {}
counts = {}
for shape, count in SHAPES:
    candidates = [f for f in everyone if f["member_id"] not in chosen and may_request(f) and shape_of(f, shape)]
    # Near expiry: prefer members still coming in (the renewal queue), who would
    # otherwise be rung about a renewal they have already decided against.
    if shape == "fixed_term_near_expiry":
        attending = [f for f in candidates if f["days_since_visit"] <= 28]
        candidates = attending if len(attending) >= count else candidates
    candidates.sort(key=lambda f: f["member_id"])
    picked = rng.sample(candidates, min(count, len(candidates)))
    for f in picked:
        chosen[f["member_id"]] = request_time(f).strftime("%Y-%m-%dT%H:%M:%S")
    counts[shape] = (len(picked), len(candidates))

members["cancellation_requested"] = members["member_id"].map(lambda m: chosen.get(m, ""))
members.to_csv(MEMBERS, index=False)

print(f"cancellation requests: {len(chosen)} of {len(members)}")
for shape, count in SHAPES:
    got, pool = counts[shape]
    flag = "" if got == count else f"   <-- wanted {count}"
    print(f"  {shape:<28} {got:>3} (from {pool} eligible){flag}")
