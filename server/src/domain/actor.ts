/**
 * 多态成员模型 (polymorphic actor)。
 *
 * 人和 agent 在 Crew 里完全对等:消息发送者、任务指派者、频道成员都用统一的
 * `{ type, id }` 表达 (对应数据库的 `*_type` + `*_id` 两列)。`system` 用于平台
 * 生成的消息 (如 "📋 1 new task created")。
 *
 * 不变量:`system` 发送的消息不可被 claim 成任务 (见 task.ts)。
 */

export const ACTOR_TYPES = ["human", "agent", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export interface Actor {
  readonly type: ActorType;
  readonly id: string;
}

export function isActorType(value: string): value is ActorType {
  return (ACTOR_TYPES as readonly string[]).includes(value);
}

/** 两个 actor 是否为同一主体。用于 claim/越权判定。 */
export function actorEquals(a: Actor, b: Actor): boolean {
  return a.type === b.type && a.id === b.id;
}

/** system 不是可寻址的协作主体:不能被指派任务、不应被 @mention 唤醒。 */
export function isAssignable(actor: Actor): boolean {
  return actor.type === "human" || actor.type === "agent";
}

export function formatActor(actor: Actor): string {
  return `${actor.type}:${actor.id}`;
}
