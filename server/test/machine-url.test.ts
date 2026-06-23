import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MachineService } from "../src/services/machine.service.js";
import { resolveRequestOrigin } from "../src/http/request-origin.js";
import { detectLanIp, lanServerUrl } from "../src/net/lan-address.js";
import { createMemoryRepos, type MemoryRepos } from "../src/repo/memory/store.js";

describe("resolveRequestOrigin (从请求头推断 base URL)", () => {
  it("用 Host 头", () => {
    expect(resolveRequestOrigin({ host: "192.168.1.20:3000" })).toBe("http://192.168.1.20:3000");
  });

  it("反代:X-Forwarded-Host/Proto 优先于 Host", () => {
    expect(
      resolveRequestOrigin({
        host: "127.0.0.1:3000",
        "x-forwarded-host": "crew.example.com",
        "x-forwarded-proto": "https",
      }),
    ).toBe("https://crew.example.com");
  });

  it("X-Forwarded-* 为逗号列表时只取最外层(第一个)", () => {
    expect(
      resolveRequestOrigin({
        "x-forwarded-host": "crew.example.com, internal-lb",
        "x-forwarded-proto": "https, http",
      }),
    ).toBe("https://crew.example.com");
  });

  it("数组头取首值", () => {
    expect(resolveRequestOrigin({ host: ["a.example.com", "b"] })).toBe("http://a.example.com");
  });

  it("没有 host 头 → undefined", () => {
    expect(resolveRequestOrigin({})).toBeUndefined();
  });
});

describe("detectLanIp / lanServerUrl", () => {
  it("探测结果要么是合法 IPv4、要么 null(无 LAN 网卡时)", () => {
    const ip = detectLanIp();
    if (ip !== null) expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it("lanServerUrl 拼出带端口的 http base URL 或 null", () => {
    const url = lanServerUrl(3000);
    if (url !== null) expect(url).toMatch(/^http:\/\/\d+\.\d+\.\d+\.\d+:3000$/);
  });
});

describe("MachineService 连接命令里的 server 地址解析优先级", () => {
  let repos: MemoryRepos;
  let svc: MachineService;
  const prevPublic = process.env.CREW_PUBLIC_URL;

  beforeEach(() => {
    repos = createMemoryRepos();
    let n = 0;
    const mint = async () => `sk_machine_${"deadbeef".repeat(8)}_${++n}`;
    svc = new MachineService(repos.machines, mint);
    delete process.env.CREW_PUBLIC_URL;
  });

  afterEach(() => {
    if (prevPublic === undefined) delete process.env.CREW_PUBLIC_URL;
    else process.env.CREW_PUBLIC_URL = prevPublic;
  });

  it("CREW_PUBLIC_URL 显式配置优先(域名/生产),并去掉尾部斜杠", async () => {
    process.env.CREW_PUBLIC_URL = "https://crew.example.com/";
    const { connectCommand } = await svc.create("ws1", "box", "http://192.168.1.20:3000");
    expect(connectCommand).toContain("--server-url https://crew.example.com ");
    expect(connectCommand).not.toContain("crew.example.com/ ");
  });

  it("无显式配置时,用非环回请求来源的主机名 + server 端口", async () => {
    const { connectCommand } = await svc.create("ws1", "box", "http://192.168.1.20:3000");
    expect(connectCommand).toContain("--server-url http://192.168.1.20:3000 ");
  });

  it("前端 dev 端口(5173)不嵌入命令,改用 server 自身端口(daemon 直连 :3000)", async () => {
    // 管理员从 vite(:5173) 访问 Web UI,daemon 仍须连 server(:3000)
    const { connectCommand } = await svc.create("ws1", "box", "http://192.168.12.73:5173");
    expect(connectCommand).toContain("--server-url http://192.168.12.73:3000 ");
  });

  it("请求来源是环回时,绝不嵌 127.0.0.1(退化到 LAN 探测或本机)", async () => {
    const { connectCommand } = await svc.create("ws1", "box", "http://127.0.0.1:3000");
    const lan = lanServerUrl(3000);
    if (lan) {
      // 有 LAN 网卡:必须用 LAN IP,不能是 127.0.0.1
      expect(connectCommand).toContain(`--server-url ${lan} `);
      expect(connectCommand).not.toContain("--server-url http://127.0.0.1");
    } else {
      // 无 LAN 网卡(隔离 CI):兜底回到请求来源
      expect(connectCommand).toContain("--server-url http://127.0.0.1:3000 ");
    }
  });

  it("regenerateCommand 同样应用解析优先级(主机名取请求来源,端口取 server 端口)", async () => {
    const { machine } = await svc.create("ws1", "box");
    const res = await svc.regenerateCommand("ws1", machine.id, "http://10.0.0.5:8080");
    expect(res?.connectCommand).toContain("--server-url http://10.0.0.5:3000 ");
  });

  it("机器不存在 → regenerateCommand 返回 null", async () => {
    expect(await svc.regenerateCommand("ws1", "nope")).toBeNull();
  });
});

describe("MachineService.delete(删除机器 + 解绑其上 agent)", () => {
  let repos: MemoryRepos;
  let svc: MachineService;

  beforeEach(() => {
    repos = createMemoryRepos();
    let n = 0;
    const mint = async () => `sk_machine_${"deadbeef".repeat(8)}_${++n}`;
    svc = new MachineService(repos.machines, mint);
  });

  it("删除存在的机器 → 返回 true、机器消失", async () => {
    const { machine } = await svc.create("ws1", "box");
    expect(await svc.delete("ws1", machine.id)).toBe(true);
    expect(await svc.get("ws1", machine.id)).toBeNull();
  });

  it("删除机器只解绑其上 agent(machineId→null),不删 agent 本身", async () => {
    const { machine } = await svc.create("ws1", "box");
    await repos.agents.create("ws1", { handle: "bot", displayName: "Bot", runtime: "claude", machineId: machine.id });
    await repos.agents.create("ws1", { handle: "free", displayName: "Free", runtime: "claude" }); // 未绑机器,不应受影响

    expect(await svc.delete("ws1", machine.id)).toBe(true);

    const bot = await repos.agents.get("ws1", "bot");
    expect(bot).not.toBeNull(); // agent 仍在
    expect(bot?.machineId).toBeNull(); // 已解绑
    const free = await repos.agents.get("ws1", "free");
    expect(free?.machineId).toBeNull();
  });

  it("删除不存在的机器 → 返回 false(路由据此回 404)", async () => {
    expect(await svc.delete("ws1", "nope")).toBe(false);
  });

  it("删除是 workspace 隔离的:不能删别的 workspace 的机器", async () => {
    const { machine } = await svc.create("ws1", "box");
    expect(await svc.delete("ws2", machine.id)).toBe(false);
    expect(await svc.get("ws1", machine.id)).not.toBeNull();
  });
});
