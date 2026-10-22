import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Copy,
  Crosshair,
  Flag,
  Link,
  LoaderCircle,
  Radio,
  RotateCcw,
  ShieldCheck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useDuel } from "./useDuel";
import type { PublicPlayer, RoomState } from "../shared/protocol";

function Seat({
  player,
  index,
  yours,
}: {
  player?: PublicPlayer;
  index: number;
  yours: boolean;
}) {
  return (
    <div
      className={`player-seat player-${index}`}
      data-testid={`seat-${index}`}
      data-player-id={player?.id ?? ""}
    >
      <div className="avatar">
        {player ? (
          player.nickname.slice(0, 1).toUpperCase()
        ) : (
          <Users size={19} />
        )}
      </div>
      <div className="seat-copy">
        <strong>
          {player?.nickname ?? "等待挑战者"}{" "}
          {yours && <span className="you-tag">你</span>}
        </strong>
        <span className="seat-status">
          <i className={player?.connected ? "online-dot" : "waiting-dot"} />
          {!player
            ? "分享房间，邀请一位朋友"
            : !player.connected
              ? "断线 · 等待恢复"
              : player.rematchRequested
                ? "已同意再来一局"
                : player.ready
                  ? "已准备"
                  : "已连接"}
        </span>
      </div>
      <strong className="seat-score" data-testid={`score-${index}`}>
        {String(player?.score ?? 0).padStart(2, "0")}
      </strong>
    </div>
  );
}
function RoomTools({ room }: { room: RoomState }) {
  const [copied, setCopied] = useState("");
  const [manual, setManual] = useState("");
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(""), 2_000);
    return () => clearTimeout(t);
  }, [copied]);
  const invite = new URL(location.href);
  invite.search = "";
  invite.searchParams.set("room", room.code);
  async function copy(value: string, label: string) {
    try {
      if (!navigator.clipboard) throw new Error("No clipboard");
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setManual("");
    } catch {
      setManual(value);
    }
  }
  return (
    <div className="room-tools">
      <div className="section-caption">
        <span>PRIVATE ROOM</span>
        <span>2 人上限</span>
      </div>
      <div className="code-row">
        <div>
          <span className="tiny-label">房间码</span>
          <strong data-testid="room-code">{room.code}</strong>
        </div>
        <button
          className="icon-button"
          aria-label="复制房间码"
          onClick={() => copy(room.code, "房间码已复制")}
        >
          <Copy size={17} />
        </button>
      </div>
      <button
        className="button invite-button"
        onClick={() => copy(invite.toString(), "邀请链接已复制")}
      >
        <Link size={16} />
        复制邀请链接
        <ArrowRight size={16} />
      </button>
      {copied && (
        <p className="copy-feedback" role="status">
          <Check size={13} />
          {copied}
        </p>
      )}
      {manual && (
        <label className="manual-copy">
          浏览器未允许复制，请手动复制
          <input
            aria-label="手动复制邀请"
            readOnly
            value={manual}
            onFocus={(e) => e.target.select()}
          />
        </label>
      )}
    </div>
  );
}
export default function App() {
  const duel = useDuel();
  const { room, connection, busy, playerId, clock } = duel;
  const [mode, setMode] = useState<"create" | "join">(() =>
    new URLSearchParams(location.search).has("room") ? "join" : "create",
  );
  const [name, setName] = useState("");
  const [code, setCode] = useState(() =>
    (new URLSearchParams(location.search).get("room") ?? "")
      .toUpperCase()
      .slice(0, 6),
  );
  const [confirmLeave, setConfirmLeave] = useState(false);
  useEffect(() => {
    if (room?.status === "COUNTDOWN" && window.innerWidth <= 700) {
      document.querySelector('[data-testid="arena"]')?.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
  }, [room?.status]);
  const you = room?.players.find((p) => p.id === playerId);
  const live = connection === "online";
  const stateLabel = !live
    ? connection === "restoring"
      ? "恢复房间中"
      : connection === "offline"
        ? "连接已中断"
        : connection === "replaced"
          ? "席位已转移"
          : "连接服务器中"
    : !room
      ? "服务器已连接"
      : {
          LOBBY: "等待准备",
          COUNTDOWN: "即将开始",
          PLAYING: "实时对局中",
          PAUSED: "对局已暂停",
          FINISHED: "本局已结束",
        }[room.status];
  const remaining =
    room?.status === "PLAYING" && room.endsAt !== null
      ? Math.min(room.durationMs, Math.max(0, room.endsAt - clock))
      : (room?.remainingMs ?? 60_000);
  const seconds = Math.ceil(remaining / 1_000);
  const minutesDisplay = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  const countdown = room?.countdownEndsAt
    ? Math.min(
        3,
        Math.max(1, Math.ceil((room.countdownEndsAt - clock) / 1_000)),
      )
    : 3;
  const grace = room?.disconnectDeadline
    ? Math.max(0, Math.ceil((room.disconnectDeadline - clock) / 1_000))
    : 30;
  const winner = room?.players.find((p) => p.id === room.winnerId);
  const canPlay = live && room?.status === "PLAYING";
  return (
    <div
      className="app"
      data-status={room?.status ?? "HOME"}
      data-version={room?.version ?? 0}
      data-round={room?.roundId ?? ""}
    >
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            if (room) e.preventDefault();
          }}
          aria-label="SPARK DUEL"
        >
          <span className="brand-mark">
            <Zap size={23} strokeWidth={2.6} />
          </span>
          <span>
            SPARK<span className="brand-light">DUEL</span>
          </span>
        </a>
        <div
          className={`connection-badge ${live ? "is-live" : ""}`}
          role="status"
        >
          <i />
          {stateLabel}
        </div>
        <div className="top-meta">
          <span>双人实时竞技</span>
          <span className="version-tag">VOL. 01</span>
        </div>
      </header>
      <main className="main-layout">
        <aside className="sidebar">
          <div className="eyebrow">
            <span className="short-rule" />
            60 秒 · 一对一 · 拼反应
          </div>
          <h1>
            一瞬之间，
            <br />
            <span>胜负已定。</span>
          </h1>
          <p className="intro">
            同一个光点，两个挑战者。
            <br />
            比对手先一步，点亮你的胜利。
          </p>
          <details className="mobile-rules">
            <summary>怎么玩？查看游戏规则</summary>
            <p>
              两人加入同一房间并准备，3
              秒后开局。点击金色光点，先到服务器的操作得 1 分，60
              秒后高分者获胜。平分即平局，双方同意可再来一局。
            </p>
          </details>
          {!room ? (
            <section className="entry-card" aria-label="进入竞技场">
              <div className="mode-tabs">
                <button
                  className={mode === "create" ? "active" : ""}
                  onClick={() => {
                    setMode("create");
                    duel.clearError();
                  }}
                >
                  创建房间
                </button>
                <button
                  className={mode === "join" ? "active" : ""}
                  onClick={() => {
                    setMode("join");
                    duel.clearError();
                  }}
                >
                  加入房间
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void duel.enter(mode, name, code);
                }}
              >
                <label htmlFor="nickname">
                  你的昵称<span>最多 16 个字符</span>
                </label>
                <input
                  id="nickname"
                  placeholder="给自己起个代号"
                  value={name}
                  maxLength={32}
                  autoComplete="off"
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                {mode === "join" && (
                  <>
                    <label htmlFor="room-code-input">房间码</label>
                    <input
                      id="room-code-input"
                      className="code-input"
                      placeholder="输入 6 位房间码"
                      value={code}
                      maxLength={6}
                      autoCapitalize="characters"
                      autoComplete="off"
                      onChange={(e) =>
                        setCode(e.target.value.toUpperCase().replace(/\s/g, ""))
                      }
                      required
                    />
                  </>
                )}
                <button
                  className="button primary"
                  type="submit"
                  disabled={
                    !live ||
                    busy ||
                    !name.trim() ||
                    (mode === "join" && code.length !== 6)
                  }
                >
                  {busy ? (
                    <LoaderCircle size={18} className="spin" />
                  ) : (
                    <Zap size={18} />
                  )}
                  {mode === "create" ? "创建竞技房间" : "加入竞技房间"}
                  <ArrowRight size={18} />
                </button>
                <p className="entry-note">
                  <ShieldCheck size={13} />
                  无需注册，房间仅限两人
                </p>
              </form>
            </section>
          ) : (
            <>
              <RoomTools room={room} />
              <div className="room-controls">
                {room.status === "LOBBY" && (
                  <button
                    className={`button ${you?.ready ? "secondary" : "primary"}`}
                    disabled={!live || busy || !you?.connected}
                    onClick={() => void duel.ready(!you?.ready)}
                  >
                    {you?.ready ? <Check size={17} /> : <Zap size={17} />}
                    {you?.ready ? "已准备 · 点击取消" : "我准备好了"}
                  </button>
                )}
                {room.status === "FINISHED" && (
                  <button
                    className={`button ${you?.rematchRequested ? "secondary" : "primary"}`}
                    disabled={!live || busy}
                    onClick={() => void duel.rematch(!you?.rematchRequested)}
                  >
                    <RotateCcw size={17} />
                    {you?.rematchRequested ? "等待对手 · 点击取消" : "再来一局"}
                  </button>
                )}
                <button
                  className="leave-button"
                  onClick={() => setConfirmLeave(true)}
                >
                  离开房间
                </button>
              </div>
            </>
          )}
          {duel.error && (
            <div className="error-message" role="alert">
              <span>{duel.error}</span>
              <button aria-label="关闭提示" onClick={duel.clearError}>
                <X size={15} />
              </button>
            </div>
          )}
          {(connection === "offline" || connection === "replaced") && (
            <button className="button secondary retry" onClick={duel.retry}>
              重新连接服务器
            </button>
          )}
          {duel.storageWarning && (
            <p className="warning-message">
              浏览器禁用了会话存储：本页可玩，但刷新后无法恢复席位。
            </p>
          )}
          <section className="rules">
            <div className="section-caption">
              <span>HOW TO DUEL</span>
              <span>游戏规则</span>
            </div>
            <div className="rule">
              <span>01</span>
              <p>
                邀请一位朋友加入，<strong>双方准备</strong>后开局。
              </p>
            </div>
            <div className="rule">
              <span>02</span>
              <p>
                点击竞技场内的光点，<strong>先到服务器</strong>的操作得 1 分。
              </p>
            </div>
            <div className="rule">
              <span>03</span>
              <p>
                <strong>60 秒</strong>后，得分更高者获胜。平分即平局。
              </p>
            </div>
          </section>
          <div className="sidebar-footer">
            <ShieldCheck size={14} />
            <span>服务器裁决 · 同一房间 · 同一局</span>
          </div>
        </aside>
        <section className="game-column" aria-label="双人竞技场">
          <div className="arena-heading">
            <div>
              <span className="tiny-label">THE ARENA</span>
              <h2>
                抢点竞技场<span>01</span>
              </h2>
            </div>
            <div className="match-meta">
              <Radio size={14} />
              <span>{room ? "私人对局" : "等待开局"}</span>
            </div>
          </div>
          <div className="scoreboard">
            <Seat
              player={room?.players[0]}
              index={0}
              yours={room?.players[0]?.id === playerId}
            />
            <div
              className={`timer ${seconds <= 10 && room?.status === "PLAYING" ? "urgent" : ""}`}
            >
              <span>{room?.status === "PAUSED" ? "已暂停" : "剩余时间"}</span>
              <strong data-testid="timer">{minutesDisplay}</strong>
              <small>VS</small>
            </div>
            <Seat
              player={room?.players[1]}
              index={1}
              yours={room?.players[1]?.id === playerId}
            />
          </div>
          <div
            className={`arena ${canPlay ? "playing" : ""}`}
            data-testid="arena"
          >
            <div className="arena-grid" />
            <span className="corner corner-tl" />
            <span className="corner corner-tr" />
            <span className="corner corner-bl" />
            <span className="corner corner-br" />
            <div className="arena-topline">
              <span>
                <i className={canPlay ? "live-dot" : ""} />
                {room?.status === "PLAYING"
                  ? "ROUND LIVE"
                  : room?.status === "FINISHED"
                    ? "ROUND COMPLETE"
                    : "STANDBY"}
              </span>
              <span>60 SEC / 2 PLAYERS</span>
            </div>
            {canPlay && room.target && (
              <button
                key={room.target.id}
                className="target"
                data-testid="target"
                data-target-id={room.target.id}
                style={{ left: `${room.target.x}%`, top: `${room.target.y}%` }}
                aria-label="抢夺当前光点"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  void duel.claim();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (!e.repeat) void duel.claim();
                  }
                }}
              >
                <span className="target-outer" />
                <span className="target-core">
                  <Zap size={24} fill="currentColor" />
                </span>
              </button>
            )}
            {room?.lastClaim &&
              room.status === "PLAYING" &&
              clock - room.lastClaim.at < 700 && (
                <span
                  key={room.lastClaim.targetId}
                  className={`score-pop ${room.lastClaim.playerId === room.players[0]?.id ? "pop-blue" : "pop-coral"}`}
                  style={{
                    left: `${room.lastClaim.x}%`,
                    top: `${room.lastClaim.y}%`,
                  }}
                >
                  +1
                </span>
              )}
            {!canPlay && (
              <div className="arena-overlay">
                {!live && room ? (
                  <>
                    <div className="standby-symbol">
                      <LoaderCircle className="spin" size={30} />
                    </div>
                    <span className="overlay-kicker">CONNECTION LOST</span>
                    <h3>正在恢复连接</h3>
                    <p>
                      服务器暂停对局，最多保留席位 30 秒。
                      <br />
                      连接恢复后继续，不会重复创建玩家。
                    </p>
                  </>
                ) : room?.status === "COUNTDOWN" ? (
                  <>
                    <span className="overlay-kicker">GET READY</span>
                    <div className="countdown-number" data-testid="countdown">
                      {countdown}
                    </div>
                    <p>视线锁定光点，准备出手。</p>
                  </>
                ) : room?.status === "PAUSED" ? (
                  <>
                    <div className="standby-symbol">
                      <LoaderCircle size={30} className="spin" />
                    </div>
                    <span className="overlay-kicker">DUEL PAUSED</span>
                    <h3>等待对手重新连接</h3>
                    <p>
                      计时和得分已冻结。重连窗口剩余 <strong>{grace} 秒</strong>
                      。
                    </p>
                  </>
                ) : room?.status === "FINISHED" ? (
                  <>
                    <div className="standby-symbol result-symbol">
                      <Flag size={29} />
                    </div>
                    <span className="overlay-kicker">ROUND COMPLETE</span>
                    <h3 data-testid="result">
                      {!winner
                        ? "势均力敌，平局！"
                        : winner.id === playerId
                          ? "漂亮，你赢了！"
                          : "差一点，下局再战。"}
                    </h3>
                    <div className="result-score">
                      <span>{room.players[0]?.nickname}</span>
                      <strong>
                        {room.players[0]?.score} <em>:</em>{" "}
                        {room.players[1]?.score}
                      </strong>
                      <span>{room.players[1]?.nickname}</span>
                    </div>
                    <p>
                      {winner ? `${winner.nickname} 赢得本局` : "双方得分相同"}{" "}
                      · 点击「再来一局」继续挑战
                    </p>
                  </>
                ) : (
                  <>
                    <div className="standby-orbit">
                      <div className="standby-symbol">
                        <Crosshair size={32} strokeWidth={1.5} />
                      </div>
                    </div>
                    <span className="overlay-kicker">READY WHEN YOU ARE</span>
                    <h3>
                      {!room
                        ? "竞技场已就绪"
                        : room.players.length < 2
                          ? "等待你的挑战者"
                          : room.players.every((p) => p.ready)
                            ? "即将开始"
                            : you?.ready
                              ? "已准备，等待对手"
                              : "挑战者已就位"}
                    </h3>
                    <p>
                      {!room
                        ? "创建房间，或输入朋友的房间码。"
                        : room.players.length < 2
                          ? "复制邀请链接，把这场对决交给朋友。"
                          : "双方点击「我准备好了」，对决即刻开始。"}
                    </p>
                    <div className="standby-chips">
                      <span>
                        <Users size={13} />
                        双人实时
                      </span>
                      <span>
                        <Crosshair size={13} />
                        一点击分
                      </span>
                      <span>
                        <Zap size={13} />
                        60 秒对决
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="arena-bottomline">
              <span>
                {canPlay
                  ? "点击光点 / CLICK THE SPARK"
                  : "同一个光点，只属于更快的你"}
              </span>
              <Crosshair size={14} />
            </div>
          </div>
          <div className="round-progress">
            <span
              style={{
                width: `${Math.max(0, Math.min(100, (remaining / (room?.durationMs ?? 60_000)) * 100))}%`,
              }}
            />
          </div>
          <div className="arena-footer">
            <span>
              <i />
              {canPlay
                ? duel.feedback || "光点已出现 · 点击即可抢分"
                : "双方准备后自动开始"}
            </span>
            <span>FIRST TO THE SERVER WINS</span>
          </div>
        </section>
      </main>
      <footer className="page-footer">
        <span>
          SPARK DUEL <b>—</b> 一局很短，胜负很真。
        </span>
        <span>本地实时联机 · 无账号 · 无数据持久化</span>
      </footer>
      {confirmLeave && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-title"
          >
            <h3 id="leave-title">离开这场对决？</h3>
            <p>离开后房间将关闭，对手也会收到通知。</p>
            <div>
              <button
                className="button secondary"
                autoFocus
                onClick={() => setConfirmLeave(false)}
              >
                继续留在房间
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setConfirmLeave(false);
                  void duel.leave();
                }}
              >
                确认离开
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
