# Fleebee Data Sync

One-shot, read-only Google Sheets importer for Fleebee accounting data.

## Run locally

Copy `.env.example` to `.env`, configure the private values, share the Sheet
with the service-account email as Viewer, then run:

```bash
npm test
npm run sync
```

Normal operator use is through `Data -> Dashboard` or `Data -> Payments` in
Fleebee. Both pages provide Refresh; scheduling is configured on the Dashboard.

See [ARCHITECTURE.md](./ARCHITECTURE.md), [PLAN.md](./PLAN.md), and
[PROGRESS.md](./PROGRESS.md).
