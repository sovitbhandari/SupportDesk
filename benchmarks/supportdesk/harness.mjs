#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";

const mode = process.argv[2] ?? "help";
const args = parseArgs(process.argv.slice(3));
const root = process.cwd();
const runId = args["run-id"] ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${mode}`;
const artifactDir = path.join(root, "docs", "evidence", "benchmarks", runId);
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:55432/supportdesk";
const apiBase = process.env.BENCH_API_BASE_URL ?? "http://localhost:4000";
const password = "BenchPass123!";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (!current.startsWith("--")) continue;
    const key = current.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = "true";
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function intArg(name, fallback) {
  const parsed = Number(args[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function listArg(name, fallback) {
  return String(args[name] ?? fallback)
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isInteger(v) && v > 0);
}

function shell(cmd, cmdArgs) {
  const result = spawnSync(cmd, cmdArgs, { cwd: root, encoding: "utf8" });
  return {
    command: [cmd, ...cmdArgs].join(" "),
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function describeError(error) {
  if (!error) return "Unknown error";
  const causes = error.errors
    ?.map((cause) => ({
      name: cause?.name,
      message: cause?.message,
      code: cause?.code,
      address: cause?.address,
      port: cause?.port
    }))
    .filter((cause) => cause.message || cause.code);
  return JSON.stringify({
    name: error.name,
    message: error.message || null,
    code: error.code || null,
    causes: causes?.length ? causes : undefined
  });
}

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return Number(sorted[idx].toFixed(2));
}

function summarizeSamples(samples) {
  const overall = summarizeFlat(samples);
  const byEndpoint = {};
  for (const sample of samples) {
    const key = sample.endpoint ?? "unknown";
    byEndpoint[key] ??= [];
    byEndpoint[key].push(sample);
  }
  return {
    ...overall,
    endpoints: Object.fromEntries(
      Object.entries(byEndpoint).map(([endpoint, endpointSamples]) => [
        endpoint,
        summarizeFlat(endpointSamples)
      ])
    )
  };
}

function summarizeFlat(samples) {
  const latencies = samples.filter((s) => s.ok).map((s) => s.ms);
  return {
    count: samples.length,
    ok: samples.filter((s) => s.ok).length,
    errors: samples.filter((s) => !s.ok).length,
    p50: quantile(latencies, 0.5),
    p95: quantile(latencies, 0.95),
    p99: quantile(latencies, 0.99)
  };
}

async function ensureArtifactDir() {
  await fs.mkdir(artifactDir, { recursive: true });
}

async function writeJson(name, value) {
  await fs.writeFile(path.join(artifactDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function appendJsonl(name, value) {
  await fs.appendFile(path.join(artifactDir, name), `${JSON.stringify(value)}\n`);
}

async function metadata(extra = {}) {
  const commit = shell("git", ["rev-parse", "HEAD"]);
  const diff = shell("git", ["diff", "--stat", "--", ".", ":(exclude)node_modules", ":(exclude)apps/frontend/dist"]);
  const node = shell("node", ["--version"]);
  const npm = shell("npm", ["--version"]);
  const docker = shell("docker", ["version", "--format", "{{.Server.Version}}"]);
  return {
    date: new Date().toISOString(),
    runId,
    mode,
    exploratory: args.final === "true" ? false : true,
    commit_sha: commit.stdout || null,
    code_changes: diff.stdout,
    versions: {
      node: node.stdout,
      npm: npm.stdout,
      dockerServer: docker.status === 0 ? docker.stdout : null
    },
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().map((cpu) => cpu.model),
      totalMemoryBytes: os.totalmem()
    },
    placement: {
      app: process.env.BENCH_APP_PLACEMENT ?? "local",
      generator: "local-node-process",
      apiBase
    },
    dockerResourceLimits: {
      source: "not detected by harness; record Docker Desktop limits manually if applicable"
    },
    schemaIndexes: {
      source: "mode-specific; see migration files and any run-created benchmark indexes"
    },
    dataset: {
      synthetic: true,
      seed: args.seed ? Number(args.seed) : null
    },
    workload: mode,
    commands: {
      invoked: ["node", "benchmarks/supportdesk/harness.mjs", mode, ...process.argv.slice(3)].join(" ")
    },
    durations: {},
    seed: args.seed ? Number(args.seed) : null,
    repetitions: args.repetitions ? Number(args.repetitions) : null,
    exclusions: [],
    rawArtifactPaths: [],
    errors: [],
    ...extra
  };
}

async function withPool(fn) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function fetchMetrics(label) {
  try {
    const response = await fetch(`${apiBase}/metrics`);
    const payload = await response.json();
    await writeJson(`server-metrics-${label}.json`, payload);
    return { status: response.status, path: `server-metrics-${label}.json` };
  } catch (error) {
    return { error: error.message };
  }
}

async function seedSynthetic() {
  const tickets = intArg("tickets", 10000);
  const orgs = intArg("orgs", 5);
  const seed = intArg("seed", 4242);
  const started = performance.now();
  await ensureArtifactDir();
  const meta = await metadata({
    dataset: { synthetic: true, tickets, orgs, seed, accounts: "bench-admin/agent/customer per org" },
    workload: "deterministic synthetic ticket seed"
  });

  try {
    await withPool(async (pool) => {
      await pool.query("BEGIN");
      await pool.query(`
        INSERT INTO roles(key, description)
        VALUES
          ('customer', 'Customer end-user role'),
          ('agent', 'Support agent role'),
          ('admin', 'Organization administrator role')
        ON CONFLICT (key) DO NOTHING
      `);
      await pool.query(
        `
        WITH org_input AS (
          SELECT generate_series(1, $1::int) AS n
        ),
        inserted_orgs AS (
          INSERT INTO organizations(name, slug)
          SELECT 'Bench Org ' || n || ' Seed ' || $2, 'bench-' || $2 || '-' || n
          FROM org_input
          ON CONFLICT (slug) DO UPDATE SET updated_at = now()
          RETURNING id, slug
        ),
        bench_users AS (
          SELECT io.id AS organization_id, io.slug, role_key
          FROM inserted_orgs io
          CROSS JOIN (VALUES ('admin'), ('agent'), ('customer')) AS roles(role_key)
        ),
        inserted_users AS (
          INSERT INTO users(organization_id, email, full_name, password_hash)
          SELECT
            organization_id,
            role_key || '@' || slug || '.synthetic.local',
            'Synthetic ' || role_key || ' ' || slug,
            crypt($3, gen_salt('bf', 10))
          FROM bench_users
          ON CONFLICT (email) DO UPDATE SET updated_at = now()
          RETURNING id, organization_id, email
        )
        INSERT INTO organization_memberships(organization_id, user_id, role_id)
        SELECT iu.organization_id, iu.id, r.id
        FROM inserted_users iu
        JOIN roles r ON r.key = split_part(iu.email, '@', 1)
        ON CONFLICT (organization_id, user_id) DO NOTHING
        `,
        [orgs, seed, password]
      );
      await pool.query(
        `
        WITH bench_orgs AS (
          SELECT id, row_number() OVER (ORDER BY slug) AS org_rank
          FROM organizations
          WHERE slug LIKE 'bench-' || $2::text || '-%'
        ),
        customers AS (
          SELECT u.id, u.organization_id, bo.org_rank
          FROM users u
          JOIN bench_orgs bo ON bo.id = u.organization_id
          WHERE u.email LIKE 'customer@bench-' || $2::text || '-%'
        ),
        generated AS (
          SELECT
            gs AS n,
            ((gs - 1) % $1::int) + 1 AS org_rank
          FROM generate_series(1, $3::int) gs
        )
        INSERT INTO tickets(organization_id, requester_id, subject, description, status, priority, created_at, updated_at)
        SELECT
          c.organization_id,
          c.id,
          'Synthetic ticket ' || g.n || ' seed ' || $2,
          'Synthetic benchmark ticket; not a real user record.',
          (ARRAY['open','pending','resolved','closed'])[((g.n + $2::int) % 4) + 1]::ticket_status,
          (ARRAY['low','medium','high','urgent'])[((g.n + $2::int) % 4) + 1]::ticket_priority,
          now() - ((g.n % 100000) || ' seconds')::interval,
          now() - ((g.n % 100000) || ' seconds')::interval
        FROM generated g
        JOIN customers c ON c.org_rank = g.org_rank
        WHERE NOT EXISTS (
          SELECT 1 FROM tickets t WHERE t.subject = 'Synthetic ticket ' || g.n || ' seed ' || $2
        )
        `,
        [orgs, seed, tickets]
      );
      await pool.query("COMMIT");
    });
    meta.outputs = [`Seeded ${tickets} synthetic tickets across ${orgs} organizations.`];
  } catch (error) {
    meta.errors.push(describeError(error));
    throw error;
  } finally {
    meta.durations = { seconds: Number(((performance.now() - started) / 1000).toFixed(2)) };
    await writeJson("metadata.json", meta);
  }
}

async function queryExperiment() {
  const variant = args.variant ?? "candidate";
  const limit = intArg("limit", 50);
  const repetitions = intArg("repetitions", 30);
  const seed = intArg("seed", 4242);
  await ensureArtifactDir();
  const meta = await metadata({
    dataset: { synthetic: true, expectedSeed: seed },
    workload: "ticket list cursor query",
    schemaIndexes: {
      baseline: "no benchmark composite ticket cursor index",
      candidate: "benchmark_tickets_org_created_id_idx on tickets(organization_id, created_at DESC, id DESC)"
    },
    cachePolicy: args["cache-policy"] ?? "warm-cache unless DB is restarted externally before run",
    repetitions
  });

  try {
    await withPool(async (pool) => {
      if (variant === "candidate") {
        await pool.query(
          "CREATE INDEX IF NOT EXISTS benchmark_tickets_org_created_id_idx ON tickets(organization_id, created_at DESC, id DESC)"
        );
      } else if (variant === "baseline") {
        await pool.query("DROP INDEX IF EXISTS benchmark_tickets_org_created_id_idx");
      } else {
        throw new Error("variant must be baseline or candidate");
      }
      const org = await pool.query(
        "SELECT id FROM organizations WHERE slug LIKE 'bench-' || $1::text || '-%' ORDER BY slug LIMIT 1",
        [seed]
      );
      if (org.rowCount !== 1) throw new Error("Synthetic benchmark org not found. Run bench:seed first.");
      const orgId = org.rows[0].id;
      const query = `
        SELECT id, created_at, status
        FROM tickets
        WHERE organization_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
      `;
      const explain = await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`, [orgId, limit]);
      await writeJson(`explain-${variant}.json`, explain.rows[0]["QUERY PLAN"]);

      const samples = [];
      for (let i = 0; i < repetitions; i += 1) {
        const started = performance.now();
        try {
          const result = await pool.query(query, [orgId, limit]);
          const ms = performance.now() - started;
          const ids = new Set(result.rows.map((row) => row.id));
          const sorted = result.rows.every((row, idx, rows) => {
            if (idx === 0) return true;
            const previous = rows[idx - 1];
            return (
              previous.created_at > row.created_at ||
              (previous.created_at.getTime?.() ?? Date.parse(previous.created_at)) >=
                (row.created_at.getTime?.() ?? Date.parse(row.created_at))
            );
          });
          samples.push({
            endpoint: "db.ticket_cursor_page",
            ok: result.rows.length <= limit && ids.size === result.rows.length && sorted,
            ms,
            rows: result.rows.length
          });
        } catch (error) {
          samples.push({ endpoint: "db.ticket_cursor_page", ok: false, ms: performance.now() - started, error: error.message });
        }
      }
      await writeJson(`query-samples-${variant}.json`, samples);
      await writeJson(`query-summary-${variant}.json`, summarizeSamples(samples));
      meta.rawArtifactPaths.push(`explain-${variant}.json`, `query-samples-${variant}.json`, `query-summary-${variant}.json`);
      meta.outputs = [`Captured ${repetitions} query repetitions for ${variant}.`];
    });
  } catch (error) {
    meta.errors.push(describeError(error));
    throw error;
  } finally {
    await writeJson("metadata.json", meta);
    await writeReports(meta);
  }
}

