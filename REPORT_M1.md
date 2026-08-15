# Milestone 1 Report — Order API on Postgres

**Scope reviewed:** [src/app.ts](src/app.ts), [src/server.ts](src/server.ts), [src/db/client.ts](src/db/client.ts), [src/config/env.ts](src/config/env.ts), [src/models/schema.sql](src/models/schema.sql), [src/middlewares/error.middleware.ts](src/middlewares/error.middleware.ts), `src/modules/products/*`, `src/modules/orders/*`, [package.json](package.json), [tsconfig.json](tsconfig.json).

**Verdict:** The layering (routes → controller → service → repository) is the right shape and the concurrency-safe stock decrement is the right *idea*. But as committed, **the app does not run**: dependencies used by npm scripts aren't installed, the schema has a typo that breaks table creation, and `POST /orders` cannot ever succeed because of a parameter/column mismatch. On top of that, the one bug that matters most for the "connection pooling" learning goal — a client that's never released back to the pool — is present on the exact code path that currently always throws, meaning the pool would exhaust after ~10 requests even once the SQL bug is fixed. None of this is exotic; it reads like it was written top-to-bottom without ever hitting the endpoints against a real database.

> **Status as of the second pass (§7 below): fixed, migrated, and verified live against the project's Neon Postgres instance**, including a 20-concurrent-request race test against limited stock. Sections 1–6 below are kept as the original findings (what was wrong and why); §7 documents what was re-checked, what was fixed, and the evidence.

---

## 1. Critical bugs (app is non-functional)

