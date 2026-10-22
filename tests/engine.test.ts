import test from "node:test";
import assert from "node:assert/strict";
import { RoomManager, GameError } from "../server/engine.js";
function fixture(options = {}) {
  let now = 10_000;
  const closed: string[] = [];
  const m = new RoomManager({
    durationMs: 60_000,
    countdownMs: 3_000,
    graceMs: 30_000,
    clock: () => now,
    onClosed: (_, reason) => closed.push(reason),
    ...options,
  });
  const a = m.create("a", { nickname: "阿蓝" });
  const b = m.join("b", { nickname: "阿橙", code: a.state.code });
  const code = a.state.code;
  return {
    m,
    a,
    b,
    code,
    closed,
    advance(ms: number) {
      now += ms;
      m.tick();
    },
    start() {
      m.ready("a", { ready: true });
      m.ready("b", { ready: true });
      now += 3_000;
      m.tick();
    },
    action(id = "operation-001") {
      const r = m.getState(code)!;
      return { roundId: r.roundId!, targetId: r.target!.id, operationId: id };
    },
  };
}
const rejects = (fn: () => unknown, code: string) =>
  assert.throws(
    fn,
    (error: unknown) => error instanceof GameError && error.code === code,
  );
test("创建/加入一致，公开快照没有秘密", () => {
  const f = fixture(),
    s = f.m.getState(f.code)!;
  assert.equal(s.players.length, 2);
  assert.equal(s.players[0].nickname, "阿蓝");
  assert.equal(JSON.stringify(s).includes("token"), false);
  assert.equal(JSON.stringify(s).includes("socketId"), false);
  assert.equal(f.a.credentials.token.length, 64);
  assert.notEqual(f.a.credentials.token, f.b.credentials.token);
});
test("双方准备才倒计时，3 秒后开始 60 秒局", () => {
  const f = fixture();
  f.m.ready("a", { ready: true });
  assert.equal(f.m.getState(f.code)!.status, "LOBBY");
  f.m.ready("b", { ready: true });
  assert.equal(f.m.getState(f.code)!.status, "COUNTDOWN");
  f.advance(2_999);
  assert.equal(f.m.getState(f.code)!.target, null);
  f.advance(1);
  assert.equal(f.m.getState(f.code)!.status, "PLAYING");
  assert.equal(f.m.getState(f.code)!.remainingMs, 60_000);
});
test("同一目标两人抢：一次计分，旧目标不能改变新目标", () => {
  const f = fixture();
  f.start();
  const action = f.action();
  f.m.claim("a", action);
  rejects(
    () => f.m.claim("b", { ...action, operationId: "operation-002" }),
    "STALE_TARGET",
  );
  const s = f.m.getState(f.code)!;
  assert.deepEqual(
    s.players.map((p) => p.score),
    [1, 0],
  );
  assert.notEqual(s.target!.id, action.targetId);
});
test("操作 ID 去重：新目标也不能复用旧操作加分", () => {
  const f = fixture();
  f.start();
  f.m.claim("a", f.action());
  f.advance(100);
  rejects(() => f.m.claim("a", f.action()), "DUPLICATE");
  assert.equal(f.m.getState(f.code)!.players[0].score, 1);
});
test("到时即结束，未 tick 的到时点击也无法加分", () => {
  let now = 1_000;
  const m = new RoomManager({
    clock: () => now,
    countdownMs: 0,
    durationMs: 100,
  });
  const a = m.create("a", { nickname: "a" });
  m.join("b", { code: a.state.code, nickname: "b" });
  m.ready("a", { ready: true });
  m.ready("b", { ready: true });
  m.tick();
  const r = m.getState(a.state.code)!;
  now += 100;
  rejects(
    () =>
      m.claim("a", {
        roundId: r.roundId,
        targetId: r.target!.id,
        operationId: "expired-001",
      }),
    "NOT_PLAYING",
  );
  assert.equal(m.getState(a.state.code)!.status, "FINISHED");
  assert.equal(m.getState(a.state.code)!.winnerId, null);
});
test("结束后无法继续计分，胜者由服务器决定", () => {
  const f = fixture();
  f.start();
  const a = f.action();
  f.m.claim("b", a);
  f.advance(60_000);
  const s = f.m.getState(f.code)!;
  assert.equal(s.status, "FINISHED");
  assert.equal(s.winnerId, f.b.credentials.playerId);
  rejects(() => f.m.claim("a", a), "NOT_PLAYING");
  assert.deepEqual(
    s.players.map((p) => p.score),
    [0, 1],
  );
});
test("双方同意再赛才清零，旧 round 不能计分", () => {
  const f = fixture();
  f.start();
  const old = f.action();
  f.m.claim("a", old);
  f.advance(60_000);
  f.m.rematch("a", { requested: true });
  assert.equal(f.m.getState(f.code)!.status, "FINISHED");
  f.m.rematch("b", { requested: true });
  assert.equal(f.m.getState(f.code)!.status, "COUNTDOWN");
  assert.deepEqual(
    f.m.getState(f.code)!.players.map((p) => p.score),
    [0, 0],
  );
  f.advance(3_000);
  rejects(
    () => f.m.claim("a", { ...f.action("old-round-01"), roundId: old.roundId }),
    "STALE_ROUND",
  );
});
test("倒计时断线回等待，所有准备取消", () => {
  const f = fixture();
  f.m.ready("a", { ready: true });
  f.m.ready("b", { ready: true });
  f.m.disconnect("a");
  const s = f.m.getState(f.code)!;
  assert.equal(s.status, "LOBBY");
  assert.equal(s.countdownEndsAt, null);
  assert.ok(s.players.every((p) => !p.ready));
});
test("中途断线冻结计时得分，恢复同席位继续", () => {
  const f = fixture();
  f.start();
  f.advance(10_000);
  const action = f.action();
  f.m.claim("a", action);
  f.m.disconnect("a");
  assert.equal(f.m.getState(f.code)!.status, "PAUSED");
  f.advance(5_000);
  rejects(() => f.m.claim("b", f.action("during-pause")), "NOT_PLAYING");
  const resumed = f.m.reconnect("a2", f.a.credentials).seat;
  assert.equal(resumed.credentials.playerId, f.a.credentials.playerId);
  assert.equal(resumed.state.players.length, 2);
  assert.equal(resumed.state.status, "PLAYING");
  assert.equal(resumed.state.remainingMs, 50_000);
  assert.equal(resumed.state.players[0].score, 1);
  rejects(() => f.m.claim("a", f.action("old-socket-1")), "NOT_MEMBER");
});
test("有效凭证接管仍在线的旧 socket，旧 socket 无权", () => {
  const f = fixture();
  f.start();
  const r = f.m.reconnect("a2", f.a.credentials);
  assert.equal(r.replacedSocketId, "a");
  rejects(() => f.m.ready("a", { ready: true }), "NOT_MEMBER");
  f.m.disconnect("a");
  assert.equal(f.m.getState(f.code)!.players[0].connected, true);
});
test("两人均断线：一人先回来不能提前恢复或延长窗口", () => {
  const f = fixture();
  f.start();
  f.m.disconnect("a");
  f.m.disconnect("b");
  f.advance(10_000);
  const r = f.m.reconnect("a2", f.a.credentials);
  assert.equal(r.seat.state.status, "PAUSED");
  f.advance(20_000);
  assert.equal(f.m.getState(f.code), undefined);
  assert.equal(f.closed.length, 1);
});
test("重连超时关闭，凭证过期不能恢复", () => {
  const f = fixture();
  f.start();
  f.m.disconnect("a");
  f.advance(30_000);
  assert.equal(f.m.size, 0);
  rejects(() => f.m.reconnect("a2", f.a.credentials), "ROOM_NOT_FOUND");
});
test("主动离开关闭房间并撤销所有玩家权限", () => {
  const f = fixture();
  f.m.leave("a");
  assert.equal(f.m.size, 0);
  assert.equal(f.closed.length, 1);
  rejects(() => f.m.ready("b", { ready: true }), "NOT_MEMBER");
});
test("不存在、满员、重复加入与非成员拒绝", () => {
  const f = fixture();
  rejects(
    () => f.m.join("c", { code: "ZZZZZZ", nickname: "c" }),
    "ROOM_NOT_FOUND",
  );
  rejects(() => f.m.join("c", { code: f.code, nickname: "c" }), "ROOM_FULL");
  rejects(
    () => f.m.join("a", { code: f.code, nickname: "a" }),
    "ALREADY_JOINED",
  );
  rejects(() => f.m.ready("outsider", { ready: true }), "NOT_MEMBER");
});
test("输入形状、昵称、码和 ready 类型严格校验", () => {
  const m = new RoomManager();
  for (const input of [null, [], 1, "bad"])
    rejects(() => m.create("a", input), "INVALID_INPUT");
  for (const name of ["", "x".repeat(17), "a\n"])
    rejects(
      () => m.create("a", { nickname: name === "a\n" ? "a\nb" : name }),
      "INVALID_NICKNAME",
    );
  const f = fixture();
  rejects(() => f.m.ready("a", { ready: "true" }), "INVALID_INPUT");
  rejects(
    () => f.m.join("c", { code: "123456", nickname: "c" }),
    "INVALID_CODE",
  );
});
test("伪造 playerId / token 无权，凭证绑定特定房间", () => {
  const f = fixture();
  rejects(
    () => f.m.reconnect("evil", { ...f.a.credentials, token: "a".repeat(64) }),
    "INVALID_SESSION",
  );
  rejects(
    () => f.m.reconnect("evil", { ...f.a.credentials, playerId: "fake" }),
    "INVALID_SESSION",
  );
  assert.equal(f.m.getState(f.code)!.players.length, 2);
});
test("房间上限和空闲过期有确定性清理", () => {
  let now = 1_000;
  const m = new RoomManager({ maxRooms: 1, idleMs: 100, clock: () => now });
  m.create("a", { nickname: "a" });
  rejects(() => m.create("b", { nickname: "b" }), "CAPACITY");
  now += 100;
  m.tick();
  assert.equal(m.size, 0);
  m.create("b", { nickname: "b" });
  assert.equal(m.size, 1);
});
test("无效 phase 和超快操作不会改变分数", () => {
  const f = fixture();
  rejects(() => f.m.rematch("a", { requested: true }), "INVALID_PHASE");
  f.start();
  rejects(() => f.m.ready("a", { ready: true }), "INVALID_PHASE");
  f.m.claim("a", f.action("first-hit-1"));
  rejects(() => f.m.claim("a", f.action("second-hit-1")), "TOO_FAST");
  assert.equal(f.m.getState(f.code)!.players[0].score, 1);
});
test("单调递增版本，目标处于可点击边界内", () => {
  const f = fixture();
  let version = f.m.getState(f.code)!.version;
  f.start();
  for (let n = 0; n < 30; n++) {
    const s = f.m.getState(f.code)!;
    assert.ok(s.version > version);
    version = s.version;
    assert.ok(s.target!.x >= 12 && s.target!.x <= 88);
    assert.ok(s.target!.y >= 15 && s.target!.y <= 85);
    f.advance(100);
    f.m.claim(n % 2 ? "a" : "b", f.action(`bounded-${n}`));
  }
  assert.equal(
    f.m.getState(f.code)!.players.reduce((total, p) => total + p.score, 0),
    30,
  );
});
