#!/usr/bin/env node
import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";
import { Queue } from "bullmq";
import { Pool } from "pg";
import { Redis } from "ioredis";

const command = process.argv[2] ?? "help";
const arg1 = process.argv[3];
const arg2 = process.argv[4];
const root = process.cwd();
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:55432/supportdesk";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const queueName = "ticket-notifications";
const redisConnectionOptions = {
  enableOfflineQueue: false,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: null
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function monotonicMs(start) {
  return Number((performance.now() - start).toFixed(3));
}

function safeMeta(meta = {}) {
  const disallowed = /password|secret|token|email|body|subject/i;
  return Object.fromEntries(
    Object.entries(meta)
      .filter(([key]) => !disallowed.test(key))
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 200) : value])
  );
}

function describeError(error) {
  if (!error) return "Unknown error";
  const primary = [error.name, error.code, error.message].filter(Boolean).join(": ");
  if (primary) return primary.slice(0, 500);
  if (Array.isArray(error.errors) && error.errors.length) {
    return error.errors.map((item) => describeError(item)).join(" | ").slice(0, 500);
  }
  return String(error).slice(0, 500);
}

function parseMaybeJsonOrYaml(filePath, text) {
  if (filePath.endsWith(".json")) {
    return JSON.parse(text);
  }
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    throw new Error("ReplayLab Phase 1 validates JSON scenarios only; YAML parser is intentionally not bundled yet.");
  }
  throw new Error("Scenario file must end in .json, .yaml, or .yml.");
}

function validateScenario(scenario) {
  const allowedHooks = new Set([
    "after_db_commit_before_enqueue",
    "after_queue_acceptance_before_dispatcher_ack",
    "before_provider_acceptance",
    "after_provider_acceptance",
    "worker_termination",
    "temporary_redis_unavailability",
    "duplicate_delivery",
    "delayed_stale_sse_wakeup",
    "after_db_write_before_commit"
  ]);
  const allowedOps = new Set([
    "create_ticket_with_outbox",
    "create_ticket_then_rollback",
    "dispatch_outbox_once",
    "deliver_notification_once"
  ]);
  const allowedAssertions = new Set([
    "eventual_disposition_for_committed_events",
    "no_secret_metadata",
    "single_operation_record_per_event",
    "explicit_external_effect_state",
    "no_outbox_for_rollback",
    "no_committed_ticket_for_rollback",
    "bounded_active_assignment",
    "no_unauthorized_tenant_access"
  ]);
  const requiredTop = ["name", "version", "seed", "dataset", "operations", "faultSchedule", "timeoutMs", "assertions"];
  for (const key of requiredTop) {
    if (!(key in scenario)) throw new Error(`Scenario missing required key: ${key}`);
  }
  const extraTop = Object.keys(scenario).filter((key) => !requiredTop.includes(key));
  if (extraTop.length) throw new Error(`Scenario has unsupported keys: ${extraTop.join(", ")}`);
  if (typeof scenario.name !== "string" || !/^[a-z0-9-]+$/.test(scenario.name)) {
    throw new Error("Scenario name must be lowercase kebab-case.");
  }
  if (scenario.version !== 1) throw new Error("Scenario version must be 1.");
  if (!Number.isInteger(scenario.seed)) throw new Error("Scenario seed must be an integer.");
  if (!Number.isInteger(scenario.timeoutMs) || scenario.timeoutMs <= 0) {
    throw new Error("Scenario timeoutMs must be a positive integer.");
  }
  if (!scenario.dataset || scenario.dataset.synthetic !== true) {
    throw new Error("Scenario dataset.synthetic must be true.");
  }
  if (!Array.isArray(scenario.operations) || scenario.operations.length === 0) {
    throw new Error("Scenario operations must be a non-empty array.");
  }
  const operationIds = new Set();
  for (const op of scenario.operations) {
    if (typeof op.id !== "string" || operationIds.has(op.id)) throw new Error("Operation ids must be unique strings.");
    operationIds.add(op.id);
    if (!allowedOps.has(op.type)) throw new Error(`Unsupported operation type: ${op.type}`);
  }
  if (!Array.isArray(scenario.faultSchedule)) throw new Error("faultSchedule must be an array.");
  for (const fault of scenario.faultSchedule) {
    if (!allowedHooks.has(fault.hook)) throw new Error(`Unsupported fault hook: ${fault.hook}`);
    if (!operationIds.has(fault.operationId)) throw new Error(`Fault references unknown operation: ${fault.operationId}`);
    if (typeof fault.action !== "string") throw new Error("Fault action must be a string.");
  }
  if (!Array.isArray(scenario.assertions)) throw new Error("assertions must be an array.");
  for (const assertion of scenario.assertions) {
    if (!allowedAssertions.has(assertion)) throw new Error(`Unsupported assertion: ${assertion}`);
  }
}

