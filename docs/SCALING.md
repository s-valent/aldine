# Scaling Papyr

Papyr is built to run two ways from one codebase:

- **Solo / self-host** — one box, `docker compose up`, flat-JSON datastore. The
  default, and the thing you give a colleague to run tonight.
- **Cloud / multi-tenant** — horizontally scalable, Postgres-backed.

The two share all product code (editor, Yjs collaboration, git versioning, the
TeX Live compile pipeline, plugins). Only the **persistence and topology glue**
differs, and it sits behind interfaces so moving between them is configuration
and infrastructure, not a rewrite.

## What's where

| Concern | Storage | Seam |
|---|---|---|
| Project files, branches, history | git repos + worktrees on disk | `store.ts` |
| Users, sessions, reset tokens | DataStore | `db/` (`JsonStore` \| `PgStore`) |
| Project metadata, sharing | DataStore | `db/` |
| Review comments | DataStore | `db/` |
| Compile-minutes usage (metering) | DataStore | `db/` |
| Rate-limit / quota counters | in-memory (per process) | `ratelimit.ts` |
| Live collaboration state (Yjs CRDT) | in-process (Hocuspocus) | `collab.ts` |

Switch the datastore with one env var:

```bash
DATABASE_URL=postgres://…    # unset = JSON files
```

## The scaling walls (in the order they bite)

The single-box default tops out at "vertical scale." Past that, four structural
limits appear. They're at the persistence/topology layer — the product core is
unaffected.

1. **Flat-JSON stores + in-memory rate/quota state** — per-process, so two app
   nodes can't share them. *Blocks running more than one app node.*
   → **Done:** Postgres backend for the datastore (`DATABASE_URL`). Still TODO:
   move rate-limit/quota/session counters to Redis so limits coordinate across
   nodes.
2. **Single-process Hocuspocus** — each Yjs document's CRDT state lives in one
   process's memory; you can't just add replicas. → split collab into its own
   service with a Redis pub/sub sync backend + sticky routing, and persist docs
   to a store. The service boundary is drawn; extraction is a deploy change.
3. **One shared compiler on one volume** — compiles are the cost driver. → a job
   queue + a fleet of stateless workers, autoscaled, with **per-compile
   isolation** (ephemeral containers / gVisor / Firecracker) for true
   multi-tenancy. The metering hook (`usage.ts`) and concurrency gate already
   anticipate this.
4. **Git-repos-on-local-disk** — the deepest coupling and the one most in
   tension with a stateless tier. → back git with object storage (S3/R2) and
   treat local disk as a cache, or use networked storage.

## Principle

Don't build the 10k-user architecture before the users exist. Do keep the seams
(datastore, rate/session store, collab-service boundary, compile dispatcher) so
each wall becomes "swap the implementation + add the infra" exactly when load
justifies it. The datastore seam (wall 1) is done; the rest are scoped, not
built.

## Cost & hosting

Compiles (CPU/RAM bursts) dominate cost, so cheap dedicated compute (a Hetzner
CCX-class box, EU for data residency) beats hyperscalers on margin. Meter
compile-minutes (`PAPYR_COMPILE_QUOTA_MIN`, read `/api/usage`) and tier plans on
them rather than seats. See [../deploy/README.md](../deploy/README.md) for the
single-VPS runbook.
