import { app } from "./app";
import { runDailyCleanup } from "./services/maintenance";

export default {
  fetch: app.fetch,

  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runDailyCleanup(env.DB, Date.now()).then((result) => {
        console.log(JSON.stringify({ level: "info", event: "daily_cleanup", ...result }));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
