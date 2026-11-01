import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/bark-weather-dashboard/",
  plugins: [react()],
  define: { "import.meta.env.VITE_MANAGEMENT_API_URL": JSON.stringify("https://bark-control-oldwung.adou19970815.chatgpt.site") },
  build: { sourcemap: false },
});
