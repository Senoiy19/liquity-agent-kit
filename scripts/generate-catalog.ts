import { writeFileSync } from "node:fs";
import { buildCapabilityCatalog } from "../src/agent-tools/capability-catalog.js";

const path = new URL("../schemas/capability-catalog.json", import.meta.url);
writeFileSync(path, JSON.stringify(buildCapabilityCatalog(), null, 2) + "\n");
console.log(`wrote ${path.pathname}`);
