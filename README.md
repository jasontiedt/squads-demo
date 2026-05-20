# Echoes of Emperors

A virtual boardgame. Web client deployed to GitHub Pages, multiplayer API on Cloudflare Workers.

## Stack

TypeScript · React + Vite · Zustand · Cloudflare Workers + KV · Zod · Vitest · pnpm workspaces.

## Quickstart

```bash
pnpm install

# in two terminals:
pnpm -F @eoe/web dev      # http://localhost:5173
pnpm -F @eoe/worker dev   # http://localhost:8787
```

Run all tests:

```bash
pnpm test
```

## Repo layout

| Path                    | What                                             |
| ----------------------- | ------------------------------------------------ |
| `apps/web`              | React + Vite client (deploys to GitHub Pages)    |
| `apps/worker`           | Cloudflare Worker API (game state in Workers KV) |
| `packages/schema`       | Zod schemas — single source of truth for types   |
| `packages/rules`        | Pure rules engine (`applyAction`), shared        |
| `packages/assets-meta`  | Hand-curated card metadata (Sabine ingests)      |
| `docs/`                 | Architecture pointer                             |
| `.squad/`               | Squad memory: roster, decisions, agent history   |

The squad config and decision ledger live under [`.squad/`](.squad/). See [`docs/architecture.md`](docs/architecture.md) for the architecture entry point.

## License

TBD.