async function login(email) {
  const response = await fetch(`${apiBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error(`login failed ${email}: ${response.status}`);
  return response.json();
}

async function apiRequest(token, endpoint, init = {}) {
  const started = performance.now();
  try {
    const response = await fetch(`${apiBase}${endpoint}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {})
      }
    });
    await response.text();
    return { endpoint: `${init.method ?? "GET"} ${endpoint.split("?")[0]}`, ok: response.ok, status: response.status, ms: performance.now() - started };
  } catch (error) {
    return { endpoint: `${init.method ?? "GET"} ${endpoint.split("?")[0]}`, ok: false, status: 0, ms: performance.now() - started, error: error.message };
  }
}

async function apiExperiment() {
  const levels = listArg("levels", "1,10,50,100");
  const warmupSeconds = intArg("warmup", 60);
  const durationSeconds = intArg("duration", 300);
  const repetitions = intArg("repetitions", 3);
  const seed = intArg("seed", 4242);
  await ensureArtifactDir();
  const meta = await metadata({
    dataset: { synthetic: true, expectedSeed: seed },
    workload: "closed-loop authenticated mixed ticket reads, creates, and messages",
    durations: { warmupSeconds, measureSeconds: durationSeconds },
    repetitions,
    exclusions: ["Closed-loop users are not an RPS capacity guarantee."]
  });

  try {
    const accounts = await withPool(async (pool) => {
      const result = await pool.query(
        `
        SELECT email
        FROM users
        WHERE email LIKE '%@bench-' || $1::text || '-%.synthetic.local'
        ORDER BY email
        `,
        [seed]
      );
      return result.rows.map((row) => row.email);
    });
    if (accounts.length === 0) throw new Error("Synthetic accounts not found. Run bench:seed first.");
    const tokens = [];
    for (const email of accounts.slice(0, Math.max(...levels))) {
      tokens.push((await login(email)).token);
    }

    for (let rep = 1; rep <= repetitions; rep += 1) {
      for (const concurrency of levels) {
        const label = `api-r${rep}-c${concurrency}`;
        await fetchMetrics(`${label}-before`);
        const warmupUntil = performance.now() + warmupSeconds * 1000;
        const measureUntil = warmupUntil + durationSeconds * 1000;
        const samples = [];
        let stopped = false;
        const clients = Array.from({ length: concurrency }, async (_, idx) => {
          const token = tokens[idx % tokens.length];
          let op = 0;
          while (!stopped && performance.now() < measureUntil) {
            const measuring = performance.now() >= warmupUntil;
            const choice = op % 4;
            let sample;
            if (choice === 0) {
              sample = await apiRequest(token, "/api/tickets?limit=50");
            } else if (choice === 1) {
              sample = await apiRequest(token, "/api/tickets", {
                method: "POST",
                body: JSON.stringify({
                  subject: `Bench API ticket ${runId}-${idx}-${op}`,
                  description: "Synthetic API benchmark ticket.",
                  priority: "medium"
                })
              });
            } else {
              sample = await apiRequest(token, "/api/tickets?limit=10");
            }
            if (measuring) samples.push(sample);
            op += 1;
            if (process.memoryUsage().rss > os.totalmem() * 0.85) stopped = true;
          }
        });
        await Promise.all(clients);
        await fetchMetrics(`${label}-after`);
        await writeJson(`${label}-samples.json`, samples);
        await writeJson(`${label}-summary.json`, {
          concurrency,
          repetition: rep,
          offeredModel: "closed-loop synthetic clients",
          achievedRequestsPerSecond: Number((samples.length / durationSeconds).toFixed(2)),
          ...summarizeSamples(samples)
        });
        meta.rawArtifactPaths.push(`${label}-samples.json`, `${label}-summary.json`);
      }
    }
  } catch (error) {
    meta.errors.push(describeError(error));
    throw error;
  } finally {
    await writeJson("metadata.json", meta);
    await writeReports(meta);
  }
}

