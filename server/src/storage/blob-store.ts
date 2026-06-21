/**
 * 二进制存储抽象 —— 附件字节落地。
 *
 * 元数据进 DB (attachment 表),字节进 BlobStore。默认本地磁盘实现;测试注入内存实现。
 * 后续接 S3/OSS 时只需新增一个 BlobStore 实现,不动 service/路由。
 */

import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";

export interface BlobStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** 本地磁盘:key 作为 root 下的相对路径。 */
export class LocalBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    // 防目录穿越:key 只允许 [\w/-.],且不含 ".."
    if (key.includes("..") || !/^[\w./-]+$/.test(key)) throw new Error(`invalid storage key: ${key}`);
    return join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}

/** 内存实现 (测试用)。 */
export class MemoryBlobStore implements BlobStore {
  private readonly map = new Map<string, Buffer>();
  async put(key: string, data: Buffer): Promise<void> { this.map.set(key, data); }
  async get(key: string): Promise<Buffer> {
    const b = this.map.get(key);
    if (!b) throw new Error(`blob not found: ${key}`);
    return b;
  }
  async delete(key: string): Promise<void> { this.map.delete(key); }
}

/** 默认存储:CREW_UPLOAD_DIR 或 <cwd>/.uploads。 */
export function defaultBlobStore(): BlobStore {
  const root = process.env.CREW_UPLOAD_DIR ?? join(process.cwd(), ".uploads");
  return new LocalBlobStore(root);
}
