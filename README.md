# Cougar-Six-Siege

## Run

Install the server dependency and start the game server:

```sh
npm install
npm start
```

Open `http://localhost:8000` or share the server's reachable address with other players. The Node server hosts the page and its WebSocket matchmaking service on the same port. For public play, deploy the server somewhere all players can reach over HTTPS/WSS; a local development server is only reachable by other devices when the host network allows it.

## Matchmaking

Choose a squad playlist (up to five players per team) or **1v1 Duel**, then select **Deploy**. Matches start as soon as players can be placed on both teams; squad matches do not wait for full teams. Create a party to get a six-character code, or join a friend's party with their code. Party members queue together and stay on the same team; 1v1 is solo-only. Every multiplayer mode offers **The Field**, **The Grand Canyon**, and **The 200s** in the map vote; The 200s still uses The Field's layout. Freeplay offers both completed maps.

The Grand Canyon is an indoor school map with spacious connected hallways, classrooms, bathrooms and a furnished cafeteria with a glass west wall. The main hall has beige brick, red-brick columns and posters, other halls have white, black and red brick bands, and the cafeteria has beige brick. Destructible wooden cover is scattered throughout; open classroom and bathroom doorways can also be barricaded. Sealed rooms cannot be entered. Defenders start at the west end and attackers at the east; the preparation barrier divides the map from north to south. Bomb and hostage sites can appear at the three marked locations. In hostage rescue, escort the hostage across the preparation line to the attackers' side.

The minimap at the top right shows the current map's rough layout. A white arrow marks your position and facing, a blue square marks your spawn, green circles show living teammates, and diamonds show active objectives (yellow, or red when a defuser is armed). A cyan circle marks a piloted drone. Enemies are not shown.

Press **C** to crouch. Hallway Monitor and Custom can deploy a controllable drone from the gadget slot: use **WASD** to drive and **G** to recall it. Hallway Monitor's faster camera drone ascends with **Space**, descends with **C**, and scans on left-click; it also scans automatically. The Custom scanner drone scans with **Space** by default. The match scoreboard shows team eliminations and each player's eliminations, deaths, and health.

Choose an operator from the roster before deploying. Preset operators use their listed kits; the loadout panel shows their bonuses and models of all four equipped items. **Custom** lets you configure all four loadout slots and inspect and customize individual items. Mr M can deploy up to three autonomous drones at once, in scanner, attacker, scanner order. Each scanner marks visible enemies within 22 units every 45 seconds; the attacker tracks a visible enemy within 24 units with a red laser, then fires 4-damage shots every 0.2 seconds after two continuous seconds of tracking. Cover and smoke break line of sight. Enemy drones, including controllable drones, can be destroyed with a single shot; a destroyed drone is unavailable for the rest of the round. Drones reset each round and stop when Mr M is eliminated. Hallway Monitor's controllable camera drone scans automatically. Operator selection and Custom's kit are saved in the browser.

Other players see a third-person model of the item currently equipped. Ballistic shields block shots that strike their front, including through the window, with a visible impact at the shield. Shots from behind or around the shield, Longwatch sniper rounds, and grenade blasts bypass it. Ms C also holds and fires her P45 while the shield is equipped. Mr L's smoke grenades create rotating tornado funnels that pull nearby players inward; he recharges one tornado grenade every 15 seconds, up to the normal three-grenade capacity, just as Ms C recharges frags.

Weapons are paintball guns. In Custom's loadout inspector, choose a paint color separately for each weapon, recon drone, frag grenade, and proximity mine; selections are saved in the browser and also apply when a preset operator uses that item. Paint colors appear on magazines and impact splashes, with larger splashes for shotguns and explosives; melee hammers leave no paint. Barricade hits stain intact cells rather than obscuring holes with splashes, and broken cells stain their surviving neighbors. Paint marks last 20 seconds. An uncovered headshot from any primary or the Magnum .44 eliminates a player or practice target immediately; helmets and shields still provide cover.

Multiplayer effects require the current server and client versions. If hosting the game remotely, redeploy the Node server as well as the page after updating.

Weapons equipped with a red dot or 4x scope display a 2D sight while aiming; iron sights retain the weapon view.

Controls can be changed in the main menu's **Settings** tab and are saved in the browser. Choose an action and press a letter, number, Space, or Shift; press Escape to cancel. ADS defaults to right mouse and can also be bound to middle mouse by pressing it in the settings panel. Jump and the Custom scanner drone's scan share a binding. Camera-drone ascent, descent and scanning, mouse look, left-click fire, arrow keys, and Escape to exit remain fixed.

The field renderer automatically caps resolution and render rate on lower-memory or lower-core-count devices, including many school Chromebooks.