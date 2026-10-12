import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({plugins:[react()],server:{fs:{deny:["**/.git/**","**/.env*","**/data/**","**/server/**","**/tests/**"]}}});
