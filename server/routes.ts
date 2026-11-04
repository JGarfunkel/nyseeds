import express, { type Express } from "express";
import { createServer, type Server } from "http";
import path from "path";
import { registerAllRoutes as registerOrdinizerRoutes } from "@civillyengaged/ordinizer-server";
import { ORDINIZER_CONTEXT_PATH } from "server";

/**
 * NYSeeds Server Routes
 * 
 * NYSeeds is a wrapper website that hosts the Ordinizer application
 * and potentially other components in the future.
 * 
 * The Ordinizer municipal statute analysis app is mounted at:
 * - Frontend: /ordinizer/*
 * - API: /api/ordinizer/*
 */

export async function registerRoutes(app: Express): Promise<Server> {
  // Mount Ordinizer application routes at /api/ordinizer
  //const dataPath = path.join(process.cwd(), "data");
  await registerOrdinizerRoutes(app, "/api" + ORDINIZER_CONTEXT_PATH);
  
  // Open space parcels. The data files (index.json, per-county CSV, per-municipality
  // GeoJSON) live in a public R2 bucket named by OPENSPACE_DATA_URL, and the browser
  // fetches them directly. Without that setting, serve the local build output from
  // scripts/openspace/build_county.py so the page works in development.
  app.get("/api/openspace/config", (_req, res) => {
    res.json({ dataUrl: process.env.OPENSPACE_DATA_URL || "/openspace-data" });
  });
  if (!process.env.OPENSPACE_DATA_URL) {
    app.use(
      "/openspace-data",
      express.static(path.resolve(process.cwd(), "local", "openspace"), { fallthrough: false }),
    );
  }

  // Future: Add other application routes here
  
  // Health check endpoint for the wrapper
  app.get("/api/health", (_req, res) => {
    res.json({ 
      status: "ok",
      message: "NYSeeds wrapper is running",
      apps: ["ordinizer", "openspace"]
    });
  });
  
  const server = createServer(app);
  return server;
}
