// Сборка + установка плагина в vault (для разработки)
import { execSync } from "child_process";
import { mkdirSync, copyFileSync } from "fs";

const VAULT_PLUGIN_DIR =
  "C:/Obsidian/Gray Fog Hub/.obsidian/plugins/tome-reader";

execSync("npm run build", { stdio: "inherit" });
mkdirSync(VAULT_PLUGIN_DIR, { recursive: true });
for (const f of ["manifest.json", "main.js", "styles.css"]) {
  copyFileSync(f, `${VAULT_PLUGIN_DIR}/${f}`);
}
console.log("✅ Tome установлен в vault:", VAULT_PLUGIN_DIR);