### 1.1 `POST /orders` always fails — parameter/column mismatch
[src/modules/orders/order.repository.ts:26-33](src/modules/orders/order.repository.ts#L26-L33)
```ts
const result = await client.query(
    `
    INSERT INTO orders (product_id, quantity)
    VALUES ($1, $2)
    RETURNING *
    `,
    [productId, quantity, "confirmed"]
);
```
Two problems stacked on each other:
- The query lists 2 placeholders (`$1, $2`) but 3 values are bound. `pg` will throw `bind message supplies 3 parameters, but prepared statement "" requires 2`.
- Even if that were fixed, the column is named `quantity` here but the schema (once its own typo is fixed, see 1.2) defines it as **`qty`**. `getOrderById` in the same file correctly selects `qty` — so the file is internally inconsistent about its own column name.
- `status` is never inserted at all, and the schema has no `DEFAULT` for it (see 1.2), so the insert would violate the `NOT NULL`/`CHECK` constraint on `status` regardless.

**Every single order creation throws**, which cascades into 1.3.

### 1.2 `schema.sql` has a typo and never gets applied anywhere
[src/models/schema.sql:11](src/models/schema.sql#L11)
```sql
product_id INT NOT NULL REFRENCES products(id),
```
`REFRENCES` → `REFERENCES`. Running this file as-is fails with a syntax error, so the `orders` table can't even be created.

Separately: nothing in the repo runs this file. There's no migration script, no `npm run migrate`, no reference to `schema.sql` anywhere (`grep` across the repo turns up nothing). If a grader pulls this repo and runs `npm run dev`, there is no database to talk to — they'd have to hand-apply the (broken) SQL themselves. For an assignment centered on "the schema decisions here will bite you later," the schema needs to actually be part of the reproducible setup (see §5.1).

Also missing from the schema: `status` has no `DEFAULT 'pending'`, so *every* insert must specify it explicitly or the `NOT NULL` constraint fires — easy to forget, and 1.1 shows it already was forgotten.

### 1.3 `client.release` is never called — pool exhausts under load
[src/modules/orders/order.service.ts:42](src/modules/orders/order.service.ts#L42)
```ts
} finally {
    client.release;   // <-- not called, just referenced
}
```
This is a property reference, not a function call — it's a no-op. Every call to `createOrder` checks out a client from the pool and never gives it back. `getOrderById` in the same file does this correctly (`client.release()`), which makes the omission here look like a copy/paste slip rather than a deliberate choice.

Given `pg.Pool` defaults to `max: 10`, and given that (per 1.1) **every** `POST /orders` currently throws and hits this `finally` block, the pool is fully exhausted after **10 requests** — the 11th call to `pool.connect()` anywhere in the app (orders *or* products) blocks forever waiting for a client that's never coming back. This turns one missing pair of parens into a total outage, and it's exactly the kind of bug the milestone is designed to surface — worth understanding well before Stage 5+ adds concurrent load.

### 1.4 `GET /orders/:id` is wired up as `POST`
[src/modules/orders/order.routes.ts:7](src/modules/orders/order.routes.ts#L7)
```ts
router.post('/:id', getOrderById);
```
The spec asks for `GET /orders/:id`. As written, `GET /orders/1` 404s (Express has no matching route), and the id lookup is only reachable via `POST /orders/1`. This is the kind of thing that's invisible in code review-by-reading but immediate the moment someone curls the endpoint.

### 1.5 The dev/build tooling isn't installed
[package.json:9-12](package.json#L9-L12):
```json
"start": "node --loader ts-node/esm src/server.ts",
"dev": "nodemon --exec tsx src/server.ts",
"typecheck": "tsc --noEmit",
"build": "tsc"
```
`typescript`, `ts-node`, and `tsx` are referenced by scripts but **none of them are in `dependencies`/`devDependencies`**, and none are present in `node_modules`. Right now:
- `npm run dev` → `tsx: command not found`
- `npm start` → `ts-node/esm` loader not found
- `npm run typecheck` / `npm run build` → no `tsc` available

Confirmed by running `npx tsc --noEmit` in this repo — npm doesn't find a local TypeScript and falls back to fetching an unrelated, unmaintained `tsc` npm package instead. There's currently no way to run this project without first manually installing packages that should be declared.

---

## 2. Correctness / design issues

### 2.1 Zod schemas are defined but never used for validation
Both [product.types.ts](src/modules/products/product.types.ts) and [order.types.ts](src/modules/orders/order.types.ts) define proper `zod` schemas (`createProductSchema`, `createOrderSchema`) — but neither controller calls `.parse()`/`.safeParse()` on them. [product.controller.ts:10](src/modules/products/product.controller.ts#L10) and [order.controller.ts:10](src/modules/orders/order.controller.ts#L10) hand `req.body` straight to the service layer untyped and unchecked.

Instead, `product.service.ts` re-implements a subset of the validation by hand (name/price/stock_qty only — `description` isn't checked at all, and isn't optional in the DB). This means:
- A missing/malformed field that isn't manually checked (e.g. `price: "10"` as a string, or a missing `description`) sails through to the SQL layer and fails there, if at all, with a confusing driver-level error instead of a clean 400.
- The validation logic exists in two places (zod schema + hand-rolled `if`s) that can drift apart, which is exactly what happened here.

**Fix:** actually use the zod schemas — a small `validateBody(schema)` middleware, or `schema.parse(req.body)` at the top of the service, and delete the manual checks.

### 2.2 Every error becomes HTTP 500
[error.middleware.ts:13](src/middlewares/error.middleware.ts#L13) always responds `res.status(500)`, no matter what threw. Combined with services throwing plain `Error` for validation failures, "not found," and "out of stock," the API currently returns 500 for:
- Missing/invalid `product_id` or `qty` on order creation (should be **400**)
- Insufficient stock or a product that doesn't exist (should be **409 Conflict** / **404**)
- A negative price or empty name on product creation (should be **400**)

On top of that, [product.controller.ts:35](src/modules/products/product.controller.ts#L35) and [order.controller.ts:36](src/modules/orders/order.controller.ts#L36) both manually return **400** for "not found," which should be **404**.

Net effect: a client of this API cannot distinguish "you sent bad input," "that resource doesn't exist," and "the server broke" — they're all either 400 or 500, assigned inconsistently. This will matter a lot once retries/circuit breakers show up in later stages, since retry logic needs to know which errors are retryable.

**Fix:** a small `AppError` class hierarchy (`BadRequestError`, `NotFoundError`, `ConflictError`, each carrying a `statusCode`), thrown from services, and an error middleware that reads `error.statusCode` before falling back to 500. See §6 for a sketch.

### 2.3 "Insufficient stock" and "product not found" are conflated
[order.service.ts:25-27](src/modules/orders/order.service.ts#L25-L27):
```ts
if (!product) {
    throw new Error("Insufficient stock or product not found");
}
```
`decrementStock`'s `WHERE id = $2 AND stock_qty >= $1` returns no row both when the product doesn't exist *and* when it exists but doesn't have enough stock. These are different failure modes for the caller (404 vs 409) and currently can't be told apart from the response. If you care about the distinction (you likely will, e.g. for client-facing messaging), do a cheap existence check first, or a plain `SELECT` inside the same transaction before the conditional `UPDATE`.

### 2.4 `pool.connect()` at startup leaks a connection
[server.ts:9](src/server.ts#L9):
```ts
await pool.connect();
```
This checks out a client to verify DB connectivity at boot but never releases it — that connection sits idle-but-checked-out for the process lifetime, permanently shrinking the effective pool size by one. Use `pool.query('SELECT 1')` (auto-releases) instead, or explicitly `client.release()`.

### 2.5 `NUMERIC` columns come back as strings from `pg`
`price` is typed `number` in [product.types.ts:7](src/modules/products/product.types.ts#L7), but `node-postgres` returns Postgres `NUMERIC`/`DECIMAL` columns as **strings** by default (to avoid silent float precision loss). Every `price` read back from `productRepository.getProductById`/`createProduct` is actually a `string` at runtime while TypeScript claims `number` — not exercised yet since nothing does arithmetic on a fetched price, but it will produce a real bug (`"12.00" + "5.00" === "12.005.00"`-style errors, or silently-wrong comparisons) the moment something does. Either cast explicitly at the repository boundary, or register a custom type parser for OID 1700 (`NUMERIC`) once, globally, in `db/client.ts`.

### 2.6 No indexes beyond primary keys
The assignment explicitly calls out "basic indexing" as a concept to touch, and currently only the implicit PK indexes exist. `orders.product_id` is a foreign key that will be filtered/joined on ("all orders for a product," stock reconciliation, etc.) — Postgres does **not** automatically index FK columns, so this needs an explicit index. `orders.status` (and probably `(status, created_at)`) will matter as soon as any later stage needs to scan for pending/processing orders. See the corrected schema in §5.1.

---

## 3. What's actually right here

Worth calling out explicitly, since it's the one thing this milestone is most about — the stock-decrement strategy is correct:

[order.repository.ts:8-16](src/modules/orders/order.repository.ts#L8-L16):
```sql
UPDATE products
SET stock_qty = stock_qty - $1
WHERE id = $2 AND stock_qty >= $1
RETURNING id, name, description, price, stock_qty
```
Doing the check-and-decrement as a **single conditional `UPDATE`** is the right pattern for "guarantee this is safe if two requests hit at once." Postgres takes a row-level lock during the `UPDATE` and re-evaluates the `WHERE` clause against the committed row, so two concurrent transactions both trying to decrement the last unit of stock will serialize on that row — one wins, one gets zero rows back — with no lost updates, and no need for an explicit `SELECT ... FOR UPDATE` or app-level locking. This holds at the default `READ COMMITTED` isolation level, which is what `pg.Pool` uses unless told otherwise.

Wrapping it in `BEGIN`/`COMMIT` with the order insert (§1.1 bugs aside) is also correct: it's what makes "decrement stock" and "record the order" atomic as a unit — if the insert fails after the decrement succeeds, the rollback puts the stock back. Once §1.1–1.3 are fixed, this transaction shape doesn't need to change.

The layering (routes/controllers/services/repositories) is a reasonable default and should scale fine into later milestones as long as validation actually happens at the boundary (§2.1) and errors carry real status codes (§2.2).

---

## 4. Minor / style

- `Number(req.params.id)` is preceded by `await` in both controllers ([product.controller.ts:23](src/modules/products/product.controller.ts#L23), [order.controller.ts:24](src/modules/orders/order.controller.ts#L24)) — `Number()` isn't async; harmless but a tell that this wasn't tested closely.
- Express 5 auto-forwards rejected promises to the error middleware, so the `try { … } catch (error) { next(error) }` wrapper in every controller is redundant (not wrong, just unnecessary boilerplate you can drop).
- `.env` in the repo currently points at a live Neon connection string with real credentials. It's correctly excluded via [.gitignore](.gitignore), so it isn't committed — just flagging so it doesn't end up in a screen-share or a zip export. Also worth noting for later stages: the Neon host is a `-pooler` endpoint (PgBouncer, transaction-pooling mode). The app's `BEGIN…COMMIT` pattern works fine against it today because it holds one `pg.Pool` client for the duration, but avoid session-level features (server-side prepared statements across calls, `SET` outside a transaction) later — they don't survive transaction-mode pooling.
- No graceful shutdown (`SIGTERM` → `pool.end()` + `server.close()`) — not required for M1, but cheap to add and saves noise in later load-testing stages.

---

## 5. Better alternative approaches

### 5.1 Make the schema part of a reproducible setup
Right now `schema.sql` is a file that nothing runs. For a project where "the schema decisions here will bite you later," it should be:
1. Fixed (typo, default status, indexes), and
2. Actually wired into setup — either a `docker-compose.yml` with a `postgres` service plus an init script (`docker-entrypoint-initdb.d`), or a one-line `npm run migrate` using something like `node-pg-migrate` (still not an ORM, just a runner — consistent with "use `pg` directly, no ORM yet").

Corrected schema:
```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    stock_qty INT NOT NULL CHECK (stock_qty >= 0)
);

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    product_id INT NOT NULL REFERENCES products(id),
    qty INT NOT NULL CHECK (qty > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_product_id ON orders(product_id);
CREATE INDEX idx_orders_status_created_at ON orders(status, created_at);
```
(`TIMESTAMPTZ` over `TIMESTAMP` — store instants, not wall-clock-without-zone; matters the moment this runs anywhere but one machine in one timezone. Also note `'confirmed'` was the status value the code actually tried to insert, but the original `CHECK` only allowed `'pending' | 'completed' | 'cancelled'` — another symptom of §1.1 never having been run against the real constraint.)

### 5.2 Typed error hierarchy instead of blanket 500
```ts
// src/errors.ts
export class AppError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}
export class BadRequestError extends AppError {
  constructor(message: string) { super(message, 400); }
}
export class NotFoundError extends AppError {
  constructor(message: string) { super(message, 404); }
}
export class ConflictError extends AppError {
  constructor(message: string) { super(message, 409); }
}
```
```ts
// error.middleware.ts
export function errorMiddleware(error: unknown, _req, res, _next) {
  console.error(error);
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  res.status(500).json({ message: "Internal Server Error" });
}
```
Then `order.service.ts` throws `new NotFoundError("Product not found")` / `new ConflictError("Insufficient stock")` / `new BadRequestError("qty must be greater than zero")` as appropriate, and the zod `.parse()` failures (§2.1) get caught and rethrown as `BadRequestError` with the zod issue list attached.

### 5.3 Validation at the edge, not scattered across services
```ts
// middlewares/validate.ts
export const validateBody = (schema: ZodSchema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) return next(new BadRequestError(result.error.message));
  req.body = result.data;
  next();
};
```
```ts
router.post('/', validateBody(createOrderSchema), createOrder);
```
This removes the need for `product.service.ts`/`order.service.ts` to hand-check types at all — the schemas already defined in `*.types.ts` become the single source of truth instead of dead code.

### 5.4 On the concurrency approach specifically (confirming, not changing, the design)
Two alternatives were available and it's worth stating explicitly why the current one beats them, since this decision compounds in later stages:
- **`SELECT ... FOR UPDATE` then app-level check-and-`UPDATE`** — works, but takes an explicit row lock for an extra round trip with no benefit over the single conditional `UPDATE` already in place; more code, same guarantee.
- **`SERIALIZABLE` isolation with retry-on-conflict** — the "correct in general" answer for arbitrary read-then-write logic, but is overkill for a single-row conditional decrement and adds retry-loop complexity for no extra safety here.

The single atomic `UPDATE ... WHERE stock_qty >= $1` already in the code is the leanest correct option for this exact operation — keep it. Where this *will* need to evolve in Stage 5+ is if "reserve stock" and "confirm order" become separate steps (e.g. a checkout flow with a payment step in between) — at that point you need either a short-lived reservation row with an expiry, or a saga/outbox pattern, because a single `UPDATE` can't hold a reservation open across an external call. Not a concern for M1, but the schema choice of a flat `orders.status` enum instead of a separate reservations concept is the thing to revisit first when that happens.

---

## 6. Priority fix checklist

1. Fix `INSERT INTO orders` column list + bound params + `status` value ([order.repository.ts:26-33](src/modules/orders/order.repository.ts#L26-L33)) — nothing works until this is fixed.
2. Fix `REFRENCES` typo and add `DEFAULT 'pending'` + indexes to `schema.sql`, and actually wire it into setup (docker-compose init script or a migration script).
3. Fix `client.release;` → `client.release();` in [order.service.ts:42](src/modules/orders/order.service.ts#L42).
4. Fix `router.post('/:id', getOrderById)` → `router.get(...)` in [order.routes.ts:7](src/modules/orders/order.routes.ts#L7).
5. Add `typescript`, `tsx`/`ts-node` to `devDependencies` so the existing npm scripts actually run.
6. Wire `createProductSchema`/`createOrderSchema` into the request path (§5.3) and delete the hand-rolled checks in the services.
7. Introduce `AppError` subclasses and stop returning 500 for validation/not-found/conflict cases (§5.2); fix the two 400s that should be 404s.
8. Fix the startup connection leak in [server.ts:9](src/server.ts#L9).
9. Decide on and apply a fix for the `NUMERIC` string-vs-number mismatch (§2.5) before anything does arithmetic on a fetched price.

Once 1–4 are done, the API is functionally correct for the spec. 5–9 are what keep it correct and debuggable once this stops being the only code touching the database.

---

## 7. Re-analysis pass — what changed, what was fixed, and verification

This section covers a second pass: re-reading the codebase against the findings above, then actually applying and verifying fixes rather than leaving them as recommendations.

### 7.1 What had already changed independently
Between the first review and this pass, a few items from §1/§6 were already addressed in the working tree (not by this pass): `tsx` and `node-pg-migrate` were added to `devDependencies`; [order.service.ts](src/modules/orders/order.service.ts)'s `client.release;` → `client.release();` was corrected; [order.routes.ts](src/modules/orders/order.routes.ts)'s id-lookup route was already `router.get(...)`; [order.repository.ts](src/modules/orders/order.repository.ts)'s parameter naming was already aligned to `qty`; and `schema.sql` already had `REFERENCES` spelled correctly with a `DEFAULT 'pending'` status. Good progress — but the INSERT itself (§1.1) was still broken: `INSERT INTO orders (product_id, qty)` with 2 placeholders bound against 3 values, so `POST /orders` still threw on every call. That's the one this pass fixed first.

### 7.2 Fixes applied this pass

| # | Fix | Where |
|---|---|---|
| 1 | Corrected the `orders` INSERT to list `product_id, qty, status` with 3 placeholders, matching the 3 bound values (`"confirmed"` on success, since stock is decremented atomically in the same transaction — there's no separate async fulfillment step yet) | [order.repository.ts](src/modules/orders/order.repository.ts) |
| 2 | Added a real migration (`migrations/1786800243488_init.sql`, run via `npm run migrate:up` / `migrate:down` using `node-pg-migrate`, which was already installed but unused) so the schema is applied reproducibly instead of existing only as an unreferenced `.sql` file. Added indexes on `orders.product_id` (FK, not auto-indexed by Postgres) and `orders(status, created_at)` (future order-scanning queries). `schema.sql` is kept as a synced human-readable reference, now with `TIMESTAMPTZ` instead of `TIMESTAMP` | [migrations/](migrations/), [schema.sql](src/models/schema.sql) |
| 3 | Added `docker-compose.yml` for a local Postgres, matching `.env.example`'s `postgresql://postgres:password@localhost:5432/mydb` — the assignment offered this and nothing existed yet | [docker-compose.yml](docker-compose.yml) |
| 4 | Added an `AppError`/`BadRequestError`/`NotFoundError`/`ConflictError` hierarchy and rewired the error middleware to use `error.statusCode` instead of hardcoding 500 for everything; unexpected (non-`AppError`) errors are still logged in full server-side but no longer echo internal messages back to the client | [errors.ts](src/errors.ts), [error.middleware.ts](src/middlewares/error.middleware.ts) |
| 5 | Wired the existing-but-unused `createProductSchema`/`createOrderSchema` zod schemas into a `validateBody` middleware applied at the route level; deleted the hand-rolled, incomplete duplicate checks from both services | [validate.middleware.ts](src/middlewares/validate.middleware.ts), [product.routes.ts](src/modules/products/product.routes.ts), [order.routes.ts](src/modules/orders/order.routes.ts), [product.service.ts](src/modules/products/product.service.ts), [order.service.ts](src/modules/orders/order.service.ts) |
| 6 | Split "insufficient stock" from "product not found" into `ConflictError` (409) vs `NotFoundError` (404) via a cheap existence check inside the same transaction, instead of one ambiguous message; fixed both `getProductById`/`getOrderById` not-found paths to return 404 instead of 400 | [order.service.ts](src/modules/orders/order.service.ts), [order.controller.ts](src/modules/orders/order.controller.ts), [product.controller.ts](src/modules/products/product.controller.ts) |
| 7 | Registered a type parser for OID 1700 (`NUMERIC`) so `price` comes back as a JS `number`, matching its TS type, instead of the string `pg` returns by default | [db/client.ts](src/db/client.ts) |
| 8 | Fixed the startup connection leak (`pool.connect()` → `pool.query('SELECT 1')`, which auto-releases) and added `SIGTERM`/`SIGINT` handling to close the pool and HTTP server on shutdown | [server.ts](src/server.ts) |
| 9 | Added `typescript` to `devDependencies` (referenced by `typecheck`/`build` but never installed) and changed `start` to run the compiled `dist/server.js` instead of a `ts-node/esm` loader that also was never installed | [package.json](package.json) |
| 10 | Added explicit `.js` extensions to every relative import across the codebase. This one wasn't in the original report because `tsc` wasn't installed yet to surface it: with `"moduleResolution": "NodeNext"` (already in `tsconfig.json`), TypeScript requires extensioned specifiers on relative ESM imports — every single relative import in the project was missing this, so `tsc --noEmit`/`tsc` failed on ~25 errors the moment `typescript` was actually installed. `tsx` (used for `dev`) resolves extensionless imports anyway via esbuild, which is almost certainly why this went unnoticed — the dev loop "worked" while the production build path was silently broken | all `src/**/*.ts` |

### 7.3 Verification (live, against the project's actual Neon Postgres instance)

Ran `npm run migrate:up`, confirmed via direct query that both tables now have the corrected columns/defaults/indexes, then built (`npm run build`) and booted `dist/server.js` against the real `DATABASE_URL`, and exercised it with `curl`:

- `POST /products` → `201`, `GET /products/:id` → `200`; nonexistent id → `404`; non-numeric id → `400`; missing `name` in body → `400` with the zod issue list attached (previously this would have hit the DB and failed there, or silently inserted `undefined`).
- `POST /orders` for 3 units against a product with 5 in stock → `201`, `status: "confirmed"`; `GET /orders/:id` → `200`; stock correctly read back as `2` afterward.
- Over-ordering (100 units against 2 remaining) → `409` (previously this — and every order — threw a raw 500 from the broken INSERT).
- Ordering against a nonexistent `product_id` → `404`, distinct from the `409` above (previously both were the same blended 500 message).
- Malformed order body (`qty: 0`) → `400` with the zod issue list.
- **Concurrency**: created a product with `stock_qty: 10` and fired 20 concurrent `POST /orders` requests (1 unit each) at it. Result: **exactly 10 succeeded (`201`), exactly 10 got `409`**, final stock landed at exactly `0` — no overselling, no lost updates, confirming the atomic conditional-`UPDATE` design in §3 holds under real concurrent load. All 20 requests completed normally with no hang, confirming the pool-exhaustion bug (§1.3, already fixed in the working tree by the time of this pass) is actually gone in practice, not just in a code read — 20 concurrent requests against a pool with a default `max` of 10 would previously have deadlocked past the 10th if any single one of them threw past the `finally`.

Test data created during verification was cleaned up afterward (`DELETE FROM orders; DELETE FROM products;`, sequences reset) — the DB was left as it was found, aside from the schema now existing via the migration.

`npm run typecheck` and `npm run build` both pass cleanly with no errors as of this pass.
