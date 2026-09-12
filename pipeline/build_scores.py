"""
Retention Router — feature engineering + rules-based cohort router

Reads the raw gym-platform tables (members.csv, contracts.csv, checkins.csv),
computes per-member derived features, classifies each member into one of five
cohorts using explainable rules (NOT a trained/statistical model), and writes
`members_scored.json` matching the dashboard's `Member` type (lib/types.ts).

The `_true_cohort` column in members.csv is an answer key from the synthetic
data generator — it is stripped before classification and used only for the
accuracy report at the end, never as an input signal to the router.
"""

import json
import os
from datetime import datetime

import numpy as np
import pandas as pd

TODAY = datetime(2026, 9, 12)  # matches generate_gym_data.py's fixed "today"

BASE_DIR = os.path.dirname(__file__)
DATA_DIR = os.path.join(BASE_DIR, "data")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

# ---------------------------------------------------------------------------
# Load
# ---------------------------------------------------------------------------

members = pd.read_csv(os.path.join(DATA_DIR, "members.csv"))
contracts = pd.read_csv(os.path.join(DATA_DIR, "contracts.csv"))
checkins = pd.read_csv(os.path.join(DATA_DIR, "checkins.csv"), parse_dates=["timestamp"])

# Answer key — pulled aside now, never fed into the router below.
true_cohort = members.set_index("member_id")["_true_cohort"]
members = members.drop(columns=["_true_cohort"])

members["join_date"] = pd.to_datetime(members["join_date"])
contracts["start_date"] = pd.to_datetime(contracts["start_date"])
contracts["expiry_date"] = pd.to_datetime(contracts["expiry_date"])

df = members.merge(contracts, on="member_id", how="left", suffixes=("", "_contract"))
df = df.set_index("member_id")

# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------

WINDOW_4WK = pd.Timedelta(days=28)
WINDOW_8WK = pd.Timedelta(days=56)

checkins_by_member = checkins.groupby("member_id")["timestamp"]
last_visit = checkins_by_member.max()
visit_counts = checkins.groupby("member_id").size()

features = pd.DataFrame(index=df.index)
features["tenure_days"] = (TODAY - df["join_date"]).dt.days
features["last_visit_ts"] = last_visit.reindex(df.index)
features["days_since_last_visit"] = (
    (TODAY - features["last_visit_ts"]).dt.days
)
# members with zero check-ins ever: treat as "dormant since joining"
features["days_since_last_visit"] = features["days_since_last_visit"].fillna(
    features["tenure_days"]
)

visits_last_4wk = {}
visits_prior_4wk = {}
old_rate = {}

for member_id, group in checkins.groupby("member_id"):
    ts = group["timestamp"]
    visits_last_4wk[member_id] = int((ts >= TODAY - WINDOW_4WK).sum())
    visits_prior_4wk[member_id] = int(
        ((ts >= TODAY - WINDOW_8WK) & (ts < TODAY - WINDOW_4WK)).sum()
    )

    # old_rate: average weekly rate over history *prior to* the last 4 weeks —
    # mirrors the "trained Nx/week" framing already used in reasoningFallback.ts
    cutoff = TODAY - WINDOW_4WK
    tenure_start = df.loc[member_id, "join_date"]
    prior_weeks = max((cutoff - tenure_start).days / 7, 1)
    prior_visits = int((ts < cutoff).sum())
    old_rate[member_id] = round(prior_visits / prior_weeks, 2) if prior_weeks > 0 else 0.0

features["visits_last_4wk"] = pd.Series(visits_last_4wk).reindex(df.index).fillna(0).astype(int)
features["visits_prior_4wk"] = pd.Series(visits_prior_4wk).reindex(df.index).fillna(0).astype(int)
features["old_rate"] = pd.Series(old_rate).reindex(df.index).fillna(0.0)

df = df.join(features)

# ---------------------------------------------------------------------------
# Cohort router — explainable rules, first match wins
# ---------------------------------------------------------------------------

def classify(row) -> str:
    if row["tenure_days"] <= 21:
        return "new_joiner"
    if row["status"] in ("expired", "expiring"):
        return "winback"
    if row["status"] == "active" and row["days_since_last_visit"] >= 60:
        return "sleeping_dog"
    if (
        row["status"] == "active"
        # a meaningful established habit (>=1.5x/week historically), not noise
        # from a low, sporadic attender whose count can swing to zero by chance
        and row["old_rate"] >= 1.5
        and row["visits_prior_4wk"] >= 2
        and row["visits_last_4wk"] <= row["visits_prior_4wk"] * 0.5
        and row["days_since_last_visit"] < 55
    ):
        return "sliding"
    return "steady"


df["cohort"] = df.apply(classify, axis=1)

# ---------------------------------------------------------------------------
# Cohort -> contact / channel / action
# ---------------------------------------------------------------------------

COHORT_ACTIONS = {
    "steady": {"contact": False, "channel": None, "action": "no action"},
    "new_joiner": {"contact": True, "channel": "staff", "action": "in-person welcome conversation"},
    "sliding": {"contact": True, "channel": "staff", "action": "floor conversation on next visit"},
    "sleeping_dog": {"contact": False, "channel": None, "action": "do not contact"},
    "winback": {"contact": True, "channel": "ai_call", "action": "outbound reactivation call"},
}

