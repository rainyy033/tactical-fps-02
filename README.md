# Breakpoint

A round-based tactical FPS built with three.js. You play as **Aegis** in a five-a-side
skirmish against five **Wraith** bots across a three-lane arena with two bomb sites
(HELIOS west, NOVA east).

Each round opens with a buy phase, then a timed combat phase. Earn money from kills and
round wins, and spend it on four weapons — Sidearm, Viper SMG, Longshot rifle, and the
Avalanche sniper. Head shots do far more damage than body shots, so accuracy beats spraying.

## Run

```bash
node serve.ts
```

Then open <http://localhost:8080>. No build step or dependencies to install (Node 22,
standard library only).

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Look |
| Click | Fire |
| `R` | Reload |
| `B` | Buy menu |
| `Ctrl` | Crouch |
| `Space` | Jump |
