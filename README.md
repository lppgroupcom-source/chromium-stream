# Chromium Stream

A real Chromium runs hidden on the machine hosting this, and a web page shows its screen and sends it your clicks and typing.

## Run on a Mac

    node server.js

Then open http://127.0.0.1:8770. Uses the installed Google Chrome. No password is needed while it only listens on the Mac itself.

## Run on Render

1. Put this folder in a GitHub repository.
2. On Render: New > Blueprint, pick the repository. `render.yaml` sets everything up.
3. When asked for `PASSWORD`, type one. The server refuses to start on a network without it.
4. Open the address Render gives you. The browser asks for a username and password: the username can be anything, the password is the one you set.

## Settings (environment variables)

| Name | Default | Meaning |
|---|---|---|
| `PASSWORD` | none | Required unless `HOST` is 127.0.0.1 |
| `HOST` | 127.0.0.1 | Address to listen on (the Dockerfile sets 0.0.0.0) |
| `PORT` | 8770 | Port to listen on (Render sets this itself) |
| `CHROME_PATH` | Google Chrome on macOS | Browser binary |
| `CHROME_FLAGS` | none | Extra browser flags, space separated |
| `MAX_SCALE` | 2 | Highest picture sharpness; 1 is lighter on the server |

Everyone who opens the page shares the same single browser.
