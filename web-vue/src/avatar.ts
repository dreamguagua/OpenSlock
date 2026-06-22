/**
 * 头像方案:DiceBear(开源、确定性 seed,本地生成 SVG,无运行时外部依赖)。
 * 按成员类型选风格:human=像素小人 / agent=机器人(贴合 AI)/ system=抽象形状。
 * seed 用 handle/id,保证同一主体永远同一头像。
 */

import { createAvatar } from "@dicebear/core";
import { pixelArt, bottts, shapes } from "@dicebear/collection";
import type { ActorType } from "./types.js";

const cache = new Map<string, string>();

export function avatarDataUri(type: ActorType, seed: string): string {
  const key = `${type}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const opts = { seed, radius: 0, backgroundColor: backgroundFor(type) };
  // 按风格分支调用(各 style 的 options 类型不同,不能共用联合类型)
  const svg = (
    type === "agent"
      ? createAvatar(bottts, opts)
      : type === "system"
        ? createAvatar(shapes, opts)
        : createAvatar(pixelArt, opts)
  ).toString();
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
}

function backgroundFor(type: ActorType): string[] {
  if (type === "agent") return ["b6e3a7", "c0e8d5"]; // 绿调
  if (type === "system") return ["d9d2c4"]; // 灰
  return ["c9e0ff", "d6e8ff"]; // 蓝调(human)
}
