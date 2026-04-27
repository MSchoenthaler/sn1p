import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import http from "http";
import { WebSocketServer } from "ws";
import { PUBLIC_DIR } from "./lib/doc-store.js";
import { createDocService } from "./lib/doc-service.js";
import { createDocRoutes } from "./routes/doc-routes.js";

const PORT = process.env.PORT || 8080;
const HTTP_JSON_LIMIT = process.env.HTTP_JSON_LIMIT || "10mb";
const WS_MAX_PAYLOAD_BYTES = Number(process.env.WS_MAX_PAYLOAD_BYTES) || 256 * 1024 * 1024;

const app = express();
const docService = createDocService();

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "script-src": ["'self'"],
        "connect-src": ["'self'"]
      }
    }
  })
);
app.use(morgan("dev"));
app.use(express.json({ limit: HTTP_JSON_LIMIT }));
app.use(express.static(PUBLIC_DIR, { index: false }));
app.use(createDocRoutes({ docService, publicDir: PUBLIC_DIR }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: WS_MAX_PAYLOAD_BYTES });

wss.on("connection", (ws, req) => {
  docService.handleWsConnection(ws, req).catch((err) => {
    console.error("WS connection setup error:", err);
    try {
      ws.close(1011, "Server error");
    } catch {
      // ignore close errors
    }
  });
});

server.listen(PORT, () => {
  console.log(`sn1p-node listening on http://localhost:${PORT}`);
});
