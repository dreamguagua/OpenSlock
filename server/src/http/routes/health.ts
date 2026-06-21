/** 健康检查 (无需鉴权)。 */

import type { FastifyInstance } from "fastify";
import { ok } from "../envelope.js";

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ok({ status: "ok" }));
}
