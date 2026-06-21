import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 反代到 server (:3000),前端同源调用,免 CORS;/ws 走 WebSocket 反代。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // 绑定所有网卡 (localhost + 127.0.0.1 + 局域网),避免只绑 IPv6 ::1
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/agent": { target: "http://127.0.0.1:3000", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:3000", ws: true },
    },
  },
});
