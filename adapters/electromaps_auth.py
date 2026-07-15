#!/usr/bin/env python3
"""
Bootstraps an electromaps Cognito refresh token for a Google-only account.

See adapters/electromaps.md's "Google-only accounts (no password path)"
section for background: no self-service password path exists for a
Google-linked electromaps account, and the OAuth redirect lands on an
Android-only custom URL scheme a browser can't follow. This script
automates everything except the Google login itself: PKCE generation,
launching a real browser window, capturing the authorization code from the
network response, and exchanging it for tokens.

Requires: pip install playwright && playwright install webkit

Usage:
    python3 adapters/electromaps_auth.py

A headed WebKit window opens on the Cognito Hosted UI login page. Log in
with the Google account tied to your electromaps account. Once Google
redirects back through Cognito, this script intercepts the final redirect
at the network level (Playwright's response event fires for that request
even though the browser can't navigate to the resulting
`electromapsandroid://` scheme), extracts the authorization code, exchanges
it for a token pair, and prints the refresh_token to paste into this app's
Settings > Electromaps account field.

If automatic capture fails, the script falls back to prompting for the
code to be pasted manually.
"""
import asyncio
import base64
import hashlib
import secrets
import sys
import urllib.parse

from playwright.async_api import async_playwright

CLIENT_ID = "e2582mkf7dvklnd3d91mpfrr0"
IDP_DOMAIN = "https://idp.electromaps.com"
REDIRECT_URI = "electromapsandroid://signin"
SCOPE = "email openid aws.cognito.signin.user.admin"


def make_pkce_pair():
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def build_authorize_url(challenge):
    params = {
        "identity_provider": "Google",
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "client_id": CLIENT_ID,
        "scope": SCOPE,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    return IDP_DOMAIN + "/oauth2/authorize?" + urllib.parse.urlencode(params)


def extract_code_from_location(location_value):
    if not location_value or not location_value.startswith(REDIRECT_URI):
        return None
    parsed = urllib.parse.urlparse(location_value)
    qs = urllib.parse.parse_qs(parsed.query)
    codes = qs.get("code")
    return codes[0] if codes else None


async def capture_auth_code(authorize_url):
    """Opens a real browser window, lets the human complete the Google
    login, and returns the authorization code by watching for the redirect
    response's Location header — without ever needing the browser to
    successfully navigate to the electromapsandroid:// target."""
    found = {"code": None}

    async with async_playwright() as p:
        browser = await p.webkit.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()

        def on_response(resp):
            if found["code"] is not None:
                return
            loc = resp.headers.get("location")
            code = extract_code_from_location(loc)
            if code:
                found["code"] = code
                print("\nCaptured authorization code from network response.")

        page.on("response", on_response)

        print("Opening Google login in a browser window...")
        print("Log in with the Google account linked to your electromaps account.")
        try:
            await page.goto(authorize_url, wait_until="networkidle", timeout=120000)
        except Exception:
            # Expected: the final redirect targets a scheme this browser
            # can't open, so goto() may report a failed/interrupted
            # navigation even after everything we need has already been
            # captured via the response event above.
            pass

        # Give the redirect chain a moment to finish even if goto() above
        # returned early/failed on the final hop.
        for _ in range(60):
            if found["code"]:
                break
            await asyncio.sleep(1)

        await browser.close()

    return found["code"]


def exchange_code_for_tokens(code, verifier):
    import urllib.request

    data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "client_id": CLIENT_ID,
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
    }).encode()

    req = urllib.request.Request(IDP_DOMAIN + "/oauth2/token", data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req, timeout=15) as resp:
        import json
        return json.loads(resp.read().decode())


async def main():
    verifier, challenge = make_pkce_pair()
    authorize_url = build_authorize_url(challenge)

    code = await capture_auth_code(authorize_url)

    if not code:
        print("\nCouldn't capture the code automatically.")
        print("Open this URL yourself, complete the Google login, then check")
        print("DevTools > Network for the request whose Location header starts")
        print("with 'electromapsandroid://signin?code=...':\n")
        print(authorize_url + "\n")
        code = input("Paste the code here: ").strip()
        if not code:
            print("No code provided, aborting.")
            sys.exit(1)

    print("\nExchanging code for tokens...")
    tokens = exchange_code_for_tokens(code, verifier)

    if "refresh_token" not in tokens:
        print("\nToken exchange failed:", tokens)
        sys.exit(1)

    print("\nSuccess. Paste this into evse-status Settings > Electromaps account > Refresh token:\n")
    print(tokens["refresh_token"])
    print()


if __name__ == "__main__":
    asyncio.run(main())
