# Milestone 2 — PostgreSQL Connection Pool Concurrency

**Scope:** load-testing `GET /products/:id` and `POST /orders` under increasing concurrency, instrumenting `pg.Pool` to observe connection-pool state directly, and investigating `idleTimeoutMillis` behavior. Builds on [M1](../M1/REPORT_M1.md), where the order-creation path (atomic stock decrement inside a transaction, `client.release()` in a `finally` block) was fixed and verified correct under a 20-concurrent-request race test.

**Objective recap:** M1 established that `POST /orders` is *correct* under concurrency (no overselling, no lost updates, no connection leak). M2 asks a different question: what happens to **latency and throughput** as concurrent load increases, and *why* — specifically, whether the Node `pg.Pool` itself becomes the bottleneck before Postgres row-locking does.

---

## Objective

Investigate PostgreSQL connection-pool behavior under concurrent order creation:

1. Establish a latency/throughput baseline for a simple read endpoint.
2. Measure how `POST /orders` throughput and latency change as client concurrency increases.
3. Instrument `pg.Pool` directly (`totalCount`, `idleCount`, `waitingCount`) to see *why* latency changes, rather than only observing the external symptom.
4. Understand what `idleTimeoutMillis` does to pooled connections between bursts of load.

## Environment / Setup

- **Database:** initial attempts were run against the Neon Postgres instance used in M1. Those results were dominated by remote database/network round-trip latency rather than by application or pool behavior, so we switched to a **locally running PostgreSQL instance in Docker** ([docker-compose.yml](../../docker-compose.yml)) and repeated the tests there to isolate connection-pool/concurrency behavior from network latency. `.env`'s `DATABASE_URL` was pointed at the local instance (`postgresql://postgres:password@localhost:5432/mydb`) for all M2 experiments.
- **Load-testing tool:** `autocannon`.
- **Pool configuration** ([src/db/client.ts](../../src/db/client.ts)):
  ```ts
  export const pool = new Pool({
      connectionString: env.DATABASE_URL,
      idleTimeoutMillis: 15000,
      connectionTimeoutMillis: 10000,
      max: 10
  });
  ```
- **Pool telemetry** ([src/server.ts](../../src/server.ts)) — polled every 500ms and logged for the duration of each test:
  ```ts
  setInterval(() => {
      console.log({
          totalCount: pool.totalCount,
          idleCount: pool.idleCount,
          waitingCount: pool.waitingCount
      });
  }, 500);
  ```

## Experiment 1 — Local PostgreSQL Baseline

Purpose: establish a latency/throughput floor for the application + local Postgres with a cheap, single-row read, before introducing the write path's transaction/lock overhead.

```
autocannon -c 10 -d 10 http://localhost:3000/products/1
```

**Observed:**

| Metric | Value |
|---|---|
| p50 | 5 ms |
| p97.5 | 17 ms |
| p99 | 28 ms |
| avg | 7.22 ms |
| throughput | ~1298 req/s |
| total requests | ~13k |

**Interpretation:** at `c=10` against a local database, a single indexed-PK read comfortably sustains ~1.3k req/s with single-digit-millisecond median latency. This is the reference point the `POST /orders` numbers in Experiment 2 are compared against — any degradation there is not explained by "the database is just slow."

## Experiment 2 — Concurrency vs Throughput

Purpose: measure how `POST /orders` behaves as client concurrency increases, holding everything else constant.

**Request body:**
```json
{"product_id":1,"qty":1}
```

**Command format:**
```
autocannon -c <connections> -d 10 -m POST \
  -H "Content-Type: application/json" \
  -b "{\"product_id\":1,\"qty\":1}" \
  http://localhost:3000/orders
```

**Results:**

| Concurrency (c) | p50 | p97.5 | p99 | avg | throughput | total requests |
|---|---|---|---|---|---|---|
| 5  | 16 ms | 145 ms | 550 ms  | 33.47 ms  | 147.6 req/s | ~1k |
| 10 | 32 ms | 153 ms | 202 ms  | 47.43 ms  | 208.4 req/s | ~2k |
| 20 | 82 ms | 314 ms | 2254 ms | 141.37 ms | 116.1 req/s | ~1k |

**Observed shape:**
- `c=5 → c=10`: throughput *increased*, 147.6 → 208.4 req/s — more concurrent requests, more work done per second, as expected while there's still headroom.
- `c=10 → c=20`: throughput *reversed*, 208.4 → 116.1 req/s, even though client concurrency doubled again.
- p50 roughly doubled, 32 ms → 82 ms.
- p99 increased by over 10x, 202 ms → 2254 ms.