async function recoveryExperiment() {
  const batch = intArg("batch", 100);
  const seed = intArg("seed", 4242);
  const waitDrainSeconds = intArg("wait-drain", 300);
  await ensureArtifactDir();
  const meta = await metadata({
    dataset: { synthetic: true, expectedSeed: seed, notificationBatch: batch },
    workload: "transactional outbox recovery with fake deterministic provider",
    exclusions: ["Requires worker to run with NOTIFICATION_PROVIDER=fake for provider-side measurement."]
  });
  try {
    const inserted = await withPool(async (pool) => {
      const context = await pool.query(
        `
        SELECT u.id AS user_id, u.organization_id
        FROM users u
        WHERE u.email = 'customer@bench-' || $1::text || '-1.synthetic.local'
        LIMIT 1
        `,
        [seed]
      );
      if (context.rowCount !== 1) throw new Error("Synthetic customer not found. Run bench:seed first.");
      const { user_id: userId, organization_id: organizationId } = context.rows[0];
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const ids = [];
        for (let i = 0; i < batch; i += 1) {
          const ticket = await client.query(
            `
            INSERT INTO tickets(organization_id, requester_id, subject, description, status, priority)
            VALUES($1, $2, $3, 'Synthetic recovery benchmark ticket.', 'open', 'medium')
            RETURNING id
            `,
            [organizationId, userId, `Bench recovery ticket ${runId}-${i}`]
          );
          const ticketId = ticket.rows[0].id;
          const outbox = await client.query(
            `
            INSERT INTO outbox_events(organization_id, event_type, schema_version, aggregate_type, aggregate_id, payload)
            VALUES($1, 'ticket.created.notification_requested', 1, 'ticket', $2, $3::jsonb)
            RETURNING id
            `,
            [organizationId, ticketId, JSON.stringify({ ticketId, requesterId: userId })]
          );
          ids.push(outbox.rows[0].id);
        }
        await client.query("COMMIT");
        return ids;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    });
    await writeJson("recovery-inserted-events.json", { eventIds: inserted });

    const started = performance.now();
    let snapshot = {};
    while (performance.now() - started < waitDrainSeconds * 1000) {
      snapshot = await withPool(async (pool) => {
        const result = await pool.query(
          `
          SELECT
            COUNT(*) FILTER (WHERE oe.id = ANY($1::uuid[]) AND oe.status IN ('pending','failed','dispatching'))::int AS remaining_backlog,
            COUNT(*) FILTER (WHERE oe.id = ANY($1::uuid[]) AND oe.status = 'dispatched')::int AS dispatched,
            COUNT(DISTINCT nj.event_id)::int AS operations,
            COUNT(na.id)::int AS provider_attempts,
            COUNT(*) FILTER (WHERE nj.status = 'failed')::int AS permanent_failures,
            COUNT(*) FILTER (WHERE duplicated.event_id IS NOT NULL)::int AS logical_duplicates
          FROM outbox_events oe
          LEFT JOIN notification_jobs nj ON nj.event_id = oe.id
          LEFT JOIN notification_attempts na ON na.event_id = oe.id
          LEFT JOIN (
            SELECT event_id
            FROM notification_jobs
            WHERE event_id = ANY($1::uuid[])
            GROUP BY event_id
            HAVING COUNT(*) > 1
          ) duplicated ON duplicated.event_id = oe.id
          WHERE oe.id = ANY($1::uuid[])
          `,
          [inserted]
        );
        return result.rows[0];
      });
      if (Number(snapshot.remaining_backlog ?? batch) === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const drainSeconds = Number(((performance.now() - started) / 1000).toFixed(2));
    await writeJson("recovery-summary.json", { ...snapshot, drainSeconds, batch, waitDrainSeconds });
    meta.rawArtifactPaths.push("recovery-inserted-events.json", "recovery-summary.json");
    meta.outputs = [`Inserted ${batch} synthetic notification events and observed recovery snapshot.`];
  } catch (error) {
    meta.errors.push(describeError(error));
    throw error;
  } finally {
    await writeJson("metadata.json", meta);
    await writeReports(meta);
  }
}

async function readSseEvent(reader, decoder, bufferRef, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    let idx = bufferRef.value.indexOf("\n\n");
    if (idx !== -1) {
      const chunk = bufferRef.value.slice(0, idx);
      bufferRef.value = bufferRef.value.slice(idx + 2);
      const lines = chunk.split("\n");
      const event = lines.find((line) => line.startsWith("event:"))?.replace("event:", "").trim();
      const id = lines.find((line) => line.startsWith("id:"))?.replace("id:", "").trim();
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace("data:", "").trimStart())
        .join("\n");
      return { event, id, data };
    }
    const remaining = Math.max(1, deadline - performance.now());
    const read = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), remaining))
    ]);
    if (read.timeout || read.done) return null;
    bufferRef.value += decoder.decode(read.value, { stream: true });
  }
  return null;
}

