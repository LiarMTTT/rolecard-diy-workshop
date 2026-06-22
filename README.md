# rolecard-diy-workshop
Universal DIY workshop index and package repository for role cards.

## v1 Scope

This repository maintains the public contract for role-card DIY workshop packages.
Workshop packages are imported into role cards as worldbook/lorebook entries or opening world-factor entries. They are not MVU variable writers and must not directly patch player save variables.

The repository contains:

- JSON schemas and examples.
- Static package indexes.
- Official fixed-version runtime manifests and scripts.
- A minimal Workshop Gateway for Discord-gated publishing, review, and owner-managed withdrawal.
- A review page, deployment self-check, and Cloudreve/public-folder sync helper for first VPS operation.
- A GitHub Actions workflow that publishes only static workshop contracts to GitHub Pages.

Actual user package JSON/media storage can live outside GitHub, such as Cloudreve or another object/file store. GitHub is the maintenance repository, not the primary user-content database. The Gateway owns package indexes, review status, publisher ownership, and withdrawal records.

In v1, package import should create or update worldbook/lorebook entries in the role card. `world_factor` packages target the opening world-factor entry, while other supported packages become independent workshop entries that the model can read as setting templates.

Official runtime manifests may describe optional UI/management-layer modules such as status bar rendering and control center UI. They must not move Zod schema, MVU update rules, variable core contracts, or the opening wizard main flow out of the role card.

The Xingyue 2.9.0 runtime folder currently contains official placeholder scripts and a loader draft. They are publishable fixed-version artifacts for GitHub Pages, but the role card should keep its bundled status bar/control center until the loader migration is explicitly wired and tested.

## Package Types

v1 accepts:

- `character`
- `user_identity`
- `world_factor`
- `shop_item`
- `blueprint`
- `recipe`
- `skill`
- `function`

v1 rejects:

- `opening_pack`
- `prompt_patch`
- `ui_theme`

## Privacy Rule

Discord login is only a key for managing the user's own published packages. The Gateway must not store Discord email, username, avatar, raw Discord user ID, IP history, or behavior profiles. It stores only a salted hash and a generated publisher ID.

When review is enabled, newly published packages are `pending` and are not listed publicly until approved. Withdrawal removes a package from the public index but preserves a minimal audit record.

## Layout

```text
workshop-index.json       Top-level static workshop entry
.github/workflows/        GitHub Pages deployment workflow
gateway/                  Minimal Node.js Workshop Gateway
runtime/xingyue/2.9.0/    Optional fixed-version runtime manifest and official scripts
schemas/                  JSON schema contracts
examples/                 Example package JSON files
cards/xingyue/index.json  Static package index placeholder
shared/tags.json          Shared tag list
tools/                    Static contract validation and Pages build scripts
```

## Static Pages

```bash
npm run validate:static
npm run build:pages
```

The Pages artifact is written to `dist-pages/` and intentionally excludes the Gateway server. In GitHub repository settings, set Pages source to GitHub Actions, then the bundled workflow can publish `workshop-index.json`, schemas, examples, card indexes, and fixed-version runtime files.

## Gateway Release

```bash
npm --prefix gateway run build:release
```

The release artifact is written to `dist-gateway/` and contains only the files needed for the VPS Gateway process.

For the full handoff checklist, see [PUBLISHING.md](PUBLISHING.md).