**Interpretation:** this is not a simple proportional slowdown (more concurrent clients → linearly more queueing on a fixed-capacity resource, throughput flat or slightly down). Throughput going *down* in absolute terms while p99 blows up by more than an order of magnitude indicates a **concurrency/resource bottleneck** being hit somewhere between `c=10` and `c=20` — work is piling up faster than it's being drained. Experiment 3 instruments the pool directly to identify what that resource is.

## Experiment 3 — Pool Telemetry

Purpose: rather than infer the bottleneck from external latency/throughput numbers alone, observe the `pg.Pool`'s internal counters directly during the `c=20` run.

`pg.Pool` exposes three relevant counters:
- **`totalCount`** — total number of clients currently held by the pool (checked out + idle), up to `max`.
- **`idleCount`** — number of those clients that are currently idle (checked in, available to hand out immediately).
- **`waitingCount`** — number of callers currently blocked in `pool.connect()`, waiting for a client to become available because the pool is at `max` and none are idle.

**During `c=20`, repeatedly observed:**
```
totalCount: 10
idleCount: 0
waitingCount: 9-10
```

**Interpretation:** `totalCount` at `10` matches the configured `max: 10` — the pool has opened as many connections as it's allowed to and no more. `idleCount: 0` means every one of those 10 connections is checked out and in use at the moment of each sample. `waitingCount` in the 9-10 range means, at any given instant, roughly that many requests are not failing and not touching Postgres yet — they are queued inside the Node process waiting for one of the 10 connections to be released. This directly explains Experiment 2's `c=20` numbers: requests are not slow because Postgres is slow to execute them, they are slow because most of the wall-clock time is spent sitting in `pool.connect()`'s wait queue before a connection is even acquired.

**After the load stopped:**
```
totalCount: 10
idleCount: 10
waitingCount: 0
```

**Interpretation:** all 10 connections returned to idle and `waitingCount` dropped to 0 once the burst ended. This is the same conclusion M1's concurrency test supported from the outside (20 concurrent order requests all completed, none hung) — here it's confirmed from inside the pool: this is **queueing, not a connection leak**. A leak would show `totalCount` climbing past `max` or idle connections never returning after load stops; instead every checked-out client came back.

## Experiment 4 — `idleTimeoutMillis`

Purpose: understand what happens to the pool's idle connections during a quiet period, given `idleTimeoutMillis: 15000`.

**Sequence observed:**

1. Immediately after a burst ended: `totalCount: 10, idleCount: 10, waitingCount: 0` (same as the end of Experiment 3 — 10 connections open, all idle).
2. After an idle period longer than the configured 15000ms timeout: `totalCount: 0, idleCount: 0, waitingCount: 0`.
3. A subsequent burst of load caused new connections to be created. Telemetry showed the pool climbing back up, first: `totalCount: 5, idleCount: 0, waitingCount: 0`, and then, once that burst's requests finished: `totalCount: 5, idleCount: 5, waitingCount: 0`.

