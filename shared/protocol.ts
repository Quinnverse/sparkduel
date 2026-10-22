export const PROTOCOL = "spark-duel-v1";
export type Phase = "LOBBY" | "COUNTDOWN" | "PLAYING" | "PAUSED" | "FINISHED";
export interface PublicPlayer {
  id: string;
  nickname: string;
  connected: boolean;
  ready: boolean;
  score: number;
  rematchRequested: boolean;
}
export interface Target {
  id: string;
  x: number;
  y: number;
  spawnedAt: number;
}
export interface RoomState {
  code: string;
  status: Phase;
  players: PublicPlayer[];
  roundId: string | null;
  target: Target | null;
  countdownEndsAt: number | null;
  endsAt: number | null;
  remainingMs: number;
  durationMs: number;
  winnerId: string | null;
  version: number;
  serverNow: number;
  disconnectDeadline: number | null;
  lastClaim: {
    playerId: string;
    targetId: string;
    x: number;
    y: number;
    at: number;
  } | null;
}
export interface Credentials {
  code: string;
  playerId: string;
  token: string;
}
export type Reply<T = Record<string, never>> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };
export interface SeatResponse {
  credentials: Credentials;
  state: RoomState;
}
export interface Claim {
  roundId: string;
  targetId: string;
  operationId: string;
}
