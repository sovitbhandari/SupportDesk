import { performance } from "node:perf_hooks";

const base = "http://localhost:4000";

async function login(email: string, password: string) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) {
    throw new Error(`Login failed for ${email}: ${response.status}`);
  }
  const data = (await response.json()) as { token: string; user: { id: string } };
  return data;
}

async function api(path: string, token: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  return { status: response.status, text };
}

async function connectSse(token: string, onMessage: (ms: number) => void) {
  const started = performance.now();
  const response = await fetch(`${base}/api/stream`, {
    headers: { authorization: `Bearer ${token}` }
  });

  if (!response.ok || !response.body) {
    throw new Error(`SSE connect failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes("event: ticket.message.created")) {
      onMessage(performance.now() - started);
      await reader.cancel();
      return;
    }
  }
}

async function run() {
  const admin = await login("amy.admin@acme.com", "hashed-password");
  const customer = await login("alice.customer@acme.com", "hashed-password");

  const createdTicketRes = await api("/api/tickets", customer.token, "POST", {
    subject: `SSE target ticket ${Date.now()}`,
    description: "Created by customer for sprint3 smoke",
    priority: "medium"
  });
  if (createdTicketRes.status !== 201) {
    throw new Error(`Unable to create smoke ticket: ${createdTicketRes.status}`);
  }
  const ticketId = JSON.parse(createdTicketRes.text).data.id as string;

  const sseLatency = new Promise<number>((resolve) => {
    void connectSse(customer.token, (ms) => resolve(ms));
  });

  await new Promise((r) => setTimeout(r, 100));

  const postStarted = performance.now();
  const messageRes = await api(`/api/tickets/${ticketId}/messages`, admin.token, "POST", {
    body: `Sprint3 smoke test ${Date.now()}`
  });
  const postLatency = performance.now() - postStarted;

  const eventLatency = await sseLatency;

  console.log(
    JSON.stringify(
      {
        messagePostStatus: messageRes.status,
        apiResponseMs: Number(postLatency.toFixed(2)),
        sseDeliveryMs: Number(eventLatency.toFixed(2))
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
