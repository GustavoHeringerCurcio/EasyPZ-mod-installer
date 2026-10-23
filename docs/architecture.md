# Architecture

## Process model

```
React renderer
   │ typed IPC (contextBridge, no Node)
Electron main
   │ in-process calls
@easypz/engine
   │
Steam / Project Zomboid / %USERPROFILE%\Zomboid / %LOCALAPPDATA%\EasyPZ
```

- The renderer has no filesystem access. It calls a narrow API exposed by `src/preload/index.ts`.
- The main process owns settings, catalog loading, elevation, logging, and all engine calls.
- The engine is plain TypeScript with Node APIs. It can be tested without Electron.

## Packages

### `@easypz/catalog`

- Zod schemas for packs and the generated catalog.
- Build and validate scripts.
- Resolver helpers: `getEffectiveMods`, `getEffectiveGroups`, `getActiveModIds`, `getManagedFolders`.
- `extends` implements pack inheritance. Advanced currently extends Medium.

### `@easypz/engine`

| Module           | Responsibility                                                                     |
| ---------------- | ---------------------------------------------------------------------------------- |
| `detect.ts`      | Steam libraries, PZ path, Workshop root, RAM/heap, free disk, process/admin checks |
| `download.ts`    | Streamed download, resume, progress, SHA256                                        |
| `archive.ts`     | Safe `.tar` extraction and mod source resolution                                   |
| `apply.ts`       | Journaled mod moves, backups, rollback, managed-folder diffs                       |
| `activation.ts`  | `default.txt` generation and backups                                               |
| `host.ts`        | `servertest.ini` `Mods=` updates                                                   |
| `gameConfig.ts`  | Launcher JSON/BAT, heap, ZombieBuddy agent, texture compression                    |
| `zombiebuddy.ts` | Detection and manual jar/DLL install                                               |
| `state.ts`       | `state.json`, legacy migration, install records                                    |
| `verify.ts`      | Per-mod health checks                                                              |
| `install.ts`     | Install orchestrator and stage/progress events                                     |
| `operations.ts`  | Activate, deactivate, purge, host, verify                                          |

## Install flow

1. **Preflight** — find PZ, refuse if the game is running, check free disk, create directories.
2. **Resolve archive** — use a valid cached archive, then a valid legacy archive, otherwise download.
3. **Verify** — SHA256 against the catalog.
4. **Extract** — into `%LOCALAPPDATA%\EasyPZ\cache\extracted\<sha256>`.
5. **Store** — move mods from the extract cache into the EasyPZ pack store, keyed by workshop ID and folder.
6. **ZombieBuddy** — manual copy of `ZombieBuddy.jar` and `zbNative.dll` when available.
7. **Configure** — heap, agent, texture compression.
8. **Activate** — move the previous active pack to the store, move the target pack from the store into `Zomboid\mods`, update only EasyPZ-owned IDs in `default.txt`, and record the active pack.
9. **Host** — do not modify `servertest.ini`; Library offers an explicit sync when it is out of date.
10. **Record** — write the install record for provenance and update availability.

Events are emitted as a discriminated union (`stage`, `progress`, `mod`, `warning`, `log`, `done`, `error`) and forwarded to the renderer over `install:event`.

## State

`%USERPROFILE%\Zomboid\EasyPZ\state.json`:

```json
{
  "schemaVersion": 1,
  "layoutVersion": 2,
  "activePackId": "advanced",
  "installs": {
    "advanced": {
      "packId": "advanced",
      "archiveSha256": "…",
      "catalogGeneratedAt": "…",
      "installedAt": "…",
      "managedFolders": ["Viewpoint", "TrueSwimming"],
      "disabledModIds": []
    }
  },
  "gamePathOverride": null,
  "migratedFrom": "ViewpointPacks",
  "createdAt": "…",
  "updatedAt": "…"
}
```

`layoutVersion: 2` introduced the pack store. Only folders tracked by an EasyPZ pack are ever moved or deleted; unmanaged mods and unmanaged `default.txt` IDs are preserved.

## Pack store and toggles

