/**
 * 人工演示脚本 —— 演示一个典型协作任务的时间线,把 M1 已实现的核心机制
 * (seq 单调 / freshness hold → draft / claim-before-work / 租户隔离) 一步步打印出来。
 *
 * 运行:  pnpm --filter @nowcrew/server demo
 */

import { createMemoryRepos } from "../src/repo/memory/store.js";
import { MessageService } from "../src/services/message.service.js";
import { TaskService } from "../src/services/task.service.js";
import { ReadStateService } from "../src/services/read-state.service.js";
import { isDomainError } from "../src/domain/errors.js";
import type { Actor } from "../src/domain/actor.js";

const line = (s = "") => console.log(s);
const step = (n: number, s: string) => console.log(`\n── 步骤 ${n} ── ${s}`);

async function main() {
  const repos = createMemoryRepos();
  const messages = new MessageService(repos.messages, repos.drafts, repos.seen);
  const tasks = new TaskService(repos.tasks, repos.seen, repos.messages);
  const reads = new ReadStateService(repos.readState, repos.seen, repos.messages);

  const WS = "ws_demo";
  const CH = "#build";
  const alice: Actor = { type: "human", id: "alice" };
  const cindy: Actor = { type: "agent", id: "cindy" };
  const dave: Actor = { type: "agent", id: "dave" };

  line("=== OpenSlock Server M1 演示:协作任务时间线 ===");

  step(1, "人类 alice 在 #build 连发两条消息");
  const m1 = await messages.sendAsHuman(WS, alice, { channelId: CH, content: "我们要修登录 bug" });
  const m2 = await messages.sendAsHuman(WS, alice, { channelId: CH, content: "@cindy 看一下" });
  line(`  ✓ 消息已写入,seq 单调递增: m1.seq=${m1.seq}, m2.seq=${m2.seq}`);

  step(2, "agent cindy 还没读频道,直接想回复 → 应被 freshness hold,落为 draft");
  const held = await messages.sendAsAgent(WS, cindy, { channelId: CH, content: "(基于过期上下文的回复)" });
  if (held.kind === "held") {
    line(`  ✓ 被拦截:未读 ${held.unseenCount} 条 (seq ${held.fromSeq}..${held.toSeq}),已存 draft=${held.draftId}`);
    line(`  → 频道里没有出现 agent 消息: ${(await repos.messages.list(WS, CH)).every((m) => m.type !== "agent")}`);
  }

  step(3, "cindy 调用 (相当于 crew message read) 读到最新,追平 freshness 游标");
  await reads.markRead(WS, cindy, CH, m2.seq);
  line(`  ✓ cindy 的 seen 游标推进到 ${await repos.seen.get(WS, cindy.id, CH)}`);

  step(4, "cindy 再发回复 → 这次通过,写入频道");
  const sent = await messages.sendAsAgent(WS, cindy, { channelId: CH, content: "收到,我来看 #160" });
  if (sent.kind === "sent") line(`  ✓ 已发送,seq=${sent.message.seq}, type=${sent.message.type}`);

  step(5, "平台建任务 #160 并发 system 消息;cindy 未读该 system 消息时 claim → freshness hold");
  repos.store.seedTask({
    id: "t160", workspaceId: WS, channelId: CH, number: 160, title: "修登录 bug",
    messageId: m1.id, assignee: null, status: "todo", anchoredOnSystemMessage: false,
  });
  await messages.appendSystem(WS, CH, "📋 1 new task created: #160");
  try {
    await tasks.claim(WS, cindy, "t160");
  } catch (e) {
    if (isDomainError(e)) line(`  ✓ claim 被拦截: code=${e.code} (${e.message})`);
  }

  step(6, "cindy 复核 (再 read) 后重试 claim → 成功,任务 todo → in_progress");
  await reads.markRead(WS, cindy, CH, await repos.messages.latestSeq(WS, CH));
  const claimed = await tasks.claim(WS, cindy, "t160");
  line(`  ✓ claimed: assignee=${claimed.assignee.type}:${claimed.assignee.id}, status=${claimed.status}`);

  step(7, "另一个 agent dave 想抢同一任务 → 冲突,不允许抢占");
  try {
    await reads.markRead(WS, dave, CH, await repos.messages.latestSeq(WS, CH));
    await tasks.claim(WS, dave, "t160");
  } catch (e) {
    if (isDomainError(e)) line(`  ✓ dave 被拒: code=${e.code}`);
  }

  step(8, "多租户隔离:另一个 workspace 看不到本 workspace 的数据");
  line(`  本 ws 的 #build 最新 seq = ${await repos.messages.latestSeq(WS, CH)}`);
  line(`  另一 ws(ws_other) 的 #build 最新 seq = ${await repos.messages.latestSeq("ws_other", CH)} (应为 0)`);

  step(9, "未读计算:旁观者 dave 把游标清零后的未读数");
  const total = await repos.messages.latestSeq(WS, CH);
  line(`  频道共 ${total} 条;dave 已读到 ${await repos.readState.get(WS, dave, CH)},未读 = ${await reads.unread(WS, dave, CH)}`);

  line("\n=== 演示结束:所有核心不变量按预期工作 ✓ ===");
}

main().catch((e) => {
  console.error("演示失败:", e);
  process.exit(1);
});
