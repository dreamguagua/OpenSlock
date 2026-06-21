/**
 * WakeService —— 把"新消息/提醒"翻译成"唤醒哪个 agent",经控制面 hub 派发给 daemon。
 * 这是 M3c 的核心:从"人手动跑 daemon"变成"@agent 自动醒来"。
 */

import { mentionedAgents } from "../domain/mention.js";
import type { DaemonHub, AgentStartMessage } from "../realtime/daemon-hub.js";

export interface WakeMessage {
  readonly channelId: string;
  readonly content: string;
  readonly senderType: string;
  readonly senderId: string;
  readonly seq?: number;
  readonly messageId?: string; // 触发消息自身 id(顶层消息将以它为线程根,让 agent 回复都落该线程)
  readonly threadParentId?: string | null; // 触发消息若是线程回复,带上其父消息 id
}

/** 唤醒路由需要知道每个 agent 跑在哪台机器上。 */
export interface WakeAgent {
  readonly handle: string;
  readonly machineId: string | null;
}

/** 分诊用的团队名册条目(含职责),用于让总管按职责分派。 */
export interface RosterEntry {
  readonly handle: string;
  readonly displayName?: string | undefined;
  readonly description?: string | undefined;
}

/** 待分诊的无主任务。 */
export interface TriageTask {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly channelId: string;
  readonly by: string; // 发起人 handle/id
}

/** 总管 handle(谁来分诊无主任务);可用环境变量覆盖,默认 cindy。 */
const DISPATCHER_HANDLE = process.env.CREW_DISPATCHER_HANDLE ?? "cindy";

export class WakeService {
  constructor(
    private readonly hub: DaemonHub,
    /** 返回某 workspace 的全部 agent (handle + 所属 machineId)。 */
    private readonly agents: (workspaceId: string) => Promise<readonly WakeAgent[]>,
    /** 可选:返回退订了某线程的 agent handle 集(用于线程内唤醒时跳过)。 */
    private readonly unfollowedFor?: (workspaceId: string, threadId: string) => Promise<Set<string>>,
    /** 可选:返回某频道的 agent 成员 handle(人类消息广播投递用)。 */
    private readonly channelAgents?: (workspaceId: string, channelId: string) => Promise<string[]>,
  ) {}

  /**
   * 新消息触发的频道分发:
   *  - @到的 agent → 精确唤醒(reason mention),也用于 agent→agent 交接。
   *  - 人类发的普通频道消息 → 广播唤醒该频道的 agent 成员(reason channel),各自判断是否行动。
   *  - agent 发的消息不广播(防风暴),只走 @。排除发送者自己 & 线程退订者。
   * 返回实际派发的 handle。
   */
  async onMessage(workspaceId: string, msg: WakeMessage): Promise<string[]> {
    const agents = await this.agents(workspaceId);
    const byHandle = new Map(agents.map((a) => [a.handle, a]));
    const notSelf = (h: string) => !(msg.senderType === "agent" && msg.senderId === h);

    const mentioned = mentionedAgents(msg.content, agents.map((a) => a.handle)).filter(notSelf);
    // 广播:仅人类消息 → 频道 agent 成员(自选是否行动)
    let broadcast: string[] = [];
    if (msg.senderType === "human" && this.channelAgents) {
      broadcast = (await this.channelAgents(workspaceId, msg.channelId)).filter(notSelf);
    }
    const mentionedSet = new Set(mentioned);
    let targets = [...new Set([...mentioned, ...broadcast])];
    // 线程内消息:跳过已退订该线程的 agent(raft thread unfollow)
    if (msg.threadParentId && this.unfollowedFor) {
      const muted = await this.unfollowedFor(workspaceId, msg.threadParentId);
      if (muted.size) targets = targets.filter((h) => !muted.has(h));
    }
    // 线程根:消息本身是线程回复→沿用其父;否则以这条消息自身为根,让 agent 的确认+后续
    // 回复都落到「该消息的线程」里(消息变任务后即线程根,讨论聚合其下)。
    const threadAnchor = msg.threadParentId ?? msg.messageId;
    const woken: string[] = [];
    for (const handle of targets) {
      const reason = mentionedSet.has(handle) ? "mention" : "channel";
      const sent = this.wake(workspaceId, handle, msg.channelId, reason, {
        ...(msg.seq !== undefined ? { seq: msg.seq } : {}),
        senderHandle: msg.senderId,
        content: msg.content,
        ...(threadAnchor ? { threadId: threadAnchor } : {}),
      }, byHandle.get(handle)?.machineId ?? null);
      if (sent) woken.push(handle);
    }
    return woken;
  }

