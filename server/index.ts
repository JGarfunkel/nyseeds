import "./env-defaults";
import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import ejs from "ejs";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

export const ORDINIZER_CONTEXT_PATH = process.env.ORDINIZER_CONTEXT_PATH || "/ordinizer";

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

// EJS configuration for server-side rendering
app.engine("html", ejs.renderFile);
app.set("view engine", "html");
app.set("views", path.resolve(process.cwd(), "client"));
const staticRoot = path.resolve(process.cwd(), "client", "public");
const projectsRoot = path.resolve(process.cwd(), "client", "public", "projects");

interface ProposalMeta {
  title: string;
  subtitle?: string;
  date?: string;
  tags?: string[];
  status?: string;
}

interface ProposalEntry {
  slug: string;
  meta: ProposalMeta;
  formattedDate: string;
}

let proposalsCache: ProposalEntry[] = [];

const parseProposalFile = (fileName: string): ProposalEntry => {
  const slug = fileName.replace(/\.html$/, "");
  let meta: ProposalMeta = { title: slug.replace(/-/g, " "), status: "proposed" };

  try {
    const content = fs.readFileSync(path.join(projectsRoot, fileName), "utf-8");
    const get = (field: string) => {
      const m = content.match(new RegExp(`<meta[^>]+name="proposal:${field}"[^>]+content="([^"]+)"`))
        ?? content.match(new RegExp(`<meta[^>]+content="([^"]+)"[^>]+name="proposal:${field}"`));
      return m ? m[1] : "";
    };

    const title = get("title");
    const date = get("date");
    const status = get("status");
    const tags = get("tags");

    if (title) meta.title = title;
    if (date) meta.date = date;
    if (status) meta.status = status;
    if (tags) meta.tags = tags.split(",").map(t => t.trim());

    const subtitleMatch = content.match(/<p[^>]*class="[^"]*\bsubtitle\b[^"]*"[^>]*>(.*?)<\/p>/s);
    if (subtitleMatch) meta.subtitle = subtitleMatch[1].replace(/<[^>]+>/g, "").trim();
  } catch {}

  let formattedDate = "";
  if (meta.date) {
    formattedDate = new Date(`${meta.date}T00:00:00`).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  return { slug, meta, formattedDate };
};

const rebuildProposalsCache = () => {
  let files: string[] = [];
  try {
    files = fs.readdirSync(projectsRoot).filter(f => f.endsWith(".html"));
  } catch {
    proposalsCache = [];
    return;
  }

  const parsed = files.map(parseProposalFile);
  parsed.sort((a, b) => (b.meta.date ?? "").localeCompare(a.meta.date ?? ""));
  proposalsCache = parsed;
};

const watchProposalsCache = () => {
  try {
    fs.watch(projectsRoot, (eventType, fileName) => {
      if (!fileName || !fileName.endsWith(".html")) return;
      if (eventType !== "rename" && eventType !== "change") return;
      rebuildProposalsCache();
    });
  } catch {
    // If the directory does not exist yet or watcher setup fails, requests still use the latest built cache.
  }
};

(async () => {
  try {
    console.log("Starting server...");
    const server = await registerRoutes(app);
    console.log("Routes registered.");

    // Serve client/public as static (CSS, images, etc.)
    app.use(express.static(staticRoot));

    rebuildProposalsCache();
    watchProposalsCache();

    // Projects index - backwards compatible route for /advocacy (used in the past for advocacy proposals)
    app.get(['/advocacy', '/advocacy/'], (req, res) => {
      res.render('proposals-index', { proposals: proposalsCache, requestPath: req.path });
    });

    // About page
    app.get(['/about', '/about/'], (req, res) => {
      res.render(path.join('public', 'about'), { requestPath: req.path });
    });

    // Proposals index
    app.get(['/projects', '/projects/'], (req, res) => {
      res.render('proposals-index', { proposals: proposalsCache, requestPath: req.path });
    });


    // Render proposals via EJS - backwards compatible route for /advocacy/:name (used in the past for advocacy proposals)
    app.get('/advocacy/:name', (req, res, next) => {
      res.render(path.join('public', 'projects', req.params.name), { requestPath: req.path }, (err, html) => {
        if (err) return next();
        res.send(html);
      });
    });

    // Render proposals via EJS (views root is client/, so path is relative to that)
    app.get('/projects/:name', (req, res, next) => {
      res.render(path.join('public', 'projects', req.params.name), { requestPath: req.path }, (err, html) => {
        if (err) return next();
        res.send(html);
      });
    });

    app.get('*', (req, res, next) => {
      if (req.path.includes('.') || req.path.startsWith('/api')) {
        return next();
      }
      const path = require("path");
      const ordinizerDist = path.resolve(process.cwd(), "dist", "public");
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(ordinizerDist, "index.html"));
    });

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

    // Serve static assets under /ordinizer.
    // index.html gets no-cache so stale hashes after a deploy don't cause JS
    // files to be served as text/html (browser re-checks on every load).
    app.use(ORDINIZER_CONTEXT_PATH, expressStatic(ordinizerDist, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      }
    }));
    // SPA fallback for client-side routes under /ordinizer.
    // Must NOT serve index.html for paths with extensions — if an asset is
    // missing (stale hash, rolling deploy) the client should get a 404, not
    // an HTML document that the browser will reject as application/javascript.
    app.get(`${ORDINIZER_CONTEXT_PATH}/*`, (req, res, next) => {
      if (req.path.includes('.')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(ordinizerDist, "index.html"));
    });

    // Example: Add more SPAs/static sites here
    // const docsDist = path.resolve(process.cwd(), "dist", "docs");
    // app.use("/docs", expressStatic(docsDist));
    // app.get("/docs/*", (_req, res) => {
    //   res.sendFile(path.join(docsDist, "index.html"));
    // });

    console.log(`Static serving setup for ${ORDINIZER_CONTEXT_PATH} (and more if added).`);
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
  }, () => {
    log(`serving on port ${port}`);
  });
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
})();