async function sseExperiment() {
  const messages = intArg("messages", 100);
  const seed = intArg("seed", 4242);
  await ensureArtifactDir();
  const meta = await metadata({
    workload: "local synthetic ticket-specific SSE receipt latency",
    dataset: { synthetic: true, expectedSeed: seed },
    repetitions: 1,
    exclusions: ["Polling comparison omitted unless an equivalent polling reference is implemented."]
  });
  try {
    const customer = await login(`customer@bench-${seed}-1.synthetic.local`);
    const admin = await login(`admin@bench-${seed}-1.synthetic.local`);
    const created = await fetch(`${apiBase}/api/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${customer.token}` },
      body: JSON.stringify({
        subject: `Bench SSE ticket ${runId}`,
        description: "Synthetic SSE benchmark ticket.",
        priority: "medium"
      })
    });
    if (!created.ok) throw new Error(`Unable to create SSE ticket: ${created.status}`);
    const ticketId = (await created.json()).data.id;
    const stream = await fetch(`${apiBase}/api/tickets/${ticketId}/stream`, {
      headers: { authorization: `Bearer ${customer.token}` }
    });
    if (!stream.ok || !stream.body) throw new Error(`SSE stream failed: ${stream.status}`);
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    const bufferRef = { value: "" };
    const seen = new Set();
    const latencies = [];
    const samples = [];
    for (let i = 0; i < messages; i += 1) {
      const sentAt = performance.now();
      const sent = await fetch(`${apiBase}/api/tickets/${ticketId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${admin.token}` },
        body: JSON.stringify({ body: `Synthetic SSE message ${runId}-${i}` })
      });
      const payload = sent.ok ? await sent.json() : null;
      const expectedMessageId = payload?.data?.id;
      let received = null;
      while (!received) {
        const frame = await readSseEvent(reader, decoder, bufferRef, 10000);
        if (!frame) break;
        if (frame.event !== "ticket.message.created") continue;
        const event = JSON.parse(frame.data);
        if (event.messageId === expectedMessageId) received = event;
      }
      const ms = performance.now() - sentAt;
      const duplicate = received ? seen.has(received.messageId) : false;
      if (received) {
        seen.add(received.messageId);
        latencies.push(ms);
      }
      samples.push({
        endpoint: "sse.ticket.message.created",
        ok: Boolean(received) && !duplicate,
        ms,
        messageId: expectedMessageId,
        receivedId: received?.messageId ?? null,
        duplicate
      });
    }
    await reader.cancel();
    await writeJson("sse-samples.json", samples);
    await writeJson("sse-summary.json", {
      messages,
      missed: samples.filter((s) => !s.receivedId).length,
      duplicates: samples.filter((s) => s.duplicate).length,
      ...summarizeSamples(samples)
    });
    meta.rawArtifactPaths.push("sse-samples.json", "sse-summary.json");
    meta.outputs = [`Recorded ${samples.length} synthetic SSE message attempts.`];
  } catch (error) {
    meta.errors.push(describeError(error));
    throw error;
  } finally {
    await writeJson("metadata.json", meta);
    await writeReports(meta);
  }
}


