# Catalog authoring

Each pack lives in `catalog/packs/<id>/`:

```
catalog/packs/medium/
├── pack.json
└── cover.jpg
```

`pnpm catalog:generate` validates every pack and writes `catalog/index.json`, which is what the app reads.

## `pack.json`

```json
{
  "schemaVersion": 1,
  "id": "medium",
  "name": "Medium",
  "tagline": "The balanced Viewpoint experience",
  "description": "Longer description shown on the detail page.",
  "cover": "packs/medium/cover.jpg",
  "gallery": [],
  "accent": "#f97316",
  "featured": true,
  "placeholderArt": false,
  "gameBuild": "42.21",
  "tags": ["balanced", "viewpoint"],
  "extends": null,
  "order": 10,
  "archive": {
    "fileName": "PZ-Viewpoint-Mods.tar",
    "sha256": "…64 lowercase hex…",
    "sizeBytes": 1181116006,
    "requiredDiskGB": 4,
    "releaseTag": "mods-v1",
    "urls": {
      "alpha": "https://github.com/GustavoHeringerCurcio/EasyPZ-assets/releases/download/medium-v1/PZ-Viewpoint-Mods.tar",
      "public": "https://github.com/GustavoHeringerCurcio/EasyPZ-assets/releases/download/medium-v1/PZ-Viewpoint-Mods.tar"
    }
  },
  "requirements": {
    "freeDiskGB": 4,
    "ramGB": 8,
    "recommendedRamGB": 16,
    "vramGB": 8
  },
  "groups": [
    {
      "name": "Core",
      "mods": [
        {
          "id": "Viewpoint",
          "name": "Viewpoint",
          "folder": "Viewpoint",
          "workshopId": "3809306528",
          "workshopUrl": "https://steamcommunity.com/sharedfiles/filedetails/?id=3809306528",
          "serverOnly": false
        }
      ]
    }
  ],
  "warnings": ["Close Project Zomboid before installing."],
  "credits": ["All mods belong to their respective authors."],
  "updatedAt": "2026-10-20"
}
```

## Inheriting a base pack

Set `extends` to another pack id. `advanced` extends `medium`; its `groups` contain only the additions. The app resolves the full mod list, client activation list, host list, and managed folders.

Do not create cycles. Validation rejects unknown parents.

## Presentation

- `accent` is the pack's hex color used for its card frame, controls, and progress. Keep it readable on the dark UI.
- `featured` places the pack in the **Recommended base modpack** row on the Catalog page. Packs without it appear under **More modpacks**.
- `cover` supports `.jpg`, `.png`, `.webp`, and `.svg`. Use a 16:9 image at 1200×675 or larger for the catalog and detail hero.

## Archive requirements

- The archive is a `.tar`.
- It extracts to `108600/<workshopId>/mods/<folder>` (the legacy layout). The engine also accepts a few flatter layouts.
- Every mod referenced in the pack must exist in the archive with a `mod.info`.
- `sha256` is mandatory.
- Alpha URLs must be HTTPS on `github.com`, under the legacy repository release path.
- Public URLs must be HTTPS on `github.com`, under this repository's release path.
- The file name in the URL must match `archive.fileName`.

## Adding a new pack

1. Create `catalog/packs/<id>/pack.json` and artwork.
2. Add the archive to a GitHub release (public launch) or use the legacy mirror (alpha).
3. Run `pnpm catalog:generate`.
4. Run `pnpm catalog:validate`.
5. Test the app with `pnpm dev`.
6. Commit the pack folder and the regenerated `catalog/index.json`.

## Artwork

- Covers are 16:9-ish; the UI crops to about `16/8.2`.
- SVG, WebP, PNG, and JPEG are supported. The main process embeds covers as data URLs, so keep files small.
- The current covers are branded placeholders with `"placeholderArt": true`.
- Do not use Project Zomboid trademarks or unlicensed screenshots in the app identity.

## Modes

`catalog/index.json` records `"mode": "alpha" | "public"`.

```powershell
pnpm --filter @easypz/catalog generate -- --mode=public
```

Alpha uses the bundled catalog and legacy archive URLs. Public uses this repository's releases. Switching modes is a catalog change, not an app code change.
