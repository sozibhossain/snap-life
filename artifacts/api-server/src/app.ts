import { initSentry, attachSentryErrorHandler } from "./lib/sentry";
initSentry();

import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { securityHeaders } from "./middlewares/security";
import { authLimiter } from "./middlewares/rateLimit";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk proxy must be mounted BEFORE body parsers — it streams raw bytes.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

const REPLIT_DOMAINS = (process.env.REPLIT_DOMAINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  if (host === "localhost" || host.startsWith("localhost:")) return true;
  if (host === "127.0.0.1" || host.startsWith("127.0.0.1:")) return true;
  if (REPLIT_DOMAINS.includes(host)) return true;
  if (CORS_ALLOWED_ORIGINS.includes(origin)) return true;
  if (CORS_ALLOWED_ORIGINS.includes(host)) return true;
  return false;
}

app.use(
  cors({
    credentials: true,
    origin: (origin, cb) => {
      if (isOriginAllowed(origin)) cb(null, true);
      else cb(new Error(`Origin ${origin ?? "<none>"} not allowed by CORS`));
    },
  }),
);
// Security headers (helmet + tuned CSP). Mounted after CORS/proxy so
// preflight/Clerk-proxy responses aren't accidentally rewritten, but
// before route handlers so every JSON response carries the headers.
app.use(securityHeaders());

// Trust the Replit edge proxy so `req.ip` reflects the real client
// address, which the rate-limit key generators rely on for pre-auth
// surfaces.
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Pre-auth rate limit on the auth surface (5/min/IP).
app.use("/api/auth", authLimiter);

const CLERK_PUBLISHABLE_KEY =
  process.env.CLERK_PUBLISHABLE_KEY ?? process.env.VITE_CLERK_PUBLISHABLE_KEY;

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

attachSentryErrorHandler(app);

export default app;
