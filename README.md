# Cougar-Six-Siege

## Run

Install the server dependency and start the game server:

```sh
npm install
npm start
```

Open `http://localhost:8000` or share the server's reachable address with other players. The Node server hosts the page and its WebSocket matchmaking service on the same port. For public play, deploy the server somewhere all players can reach over HTTPS/WSS; a local development server is only reachable by other devices when the host network allows it.

## Matchmaking

Choose a squad playlist (up to five players per team) or **1v1 Duel**, then select **Deploy**. Matches start as soon as players can be placed on both teams; squad matches do not wait for full teams. Create a party to get a six-character code, or join a friend's party with their code. Party members queue together and stay on the same team; 1v1 is solo-only. Online matches currently use **The Field** map.

In The Field, press **C** to crouch. Deploy the recon drone from the gadget slot, use **WASD** to drive, **Space** to scan, and **G** to recall it. The match scoreboard shows team kills and each player's kills, deaths, and health.

Weapons equipped with a red dot or 4x scope display a 2D sight while aiming; iron sights retain the weapon view.

Controls for The Field can be changed in the main menu's **Settings** tab and are saved in the browser. Choose an action and press a letter, number, Space, or Shift; press Escape to cancel. ADS defaults to right mouse and can also be bound to middle mouse by pressing it in the settings panel. Jump and drone scan share a binding. Mouse look, left-click fire, arrow keys, and Escape to exit remain fixed.

The field renderer automatically caps resolution and render rate on lower-memory or lower-core-count devices, including many school Chromebooks.