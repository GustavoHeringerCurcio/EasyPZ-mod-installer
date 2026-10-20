# EasyPZ Mod Installer

A desktop catalog and installer for Project Zomboid modpacks. Pick a pack, see exactly what is inside, and install it in one click — no terminal, no typing `1` or `2`.

> **Status: private alpha (`v0.1.0-alpha.0`).** The repository is private while the app is tested. Builds are unsigned for now, so Windows SmartScreen may ask for confirmation.

EasyPZ is the successor to the legacy [pz-viewpoint-starter](https://github.com/GustavoHeringerCurcio/pz-viewpoint-starter) installer. The old repository remains online and untouched for existing users; this project is a clean rebuild.

## What it does

- Catalog with pack covers, descriptions, tags, requirements, and full mod lists.
- One-click install of the complete pack: mods, ZombieBuddy, launcher heap/agent configuration, `default.txt`, and host INI when present.
- Download progress, checksum verification, extraction progress, cancellation, and actionable errors.
- Package switching with managed-folder diffs; unmanaged mods are never touched.
- Library health checks, activation, deactivation to backup, purge, repair, and host setup.
- Legacy migration: reuses the old profile, marker, and archive cache when the hash matches.
- English by default, Portuguese (BR) toggle.
- Remote-catalog-ready architecture; the alpha build uses a bundled catalog because the repository is private.

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

- **Alpha:** catalog is bundled with the app; archive URLs temporarily point at the legacy public releases. This is what the private alpha uses, and it needs no GitHub token.
- **Public:** catalog is served remotely from this repository and archives are hosted in this repository's releases. Enabled at public launch.

The mode is stored in `catalog/index.json` and validated by the app. See [docs/catalog.md](docs/catalog.md).

## Packaging

```powershell
pnpm package:win
```

Outputs:

- `release/EasyPZ-<version>-setup.exe` — per-user NSIS installer
- `release/EasyPZ-<version>-x64.zip` — portable build
- `release/*.blockmap` and `release/SHA256SUMS.txt` on CI

Builds are unsigned. `win.signAndEditExecutable` is disabled so packaging works without symlink privileges; code signing hooks can be enabled later.

## Alpha testing

Read [docs/alpha.md](docs/alpha.md). In short:

1. Download the installer from the private release and share it directly with testers.
2. Expect SmartScreen on unsigned builds (More info → Run anyway).
3. Test a fresh install and a legacy migration.
4. Report errors with the log file at `%LOCALAPPDATA%\EasyPZ\logs\main.log`.

## Data locations

| Path                                      | Contents                                                |
| ----------------------------------------- | ------------------------------------------------------- |
| `%APPDATA%\EasyPZ`                        | App settings and pending elevated action                |
| `%LOCALAPPDATA%\EasyPZ\logs`              | Logs                                                    |
| `%LOCALAPPDATA%\EasyPZ\cache\archives`    | Verified pack archives                                  |
| `%LOCALAPPDATA%\EasyPZ\cache\extracted`   | Extracted archives keyed by SHA256                      |
| `%USERPROFILE%\Zomboid\EasyPZ\state.json` | Active pack and install records                         |
| `%USERPROFILE%\Zomboid\mods`              | Installed mods                                          |
| `%USERPROFILE%\Zomboid\backups`           | EasyPZ backups, `default.txt` backups, host INI backups |

EasyPZ does **not** back up saves. Make a manual save backup before switching packs.

## Security

- Catalog is validated with Zod; archive URLs must be HTTPS on the pinned GitHub repository and match the expected file name.
- SHA256 is mandatory for every archive.
- Archive extraction rejects path traversal.
- Renderer runs with `contextIsolation`, no Node integration, a narrow preload bridge, and a Content Security Policy.
- The app never embeds a GitHub token. Private alpha installers are shared directly.
- No pack-provided code is executed by the installer.

## Public launch checklist

- [ ] Flip the repository to public or create a public catalog/asset repository.
- [ ] Re-upload `mods-v1` and `mods-v3` archives to this repository with identical SHA256.
- [ ] Switch the catalog to `public` mode and host `catalog/index.json` remotely.
- [ ] Enable `electron-updater` (currently off in alpha).
- [ ] Add the legacy banner to the old repository and archive it.
- [ ] Decide on code signing (SignPath for open source, or a certificate).
- [ ] Replace placeholder catalog artwork.

## Credits

All mods belong to their respective authors. The release archive is a convenience mirror; it is not claimed as original work. Not affiliated with The Indie Stone.

## License

MIT for the scripts and application code in this repository.