async function writeReports(meta) {
  const resultFiles = (await fs.readdir(artifactDir)).filter(
    (name) => name.includes("summary") && name.endsWith(".json")
  );
  const summaries = [];
  for (const file of resultFiles) {
    summaries.push({ file, data: JSON.parse(await fs.readFile(path.join(artifactDir, file), "utf8")) });
  }
  const status = meta.errors.length ? "BLOCKED" : summaries.length ? "MEASURED" : "PLANNED";
  const results = [
    `# Benchmark Results: ${runId}`,
    "",
    `Status: ${status}`,
    "",
    "## Metadata",
    "",
    `- Date: ${meta.date}`,
    `- Commit: ${meta.commit_sha ?? "unknown"}`,
    `- Mode: ${mode}`,
    `- Exploratory: ${meta.exploratory}`,
    "",
    "## Summaries",
    "",
    summaries.length
      ? summaries.map((entry) => `- ${entry.file}: ${JSON.stringify(entry.data)}`).join("\n")
      : "- No completed measurement summaries in this run.",
    "",
    "## Errors",
    "",
    meta.errors.length ? meta.errors.map((e) => `- ${e}`).join("\n") : "- None recorded.",
    "",
    "## Aggregate Method",
    "",
    "Percentiles are nearest-rank over successful request/query latency samples per repetition. Aggregate claims should be computed from saved repetition summaries, not from tuned exploratory runs."
  ].join("\n");
  await fs.writeFile(path.join(artifactDir, "results.md"), `${results}\n`);

  const resume = [
    "# Resume Candidates",
    "",
    status === "MEASURED"
      ? "- Candidate numerical bullet may be drafted from the measured summary above with qualifier: local synthetic workload."
      : "- PLANNED: Built a reproducible benchmark harness for SupportDesk covering synthetic query/index, API load, notification recovery, and SSE replay experiments; numerical resume claims remain pending actual measured runs.",
    "",
    "## Two-Minute Reproduction/Demo Script",
    "",
    "1. Start Docker Desktop.",
    "2. Run `npm ci`.",
    "3. Run `npm run db:reset && npm run db:migrate && npm run db:seed`.",
    "4. Run `npm run bench:seed -- --tickets 10000 --orgs 5 --seed 4242`.",
    "5. Run `npm run bench:query -- --variant baseline --seed 4242 --run-id demo-query-baseline`.",
    "6. Run `npm run bench:query -- --variant candidate --seed 4242 --run-id demo-query-candidate`.",
    "7. Open `docs/evidence/benchmarks/demo-query-*/results.md` and compare only matching workload fields.",
    "",
    "## Tradeoff",
    "",
    "The harness uses a plain Node client instead of adding k6 because the project already ships Node/TypeScript tooling and PostgreSQL access. That keeps installation simple for an entry-level portfolio, while documenting the closed-loop semantics so the results are not overstated as open-loop capacity."
  ].join("\n");
  await fs.writeFile(path.join(artifactDir, "resume-candidates.md"), `${resume}\n`);
}

