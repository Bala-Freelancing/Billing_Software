import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// One build produces both the React app (static assets) and the Worker (API).
// `vite dev` runs the Worker inside the real workerd runtime with a local D1.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  build: {
    sourcemap: true,
  },
});
