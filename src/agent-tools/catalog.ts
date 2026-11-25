import { agentTools } from "./tools.js";

/** Machine-readable catalog derived from the executable tool definitions, so docs and code cannot drift. */
export const agentToolCatalog = agentTools.map(({ name, group, sideEffects, description, inputSchema }) => ({ name, group, sideEffects, description, inputSchema }));