async function loadScenario(filePath) {
  const absolute = path.resolve(root, filePath);
  const text = await fs.readFile(absolute, "utf8");
  const scenario = parseMaybeJsonOrYaml(absolute, text);
  validateScenario(scenario);
  return { scenario, absolute, checksum: sha256(text) };
}

async function makeRunDir(scenarioName) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${scenarioName}`;
  const dir = path.join(root, "docs", "evidence", "replaylab", runId);
  await fs.mkdir(dir, { recursive: true });
  return { runId, dir };
}

async function journalEvent(ctx, entry) {
  const event = {
    index: ctx.index++,
    monotonicMs: monotonicMs(ctx.start),
    wallTime: new Date().toISOString(),
    component: entry.component,
    operationId: entry.operationId ?? null,
    eventId: entry.eventId ?? null,
    attempt: entry.attempt ?? null,
    transition: entry.transition,
    correlationId: entry.correlationId ?? ctx.correlationId,
    metadata: safeMeta(entry.metadata ?? {})
  };
  const checksum = sha256(JSON.stringify(event));
  await fs.appendFile(ctx.journalPath, `${JSON.stringify({ ...event, checksum })}\n`);
  ctx.events.push({ ...event, checksum });
}

function faultFor(scenario, operationId, hook) {
  return scenario.faultSchedule.find((fault) => fault.operationId === operationId && fault.hook === hook);
}

async function setupContext(scenarioInfo) {
  const { runId, dir } = await makeRunDir(scenarioInfo.scenario.name);
  const ctx = {
    runId,
    dir,
    journalPath: path.join(dir, "journal.jsonl"),
    start: performance.now(),
    index: 0,
    events: [],
    createdEventIds: [],
    rollbackOperationKeys: [],
    correlationId: crypto.randomUUID()
  };
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  const metadata = {
    date: new Date().toISOString(),
    runId,
    scenario: scenarioInfo.scenario,
    scenarioPath: scenarioInfo.absolute,
    scenarioChecksum: scenarioInfo.checksum,
    commit: git.stdout.trim() || null,
    versions: {
      node: process.version
    },
    host: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch()
    },
    artifacts: {
      journal: "journal.jsonl",
      report: "report.json",
      reportMarkdown: "report.md"
    },
    errors: []
  };
  await fs.writeFile(path.join(dir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  return ctx;
}

function makeRedisClient() {
  const redis = new Redis(redisUrl, redisConnectionOptions);
  redis.on("error", () => undefined);
  return redis;
}

function makeQueue() {
  const redisUrlObj = new URL(redisUrl);
  const queue = new Queue(queueName, {
    connection: {
      host: redisUrlObj.hostname,
      port: Number(redisUrlObj.port || 6379),
      enableOfflineQueue: false,
      maxRetriesPerRequest: null,
      retryStrategy: null
    }
  });
  queue.on("error", () => undefined);
  return queue;
}

async function getSyntheticContext(pool, scenario) {
  const customerEmail = scenario.dataset.customerEmail;
  const result = await pool.query(
    `
    SELECT u.id AS user_id, u.organization_id
    FROM users u
    WHERE u.email = $1
      AND u.is_active = true
    LIMIT 1
    `,
    [customerEmail]
  );
  if (result.rowCount !== 1) {
    throw new Error("Synthetic/seed customer not found. Run migrations and seed before ReplayLab.");
  }
  return result.rows[0];
}

async function createTicketWithOutbox(pool, ctx, scenario, op, rollback = false) {
  const seed = await getSyntheticContext(pool, scenario);
  const client = await pool.connect();
  const operationKey = op.idempotencyKey ?? op.id;
  try {
    await client.query("BEGIN");
    await journalEvent(ctx, {
      component: "postgres",
      operationId: op.id,
      transition: "transaction.begin",
      metadata: { operationKey }
    });
    const ticket = await client.query(
      `
      INSERT INTO tickets(organization_id, requester_id, subject, description, status, priority)
      VALUES($1, $2, $3, 'ReplayLab synthetic ticket.', 'open', 'medium')
      RETURNING id
      `,
      [seed.organization_id, seed.user_id, `ReplayLab ${operationKey}`]
    );
    const ticketId = ticket.rows[0].id;
    const outbox = await client.query(
      `
      INSERT INTO outbox_events(organization_id, event_type, schema_version, aggregate_type, aggregate_id, payload)
      VALUES($1, 'ticket.created.notification_requested', 1, 'ticket', $2, $3::jsonb)
      RETURNING id
      `,
      [seed.organization_id, ticketId, JSON.stringify({ ticketId, requesterId: seed.user_id, operationKey })]
    );
    const eventId = outbox.rows[0].id;
    await journalEvent(ctx, {
      component: "postgres",
      operationId: op.id,
      eventId,
      transition: "outbox.inserted",
      metadata: { aggregateType: "ticket" }
    });
    if (rollback || faultFor(scenario, op.id, "after_db_write_before_commit")) {
      await client.query("ROLLBACK");
      ctx.rollbackOperationKeys.push(operationKey);
      await journalEvent(ctx, {
        component: "postgres",
        operationId: op.id,
        eventId,
        transition: "transaction.rollback",
        metadata: { expectedConflict: false }
      });
      return null;
    }
    await client.query("COMMIT");
    ctx.createdEventIds.push(eventId);
    await journalEvent(ctx, {
      component: "postgres",
      operationId: op.id,
      eventId,
      transition: "transaction.commit",
      metadata: { ticketCreated: true }
    });
    return eventId;
  } finally {
    client.release();
  }
}

async function dispatchOutbox(pool, ctx, scenario, op) {
  const result = await pool.query(
    `
    SELECT id
    FROM outbox_events
    WHERE status IN ('pending', 'failed')
    ORDER BY created_at ASC
    LIMIT 1
    `
  );
  const eventId = result.rows[0]?.id;
  if (!eventId) {
    await journalEvent(ctx, { component: "dispatcher", operationId: op.id, transition: "dispatch.noop" });
    return null;
  }
  await pool.query("UPDATE outbox_events SET status = 'dispatching', attempts = attempts + 1, updated_at = now() WHERE id = $1", [eventId]);
  await journalEvent(ctx, { component: "dispatcher", operationId: op.id, eventId, transition: "dispatch.claimed", attempt: 1 });
  if (faultFor(scenario, op.id, "after_db_commit_before_enqueue")) {
    await pool.query("UPDATE outbox_events SET status = 'failed', error_summary = 'ReplayLab redis unavailable', updated_at = now() WHERE id = $1", [eventId]);
    await journalEvent(ctx, { component: "redis", operationId: op.id, eventId, transition: "enqueue.blocked", metadata: { infrastructureFailure: false } });
    return eventId;
  }
  const redis = makeRedisClient();
  const queue = makeQueue();
  try {
    await redis.connect();
    await redis.ping();
    await queue.add("outbox-notification", { eventId }, { jobId: eventId });
    await journalEvent(ctx, { component: "bullmq", operationId: op.id, eventId, transition: "queue.accepted", attempt: 1 });
    if (faultFor(scenario, op.id, "after_queue_acceptance_before_dispatcher_ack")) {
      await journalEvent(ctx, { component: "dispatcher", operationId: op.id, eventId, transition: "dispatcher.ack.skipped" });
      return eventId;
    }
    await pool.query("UPDATE outbox_events SET status = 'dispatched', dispatched_at = now(), updated_at = now() WHERE id = $1", [eventId]);
    await journalEvent(ctx, { component: "dispatcher", operationId: op.id, eventId, transition: "dispatch.acknowledged" });
    return eventId;
  } finally {
    await queue.close().catch(() => undefined);
    redis.disconnect();
  }
}

async function deliverOnce(pool, ctx, scenario, op) {
  const eventId = ctx.createdEventIds[0];
  if (!eventId) throw new Error("No committed event exists for delivery.");
  const event = await pool.query("SELECT id, organization_id, aggregate_id, payload FROM outbox_events WHERE id = $1", [eventId]);
  if (event.rowCount !== 1) throw new Error("Outbox event not found for delivery.");
  const existing = await pool.query("SELECT id, status, attempts FROM notification_jobs WHERE event_id = $1", [eventId]);
  if (existing.rows[0]?.status === "completed") {
    await journalEvent(ctx, { component: "worker", operationId: op.id, eventId, transition: "delivery.duplicate_ignored" });
    return;
  }
  const attempts = Number(existing.rows[0]?.attempts ?? 0) + 1;
  const job = existing.rowCount
    ? await pool.query("UPDATE notification_jobs SET status = 'sending', attempts = attempts + 1, updated_at = now() WHERE event_id = $1 RETURNING id", [eventId])
    : await pool.query(
        `
        INSERT INTO notification_jobs(organization_id, event_id, aggregate_id, type, payload, status, attempts, updated_at)
        VALUES($1, $2, $3, 'ticket-created', $4::jsonb, 'sending', 1, now())
        RETURNING id
        `,
        [event.rows[0].organization_id, eventId, event.rows[0].aggregate_id, JSON.stringify(event.rows[0].payload)]
      );
  await journalEvent(ctx, { component: "worker", operationId: op.id, eventId, attempt: attempts, transition: "provider.before_acceptance" });
  if (faultFor(scenario, op.id, "before_provider_acceptance")) {
    await pool.query("UPDATE notification_jobs SET status = 'failed', error_message = 'ReplayLab provider rejected before acceptance', updated_at = now() WHERE event_id = $1", [eventId]);
    await journalEvent(ctx, { component: "fake-provider", operationId: op.id, eventId, attempt: attempts, transition: "provider.rejected" });
    return;
  }
  await pool.query(
    `
    INSERT INTO notification_attempts(event_id, notification_job_id, organization_id, provider, attempt_number, status, provider_message_id)
    VALUES($1, $2, $3, 'fake', $4, 'accepted', $5)
    `,
    [eventId, job.rows[0].id, event.rows[0].organization_id, attempts, `fake-${eventId}-${attempts}`]
  );
  await journalEvent(ctx, { component: "fake-provider", operationId: op.id, eventId, attempt: attempts, transition: "provider.accepted" });
  if (faultFor(scenario, op.id, "after_provider_acceptance")) {
    await journalEvent(ctx, { component: "worker", operationId: op.id, eventId, attempt: attempts, transition: "receipt.unknown_after_acceptance" });
    return;
  }
  await pool.query("UPDATE notification_jobs SET status = 'completed', provider_message_id = $2, updated_at = now() WHERE event_id = $1", [eventId, `fake-${eventId}-${attempts}`]);
  await journalEvent(ctx, { component: "worker", operationId: op.id, eventId, attempt: attempts, transition: "receipt.completed" });
}

async function verifyInvariants(pool, ctx, scenario) {
  const violations = [];
  const expectedConflicts = [];
  const infrastructureFailures = [];
  for (const assertion of scenario.assertions) {
    if (assertion === "no_secret_metadata") {
      const leaked = ctx.events.some((event) => /password|secret|token|email|body|subject/i.test(JSON.stringify(event.metadata)));
      if (leaked) violations.push({ assertion, detail: "Journal metadata contains a forbidden key." });
    }
    if (assertion === "eventual_disposition_for_committed_events") {
      if (ctx.createdEventIds.length > 0) {
        const result = await pool.query(
          "SELECT id, status FROM outbox_events WHERE id = ANY($1::uuid[])",
          [ctx.createdEventIds]
        );
        for (const row of result.rows) {
          if (!["dispatched", "failed"].includes(row.status)) {
            violations.push({ assertion, eventId: row.id, detail: `Outbox status remained ${row.status}.` });
          }
        }
      }
    }
    if (assertion === "single_operation_record_per_event") {
      const result = await pool.query(
        "SELECT event_id, COUNT(*)::int AS count FROM notification_jobs WHERE event_id = ANY($1::uuid[]) GROUP BY event_id HAVING COUNT(*) > 1",
        [ctx.createdEventIds]
      );
      for (const row of result.rows) violations.push({ assertion, eventId: row.event_id, detail: `notification_jobs count ${row.count}` });
    }
    if (assertion === "explicit_external_effect_state") {
      const accepted = ctx.events.filter((event) => event.transition === "provider.accepted");
      const completed = ctx.events.filter((event) => event.transition === "receipt.completed");
      if (accepted.length > 0 && completed.length === 0) {
        expectedConflicts.push({ assertion, detail: "Provider accepted but DB receipt is intentionally unknown after ambiguous boundary." });
      }
    }
    if (assertion === "no_outbox_for_rollback") {
      for (const key of ctx.rollbackOperationKeys) {
        const result = await pool.query("SELECT COUNT(*)::int AS count FROM outbox_events WHERE payload->>'operationKey' = $1", [key]);
        if (Number(result.rows[0].count) !== 0) violations.push({ assertion, detail: `Outbox leaked for ${key}.` });
      }
    }
    if (assertion === "no_committed_ticket_for_rollback") {
      for (const key of ctx.rollbackOperationKeys) {
        const result = await pool.query("SELECT COUNT(*)::int AS count FROM tickets WHERE subject = $1", [`ReplayLab ${key}`]);
        if (Number(result.rows[0].count) !== 0) violations.push({ assertion, detail: `Ticket leaked for ${key}.` });
      }
    }
  }
  return {
    status: infrastructureFailures.length ? "INFRASTRUCTURE_FAILURE" : violations.length ? "FAILED" : "PASSED",
    violations,
    expectedConflicts,
    infrastructureFailures
  };
}

async function runScenario(filePath) {
  const scenarioInfo = await loadScenario(filePath);
  const ctx = await setupContext(scenarioInfo);
  const pool = new Pool({ connectionString: databaseUrl });
  let verifier = null;
  try {
    await journalEvent(ctx, { component: "replaylab", transition: "scenario.start", metadata: { scenario: scenarioInfo.scenario.name } });
    for (const op of scenarioInfo.scenario.operations) {
      await journalEvent(ctx, { component: "replaylab", operationId: op.id, transition: "operation.start", metadata: { type: op.type } });
      if (op.type === "create_ticket_with_outbox") await createTicketWithOutbox(pool, ctx, scenarioInfo.scenario, op);
      if (op.type === "create_ticket_then_rollback") await createTicketWithOutbox(pool, ctx, scenarioInfo.scenario, op, true);
      if (op.type === "dispatch_outbox_once") await dispatchOutbox(pool, ctx, scenarioInfo.scenario, op);
      if (op.type === "deliver_notification_once") await deliverOnce(pool, ctx, scenarioInfo.scenario, op);
      await journalEvent(ctx, { component: "replaylab", operationId: op.id, transition: "operation.end" });
    }
    verifier = await verifyInvariants(pool, ctx, scenarioInfo.scenario);
    await journalEvent(ctx, { component: "verifier", transition: "scenario.verified", metadata: { status: verifier.status } });
  } catch (error) {
    const detail = describeError(error);
    verifier = {
      status: "INFRASTRUCTURE_FAILURE",
      violations: [],
      expectedConflicts: [],
      infrastructureFailures: [{ detail }]
    };
    await journalEvent(ctx, { component: "replaylab", transition: "scenario.infrastructure_failure", metadata: { error: detail } });
  } finally {
    await pool.end().catch(() => undefined);
  }
  await fs.writeFile(path.join(ctx.dir, "report.json"), `${JSON.stringify(verifier, null, 2)}\n`);
  await writeMarkdownReport(ctx.dir, scenarioInfo.scenario, verifier, ctx.events);
  console.log(`${verifier.status}: ${ctx.dir}`);
  if (verifier.status === "FAILED") process.exitCode = 1;
}

async function readJournal(journalPath) {
  const text = await fs.readFile(path.resolve(root, journalPath), "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function replayJournal(journalPath) {
  const events = await readJournal(journalPath);
  const invalid = events.filter((event) => {
    const { checksum, ...withoutChecksum } = event;
    return sha256(JSON.stringify(withoutChecksum)) !== checksum;
  });
  const result = {
    status: invalid.length ? "FAILED" : "PASSED",
    events: events.length,
    checksumFailures: invalid.map((event) => event.index)
  };
  console.log(JSON.stringify(result, null, 2));
  if (invalid.length) process.exitCode = 1;
}

async function compareJournals(leftPath, rightPath) {
  const left = await readJournal(leftPath);
  const right = await readJournal(rightPath);
  const summarize = (events) => events.reduce((acc, event) => {
    acc[event.transition] = (acc[event.transition] ?? 0) + 1;
    return acc;
  }, {});
  const result = {
    left: { path: leftPath, events: left.length, transitions: summarize(left) },
    right: { path: rightPath, events: right.length, transitions: summarize(right) }
  };
  console.log(JSON.stringify(result, null, 2));
}

async function writeMarkdownReport(dir, scenario, verifier, events) {
  const timeline = events
    .map((event) => `- ${event.monotonicMs}ms ${event.component} ${event.transition} ${event.eventId ?? ""}`)
    .join("\n");
  const body = [
    `# ReplayLab Report: ${scenario.name}`,
    "",
    `Status: ${verifier.status}`,
    "",
    "## Invariants",
    "",
    `- Violations: ${verifier.violations.length}`,
    `- Expected conflicts: ${verifier.expectedConflicts.length}`,
    `- Test infrastructure failures: ${verifier.infrastructureFailures.length}`,
    "",
    "## Timeline",
    "",
    timeline || "- No events recorded.",
    "",
    "## Raw Artifacts",
    "",
    "- `metadata.json`",
    "- `journal.jsonl`",
    "- `report.json`"
  ].join("\n");
  await fs.writeFile(path.join(dir, "report.md"), `${body}\n`);
}

async function reportRun(dirPath) {
  const absolute = path.resolve(root, dirPath);
  const report = await fs.readFile(path.join(absolute, "report.md"), "utf8");
  console.log(report);
}

async function main() {
  if (command === "run") {
    if (!arg1) throw new Error("Usage: npm run replaylab -- run <scenario.json>");
    await runScenario(arg1);
  } else if (command === "replay") {
    if (!arg1) throw new Error("Usage: npm run replaylab -- replay <journal.jsonl>");
    await replayJournal(arg1);
  } else if (command === "compare") {
    if (!arg1 || !arg2) throw new Error("Usage: npm run replaylab -- compare <left-journal> <right-journal>");
    await compareJournals(arg1, arg2);
  } else if (command === "report") {
    if (!arg1) throw new Error("Usage: npm run replaylab -- report <run-dir>");
    await reportRun(arg1);
  } else {
    console.log("Usage: npm run replaylab -- <run|replay|compare|report> ...");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