**Interpretation:** the 10 idle connections from the prior burst were closed by `pg.Pool` after sitting idle past `idleTimeoutMillis`, bringing the pool down to zero held connections. The next burst then had to establish new connections from scratch (`totalCount` climbing again, this time to 5, reflecting that burst's lower concurrency) rather than reusing anything left over from before.

**Important limitation:** the telemetry log captured pool state (`totalCount`/`idleCount`/`waitingCount`) for this sequence, but **no autocannon latency/throughput numbers were captured for the second burst**. We therefore know the pool had to re-establish connections for that burst, but we did **not** measure whether that burst was slower than one hitting a warm pool. That comparison was not run — see Limitations below.

## Findings

**Causal chain — concurrency vs pool saturation (Experiments 2 and 3):**
```
Higher concurrency
      ↓
pool reaches max=10
      ↓
idleCount → 0
      ↓
waitingCount increases
      ↓
requests queue for DB connections
      ↓
latency increases
      ↓
throughput can decrease
```
This chain is directly supported by the data: Experiment 2 observed the external symptom (throughput reversal, p99 spike at `c=20`), and Experiment 3 observed the internal cause at the same concurrency level (`totalCount` pinned at `max`, `idleCount: 0`, `waitingCount` in the 9-10 range).

**Causal chain — idle timeout (Experiment 4):**
```
burst
  ↓
connections become idle
  ↓
idleTimeoutMillis expires
  ↓
idle connections are closed
  ↓
later burst requires new connections
```

**Pool saturation is distinct from row-lock contention.** M1's concurrency test showed the stock-decrement `UPDATE ... WHERE stock_qty >= $1` correctly serializes concurrent writers at the Postgres row-lock level with no overselling. What M2 observed is a *different, earlier* bottleneck: requests can be stuck waiting for a `pg.Pool` client before they ever reach Postgres and touch that row lock at all. `waitingCount` counts callers blocked in `pool.connect()` — that queueing happens entirely in the Node process, independent of anything Postgres is doing with the `orders`/`products` tables.

**This was queueing, not a leak.** `totalCount` never exceeded the configured `max: 10`, and every checked-out client returned to idle once its request finished (`waitingCount: 0`, `idleCount` back to `totalCount` after each burst in both Experiment 3 and Experiment 4). This is consistent with M1's fix to `order.service.ts`'s `client.release()` call working correctly under load — the stock-decrement implementation releases its client in every code path, including on error/rollback.

## What We Learned

- A local Postgres baseline is necessary to isolate pool/concurrency effects from network latency — the original Neon-based attempts couldn't cleanly separate "the pool is saturated" from "the remote round-trip is slow," which is why the local Docker setup was adopted for these experiments.
- Throughput vs concurrency is not monotonic once a fixed-size resource (here, `pool.max`) is saturated: pushing more concurrent clients at a saturated pool doesn't just plateau throughput, it can *reduce* it while blowing up tail latency, because work queues up faster than the fixed number of connections can drain it.
- Watching an external symptom (autocannon's latency/throughput numbers) and watching the internal resource state (`pg.Pool` counters) told a consistent, corroborating story: the same `c=20` condition that produced the throughput reversal in Experiment 2 produced `idleCount: 0` / high `waitingCount` in Experiment 3.
- `idleTimeoutMillis` is not just a config knob — its effect (idle connections actually closing, `totalCount` dropping to 0) is directly observable in the pool telemetry, and the pool re-establishes connections on demand for the next burst.

## Limitations / What We Have Not Proven

- **No second-burst latency/throughput data.** Experiment 4 shows the pool had to re-create connections after the idle timeout, but we did not run autocannon against that second burst, so we cannot and do not claim it was measurably slower than a burst hitting a warm pool. That is a plausible follow-up experiment, not a result we have.
- **No isolation of connection-establishment cost specifically.** We observed *that* connections were re-created after the idle timeout; we did not measure the cost of establishing a single new connection in isolation (e.g., via a targeted single-connection timing test) against either the local or Neon database.
- **Neon vs local connection-establishment cost is a hypothesis, not a measurement.** Because Neon is a remote hosted database, it is reasonable to expect that connection establishment (and therefore effects like the idle-timeout-driven reconnect in Experiment 4) would be more consequential there than against a local Postgres instance. We have not run this experiment against Neon, so this is a hypothesis for future investigation, not a quantitative claim.
- **These results are single-run, single-machine numbers.** No repeated trials were done to check run-to-run variance; the figures in Experiments 1 and 2 should be read as representative of the observed behavior/shape, not as precise, reproducible-to-the-millisecond benchmarks.
- **`pool.max: 10` is one specific configuration.** We observed behavior at that setting; we have not measured how throughput/latency shift at other `max` values, so we cannot yet say where the "right" pool size is for this workload, only that `10` saturates under `c=20` concurrent order-creation requests locally.

## M2 Conclusion

Under concurrent `POST /orders` load, throughput does not scale indefinitely with client concurrency — it increased from `c=5` to `c=10`, then reversed from `c=10` to `c=20`, accompanied by a roughly 2x increase in p50 and an order-of-magnitude increase in p99. Instrumenting `pg.Pool` directly during the `c=20` condition confirmed the cause: the pool saturates at its configured `max: 10`, `idleCount` drops to 0, and further requests queue in `waitingCount` waiting for a connection rather than failing or leaking — confirmed by `totalCount`/`idleCount` returning cleanly to a fully-idle state once load stopped. This is a **Node/pg connection-pool resource limit**, distinct from and observed independently of the row-lock-level concurrency safety already established in M1 for the stock-decrement transaction. Separately, `idleTimeoutMillis: 15000` was confirmed to actually close idle pooled connections (`totalCount` reaching 0 after a sufficiently long idle period), with a subsequent burst re-establishing connections from scratch — though the performance cost of that reconnection was not measured in this milestone and remains an open question, particularly for a remote database like Neon where connection establishment is likely to matter more.
