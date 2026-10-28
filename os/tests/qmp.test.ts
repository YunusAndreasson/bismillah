import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { QmpClient } from "../scripts/qmp.ts";

async function monitor(
  t: TestContext,
  reply: (message: Record<string, unknown>, socket: Socket) => void,
  timeoutMs = 30_000,
): Promise<QmpClient> {
  const dir = mkdtempSync(join(tmpdir(), "bismillah-qmp-"));
  const path = join(dir, "monitor.sock");
  const peers: Socket[] = [];
  const server = createServer((socket) => {
    peers.push(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        reply(JSON.parse(line) as Record<string, unknown>, socket);
      }
    });
  });
  t.after(() => {
    for (const peer of peers) peer.destroy();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  server.listen(path);
  await once(server, "listening");
  const socket = createConnection(path);
  t.after(() => socket.destroy());
  const client = new QmpClient(socket, timeoutMs);
  await once(socket, "connect");
  return client;
}

void test("a disconnected monitor rejects all outstanding commands instead of hanging", async (t) => {
  const client = await monitor(t, (_message, socket) => {
    if (!socket.writableEnded) socket.end();
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.allSettled([client.command("query-status"), client.command("query-version")]).then(
        (results) =>
          results.every((result) => result.status === "rejected") ? "rejected" : "resolved",
      ),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve("still pending"), 1000);
      }),
    ]);
    assert.equal(result, "rejected");
    await assert.rejects(client.command("query-status"), /closed/);
  } finally {
    clearTimeout(timer);
  }
});

void test("command IDs keep out-of-order replies attached to their requests", async (t) => {
  let first: Record<string, unknown> | undefined;
  const client = await monitor(t, (message, socket) => {
    if (!first) {
      first = message;
      return;
    }
    socket.write(JSON.stringify({ return: "second", id: message["id"] }) + "\n");
    socket.write(JSON.stringify({ return: "first", id: first["id"] }) + "\n");
  });
  assert.deepEqual(await Promise.all([client.command("first"), client.command("second")]), [
    "first",
    "second",
  ]);
});

void test("an unanswered command times out and its late reply cannot satisfy the next one", async (t) => {
  let first: Record<string, unknown> | undefined;
  const client = await monitor(
    t,
    (message, socket) => {
      if (!first) {
        first = message;
        return;
      }
      socket.write(JSON.stringify({ return: "late", id: first["id"] }) + "\n");
      socket.write(JSON.stringify({ return: "current", id: message["id"] }) + "\n");
    },
    100,
  );
  await assert.rejects(client.command("unanswered"), /timed out/);
  assert.equal(await client.command("next"), "current");
});

void test("fragmented replies and asynchronous events do not consume a command", async (t) => {
  const client = await monitor(t, (message, socket) => {
    const reply = JSON.stringify({ return: { status: "running" }, id: message["id"] }) + "\n";
    socket.write('{"QMP":{}}\n{"event":"RESUME"}\n' + reply.slice(0, 8));
    setImmediate(() => socket.write(reply.slice(8)));
  });
  assert.deepEqual(await client.command("query-status"), { status: "running" });
});

void test("QMP command errors reject only their request", async (t) => {
  const client = await monitor(t, (message, socket) => {
    const result =
      message["execute"] === "bad"
        ? { error: { class: "CommandNotFound", desc: "unknown command" } }
        : { return: "ok" };
    socket.write(JSON.stringify({ ...result, id: message["id"] }) + "\n");
  });
  await assert.rejects(client.command("bad"), /CommandNotFound/);
  assert.equal(await client.command("good"), "ok");
});

void test("malformed monitor data rejects pending and future requests", async (t) => {
  const client = await monitor(t, (_message, socket) => socket.write("not JSON\n"));
  await assert.rejects(client.command("query-status"), /invalid QMP response/);
  await assert.rejects(client.command("query-status"), /invalid QMP response/);
});
