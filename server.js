import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import http from "http";
import { WebSocketServer } from "ws";
import { PUBLIC_DIR } from "./lib/doc-store.js";
import { createDocService } from "./lib/doc-service.js";
import { createDocRoutes } from "./routes/doc-routes.js";

const PORT = process.env.PORT || 8080;

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
app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR));
app.use(createDocRoutes({ docService, publicDir: PUBLIC_DIR }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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
