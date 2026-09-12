"""
ElevenLabs outbound agent call. Puts the actual retention agent on the phone.

RUN:
  pip install requests python-dotenv
  python elevenlabs_call.py
"""

import json
import os
import sys
from pathlib import Path
 
import requests
from dotenv import load_dotenv
 
# Look for .env.local here, then one and two levels up.
for folder in [Path.cwd(), *list(Path.cwd().parents)[:2]]:
    env = folder / ".env.local"
    if env.exists():
        load_dotenv(env)
        print(f"Loaded {env}")
        break
else:
    sys.exit("No .env.local found. Run this from your project folder.")
 
API_KEY         = os.getenv("ELEVENLABS_API_KEY")
AGENT_ID        = os.getenv("ELEVENLABS_AGENT_ID")
PHONE_NUMBER_ID = os.getenv("ELEVENLABS_PHONE_NUMBER_ID")
TO_NUMBER       = os.getenv("TEST_TO_NUMBER", "+61491749433")  # lando's number rn.
 
missing = [n for n, v in [
    ("ELEVENLABS_API_KEY", API_KEY),
    ("ELEVENLABS_AGENT_ID", AGENT_ID),
    ("ELEVENLABS_PHONE_NUMBER_ID", PHONE_NUMBER_ID),
] if not v]
if missing:
    sys.exit("Missing from .env.local: " + ", ".join(missing))
 
# Must match the {{placeholders}} in your agent prompt EXACTLY -- same names,
# same count. A missing one is what makes the first message go silent.
MEMBER = {
    "gym_name":    "Southbank Strength",
    "member_name": "Sarah",
    "expiry_date": "14 February",
    "last_visit":  "six weeks ago",
    "old_rate":    "three",
    "tenure":      "eight months",
    "offer":       "a free PT session",
}
 
print(f"Calling {TO_NUMBER} as {MEMBER['member_name']}...")
 
r = requests.post(
    "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
    headers={"xi-api-key": API_KEY, "Content-Type": "application/json"},
    json={
        "agent_id": AGENT_ID,
        "agent_phone_number_id": PHONE_NUMBER_ID,
        "to_number": TO_NUMBER,
        "conversation_initiation_client_data": {"dynamic_variables": MEMBER},
    },
)
 
print(f"HTTP {r.status_code}")
try:
    body = r.json()
    print(json.dumps(body, indent=2))
except ValueError:
    print(r.text)
    raise SystemExit
 
if r.ok:
    print("\nAccepted. Watch your phone.")
    print("Conversation:", body.get("conversation_id"))
    print("Rings but silent? A dynamic variable did not resolve --")
    print("check Agents -> Conversations for the exact reason.")
else:
    msg = str(body).lower()
    if "dynamic" in msg or "variable" in msg:
        print("\n-> A {{variable}} in your prompt has no value in MEMBER above.")
    elif "phone" in msg:
        print("\n-> PHONE_NUMBER_ID wrong. Use the ID, not the number.")
    elif r.status_code == 401:
        print("\n-> Bad API key.")
    elif r.status_code == 404:
        print("\n-> AGENT_ID or PHONE_NUMBER_ID does not exist.")
 