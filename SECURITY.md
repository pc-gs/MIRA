# Security policy

## Supported versions

Mira has no stable release yet. Security fixes go to `main` and to the latest release once there is one.

| Version | Supported |
| --- | --- |
| `main` / latest release | Yes |
| Anything older | No |

## What counts as a security issue

Mira runs only on your Mac, but it asks for sensitive permissions (Screen Recording for zoom) and draws over every app. Please report privately anything that could:

- expose screen contents outside the zoom view, or keep them after zoom closes;
- capture or leak keystrokes or the cursor position beyond what the app needs;
- let a web page, file or other app run code inside Mira or use its permissions;
- show the toolbar or other private UI in a screen share when it shouldn't be visible.

Bugs that only affect drawing or the UI are welcome as regular [issues](https://github.com/pc-gs/MIRA/issues).

## How to report

Report it privately at **[Report a vulnerability](https://github.com/pc-gs/MIRA/security/advisories/new)**. Please **don't** open a public issue, pull request or discussion for it.

Include, if you can:

- the Mira version or commit and your macOS version;
- the steps to reproduce, and what an attacker would gain;
- a proof of concept, if you have one.

## What to expect

- An acknowledgement within **3 business days**.
- An assessment and a planned fix, or an explanation if it's not considered a vulnerability, within **14 days**.
- Credit in the release notes once the fix ships, unless you'd rather stay anonymous.

Please give us a reasonable time to fix the issue before disclosing it publicly.