async function plannedHarness() {
  await ensureArtifactDir();
  const meta = await metadata({
    workload: "planned benchmark harness artifact",
    dataset: { synthetic: true, status: "not generated in this planned run" },
    repetitions: 0,
    exclusions: [
      "No benchmark measurements were run in this planned artifact.",
      "Docker/PostgreSQL/Redis/API/provider availability must be confirmed before final runs."
    ],
    outputs: [
      "Harness supports seed, query, api, recovery, and sse modes with raw artifact and metadata output."
    ]
  });
  await writeJson("metadata.json", meta);
  await writeReports(meta);
}

async function main() {
  await ensureArtifactDir();
  try {
    if (mode === "seed") await seedSynthetic();
    else if (mode === "query") await queryExperiment();
    else if (mode === "api") await apiExperiment();
    else if (mode === "recovery") await recoveryExperiment();
    else if (mode === "sse") await sseExperiment();
    else if (mode === "plan") await plannedHarness();
    else {
      await writeJson("metadata.json", await metadata({ errors: ["Unknown mode"], outputs: ["Use seed, query, api, recovery, or sse."] }));
      console.log("Usage: npm run bench -- <seed|query|api|recovery|sse> [--key value]");
    }
  } catch (error) {
    const metaPath = path.join(artifactDir, "metadata.json");
    let meta;
    try {
      meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    } catch {
      meta = await metadata();
    }
    meta.errors ??= [];
    meta.errors.push(describeError(error));
    await writeJson("metadata.json", meta);
    await writeReports(meta);
    console.error(error.message);
    process.exit(1);
  }
}

void main();
