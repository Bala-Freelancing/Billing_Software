import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { AppError, handleError } from "./lib/errors";
import { requestContext, sameOriginOnly } from "./middleware";
import { authRoutes } from "./routes/auth";
import { masterRoutes } from "./routes/masters";
import { purchaseRoutes } from "./routes/purchases";
import type { AppEnv } from "./types";

export const app = new Hono<AppEnv>();

app.use("/api/*", requestContext);
app.use(
  "/api/*",
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    strictTransportSecurity: "max-age=31536000; includeSubDomains",
  }),
);
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 64 * 1024,
    onError: () => {
      throw new AppError(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
    },
  }),
);
app.use("/api/*", sameOriginOnly);

app.get("/api/health", async (c) => {
  await c.env.DB.prepare("SELECT 1").first();
  return c.json({ status: "ok" });
});

app.route("/api/auth", authRoutes);
app.route("/api", masterRoutes);
app.route("/api", purchaseRoutes);

app.notFound((c) => {
  throw new AppError(404, "NOT_FOUND", `No API route for ${c.req.method} ${c.req.path}`);
});
app.onError(handleError);
