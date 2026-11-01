import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/bark-weather-dashboard/",
  plugins: [react()],
  build: { sourcemap: false },
});
