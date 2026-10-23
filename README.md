# EasyPZ Mod Installer

A desktop catalog and installer for Project Zomboid modpacks. Pick a pack, see exactly what is inside, and install it in one click — no terminal, no typing `1` or `2`.

> **Status: private alpha (`v0.1.0-alpha.0`).** The repository is private while the app is tested. Builds are unsigned for now, so Windows SmartScreen may ask for confirmation.

EasyPZ is the successor to the legacy [pz-viewpoint-starter](https://github.com/GustavoHeringerCurcio/pz-viewpoint-starter) installer. The old repository remains online and untouched for existing users; this project is a clean rebuild.

## What it does

- Catalog with pack covers, tags, requirements, and full mod lists.
- One-click install of the complete pack: mods, ZombieBuddy, launcher heap/agent configuration, and activation.
- Live Workshop progress for SteamCDN packs: current item, byte progress when SteamCMD reports it, speed/ETA, and cached/downloaded/failed counts.
- One active pack at a time. Inactive packs stay installed in EasyPZ storage and can be toggled on instantly.
- Toggle individual mods on or off from a pack's **Mods** tab. Disabled mods stay installed but are removed from `default.txt`, so the rest of the pack keeps working.
- Download progress, checksum verification, extraction progress, cancellation, and actionable errors.
- Switching moves only EasyPZ-managed mod folders; unmanaged mods and `default.txt` entries are preserved.
- Library health checks, toggles, delete, repair, and explicit host sync.
- Catalog source/version display and manual refresh; installed packs show **Update available** when the catalog changes, with an **Update pack** action instead of Repair.
- Legacy migration: reuses the old profile, marker, and archive cache when the hash matches.
- **FPS Boost** section in Settings: an independent game RAM slider, Recommended/Light one-click presets, restore defaults, and an explicit change preview.
- English by default, Portuguese (BR) toggle.
- Remote-catalog-ready architecture; the alpha build uses a bundled catalog because the repository is private.

## Packs

| Pack                             |        Client mods | Download | Notes                                                      |
| -------------------------------- | -----------------: | -------: | ---------------------------------------------------------- |
| **Essentials**                   |                  6 |  ~515 MB | Core Viewpoint, 3D models, interface, ADS, right-click fix |
| **Medium**                       |                 38 |  ~1.1 GB | Balanced Viewpoint pack                                    |
| **Advanced**                     |                 45 |  ~1.0 GB | Medium plus mechanics, realism, and swimming               |
| **Ultra**                        | 140 Workshop items |  ~3.1 GB | Advanced plus horses, maps, 3D world, and curated vehicles |
| **Project Viewpoint Collection** |  90 Workshop items |  ~2.2 GB | Full Workshop collection, downloaded through SteamCMD      |
| **Project Viewpoint - Addons**   | 198 Workshop items |  ~6.0 GB | Large reference collection of Viewpoint add-ons            |

Essentials is standalone. Medium and Advanced are additive to each other, but Essentials is a smaller independent starter pack.

## FPS Boost

Settings now includes an **FPS Boost** section for every pack:

- **Game RAM slider** is independent. It starts from the current game heap, uses the detected recommended value, and enforces a 3 GB minimum. **Save RAM** writes `-Xmx` to `ProjectZomboid64.json` and `ProjectZomboid64.bat`.
- **Recommended Boost** is the one-click path: it applies the full performance profile and sets game RAM to the recommended value.
- **Light Boost** keeps blood, ragdolls, and vehicle textures untouched; it only reduces Viewpoint floor, weather, shadow, rain, and render-scale cost.
- **Restore defaults** returns the managed performance keys to their default values and sets game RAM to the recommended value. It uses fixed defaults, not a backup.
- The expanded “See exactly what changes” list shows the settings and files before applying.
- No backup is created for FPS Boost. The game must be closed. Visual mods, maps, and vehicles stay installed; FPS Boost only lowers resource-heavy settings.

Ultra intentionally excludes Directional Melee, PoolPit, The Only Cure+, Immersive Physics & Weather, and the 99 CVPI for stability. Expanded Helicopter Events is Build 41 only and is not included.

## How activation works

Only one EasyPZ modpack can be ready to play at a time.

- The active pack’s folders live in `%USERPROFILE%\Zomboid\mods`.
- Inactive packs stay installed in `%USERPROFILE%\Zomboid\EasyPZ\store`.
- Enabling a pack moves the previous pack’s managed folders to the store and the target pack’s folders into `Zomboid\mods`.
- Disabling a pack moves it to the store and removes its IDs from `default.txt`.
- Mods are moved, not re-downloaded, so switching is fast once a pack is installed.
- The app preserves unrelated mod IDs the user added to `default.txt`.

## Workshop collection packs

The **Project Viewpoint Collection** (`3820219222`, 90 items) and **Project Viewpoint - Addons** (`3812839109`, 198 items) are not prebuilt archives. They use public Steam Workshop collections and download through SteamCMD.

The Addons collection is a reference index, not a tested modpack. It contains obsolete and conflicting alternatives, so expect conflicts if all 198 items are enabled together.

- SteamCMD is downloaded automatically to `%LOCALAPPDATA%\EasyPZ\steamcmd`.
- Items already present in the Steam client’s Workshop folder are reused.
- The app discovers each item’s real mod ID and folder from `mod.info`.
- Failed or removed items are reported and skipped; the rest of the collection continues.
- Already downloaded items are reused, so restarting or retrying resumes instead of downloading everything again.
- Small items are pre-downloaded in batches through one SteamCMD process to avoid paying SteamCMD's login/validation cost for every mod. Large map items run individually. A stalled run is retried item by item after five minutes without download activity (or 30 minutes total), so it cannot block the rest of the collection. SteamCMD's own cache is kept so later items do not fail with missing depot files.
- The collection changes when Workshop items update. For a stable test, use a new save and keep a manual backup.
- This is a large, uncurated collection. It appears under **More modpacks**, not the recommended section.

## Requirements

- Windows 10/11 x64
- Steam + Project Zomboid Build 42.21
- 8 GB RAM minimum, 16 GB recommended
- Project Zomboid closed during installation

## Development

Requirements: Node.js 22+, pnpm 11+, Windows.

```powershell
pnpm install
pnpm dev
```

`pnpm dev` builds the local packages and starts Electron with Vite.

### Useful commands

| Command                 | What it does                                                  |
| ----------------------- | ------------------------------------------------------------- |
| `pnpm dev`              | Build libraries and run the Electron app                      |
| `pnpm build:libs`       | Compile `@easypz/catalog` and `@easypz/engine`                |
| `pnpm catalog:generate` | Rebuild `catalog/index.json` from `catalog/packs/*/pack.json` |
| `pnpm catalog:validate` | Validate the committed catalog                                |
| `pnpm typecheck`        | Build libraries and typecheck every package                   |
| `pnpm test`             | Run catalog and engine unit tests                             |
| `pnpm lint`             | Prettier check                                                |
| `pnpm format`           | Prettier write                                                |
| `pnpm package:win`      | Build NSIS installer and portable ZIP in `release/`           |

### Repository layout

```
apps/desktop/          Electron main, preload, React renderer
packages/engine/       TypeScript install engine
packages/catalog/      Zod schema, validator, catalog builder
catalog/packs/         One folder per modpack
catalog/index.json     Generated catalog consumed by the app
docs/                  Architecture, catalog authoring, alpha guide
```

See [docs/architecture.md](docs/architecture.md), [docs/catalog.md](docs/catalog.md), and [docs/alpha.md](docs/alpha.md).

## Catalog modes

The app supports two catalog modes:

- **Alpha:** the catalog is fetched from the public `EasyPZ-assets` repository, with the bundled catalog as offline fallback. Archives may still point at the legacy releases or the assets repository.
- **Public:** the catalog is served remotely and archives are hosted in public GitHub releases.

The mode is stored in `catalog/index.json` and validated by the app. The app prefers the remote catalog and falls back to the bundled copy if GitHub is unavailable. See [docs/catalog.md](docs/catalog.md).

## Packaging

```powershell
pnpm package:win
```

Outputs:

- `release/EasyPZ-<version>-setup.exe` — per-user NSIS installer
- `release/EasyPZ-<version>-portable.exe` — single-file portable build
- `release/EasyPZ-<version>-x64.zip` — portable folder build
- `release/*.blockmap` and `release/SHA256SUMS.txt` on CI

The ZIP and installed app include `START-HERE.txt` with launch and SmartScreen instructions. Because the repository is private, share builds through a file link rather than a GitHub release link.

Builds are unsigned. `win.signAndEditExecutable` is disabled so packaging works without symlink privileges; code signing hooks can be enabled later.

## Alpha testing

Read [docs/alpha.md](docs/alpha.md). In short:

1. Build with `pnpm package:win`, then share the setup, portable EXE, or ZIP directly with testers.
2. Expect SmartScreen on unsigned builds (More info → Run anyway).
3. For the ZIP, tell testers to extract the whole archive before running the app.
4. Test a fresh install and a legacy migration.
5. Report errors with the log file at `%LOCALAPPDATA%\EasyPZ\logs\main.log`.

## Data locations

| Path                                      | Contents                                                |
| ----------------------------------------- | ------------------------------------------------------- |
| `%APPDATA%\EasyPZ`                        | App settings and pending elevated action                |
| `%LOCALAPPDATA%\EasyPZ\logs`              | Logs                                                    |
| `%LOCALAPPDATA%\EasyPZ\cache\archives`    | Verified pack archives                                  |
| `%LOCALAPPDATA%\EasyPZ\cache\extracted`   | Extracted archives keyed by SHA256                      |
| `%USERPROFILE%\Zomboid\EasyPZ\state.json` | Active pack and install records                         |
| `%LOCALAPPDATA%\EasyPZ\steamcmd`          | SteamCMD used for Workshop collection downloads         |
| `%USERPROFILE%\Zomboid\EasyPZ\store`      | Inactive downloaded pack mods                           |
| `%USERPROFILE%\Zomboid\mods`              | Mods for the one active pack                            |
| `%USERPROFILE%\Zomboid\backups`           | EasyPZ backups, `default.txt` backups, host INI backups |

EasyPZ does **not** back up saves. Make a manual save backup before switching packs.

## Hosting a server

`%USERPROFILE%\Zomboid\Server\servertest.ini` is the config for a Project Zomboid server hosted from this PC. Single-player users do not have it and do not need it.

If it exists and its `Mods=` list does not match the active pack, EasyPZ shows a banner in Library with a **Sync host mods** action. EasyPZ never modifies that file silently; syncing creates a backup first.

## Security

- Catalog is validated with Zod; archive URLs must be HTTPS on the pinned GitHub repositories (`EasyPZ-mod-installer` or `EasyPZ-assets`) and match the expected file name.
- SHA256 is mandatory for every archive.
- Archive extraction rejects path traversal.
- Renderer runs with `contextIsolation`, no Node integration, a narrow preload bridge, and a Content Security Policy.
- The app never embeds a GitHub token. Private alpha installers are shared directly.
- No pack-provided code is executed by the installer.

## Public launch checklist

- [x] Create the public `EasyPZ-assets` catalog/archive repository.
- [x] Publish the Essentials and Advanced v2 archives there.
- [x] Publish `catalog/index.json` and covers there.
- [ ] Move the remaining Medium archive to `EasyPZ-assets` or the public main repo.
- [ ] Switch the catalog to `public` mode.
- [ ] Enable `electron-updater` (currently off in alpha).
- [ ] Add the legacy banner to the old repository and archive it.
- [ ] Decide on code signing (SignPath for open source, or a certificate).
- [ ] Replace placeholder catalog artwork.

## Credits

All mods belong to their respective authors. The release archive is a convenience mirror; it is not claimed as original work. Not affiliated with The Indie Stone.

## License

MIT for the scripts and application code in this repository.
