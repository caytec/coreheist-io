# CoreHeist.io

CoreHeist.io is a real-time multiplayer browser game where players build forts, defend glowing cores, raid rival bases, steal enemy cores, and extract them at home.

The project includes:

- A branded SEO landing page at `/`
- The playable game at `/play.html`
- Express static hosting
- WebSocket multiplayer through `ws`
- Authoritative server simulation
- Room codes and automatic matchmaking
- Bot contestants for quiet rooms
- Resource gathering
- Fort building
- Structure collision and health
- Player combat and respawning
- Core theft and extraction
- Automatic build, raid, and intermission phases
- SEO metadata
- Open Graph and Twitter card metadata
- A canonical sitemap
- Health monitoring at `/health`

## Domain status

The selected domain is `CoreHeist.io`.

Domain availability is **unverified**. Confirm availability directly with a registrar before purchasing the domain or publicly announcing it.

## Requirements

- Node.js 18 or newer
- npm
- A modern browser
- A hosting provider that supports long-lived WebSocket connections

## Local installation

```bash
npm install
npm start
```

The default local URL is:

```text
http://localhost:3000
```

Open the landing page:

```text
http://localhost:3000/
```

Open the game:

```text
http://localhost:3000/play.html
```

Health check:

```text
http://localhost:3000/health
```

The server reads the hosting platform's `PORT` environment variable. It defaults to port `3000` when `PORT` is not supplied.

## Controls

- `W`, `A`, `S`, `D`: move
- Arrow keys: move
- Left mouse button: attack
- Right mouse button: build
- `1`: select Wood Wall
- `2`: select Stone Wall
- `3`: select Gate
- `4`: select Launch Pad
- `E`: gather resources
- `Space`: dash

## Game flow

### Build phase

The build phase lasts 45 seconds.

Players gather wood and stone from resource nodes. Right-clicking places a selected structure near the player.

Available structures:

- Wood Wall
- Stone Wall
- Gate
- Launch Pad

The server validates the structure type, cost, position, boundaries, placement distance, and overlaps.

### Raid phase

The raid phase lasts 90 seconds.

Players can attack rival players and enemy structures. Touching an enemy's glowing core steals it. The carrier moves slower and is highlighted.

To score the extraction, the carrier must return to the carrier's own glowing core.

If the carrier is defeated, the stolen core is returned to its owner.

### Round lifecycle

Each room cycles through:

1. 45-second build phase
2. 90-second raid phase
3. 8-second intermission
4. New round

Rooms support up to eight players. New rooms are filled with bots up to four contestants so a new visitor can immediately play.

## Server authority

The server controls:

- Player movement
- Movement speed
- Collision
- Resource gathering
- Building
- Structure health
- Combat damage
- Respawning
- Core ownership
- Core theft
- Core extraction
- Round timing
- Scoring
- Leaderboard values

The client renders snapshots from the server and interpolates player movement for smoother visuals.

## Deployment to Render

Render is suitable for this project when using a Web Service with WebSocket support.

1. Push the project to a Git repository.
2. Sign in to Render.
3. Select **New > Web Service**.
4. Connect the repository.
5. Set the runtime to Node.
6. Set the build command:

   ```bash
   npm install
   ```

7. Set the start command:

   ```bash
   npm start
   ```

8. Choose a service region and instance size.
9. Deploy the service.
10. Render supplies the `PORT` environment variable automatically.
11. Do not configure the service as a static site because WebSockets require a running Node process.
12. Test:

   ```text
   https://YOUR-RENDER-SERVICE.onrender.com/health
   ```

The expected response contains `"ok": true`.

## Deployment to Railway

1. Push the project to GitHub.
2. Create a new Railway project.
3. Choose **Deploy from GitHub Repo**.
4. Select the repository.
5. Railway detects the Node project from `package.json`.
6. Confirm the start command is:

   ```bash
   npm start
   ```

7. Railway supplies `PORT` automatically.
8. Generate a public domain from the Railway service settings.
9. Test:

   ```text
   https://YOUR-RAILWAY-DOMAIN/health
   ```

## Deployment to Fly.io

1. Install the Fly CLI.
2. Sign in:

   ```bash
   fly auth login
   ```

3. From the project directory, launch the app:

   ```bash
   fly launch
   ```

4. Use the Node server configuration.
5. Ensure the app listens on `0.0.0.0` through the platform-provided `PORT`.
6. Deploy:

   ```bash
   fly deploy
   ```

7. Check:

   ```text
   https://YOUR-FLY-APP.fly.dev/health
   ```

## Environment settings

Required production setting:

```text
PORT=<provided automatically by the host>
```

The application does not require a database or external API key.

Do not hard-code a production port. The server already reads `process.env.PORT`.

For local development, an optional `.env` file can contain:

```text
PORT=3000
```

This project does not load `.env` automatically, so local shells should export the variable directly or use a hosting platform's environment settings.

## DNS setup for CoreHeist.io

Domain availability is unverified. First confirm that `coreheist.io` can be registered.

After purchasing the domain:

### Option A: CNAME to a platform hostname

For a host such as Render or Railway:

1. Open the hosting provider's custom-domain settings.
2. Add:

   ```text
   coreheist.io
   ```

3. Add:

   ```text
   www.coreheist.io
   ```

4. The provider will show its required DNS target.
5. At the domain registrar, create:

   ```text
   Type: CNAME
   Name: www
   Target: <provider hostname>
   ```

6. For the root domain, follow the provider's instructions. Some providers use an ALIAS or ANAME record; others provide fixed A records.
7. Return to the host dashboard and wait for certificate provisioning.
8. Configure the preferred canonical hostname and redirect the alternate hostname to it.

### Option B: A records

If the hosting provider supplies fixed IPv4 addresses:

```text
Type: A
Name: @
Value: <provider IPv4 address>
```

For `www`:

```text
Type: CNAME
Name: www
Target: coreheist.io
```

Use the exact records supplied by the hosting provider. Do not guess IP addresses.

DNS propagation can take from a few minutes to 48 hours.

## HTTPS and WebSockets

The production game uses:

```text
wss://coreheist.io
```

The client automatically selects:

- `ws://` for local HTTP
- `wss://` for HTTPS production traffic

Use a host with WebSocket support. Do not deploy this application as a static-only site or behind a proxy that terminates long-lived WebSocket connections without forwarding upgrade requests.

## Health check

Configure the hosting provider's health check path as:

```text
/health
```

A healthy response resembles:

```json
{
  "ok": true,
  "game": "CoreHeist.io",
  "rooms": 1,
  "players": 4,
  "uptime": 123.45
}
```

The room and player counts change during normal operation.

## Production checklist

- Confirm `coreheist.io` availability with a registrar.
- Deploy as a Node Web Service.
- Confirm `npm install` completes successfully.
- Confirm `npm start` is the start command.
- Confirm the platform supplies `PORT`.
- Confirm `/health` returns HTTP 200.
- Confirm `/` displays the landing page.
- Confirm `/play.html` loads the game.
- Confirm browser WebSocket connections remain open.
- Add the custom domain at the hosting provider.
- Add the provider's exact DNS records.
- Confirm HTTPS certificate issuance.
- Test `wss://` multiplayer from the production domain.
- Submit `https://coreheist.io/sitemap.xml` to search engines after launch.

## Project structure

```text
coreheist/
├── .gitignore
├── README.md
├── package.json
├── server.js
└── public/
    ├── favicon.svg
    ├── game.js
    ├── index.html
    ├── play.html
    ├── robots.txt
    ├── sitemap.xml
    └── social-card.svg
```
