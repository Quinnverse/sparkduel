import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  PROTOCOL,
  type Credentials,
  type Reply,
  type RoomState,
  type SeatResponse,
} from "../shared/protocol";
import { operationId } from "./operationId";
const KEY = "spark-duel-seat-v1";
type Connection =
  | "connecting"
  | "online"
  | "offline"
  | "restoring"
  | "replaced";
function stored(): Credentials | null {
  try {
    const data = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    return data &&
      typeof data.code === "string" &&
      typeof data.playerId === "string" &&
      typeof data.token === "string"
      ? data
      : null;
  } catch {
    return null;
  }
}
export function useDuel() {
  const socket = useRef<Socket | null>(null);
  const credentials = useRef<Credentials | null>(stored());
  const [playerId, setPlayerId] = useState(credentials.current?.playerId ?? "");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [clock, setClock] = useState(Date.now());
  const offset = useRef(0);
  const latestSnapshot = useRef<{
    code: string;
    version: number;
    roundId: string | null;
  } | null>(null);
  useEffect(() => {
    setFeedback("");
  }, [room?.roundId]);
  const clear = useCallback(() => {
    credentials.current = null;
    latestSnapshot.current = null;
    setPlayerId("");
    setRoom(null);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* Storage may be denied; in-memory session still works. */
    }
  }, []);
  const accept = useCallback((state: RoomState) => {
    const latest = latestSnapshot.current;
    if (latest?.code === state.code && latest.version > state.version) return;
    latestSnapshot.current = {
      code: state.code,
      version: state.version,
      roundId: state.roundId,
    };
    offset.current = state.serverNow - Date.now();
    setRoom(state);
  }, []);
  const seat = useCallback(
    (data: SeatResponse) => {
      credentials.current = data.credentials;
      setPlayerId(data.credentials.playerId);
      try {
        sessionStorage.setItem(KEY, JSON.stringify(data.credentials));
      } catch {
        setStorageWarning(true);
      }
      accept(data.state);
    },
    [accept],
  );
  useEffect(() => {
    const client = io({
      auth: { protocol: PROTOCOL },
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 2_000,
      timeout: 5_000,
      transports: ["websocket", "polling"],
    });
    socket.current = client;
    client.on("connect", () => {
      if (credentials.current) {
        setConnection("restoring");
        client
          .timeout(5_000)
          .emit(
            "reconnectRoom",
            credentials.current,
            (timeout: Error | null, result: Reply<SeatResponse>) => {
              if (timeout) {
                setError("恢复请求超时，请检查连接后刷新。");
                setConnection("offline");
                return;
              }
              if (!result.ok) {
                clear();
                setError(result.error.message);
              } else {
                seat(result.data);
                setError("");
              }
              setConnection("online");
            },
          );
      } else setConnection("online");
    });
    client.on("roomState", (state: RoomState) => accept(state));
    client.on("disconnect", (reason) => {
      setBusy(false);
      if (reason !== "io client disconnect") setConnection("offline");
    });
    client.on("connect_error", (cause: Error) => {
      setConnection("offline");
      setError(`无法连接服务器：${cause.message}`);
    });
    client.on("roomClosed", ({ reason }: { reason: string }) => {
      clear();
      setError(reason);
    });
    client.on("sessionReplaced", ({ message }: { message: string }) => {
      clear();
      setConnection("replaced");
      setError(message);
      client.disconnect();
    });
    client.connect();
    const frame = setInterval(() => setClock(Date.now() + offset.current), 100);
    const sync = setInterval(() => {
      if (!client.connected) return;
      const sent = Date.now();
      client
        .timeout(2_000)
        .emit(
          "syncClock",
          {},
          (err: Error | null, reply: Reply<{ serverNow: number }>) => {
            if (!err && reply.ok)
              offset.current = reply.data.serverNow - (sent + Date.now()) / 2;
          },
        );
    }, 5_000);
    return () => {
      clearInterval(frame);
      clearInterval(sync);
      client.removeAllListeners();
      client.disconnect();
      socket.current = null;
    };
  }, [accept, seat, clear]);
  const command = useCallback(
    async <T>(
      event: string,
      data: unknown,
      quiet = false,
    ): Promise<Reply<T> | null> => {
      if (!socket.current?.connected || connection !== "online") {
        if (!quiet) setError("连接尚未恢复，请稍后。");
        return null;
      }
      if (!quiet) {
        setBusy(true);
        setError("");
      }
      return new Promise((resolve) => {
        socket
          .current!.timeout(5_000)
          .emit(event, data, (timeout: Error | null, result: Reply<T>) => {
            if (!quiet) setBusy(false);
            if (timeout) {
              if (!quiet)
                setError(
                  "请求超时。操作可能已到达服务器，请刷新恢复房间后再试。",
                );
              resolve(null);
              return;
            }
            if (!result.ok && !quiet) setError(result.error.message);
            resolve(result);
          });
      });
    },
    [connection],
  );
  const enter = useCallback(
    async (mode: "create" | "join", nickname: string, code = "") => {
      const reply = await command<SeatResponse>(
        mode === "create" ? "createRoom" : "joinRoom",
        { nickname, code },
      );
      if (reply?.ok) {
        seat(reply.data);
        const url = new URL(location.href);
        url.searchParams.set("room", reply.data.state.code);
        history.replaceState(null, "", url);
      }
    },
    [command, seat],
  );
  const claim = useCallback(async () => {
    if (
      !room?.target ||
      !room.roundId ||
      room.status !== "PLAYING" ||
      connection !== "online"
    )
      return;
    setFeedback("已出手");
    const reply = await command(
      "claimTarget",
      {
        targetId: room.target.id,
        roundId: room.roundId,
        operationId: operationId(),
      },
      true,
    );
    if (latestSnapshot.current?.roundId !== room.roundId) return;
    setFeedback(
      reply?.ok
        ? "抢点成功 +1"
        : reply && !reply.ok
          ? reply.error.message
          : "连接未确认",
    );
  }, [room, connection, command]);
  const leave = useCallback(async () => {
    if (socket.current?.connected && credentials.current)
      await command("leaveRoom", {});
    clear();
    setError("");
    const url = new URL(location.href);
    url.searchParams.delete("room");
    history.replaceState(null, "", url);
    if (!socket.current?.connected) {
      setConnection("connecting");
      socket.current?.connect();
    }
  }, [command, clear]);
  return {
    room,
    playerId,
    connection,
    error,
    storageWarning,
    busy,
    feedback,
    clock,
    clearError: () => setError(""),
    enter,
    claim,
    leave,
    ready: (ready: boolean) => command("setReady", { ready }),
    rematch: (requested: boolean) => command("requestRematch", { requested }),
    retry: () => {
      setConnection("connecting");
      socket.current?.connect();
    },
  };
}
