/**
 * Fastify 应用工厂。依赖可注入 (仓储 / token 解析 / 实时总线),便于测试用内存实现,
 * 生产用 PG + DB 鉴权。
 */

import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { makeAuthenticate, type TokenResolver } from "./auth.js";
import { createServices, type AppRepos } from "./services-context.js";
import type { BlobStore } from "../storage/blob-store.js";
import { OAuthService, providersFromEnv, type OAuthProvider } from "../auth/oauth.js";
import { findOrCreateOAuthLogin } from "../auth/service.js";
import type { MintFn } from "../services/machine.service.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerWebRoutes } from "./routes/web.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerDaemonRoutes } from "./routes/daemon.js";
import { registerWs } from "../realtime/hub.js";
import { registerControlPlane } from "../realtime/control-plane.js";
import { registerDashboard } from "./routes/dashboard.js";
import { RealtimeBus, defaultBus } from "../realtime/bus.js";
import { DaemonHub, defaultDaemonHub } from "../realtime/daemon-hub.js";
import { err } from "./envelope.js";

export interface BuildAppDeps {
  readonly repos: AppRepos;
  readonly resolveToken: TokenResolver;
  readonly bus?: RealtimeBus;
  readonly daemonHub?: DaemonHub;
  /** 凭证签发函数 (内存测试可注入假实现,免连库)。生产用默认 DB 实现。 */
  readonly mint?: MintFn;
  /** 是否挂载开发用仪表盘 (依赖真实 DB,仅生产 server 开启)。 */
  readonly serveDashboard?: boolean;
  /** 附件字节存储 (内存测试注入 MemoryBlobStore)。生产默认本地磁盘。 */
  readonly store?: BlobStore;
  /** OAuth provider(测试注入 fake;生产从 env 装配)。 */
  readonly oauthProviders?: Record<string, OAuthProvider>;
}

export async function buildApp(deps: BuildAppDeps): Promise<FastifyInstance> {
  const bus = deps.bus ?? defaultBus;
  const hub = deps.daemonHub ?? defaultDaemonHub;
  const app = Fastify({ logger: false });

  app.decorate("authenticate", makeAuthenticate(deps.resolveToken));
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  const services = createServices(deps.repos, bus.emit, hub, deps.mint, deps.store);

  const oauth = new OAuthService({
    providers: deps.oauthProviders ?? providersFromEnv(),
    findOrCreateByEmail: findOrCreateOAuthLogin,
  });

  await registerHealthRoutes(app);
  await registerAuthRoutes(app, oauth);
  await registerAgentRoutes(app, services);
  await registerWebRoutes(app, services);
  await registerDaemonRoutes(app);
  await registerWs(app, { resolveToken: deps.resolveToken, bus });
  await registerControlPlane(app, {
    resolveToken: deps.resolveToken, hub, bus,
    machines: services.machines,
    appendActivity: services.activities.append,
  });
  if (deps.serveDashboard) await registerDashboard(app);

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send(err("NOT_FOUND", "route not found")),
  );

  return app;
}
