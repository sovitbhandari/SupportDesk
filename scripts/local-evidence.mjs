#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(root, "docs", "evidence", "local-demo", runId);
const logPath = path.join(runDir, "commands.log");
const metadataPath = path.join(runDir, "metadata.json");
const dockerConfigDir = path.join(os.tmpdir(), "supportdesk-docker-config");

fs.mkdirSync(runDir, { recursive: true });
fs.mkdirSync(dockerConfigDir, { recursive: true });

const commands = [
  {
    name: "static check",
    command: "npm",
    args: ["run", "check"]
  },
  {
    name: "docker daemon readiness",
    command: "docker",
    args: ["version"]
  },
  {
    name: "start local dependencies",
    command: "docker-compose",
    args: ["up", "--wait", "-d", "db", "redis", "mailhog"],
    env: {
      DOCKER_CONFIG: dockerConfigDir
    }
  },
  {
    name: "migrate database",
    command: "npm",
    args: ["run", "db:migrate"]
  },
  {
    name: "seed synthetic/demo data",
    command: "npm",
    args: ["run", "db:seed"]
  },
  {
    name: "verify tenant isolation",
    command: "npm",
    args: ["run", "db:verify-isolation"]
  },
  {
    name: "verify runtime role",
    command: "npm",
    args: ["--workspace", "@zendesk-lite/db", "run", "verify:runtime-role"]
  },
  {
    name: "verify active assignment uniqueness",
    command: "npm",
    args: ["--workspace", "@zendesk-lite/db", "run", "verify:assignments"]
  },
  {
    name: "verify transactional outbox",
    command: "npm",
    args: ["--workspace", "@zendesk-lite/db", "run", "verify:outbox"]
  },
  {
    name: "verify ticket event replay",
    command: "npm",
    args: ["--workspace", "@zendesk-lite/db", "run", "verify:ticket-events"]
  },
  {
    name: "replaylab rollback invariant",
    command: "npm",
    args: ["run", "replaylab", "--", "run", "replaylab/scenarios/rollback-no-outbox.json"]
  },
  {
    name: "replaylab redis outage invariant",
    command: "npm",
    args: ["run", "replaylab", "--", "run", "replaylab/scenarios/outbox-redis-outage.json"]
  },
  {
    name: "replaylab duplicate delivery invariant",
    command: "npm",
    args: ["run", "replaylab", "--", "run", "replaylab/scenarios/duplicate-delivery.json"]
  },
  {
    name: "benchmark harness plan artifact",
    command: "npm",
    args: ["run", "bench", "--", "plan", "--run-id", `local-demo-${runId}`]
  }
];

const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
const startedAt = new Date().toISOString();
const results = [];

function append(value = "") {
  fs.appendFileSync(logPath, `${value}\n`);
}

append(`SupportDesk local evidence run`);
append(`Started: ${startedAt}`);
append(`Run directory: ${runDir}`);
append(`Commit: ${git.stdout.trim() || "unknown"}`);
append(`Node: ${process.version}`);
append(`Host: ${os.platform()} ${os.release()} ${os.arch()}`);
append("");

for (const item of commands) {
  append(`$ ${[item.command, ...item.args].join(" ")}`);
  const started = Date.now();
  const result = spawnSync(item.command, item.args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...(item.env ?? {}) }
  });
  const durationMs = Date.now() - started;
  if (result.stdout) append(result.stdout.trimEnd());
  if (result.stderr) append(result.stderr.trimEnd());
  append(`exit ${result.status ?? 1} (${durationMs}ms)`);
  append("");
  results.push({
    name: item.name,
    command: [item.command, ...item.args].join(" "),
    exitCode: result.status ?? 1,
    durationMs
  });
  if (result.status !== 0) {
    append(`Stopped after failure: ${item.name}`);
    break;
  }
}

const status = results.every((item) => item.exitCode === 0) && results.length === commands.length ? "PASSED" : "FAILED";
const metadata = {
  date: startedAt,
  runId,
  status,
  commit: git.stdout.trim() || null,
  node: process.version,
  host: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch()
  },
  workload: "Local synthetic SupportDesk verification: static checks, Dockerized PostgreSQL/Redis/MailHog, DB verifiers, ReplayLab scenarios, and benchmark plan artifact.",
  commands: results,
  artifacts: {
    commandLog: path.relative(root, logPath),
    dockerConfigDir
  },
  limitations: [
    "Requires Docker Desktop or a compatible Docker daemon.",
    "ReplayLab scenarios use synthetic seeded accounts/data only.",
    "Benchmark command here creates a plan artifact; measured benchmark runs are separate."
  ]
};

fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`${status}: ${runDir}`);
process.exitCode = status === "PASSED" ? 0 : 1;