- Inactive packs live in `%USERPROFILE%\Zomboid\EasyPZ\store\108600\<workshopId>\mods\<folder>`.
- The active pack lives in `%USERPROFILE%\Zomboid\mods`.
- `getAvailablePackIds` marks a pack available when every managed mod is in the store or active.
- Enabling or disabling a pack is a directory-move transaction, not an install.
- Moves are journaled to `%USERPROFILE%\Zomboid\EasyPZ\move-journal.json`. On startup, an interrupted move is completed and the active pack is reconciled from the physical folder state.
- Shared mods are stored once under their workshop/folder key.
- Deleting a pack removes only store folders not referenced by another available pack.

## Per-mod toggles

Each install record keeps `disabledModIds`. Toggling a mod never moves its folder:

- **Active pack:** the mod ID is added to or removed from `default.txt`. Project Zomboid only loads IDs listed there, so the folder stays in `Zomboid\mods` but the mod does not load.
- **Inactive pack:** only the install record changes. The preference is applied the next time the pack is activated.
- **Pack switch:** each pack keeps its own disabled set. Activation re-adds only that pack's enabled IDs.
- **Install, repair, and UI-suite changes:** existing disabled IDs are preserved when the mod is still part of the pack; stale IDs are dropped.
- **Host sync:** `Mods=` and `WorkshopItems=` exclude disabled mods, so the Library out-of-sync banner reacts to per-mod changes.
- **Core mods:** `ZombieBuddy` and `Viewpoint` stay toggleable, but the UI warns before disabling them because Viewpoint add-ons depend on them.

## Workshop collection packs

Packs with `source: "workshop"` do not use an archive. The catalog pins the public collection ID and its current item list.

1. Ensure SteamCMD exists at `%LOCALAPPDATA%\EasyPZ\steamcmd`.
2. For each item, check the Steam client Workshop folder first.
3. Download missing items with SteamCMD in small batches.
4. Discover each item’s `mods/<folder>` content and parse `mod.info`.
5. Copy mods into the EasyPZ store.
6. Record the discovered mod IDs/folders in the install record.
7. Activate normally using the recorded IDs.

The collection’s install record is the source of truth for availability, activation, verification, and deletion. Partial item failures are reported but do not abort the entire collection.

## Legacy migration

On first read, if state does not exist:

- `Zomboid\ViewpointPacks\profile.txt` maps to `activePackId`.
- `Zomboid\mods\.pz-viewpoint-installed` is matched against catalog archive hashes.
- A matching pack gets an install record.
- The old archive at `%LOCALAPPDATA%\PZViewpoint\archive` is reused when its SHA256 matches.

## Elevation

Browsing the catalog, changing settings, and verifying do not require admin.

If the game folder is not writable and the process is not elevated, the install returns `ELEVATION_REQUIRED`. The UI offers a restart:

1. The pending install is saved to `%APPDATA%\EasyPZ\pending-action.json`.
2. The packaged app relaunches itself with `--elevated` through `Start-Process -Verb RunAs`.
3. On startup the renderer consumes the pending action and starts the install.

In development this relaunch is disabled; run the terminal as Administrator to test installs.

## Security boundaries

- Catalog and archive URLs are validated and pinned to the project repository.
- SHA256 is mandatory.
- Tar extraction rejects `..` entries and disables path preservation.
- Renderer is sandboxed from Node, with `contextIsolation` and a CSP.
- The app never stores GitHub credentials.
- Logs do not contain secrets.

## Remote catalog

The app prefers the public catalog at:

```text
https://raw.githubusercontent.com/GustavoHeringerCurcio/EasyPZ-assets/main/catalog/index.json
```

The bundled catalog in `resources/catalog` is the offline fallback. The remote fetch has an 8-second timeout; covers are resolved relative to the catalog URL and embedded as data URLs. If a cover fetch fails, the bundled cover is used.

Override the catalog for development:

```powershell
$env:EASYPZ_CATALOG_URL = 'https://raw.githubusercontent.com/GustavoHeringerCurcio/EasyPZ-assets/main/catalog/index.json'
pnpm dev
```

Publishing the catalog to `EasyPZ-assets` means new packs, archive fixes, and hash changes no longer require an app release. The schemas and app code do not change; only the catalog source and archive URLs change.
