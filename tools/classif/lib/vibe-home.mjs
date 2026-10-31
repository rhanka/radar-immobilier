// Per-effort vibe configurations (L0 open point): one private VIBE_HOME per thinking level under
// $CLASSIF_HOME/vibe/<level>/, selected per call with the VIBE_HOME environment variable. Each is
// the user's ~/.vibe/config.toml without its MCP servers, plus classification aliases whose
// `thinking` is the level: glm-5-3-classif (zai-glm-5-3) and mistral-large-4-classif
// (mistral-large-4). GLM prices from the vibe catalog ($1.4/M in, $4.4/M out); Mistral Large 4
// price unknown (left at 0 = cost not computed). Provider keys stay in the system keyring (never copied, never read).
import os from 'node:os';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { privateDir } from './paths.mjs';

export const LEVELS = ['low', 'medium', 'high'];
export const ALIASES = { glm: 'glm-5-3-classif', mistral: 'mistral-large-4-classif' };

export function vibeConfig(base, level) {
  const cut = base.indexOf('\n[[mcp_servers]]');
  const head = (cut >= 0 ? base.slice(0, cut) : base).replace(/^active_model\s*=.*$/m, 'active_model = ""');
  return `${head.trimEnd()}

# --- classification pilot aliases (thinking = ${level}) ---
[[models]]
name = "zai-glm-5-3"
provider = "mistral"
alias = "${ALIASES.glm}"
temperature = 1.0
input_price = 1.4
output_price = 4.4
thinking = "${level}"
supports_images = false

[[models]]
name = "mistral-large-4"
provider = "mistral"
alias = "${ALIASES.mistral}"
temperature = 0.7
thinking = "${level}"
supports_images = false
`;
}

/** Writes (once) and returns the VIBE_HOME directory for `level`. */
export function vibeHome(home, level, { source = path.join(os.homedir(), '.vibe', 'config.toml') } = {}) {
  if (!LEVELS.includes(level)) throw new Error(`vibe level ${level} not in ${LEVELS.join('|')}`);
  const dir = privateDir(path.join(home, 'vibe', level));
  const file = path.join(dir, 'config.toml');
  if (!existsSync(file)) writeFileSync(file, vibeConfig(readFileSync(source, 'utf8'), level), { mode: 0o600 });
  return dir;
}
