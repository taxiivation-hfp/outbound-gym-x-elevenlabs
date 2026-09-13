"""
Retention Router — feature engineering + rules-based cohort router

Reads the raw gym-platform tables (members.csv, contracts.csv, checkins.csv),
computes per-member derived features, classifies each member into one of five
cohorts using explainable rules (NOT a trained/statistical model), and writes
`members_scored.json` matching the dashboard's `Member` type (lib/types.ts).

The `_true_cohort` column in members.csv is an answer key from the synthetic
data generator — it is stripped before classification and never used as an
input signal to the router.

## What this file does NOT do

It emits raw per-member facts only: ISO dates, booleans, counts, rates. Every
plain-English string the voice agent hears (`time_left`, `context`,
`expiry_line`, `last_visit`, `tenure`) is compiled in `lib/compileVariables.ts`
at call time instead, and `call_type` is derived in `lib/callType.ts`. Two
reasons: this pipeline's clock is frozen (see TODAY below) while the app's is
not, and `context` has to fold in live call history from Supabase, which an
offline batch job cannot see.

## No accuracy number

An earlier version of this file reported ~90% "accuracy" against
`_true_cohort`. That number was withdrawn: the answer key is produced by the
same rules the router applies, so the comparison is circular and measures
nothing. What remains below is a data-sufficiency report — does the dataset
contain a population in every call window — plus the real evaluation, which
lives in `evals/` and scores agent behaviour on transcripts.
"""

import json
import os
from datetime import datetime

import pandas as pd

# Frozen reference date. The whole dataset — check-ins, expiries, tenures — is
# generated relative to this instant, so the app reads it back from
# `data/dataset_meta.json` (see lib/clock.ts) rather than using the wall clock,
# and a member who was twelve days from expiry stays twelve days from expiry.
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

# Answer key — dropped here so it cannot leak into a feature or a rule below.
# Nothing downstream reads it; the discipline is the point.
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
WINDOW_90D = pd.Timedelta(days=90)

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
visits_90d = {}
old_rate = {}

for member_id, group in checkins.groupby("member_id"):
    ts = group["timestamp"]
    visits_last_4wk[member_id] = int((ts >= TODAY - WINDOW_4WK).sum())
    visits_prior_4wk[member_id] = int(
        ((ts >= TODAY - WINDOW_8WK) & (ts < TODAY - WINDOW_4WK)).sum()
    )
    visits_90d[member_id] = int((ts >= TODAY - WINDOW_90D).sum())

    # old_rate: average weekly rate over history *prior to* the last 4 weeks —
    # mirrors the "trained Nx/week" framing already used in reasoningFallback.ts
    cutoff = TODAY - WINDOW_4WK
    tenure_start = df.loc[member_id, "join_date"]
    prior_weeks = max((cutoff - tenure_start).days / 7, 1)
    prior_visits = int((ts < cutoff).sum())
    old_rate[member_id] = round(prior_visits / prior_weeks, 2) if prior_weeks > 0 else 0.0

features["visits_last_4wk"] = pd.Series(visits_last_4wk).reindex(df.index).fillna(0).astype(int)
features["visits_prior_4wk"] = pd.Series(visits_prior_4wk).reindex(df.index).fillna(0).astype(int)
features["visit_count_90d"] = pd.Series(visits_90d).reindex(df.index).fillna(0).astype(int)
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


