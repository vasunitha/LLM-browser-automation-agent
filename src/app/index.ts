import express, { type Express } from "express";
import path from "node:path";
import type Database from "better-sqlite3";
import { createRouter } from "./routes";

/**
 * Credit Union Teller Console — the target application the computer-use
 * agent will later operate. Implements both approved capabilities:
 * get-savings-balance (member search -> detail -> savings balance) and
 * open-sub-account (search -> multi-field form -> validation ->
 * confirmation). See routes.ts for the actual flow.
 */
export function createApp(db: Database.Database): Express {
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", phase: 3 });
  });

  app.use(createRouter(db));

  return app;
}