  /**
   * 分诊:channel 里建了无主任务(没 DM、没 @mention)时,把任务交给总管(默认 Cindy),
   * 让其按团队职责决定派给谁。团队名册+职责直接随唤醒内容下发,总管读到即可 assign。
   * @returns 是否成功派发给总管(总管不存在 / 发起人就是总管 / 无在线 daemon → false)。
   */
  async dispatchTriage(
    workspaceId: string,
    roster: readonly RosterEntry[],
    task: TriageTask,
  ): Promise<boolean> {
    if (task.by === DISPATCHER_HANDLE) return false; // 总管自己发起的,不再回派给自己
    if (!roster.some((a) => a.handle === DISPATCHER_HANDLE)) return false; // 没有总管这个 agent
    const agents = await this.agents(workspaceId);
    const machineId = agents.find((a) => a.handle === DISPATCHER_HANDLE)?.machineId ?? null;
    const team = roster
      .filter((a) => a.handle !== DISPATCHER_HANDLE)
      .map((a) => `- ${a.handle}${a.displayName ? `(${a.displayName})` : ""}: ${a.description?.trim() || "(无职责说明)"}`)
      .join("\n");
    const instruction = [
      "【分诊请求】频道里新建了一个无人认领的任务,需要你作为总管按团队职责把它分派出去:",
      `- 任务: #${task.number} 「${task.title}」 (taskId=${task.id})`,
      `- 发起人: ${task.by}`,
      "",
      "团队成员与职责:",
      team || "(暂无其他成员)",
      "",
      "请判断该任务最该由谁负责,然后执行其一:",
      `  crew task assign ${task.id} --to <handle>   # 指派给最合适的成员`,
      `  crew task claim ${task.id}                   # 如果该你自己做`,
      "若没有合适的人选,在频道里 @发起人 说明并给出建议,不要硬指派。",
    ].join("\n");
    return this.wake(
      workspaceId,
      DISPATCHER_HANDLE,
      task.channelId,
      "triage",
      { content: instruction, senderHandle: "system" },
      machineId,
    );
  }

  /** DM 场景:直接唤醒指定 handle 的 agent(无需 @mention),按其 machine 精确投递。 */
  async wakeAgentByHandle(
    workspaceId: string,
    handle: string,
    channelId: string,
    content: string,
    senderId: string,
    threadParentId?: string | null,
  ): Promise<boolean> {
    if (senderId === handle) return false; // 不唤醒自己
    const agents = await this.agents(workspaceId);
    const a = agents.find((x) => x.handle === handle);
    if (!a) return false;
    return this.wake(workspaceId, handle, channelId, "mention", {
      senderHandle: senderId, content,
      ...(threadParentId ? { threadId: threadParentId } : {}),
    }, a.machineId ?? null);
  }

  /**
   * 唤醒一个 agent。machineId 已知则精确投递到那台机器;否则(或为兜底)
   * 向 workspace 内任一在线 daemon 轮询。返回是否送达 (有在线 daemon)。
   */
  wake(
    workspaceId: string,
    agentHandle: string,
    channelId: string,
    reason: AgentStartMessage["reason"],
    wake?: AgentStartMessage["wake"],
    machineId?: string | null,
  ): boolean {
    const msg: AgentStartMessage = {
      type: "agent:start",
      agentHandle,
      channelId,
      reason,
      ...(wake ? { wake } : {}),
    };
    if (machineId) return this.hub.dispatchToMachine(workspaceId, machineId, msg);
    return this.hub.dispatchAny(workspaceId, msg);
  }
}
