# Xingyue 2.9.0 Runtime

This directory defines the optional remote runtime contract for Xingyue 2.9.0.

The remote runtime is only for UI and management-layer slimming. It must not become a hard dependency for gameplay, opening setup, MVU updates, Zod validation, or worldbook core entries.

## Keep In Card

These components stay bundled in the role card:

- Zod schema.
- Initial variables.
- MVU update rules and output format.
- MVU variable group metadata.
- The paged opening wizard main flow.
- World-factor, COT, and control-center policy worldbook entries.

## Remote Candidates

- `statusbar-renderer`: large status bar renderer and styles.
- `control-center-ui`: control center panel and workshop management UI.
- `media-library-ui`: optional media library management helpers.

## Migration Rule

The first migration step now publishes a fixed-version manifest plus placeholder official scripts. The role card should keep the bundled implementation until the loader is intentionally wired into the card and verified.

Published files:

- `manifest.json`
- `statusbar-renderer.js`
- `control-center-ui.js`
- `runtime-loader.example.js`

The example loader shows how to:

- load a fixed version URL,
- cache the last successful runtime,
- show a clear failure notice,
- preserve offline opening and MVU behavior,
- verify `sha256` before executing remote JavaScript.

GitHub hosts only official runtime files. Player workshop content stays as JSON packages and must never be executed as JavaScript.

The current runtime scripts are compatibility placeholders. They expose metadata on `window.XingyueRuntime` and dispatch `xingyue:runtime-ready`; they do not replace the bundled status bar or control center yet.
