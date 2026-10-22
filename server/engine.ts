import {
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type {
  Claim,
  Credentials,
  Phase,
  PublicPlayer,
  RoomState,
  SeatResponse,
  Target,
} from "../shared/protocol.js";

export class GameError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
interface Player extends PublicPlayer {
  socketId: string;
  token: string;
  operations: Set<string>;
  lastClaimAt: number;
}
interface Room {
  code: string;
  status: Phase;
  players: Player[];
  roundId: string | null;
  target: Target | null;
  countdownEndsAt: number | null;
  endsAt: number | null;
  remainingMs: number;
  winnerId: string | null;
  version: number;
  disconnectDeadline: number | null;
  lastActivity: number;
  lastClaim: RoomState["lastClaim"];
}
interface Options {
  durationMs?: number;
  countdownMs?: number;
  graceMs?: number;
  idleMs?: number;
  maxRooms?: number;
  clock?: () => number;
  onState?: (state: RoomState) => void;
  onClosed?: (code: string, reason: string) => void;
}
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function fail(code: string, message: string): never {
  throw new GameError(code, message);
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_INPUT", "请求格式不正确。");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 80): string {
  if (typeof value !== "string" || value.length > max)
    fail("INVALID_INPUT", "请求字段不正确。");
  return value;
}
export function nickname(value: unknown): string {
  const name = text(value, 64).trim();
  if (
    !name ||
    [...name].length > 16 ||
    /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(name)
  )
    fail("INVALID_NICKNAME", "昵称需要 1–16 个字符，不能包含控制字符。");
  return name;
}
export function roomCode(value: unknown): string {
  const code = text(value, 20).trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code))
    fail("INVALID_CODE", "请输入 6 位房间码（不含 I、O、0、1）。");
  return code;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private seats = new Map<string, { code: string; playerId: string }>();
  readonly durationMs: number;
  readonly countdownMs: number;
  readonly graceMs: number;
  private idleMs: number;
  private maxRooms: number;
  private now: () => number;
  private onState: (state: RoomState) => void;
  private onClosed: (code: string, reason: string) => void;
  constructor(options: Options = {}) {
    this.durationMs = options.durationMs ?? 60_000;
    this.countdownMs = options.countdownMs ?? 3_000;
    this.graceMs = options.graceMs ?? 30_000;
    this.idleMs = options.idleMs ?? 15 * 60_000;
    this.maxRooms = options.maxRooms ?? 500;
    this.now = options.clock ?? Date.now;
    this.onState = options.onState ?? (() => {});
    this.onClosed = options.onClosed ?? (() => {});
  }
  get size() {
    return this.rooms.size;
  }
  hasSeat(socketId: string) {
    return this.seats.has(socketId);
  }
  private player(socketId: string): { room: Room; player: Player } {
    const seat = this.seats.get(socketId);
    if (!seat) fail("NOT_MEMBER", "请先创建或加入房间。");
    const room = this.rooms.get(seat.code);
    const player = room?.players.find((p) => p.id === seat.playerId);
    if (!room || !player || player.socketId !== socketId || !player.connected)
      fail("NOT_MEMBER", "当前连接没有房间操作权限。");
    this.advance(room);
    if (!this.rooms.has(room.code))
      fail("ROOM_CLOSED", "房间已关闭，请重新创建。");
    return { room, player };
  }
  private newPlayer(name: string, socketId: string): Player {
    return {
      id: randomUUID(),
      nickname: name,
      socketId,
      token: randomBytes(32).toString("hex"),
      connected: true,
      ready: false,
      score: 0,
      rematchRequested: false,
      operations: new Set(),
      lastClaimAt: -Infinity,
    };
  }
  private snapshot(room: Room): RoomState {
    const now = this.now();
    return {
      code: room.code,
      status: room.status,
      players: room.players.map(
        ({ id, nickname, connected, ready, score, rematchRequested }) => ({
          id,
          nickname,
          connected,
          ready,
          score,
          rematchRequested,
        }),
      ),
      roundId: room.roundId,
      target: room.target ? { ...room.target } : null,
      countdownEndsAt: room.countdownEndsAt,
      endsAt: room.endsAt,
      remainingMs:
        room.status === "PLAYING" && room.endsAt !== null
          ? Math.max(0, room.endsAt - now)
          : room.remainingMs,
      durationMs: this.durationMs,
      winnerId: room.winnerId,
      version: room.version,
      serverNow: now,
      disconnectDeadline: room.disconnectDeadline,
      lastClaim: room.lastClaim ? { ...room.lastClaim } : null,
    };
  }
  private emit(room: Room) {
    room.version++;
    this.onState(this.snapshot(room));
  }
  private response(room: Room, player: Player): SeatResponse {
    return {
      credentials: {
        code: room.code,
        playerId: player.id,
        token: player.token,
      },
      state: this.snapshot(room),
    };
  }
  getState(code: string): RoomState | undefined {
    const room = this.rooms.get(code);
    return room ? this.snapshot(room) : undefined;
  }
  create(socketId: string, data: unknown): SeatResponse {
    const name = nickname(record(data).nickname);
    if (this.seats.has(socketId))
      fail("ALREADY_JOINED", "你已在一个房间，请先离开。");
    if (this.rooms.size >= this.maxRooms)
      fail("CAPACITY", "房间数量已达上限，请稍后重试。");
    let code: string;
    do {
      code = Array.from(
        { length: 6 },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join("");
    } while (this.rooms.has(code));
    const player = this.newPlayer(name, socketId);
    const room: Room = {
      code,
      status: "LOBBY",
      players: [player],
      roundId: null,
      target: null,
      countdownEndsAt: null,
      endsAt: null,
      remainingMs: this.durationMs,
      winnerId: null,
      version: 0,
      disconnectDeadline: null,
      lastActivity: this.now(),
      lastClaim: null,
    };
    this.rooms.set(code, room);
    this.seats.set(socketId, { code, playerId: player.id });
    this.emit(room);
    return this.response(room, player);
  }
  join(socketId: string, data: unknown): SeatResponse {
    const input = record(data),
      code = roomCode(input.code),
      name = nickname(input.nickname);
    if (this.seats.has(socketId))
      fail("ALREADY_JOINED", "你已在一个房间，请先离开。");
    const room = this.rooms.get(code);
    if (!room) fail("ROOM_NOT_FOUND", "没有找到这个房间，请检查房间码。");
    this.advance(room);
    if (!this.rooms.has(code))
      fail("ROOM_NOT_FOUND", "这个房间已过期，请创建新房间。");
    if (room.players.length >= 2)
      fail("ROOM_FULL", "房间已满，最多容纳两名玩家。");
    if (room.status !== "LOBBY") fail("GAME_IN_PROGRESS", "这一局已经开始。");
    const player = this.newPlayer(name, socketId);
    room.players.push(player);
    room.lastActivity = this.now();
    this.seats.set(socketId, { code, playerId: player.id });
    this.emit(room);
    return this.response(room, player);
  }
  reconnect(
    socketId: string,
    data: unknown,
  ): { seat: SeatResponse; replacedSocketId: string | null } {
    const input = record(data),
      code = roomCode(input.code);
    const id = text(input.playerId),
      token = text(input.token, 64);
    if (!/^[a-f0-9]{64}$/.test(token))
      fail("INVALID_SESSION", "恢复凭证无效，请重新加入。");
    const room = this.rooms.get(code);
    if (!room)
      fail("ROOM_NOT_FOUND", "房间已关闭或服务器已重启，请创建新房间。");
    this.advance(room);
    if (!this.rooms.has(code))
      fail("ROOM_CLOSED", "重连时间已过，房间已关闭。");
    const player = room.players.find((p) => p.id === id);
    if (
      !player ||
      !timingSafeEqual(Buffer.from(player.token), Buffer.from(token))
    )
      fail("INVALID_SESSION", "无法恢复这个玩家，请重新加入。");
    const existing = this.seats.get(socketId);
    if (existing && (existing.code !== code || existing.playerId !== id))
      fail("ALREADY_JOINED", "当前连接已经在另一个房间。");
    const replacedSocketId =
      player.socketId !== socketId ? player.socketId : null;
    if (replacedSocketId) this.seats.delete(replacedSocketId);
    player.socketId = socketId;
    player.connected = true;
    this.seats.set(socketId, { code, playerId: id });
    room.lastActivity = this.now();
    if (room.players.every((p) => p.connected)) {
      room.disconnectDeadline = null;
      if (room.status === "PAUSED") {
        room.status = "PLAYING";
        room.endsAt = this.now() + room.remainingMs;
      }
    }
    this.emit(room);
    return { seat: this.response(room, player), replacedSocketId };
  }
  ready(socketId: string, data: unknown) {
    const { room, player } = this.player(socketId);
    const ready = record(data).ready;
    if (typeof ready !== "boolean") fail("INVALID_INPUT", "准备状态不正确。");
    if (room.status !== "LOBBY")
      fail("INVALID_PHASE", "当前阶段无法更改准备状态。");
    player.ready = ready;
    room.lastActivity = this.now();
    if (
      room.players.length === 2 &&
      room.players.every((p) => p.connected && p.ready)
    )
      this.begin(room);
    else this.emit(room);
  }
  private begin(room: Room) {
    room.status = "COUNTDOWN";
    room.roundId = randomUUID();
    room.target = null;
    room.countdownEndsAt = this.now() + this.countdownMs;
    room.endsAt = null;
    room.remainingMs = this.durationMs;
    room.winnerId = null;
    room.lastClaim = null;
    room.players.forEach((p) => {
      p.score = 0;
      p.rematchRequested = false;
      p.ready = false;
      p.operations.clear();
      p.lastClaimAt = -Infinity;
    });
    this.emit(room);
  }
  private spawn(room: Room) {
    room.target = {
      id: randomUUID(),
      x: randomInt(120, 881) / 10,
      y: randomInt(150, 851) / 10,
      spawnedAt: this.now(),
    };
  }
  claim(socketId: string, data: unknown) {
    const { room, player } = this.player(socketId);
    const input = record(data);
    const action: Claim = {
      roundId: text(input.roundId),
      targetId: text(input.targetId),
      operationId: text(input.operationId),
    };
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(action.operationId))
      fail("INVALID_INPUT", "操作标识不正确。");
    if (room.status !== "PLAYING") fail("NOT_PLAYING", "现在不能抢点。");
    if (!room.players.every((p) => p.connected))
      fail("PAUSED", "对手正在重连，对局已暂停。");
    if (action.roundId !== room.roundId)
      fail("STALE_ROUND", "这不是当前对局。");
    if (player.operations.has(action.operationId))
      fail("DUPLICATE", "这个操作已经处理过了。");
    player.operations.add(action.operationId);
    if (player.operations.size > 128)
      player.operations.delete(player.operations.values().next().value!);
    if (!room.target || action.targetId !== room.target.id)
      fail("STALE_TARGET", "慢了一拍，这个光点已被抢走。");
    if (this.now() - player.lastClaimAt < 60)
      fail("TOO_FAST", "操作太快，请稍后。");
    player.lastClaimAt = this.now();
    room.lastClaim = {
      playerId: player.id,
      targetId: room.target.id,
      x: room.target.x,
      y: room.target.y,
      at: this.now(),
    };
    player.score++;
    room.lastActivity = this.now();
    this.spawn(room);
    this.emit(room);
  }
  rematch(socketId: string, data: unknown) {
    const { room, player } = this.player(socketId);
    const requested = record(data).requested;
    if (typeof requested !== "boolean")
      fail("INVALID_INPUT", "再赛状态不正确。");
    if (room.status !== "FINISHED") fail("INVALID_PHASE", "这一局还没有结束。");
    player.rematchRequested = requested;
    room.lastActivity = this.now();
    if (
      room.players.length === 2 &&
      room.players.every((p) => p.connected && p.rematchRequested)
    )
      this.begin(room);
    else this.emit(room);
  }
  disconnect(socketId: string) {
    const seat = this.seats.get(socketId);
    if (!seat) return;
    this.seats.delete(socketId);
    const room = this.rooms.get(seat.code),
      player = room?.players.find((p) => p.id === seat.playerId);
    if (!room || !player || player.socketId !== socketId) return;
    this.advance(room);
    if (!this.rooms.has(room.code)) return;
    player.connected = false;
    player.ready = false;
    player.rematchRequested = false;
    room.disconnectDeadline ??= this.now() + this.graceMs;
    if (room.status === "PLAYING") {
      room.remainingMs = Math.max(0, room.endsAt! - this.now());
      room.endsAt = null;
      room.status = "PAUSED";
    }
    if (room.status === "COUNTDOWN") {
      room.status = "LOBBY";
      room.countdownEndsAt = null;
      room.players.forEach((p) => (p.ready = false));
    }
    this.emit(room);
  }
  leave(socketId: string) {
    const { room } = this.player(socketId);
    this.close(room, "一名玩家已离开，房间已关闭。");
  }
  private finish(room: Room) {
    room.status = "FINISHED";
    room.remainingMs = 0;
    room.endsAt = null;
    room.target = null;
    const [a, b] = room.players;
    room.winnerId =
      a.score === b.score ? null : a.score > b.score ? a.id : b.id;
    room.lastActivity = this.now();
    this.emit(room);
  }
  private close(room: Room, reason: string) {
    for (const p of room.players) this.seats.delete(p.socketId);
    this.rooms.delete(room.code);
    this.onClosed(room.code, reason);
  }
  private advance(room: Room) {
    const now = this.now();
    if (room.disconnectDeadline !== null && now >= room.disconnectDeadline) {
      this.close(room, "30 秒重连窗口已结束，房间已关闭。");
      return;
    }
    if (
      (room.status === "LOBBY" || room.status === "FINISHED") &&
      now - room.lastActivity >= this.idleMs
    ) {
      this.close(room, "房间长时间没有操作，已自动关闭。");
      return;
    }
    if (room.status === "COUNTDOWN" && now >= room.countdownEndsAt!) {
      room.status = "PLAYING";
      room.endsAt = now + this.durationMs;
      room.countdownEndsAt = null;
      this.spawn(room);
      this.emit(room);
    }
    if (room.status === "PLAYING" && now >= room.endsAt!) this.finish(room);
  }
  tick() {
    for (const room of this.rooms.values()) this.advance(room);
  }
}
