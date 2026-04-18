import express from "express";
import path from "path";
import { allocateDocId, sanitizeDocName } from "../lib/doc-store.js";

export function createDocRoutes({ docService, publicDir }) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    try {
      const id = await allocateDocId();
      return res.redirect(303, `/${id}`);
    } catch (err) {
      console.error(err);
      return res.status(500).send("Failed to allocate document id");
    }
  });

  router.get("/api/doc/:doc", async (req, res) => {
    try {
      const result = await docService.getDocMeta(req.params.doc);
      res.status(result.status).json(result.body);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load doc" });
    }
  });

  router.post("/api/doc/:doc/unlock", async (req, res) => {
    try {
      const result = await docService.unlockDocument(req.params.doc, req.body?.auth);
      res.status(result.status).json(result.body);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to unlock doc" });
    }
  });

  router.get("/:doc", (req, res) => {
    sanitizeDocName(req.params.doc);
    res.sendFile(path.join(publicDir, "index.html"));
  });

  return router;
}
