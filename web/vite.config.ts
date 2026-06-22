import { defineConfig, type ProxyOptions } from "vite";
import vue from "@vitejs/plugin-vue";

// changeOrigin 会把 Host 改成 target(127.0.0.1),server 就拿不到「管理员访问 Web UI 的真实主机」。
// 故显式补发 X-Forwarded-Host,让 server 生成连接命令时仍能用到你访问用的 LAN 主机(如 192.168.x.x)。
const forwardHost: Pick<ProxyOptions, "configure"> = {
  configure: (proxy) => {
    proxy.on("proxyReq", (proxyReq, req) => {
      const host = req.headers.host;
      if (host) proxyReq.setHeader("x-forwarded-host", host);
      proxyReq.setHeader("x-forwarded-proto", "http");
    });
  },
};

// 反代到 server (:3000),前端同源调用,免 CORS;/ws 走 WebSocket 反代。
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: true, // 绑定所有网卡 (localhost + 127.0.0.1 + 局域网),避免只绑 IPv6 ::1
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true, ...forwardHost },
      "/agent": { target: "http://127.0.0.1:3000", changeOrigin: true, ...forwardHost },
      "/ws": { target: "ws://127.0.0.1:3000", ws: true },
    },
  },
});
