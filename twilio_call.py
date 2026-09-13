"""
Twilio test call: a US Twilio number ringing an Australian mobile.

This was the first thing that proved the telephony leg worked, and it is kept
because it is still the shortest way to check whether Twilio itself is healthy
without going through ElevenLabs or the app.

SECURITY NOTE — read this before using it.

An earlier version of this file had the Account SID and auth token hardcoded in
plaintext and was committed, so they are still in this repository's git history.
The auth token has since been rotated in the Twilio console, so the one in
history no longer works. Rewriting history to remove it is still outstanding.
Credentials now come only from the environment. See REVIEW_NOTES.md.

RUN:
  pip install requests python-dotenv
  python twilio_call.py +61400000000
"""

import os
import sys
from pathlib import Path

import requests

try:
    from dotenv import load_dotenv
except ImportError:  # dotenv is optional; env vars work on their own
    load_dotenv = None

if load_dotenv:
    for folder in [Path.cwd(), *list(Path.cwd().parents)[:2]]:
        env = folder / ".env.local"
        if env.exists():
            load_dotenv(env)
            break

SID = os.environ.get("TWILIO_ACCOUNT_SID")
TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")
FROM = os.environ.get("TWILIO_SMS_FROM")
TO = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("CALL_OVERRIDE_NUMBER")

SAY = "If you can hear this, the telephony leg is working."

if not (SID and TOKEN and FROM):
    sys.exit(
        "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_SMS_FROM in .env.local first."
    )
if not TO:
    sys.exit("Pass a number to call, or set CALL_OVERRIDE_NUMBER in .env.local.")

r = requests.post(
    f"https://api.twilio.com/2010-04-01/Accounts/{SID}/Calls.json",
    auth=(SID, TOKEN),
    data={
        "To": TO,
        "From": FROM,
        "Twiml": f"<Response><Say>{SAY}</Say></Response>",
    },
    timeout=30,
)

if r.ok:
    print("Request accepted. Watch the phone.")
    print("Call SID:", r.json().get("sid"))
else:
    err = r.json()
    code = err.get("code")
    print(f"FAILED ({r.status_code}) code {code}: {err.get('message')}")
    hints = {
        21215: "Australia not enabled. Voice -> Settings -> Geographic Permissions.",
        21210: "The From number isn't yours. Check you copied the Twilio number.",
        21211: "The To number is malformed. Needs +61 and no leading zero.",
        21219: "Trial account: verify the mobile under Verified Caller IDs.",
        21216: "Missing customer profile in TrustHub.",
        20003: "Bad SID or auth token.",
    }
    if code in hints:
        print("->", hints[code])
