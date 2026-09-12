"""
Twilio test call; US Twilio ringing an Australian mobile.

RUN:
  pip install requests
  python test_call.py
"""

import requests

SID   = "ACcd469ea9fd1836bfb22d6ab11677ef17"  
TOKEN = "29ee0d11cef2ac94434feafecee6247e"                
FROM  = "+14128662936"                        # the US number we bought
TO    = "+61491749433"                        # lando's number rn.
# 

SAY = "If you can hear this, the hard part is done. Orlando Tan works at KebabX Clayton."

r = requests.post(
    f"https://api.twilio.com/2010-04-01/Accounts/{SID}/Calls.json",
    auth=(SID, TOKEN),
    data={
        "To": TO,
        "From": FROM,
        "Twiml": f"<Response><Say>{SAY}</Say></Response>",
    },
)

if r.ok:
    print("Request accepted. Watch your phone.")
    print("Call SID:", r.json().get("sid"))
else:
    err = r.json()
    code = err.get("code")
    print(f"FAILED ({r.status_code}) code {code}: {err.get('message')}")
    hints = {
        21215: "Australia not enabled. Voice -> Settings -> Geographic Permissions.",
        21210: "The From number isn't yours. Check you copied the Twilio number.",
        21211: "The To number is malformed. Needs +61 and no leading zero.",
        21219: "Trial account: verify your mobile under Verified Caller IDs.",
        21216: "Missing customer profile in TrustHub.",
        20003: "Bad SID or auth token.",
    }
    if code in hints:
        print("->", hints[code])