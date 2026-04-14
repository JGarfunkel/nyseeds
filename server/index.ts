import "./env-defaults";
import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    console.log("Starting server...");
    const server = await registerRoutes(app);
    console.log("Routes registered.");

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    console.log("Setting up Vite...");
    await setupVite(app, server);
    console.log("Vite setup complete.");

  } else {
    // Example: Serve /ordinizer SPA
    const path = require("path");
    const expressStatic = express.static;
    const ordinizerDist = path.resolve(process.cwd(), "dist", "public");

    // Serve static assets under /ordinizer
    app.use("/ordinizer", expressStatic(ordinizerDist));
    // Catch-all for client-side routing under /ordinizer
    app.get("/ordinizer/*", (_req, res) => {
      res.sendFile(path.join(ordinizerDist, "index.html"));
    });

    // Example: Add more SPAs/static sites here
    // const docsDist = path.resolve(process.cwd(), "dist", "docs");
    // app.use("/docs", expressStatic(docsDist));
    // app.get("/docs/*", (_req, res) => {
    //   res.sendFile(path.join(docsDist, "index.html"));
    // });

    console.log("Static serving setup for /ordinizer (and more if added).");
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  console.log(`Attempting to listen on port ${port}...`);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
})();