def generate_reason(
    name: str, cohort: str, tenure_days: int, old_rate_val: float, days_since: int, auto_renew: bool
) -> str:
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
        # Dormancy alone is not the reason to stay away — the contract type is.
        # A dormant auto-renewer is the one member a call can actively lose.
        if auto_renew:
            return (
                f"{name} hasn't visited in {since_str} but is still billing on an auto-renewing "
                "membership. A call reminds them to cancel — never contacted."
            )
        return (
            f"{name} hasn't visited in {since_str} and is on a fixed term that will simply lapse. "
            "Nothing is lost by calling and a lapse is lost either way."
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


# ---------------------------------------------------------------------------
# Assemble output rows
#
# Raw facts only. Anything the agent says out loud is compiled in
# lib/compileVariables.ts at call time — see the module docstring.
# ---------------------------------------------------------------------------

records = []
for member_id, row in df.iterrows():
    cohort = row["cohort"]
    action_meta = COHORT_ACTIONS[cohort]
    auto_renew = bool(row["auto_renew"])
    reason = generate_reason(
        row["name"],
        cohort,
        int(row["tenure_days"]),
        float(row["old_rate"]),
        int(row["days_since_last_visit"]),
        auto_renew,
    )

    records.append({
        "member_id": member_id,
        "name": row["name"],
        "phone": row["phone"],
        "cohort": cohort,
        "contact": action_meta["contact"],
        "channel": action_meta["channel"],
        "action": action_meta["action"],
        "reason": reason,
        # Contract facts. `auto_renew` is the hard exclusion the whole product
        # rests on; `expiry_date` is ISO for every member, not just the lapsed
        # ones, because all three call triggers are dated off it.
        "auto_renew": auto_renew,
        "contract_type": row["contract_type"],
        "contract_status": row["status"],
        "expiry_date": row["expiry_date"].date().isoformat(),
        "monthly_fee": int(row["monthly_fee"]),
        "renewal_fee": int(row["renewal_fee"]),
        # When the member asked to cancel (local time), or None. A raw fact
        # only: nothing routes on it yet, and an auto-renewing member who has
        # asked is still never called. See pipeline/generate_cancellations.py.
        "cancellation_requested": (
            None if pd.isna(row.get("cancellation_requested")) else str(row["cancellation_requested"])
        ),
        "signals": {
            "days_since_visit": int(row["days_since_last_visit"]),
            "old_rate": float(row["old_rate"]),
            "tenure_days": int(row["tenure_days"]),
            "visit_count_90d": int(row["visit_count_90d"]),
        },
    })

os.makedirs(OUTPUT_DIR, exist_ok=True)
output_path = os.path.join(OUTPUT_DIR, "members_scored.json")
with open(output_path, "w") as f:
    json.dump(records, f, indent=2)

meta_path = os.path.join(OUTPUT_DIR, "dataset_meta.json")
with open(meta_path, "w") as f:
    json.dump(
        {
            "as_of": TODAY.date().isoformat(),
            "generator_seed": 42,
            "members": len(records),
            # Read by /api/call, which refuses to dial a synthetic dataset
            # unless an override number is set. Faker's Australian numbers are
            # well-formed and belong to real strangers.
            "synthetic": True,
            "note": (
                "Synthetic dataset with a frozen reference date. The app reads `as_of` "
                "from here so relative phrases like 'twelve days' stay true as real time "
                "passes. Re-run the pipeline to move it."
            ),
        },
        f,
        indent=2,
    )

print(f"Wrote {len(records)} members to {output_path}")
print(f"Wrote dataset metadata to {meta_path}")

# ---------------------------------------------------------------------------
# Data-sufficiency report
#
# Not an accuracy metric — see the module docstring for why the old one was
# withdrawn. This answers a narrower, checkable question: does the dataset
# actually contain members sitting in each window a call type fires on? If any
# line here reads 0, that call type cannot be demonstrated.
# ---------------------------------------------------------------------------

live = df["status"] != "expired"
fixed_term = ~df["auto_renew"].astype(bool)
days_to_expiry = (df["expiry_date"] - TODAY).dt.days
days_since_expiry = -days_to_expiry
absent_4wk = df["days_since_last_visit"] >= 28
had_habit = df["old_rate"] >= 1.0

windows = {
    "renewal            (live, fixed term, <=14d to expiry, visited in last 28d)":
        live & fixed_term & (days_to_expiry >= 0) & (days_to_expiry <= 14) & ~absent_4wk,
    "reengagement-early (live, fixed term, absent 28d+, habit, >30d to expiry)":
        live & fixed_term & absent_4wk & had_habit & (days_to_expiry > 30),
    "reengagement-near  (live, fixed term, absent 28d+, <=14d to expiry)":
        live & fixed_term & absent_4wk & (days_to_expiry >= 0) & (days_to_expiry <= 14),
    "winback ~1 month   (expired 20-45d ago)":
        ~live & days_since_expiry.between(20, 45),
    "winback ~3 months  (expired 75-105d ago)":
        ~live & days_since_expiry.between(75, 105),
    "winback ~6 months  (expired 165-195d ago)":
        ~live & days_since_expiry.between(165, 195),
}

print("\nCallable population per window (the router's own triggers live in lib/callType.ts):")
for label, mask in windows.items():
    count = int(mask.sum())
    flag = "" if count else "   <-- EMPTY, this call type cannot be demoed"
    print(f"  {label:<74} {count:>4}{flag}")

excluded = int(df["auto_renew"].astype(bool).sum())
looks_due = int((df["auto_renew"].astype(bool) & days_to_expiry.between(0, 14)).sum())
print(
    f"\nExcluded by the auto-renew rule: {excluded} of {len(df)} "
    f"({excluded / len(df):.0%}); {looks_due} of them sit inside a 14-day expiry window "
    "and would be dialled by a date-triggered system."
)

print("\nCohort mix (router output, for reference):")
print(df["cohort"].value_counts().to_string())
