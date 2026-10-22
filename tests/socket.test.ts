import test from "node:test";
import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import { createApp } from "../server/app.js";
import {
  PROTOCOL,
  type Reply,
  type RoomState,
  type SeatResponse,
} from "../shared/protocol.js";
async function emit<T>(
  socket: Socket,
  event: string,
  data: unknown,
): Promise<Reply<T>> {
  return new Promise((resolve, reject) =>
    socket
      .timeout(2_000)
      .emit(event, data, (err: Error | null, result: Reply<T>) =>
        err ? reject(err) : resolve(result),
      ),
  );
}
function waitFor(
  socket: Socket,
  predicate: (s: RoomState) => boolean,
): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("roomState", listener);
      reject(new Error("snapshot timeout"));
    }, 3_000);
    const listener = (s: RoomState) => {
      if (predicate(s)) {
        clearTimeout(timer);
        socket.off("roomState", listener);
        resolve(s);
      }
    };
    socket.on("roomState", listener);
  });
}
async function connect(url: string) {
  const socket = io(url, {
    auth: { protocol: PROTOCOL },
    transports: ["websocket"],
    forceNew: true,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}
test("真实双 socket：同房、并发唯一计分、结束、再赛、刷新凭证恢复", async () => {
  const app = await createApp({
    durationMs: 350,
    countdownMs: 30,
    graceMs: 500,
  });
  const port = await app.listen(0);
  const url = `http://127.0.0.1:${port}`;
  const sockets: Socket[] = [];
  try {
    const a = await connect(url),
      b = await connect(url),
      c = await connect(url);
    sockets.push(a, b, c);
    const created = await emit<SeatResponse>(a, "createRoom", {
      nickname: "Alpha",
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const otherJoin = waitFor(a, (s) => s.players.length === 2);
    const joined = await emit<SeatResponse>(b, "joinRoom", {
      nickname: "Beta",
      code: created.data.state.code,
    });
    assert.equal(joined.ok, true);
    assert.equal((await otherJoin).code, created.data.state.code);
    const full = await emit(c, "joinRoom", {
      nickname: "Third",
      code: created.data.state.code,
    });
    assert.equal(full.ok, false);
    if (!full.ok) assert.equal(full.error.code, "ROOM_FULL");
    const outsider = await emit(c, "setReady", { ready: true });
    assert.equal(outsider.ok, false);
    const startA = waitFor(a, (s) => s.status === "PLAYING"),
      startB = waitFor(b, (s) => s.status === "PLAYING");
    await emit(a, "setReady", { ready: true });
    await emit(b, "setReady", { ready: true });
    const [sa, sb] = await Promise.all([startA, startB]);
    assert.equal(sa.target!.id, sb.target!.id);
    assert.equal(sa.roundId, sb.roundId);
    const claims = await Promise.all([
      emit(a, "claimTarget", {
        roundId: sa.roundId,
        targetId: sa.target!.id,
        operationId: "concurrent-a1",
      }),
      emit(b, "claimTarget", {
        roundId: sb.roundId,
        targetId: sb.target!.id,
        operationId: "concurrent-b1",
      }),
    ]);
    assert.equal(claims.filter((r) => r.ok).length, 1);
    assert.equal(
      app.manager.getState(sa.code)!.players.reduce((n, p) => n + p.score, 0),
      1,
    );
    const endA = waitFor(a, (s) => s.status === "FINISHED"),
      endB = waitFor(b, (s) => s.status === "FINISHED");
    const [ea, eb] = await Promise.all([endA, endB]);
    assert.equal(ea.winnerId, eb.winnerId);
    assert.deepEqual(ea.players, eb.players);
    const late = await emit(a, "claimTarget", {
      roundId: sa.roundId,
      targetId: sa.target!.id,
      operationId: "late-claim1",
    });
    assert.equal(late.ok, false);
    const restart = waitFor(a, (s) => s.status === "PLAYING");
    await emit(a, "requestRematch", { requested: true });
    await emit(b, "requestRematch", { requested: true });
    const next = await restart;
    assert.deepEqual(
      next.players.map((p) => p.score),
      [0, 0],
    );
    assert.notEqual(next.roundId, sa.roundId);
    const paused = waitFor(b, (s) => s.status === "PAUSED");
    a.disconnect();
    await paused;
    const a2 = await connect(url);
    sockets.push(a2);
    const resumed = await emit<SeatResponse>(
      a2,
      "reconnectRoom",
      created.data.credentials,
    );
    assert.equal(resumed.ok, true);
    if (resumed.ok) {
      assert.equal(resumed.data.state.players.length, 2);
      assert.equal(
        resumed.data.credentials.playerId,
        created.data.credentials.playerId,
      );
      assert.equal(resumed.data.state.status, "PLAYING");
    }
  } finally {
    sockets.forEach((s) => s.disconnect());
    await app.close();
  }
});
test("协议拒绝无版本客户端、恶意输入和速率洪泛，仍可正常操作", async () => {
  const app = await createApp();
  const port = await app.listen(0);
  const url = `http://127.0.0.1:${port}`;
  const bad = io(url, {
    auth: { protocol: "old" },
    reconnection: false,
    transports: ["websocket"],
  });
  let a: Socket | undefined;
  try {
    const message = await new Promise<string>((resolve) =>
      bad.once("connect_error", (err) => resolve(err.message)),
    );
    assert.match(message, /版本/);
    a = await connect(url);
    const input = await emit(a, "createRoom", null);
    assert.equal(input.ok, false);
    const burst = await Promise.all(
      Array.from({ length: 35 }, () => emit(a!, "setReady", { ready: true })),
    );
    assert.ok(burst.some((r) => !r.ok && r.error.code === "RATE_LIMIT"));
    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).protocol, PROTOCOL);
  } finally {
    bad.disconnect();
    a?.disconnect();
    await app.close();
  }
});