# ---------------------------------------------------------------------------
# Reason templates — ported from lib/reasoningFallback.ts so tone/format match
# the dashboard's own TS fallback. Rules-based only; no LLM call here.
# ---------------------------------------------------------------------------

def format_rate(rate_per_week: float) -> str:
    if rate_per_week <= 0:
        return "rarely"
    rounded = round(rate_per_week * 10) / 10
    return f"{rounded}x/week"


def plural(n: int) -> str:
    return "" if n == 1 else "s"


def format_days_since(days: int) -> str:
    if days < 7:
        return f"{days} day{plural(days)}"
    if days < 60:
        weeks = round(days / 7)
        return f"{weeks} week{plural(weeks)}"
    months = round(days / 30)
    return f"{months} month{plural(months)}"


def generate_reason(name: str, cohort: str, tenure_days: int, old_rate_val: float, days_since: int) -> str:
    tenure_months = max(1, round(tenure_days / 30))
    rate_str = format_rate(old_rate_val)
    since_str = format_days_since(days_since)

    if cohort == "winback":
        return (
            f"{name} trained {rate_str} for about {tenure_months} month{plural(tenure_months)} "
            f"and hasn't visited in {since_str}. Membership has lapsed — an outbound call has "
            "nothing left to cancel."
        )
    if cohort == "sleeping_dog":
        return (
            f"{name} hasn't visited in {since_str} but is still an active, paying member. "
            "Contacting them risks reminding them to cancel — do not contact."
        )
    if cohort == "sliding":
        return (
            f"{name}'s visits have dropped off recently after training {rate_str}. Still "
            "attending occasionally — a floor conversation next visit can catch this before it "
            "becomes a lapse."
        )
    if cohort == "new_joiner":
        when = "recently" if tenure_months <= 1 else f"{tenure_months} months ago"
        return (
            f"{name} joined {when} and has visited fewer than twice so far. An in-person "
            "welcome conversation now sets the habit early."
        )
    if cohort == "steady":
        return f"{name} is training consistently at {rate_str} with no signs of drop-off. No action needed right now."
    return f"{name}: no action."


def format_last_visit(days: int) -> str:
    if days < 7:
        return f"{days} day{plural(days)} ago"
    if days < 60:
        weeks = round(days / 7)
        return f"{weeks} week{plural(weeks)} ago"
    months = round(days / 30)
    return f"{months} month{plural(months)} ago"


def format_expiry(expiry_date) -> str:
    return expiry_date.strftime("%-d %B") if os.name != "nt" else expiry_date.strftime("%#d %B")


OFFERS = [
    "a free PT session and a two-week trial",
    "a two-week trial and a class pass",
    "a free recovery-focused PT session",
]


def pick_offer(member_id: str) -> str:
    # deterministic pseudo-rotation so re-runs are stable
    idx = int(member_id[1:]) % len(OFFERS)
    return OFFERS[idx]


# ---------------------------------------------------------------------------
# Assemble output rows
# ---------------------------------------------------------------------------

records = []
for member_id, row in df.iterrows():
    cohort = row["cohort"]
    action_meta = COHORT_ACTIONS[cohort]
    reason = generate_reason(
        row["name"], cohort, int(row["tenure_days"]), float(row["old_rate"]), int(row["days_since_last_visit"])
    )

    record = {
        "member_id": member_id,
        "name": row["name"],
        "phone": row["phone"],
        "cohort": cohort,
        "contact": action_meta["contact"],
        "channel": action_meta["channel"],
        "action": action_meta["action"],
        "reason": reason,
        "signals": {
            "days_since_visit": int(row["days_since_last_visit"]),
            "old_rate": float(row["old_rate"]),
            "tenure_days": int(row["tenure_days"]),
        },
    }

    if cohort == "winback":
        record["last_visit"] = format_last_visit(int(row["days_since_last_visit"]))
        record["expiry"] = format_expiry(row["expiry_date"])
        record["offer"] = pick_offer(member_id)

    records.append(record)

os.makedirs(OUTPUT_DIR, exist_ok=True)
output_path = os.path.join(OUTPUT_DIR, "members_scored.json")
with open(output_path, "w") as f:
    json.dump(records, f, indent=2)

print(f"Wrote {len(records)} members to {output_path}")

# ---------------------------------------------------------------------------
# Accuracy report vs. the answer key (never used as a router input above)
# ---------------------------------------------------------------------------

predicted = df["cohort"]
comparison = pd.DataFrame({"true": true_cohort.reindex(df.index), "predicted": predicted})
accuracy = (comparison["true"] == comparison["predicted"]).mean()

print(f"\nAccuracy vs. _true_cohort answer key: {accuracy:.1%}")
print("\nConfusion matrix (rows = true cohort, cols = predicted):")
print(pd.crosstab(comparison["true"], comparison["predicted"]))

mismatches = comparison[comparison["true"] != comparison["predicted"]]
if len(mismatches):
    print(f"\n{len(mismatches)} mismatches:")
    print(mismatches)
