# Security

If you find a vulnerability in Fifteen, please report it privately rather than opening a public issue:
use GitHub's **Report a vulnerability** button under the repository's Security tab.

Please include what you found, how to reproduce it, and what an attacker could do with it. You will get a
reply as soon as possible, and credit in the fix if you would like it.

## How Fifteen protects accounts

- Passwords never reach the server. The browser stretches the password with PBKDF2 (600,000 rounds) and
  sends only the derived key; the server stores a salted hash of that key.
- Sessions are random tokens in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Only a hash is stored.
- Every write checks the request's `Origin`. All SQL uses bound parameters.
- Sign-in endpoints are rate limited, accounts lock for 15 minutes after repeated failures, and Cloudflare
  Turnstile can be switched on for sign-up, log-in and recovery.
- A strict Content Security Policy is served with every page. There are no third-party scripts or fonts.
- No secrets live in this repository. `npm run scan` checks the full git history with gitleaks.
