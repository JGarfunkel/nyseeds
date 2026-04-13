import type { Express } from "express";
import { createServer, type Server } from "http";
import path from "path";
import { registerRoutes as registerOrdinizerRoutes } from "ordinizer/app/server/routes";

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
  // Pass nyseeds/data as the data directory path
  const dataPath = path.join(process.cwd(), "data");
  await registerOrdinizerRoutes(app, "/api/ordinizer", dataPath);
  
  // Future: Add other application routes here
  // Example:
  // app.get("/api/other-app/...", ...)
  
  // Health check endpoint for the wrapper
  app.get("/api/health", (_req, res) => {
    res.json({ 
      status: "ok",
      message: "NYSeeds wrapper is running",
      apps: ["ordinizer"]
    });
  });
  
  const server = createServer(app);
  return server;
}
