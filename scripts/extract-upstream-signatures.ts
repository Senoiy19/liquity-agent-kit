/**
 * Extracts function signatures from the upstream liquity/bold Solidity sources and writes the fixture that
 * test/abi-drift.test.ts compares the hand-written ABIs against.
 *
 *   git clone https://github.com/liquity/bold /tmp/bold && git -C /tmp/bold checkout <sourceCommit>
 *   npm run abi:extract -- /tmp/bold
 *
 * It parses function declarations and public state-variable getters (including the struct-member flattening
 * Solidity applies to public mappings of structs), expands struct/enum/contract types, and records mutability.
 * It fails if any function in the repo's ABIs cannot be found upstream, or if a name is ambiguous.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { collateralRegistryReadAbi, multiTroveGetterAbi } from "../src/abis/multi-trove-getter.js";
import { borrowerOperationsReadAbi } from "../src/abis/borrower-operations.js";
import { priceFeedAbi } from "../src/abis/price-feed.js";
import { stabilityPoolReadAbi } from "../src/abis/stability-pool.js";
import { troveManagerReadAbi } from "../src/abis/trove-manager.js";
import { abiFunctions, type AbiFn } from "./lib/abi-signature.js";

const GROUPS: Record<string, { abi: readonly AbiFn[]; sources: string[] }> = {
  troveManagerReadAbi: { abi: troveManagerReadAbi as readonly AbiFn[], sources: ["Interfaces/ITroveManager.sol", "TroveManager.sol"] },
  borrowerOperationsReadAbi: { abi: borrowerOperationsReadAbi as readonly AbiFn[], sources: ["Interfaces/IBorrowerOperations.sol", "BorrowerOperations.sol", "Interfaces/ILiquityBase.sol", "Dependencies/LiquityBase.sol"] },
  priceFeedAbi: { abi: priceFeedAbi as readonly AbiFn[], sources: ["Interfaces/IPriceFeed.sol", "Interfaces/IMainnetPriceFeed.sol", "PriceFeeds/MainnetPriceFeedBase.sol"] },
  stabilityPoolReadAbi: { abi: stabilityPoolReadAbi as readonly AbiFn[], sources: ["Interfaces/IStabilityPool.sol", "StabilityPool.sol"] },
  multiTroveGetterAbi: { abi: multiTroveGetterAbi as readonly AbiFn[], sources: ["Interfaces/IMultiTroveGetter.sol", "MultiTroveGetter.sol"] },
  collateralRegistryReadAbi: { abi: collateralRegistryReadAbi as readonly AbiFn[], sources: ["Interfaces/ICollateralRegistry.sol", "CollateralRegistry.sol"] }
};

const repo = process.argv[2];
if (!repo) { console.error("usage: npm run abi:extract -- <path to liquity/bold checkout>"); process.exit(2); }
const srcRoot = join(repo, "contracts", "src");
const commit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".sol") ? [p] : []; });
const files = new Map(walk(srcRoot).map((p) => [relative(srcRoot, p), strip(readFileSync(p, "utf8"))]));

// ---- type index -------------------------------------------------------------------------------------------
interface Field { type: string; name: string }
const structs = new Map<string, Array<{ file: string; fields: Field[] }>>();
const enums = new Set<string>();
const contracts = new Set<string>();
for (const [file, text] of files) {
  for (const m of text.matchAll(/\bstruct\s+(\w+)\s*\{([^}]*)\}/g)) {
    const fields = m[2]!.split(";").map((x) => x.trim()).filter(Boolean).map((x) => { const parts = x.split(/\s+/); return { type: parts.slice(0, -1).join(" "), name: parts.at(-1)! }; });
    structs.set(m[1]!, [...(structs.get(m[1]!) ?? []), { file, fields }]);
  }
  for (const m of text.matchAll(/\benum\s+(\w+)\s*\{/g)) enums.add(m[1]!);
  for (const m of text.matchAll(/\b(?:interface|contract|library)\s+(\w+)/g)) contracts.add(m[1]!);
}

function resolveStruct(name: string, file: string): Field[] | null {
  const defs = structs.get(name);
  if (!defs) return null;
  const local = defs.find((d) => d.file === file);
  if (local) return local.fields;
  const distinct = new Set(defs.map((d) => JSON.stringify(d.fields)));
  if (distinct.size > 1) throw new Error(`Ambiguous struct ${name} (defined differently in ${defs.map((d) => d.file).join(", ")})`);
  return defs[0]!.fields;
}

/** Solidity type text -> canonical ABI type. */
function abiType(raw: string, file: string): string {
  let t = raw.replace(/\b(memory|calldata|storage|payable)\b/g, "").trim().replace(/\s+/g, " ");
  const arr = /((?:\[\d*\])*)$/.exec(t)![1]!; t = t.slice(0, t.length - arr.length).trim();
  t = t.split(".").at(-1)!;
  let base: string;
  if (t === "uint") base = "uint256";
  else if (t === "int") base = "int256";
  else if (/^(u?int\d+|address|bool|bytes\d*|string)$/.test(t)) base = t;
  else if (enums.has(t)) base = "uint8";
  else if (contracts.has(t) || EXTERNAL_CONTRACT_TYPES.has(t)) base = "address";
  else { const f = resolveStruct(t, file); if (!f) throw new Error(`Unknown type "${raw}" in ${file}`); base = `(${f.map((x) => abiType(x.type, file)).join(",")})`; }
  return base + arr;
}
// Contract/interface types that come from dependencies outside contracts/src (OpenZeppelin); all are ABI-encoded as address.
const EXTERNAL_CONTRACT_TYPES = new Set(["IERC20", "IERC20Metadata", "IERC721", "IERC721Metadata"]);
const firstToken = (p: string) => p.trim().split(/\s+/)[0]!; // "uint256[] memory x" -> "uint256[]"
const splitTop = (s: string) => s.trim() === "" ? [] : s.split(",").map((x) => x.trim());

function findFunction(name: string, file: string, text: string) {
  const hits: Array<{ inputs: string[]; outputs: string[]; mut: string; kind: string }> = [];
  for (const m of text.matchAll(/\bfunction\s+(\w+)\s*\(([^)]*)\)([^;{]*)[;{]/g)) {
    if (m[1] !== name) continue;
    const mods = m[3]!;
    const ret = /\breturns\s*\(([^)]*)\)/.exec(mods);
    const head = mods.replace(/\breturns\s*\([^)]*\)/, "");
    const mut = /\b(view|pure)\b/.test(head) ? "view" : /\bpayable\b/.test(head) ? "payable" : "nonpayable";
    hits.push({ inputs: splitTop(m[2]!).map((p) => abiType(firstToken(p), file)), outputs: ret ? splitTop(ret[1]!).map((p) => abiType(firstToken(p), file)) : [], mut, kind: `function in ${file}` });
  }
  for (const m of text.matchAll(/^\s*(mapping\s*\([^;]*?\)|[\w.]+(?:\[\d*\])*)\s+public\s+(?:immutable\s+|constant\s+)?(\w+)\s*(?:=[^;]*)?;/gm)) {
    if (m[2] !== name) continue;
    const decl = m[1]!;
    const map = /^mapping\s*\(\s*([\w.]+)\s*=>\s*([\w.]+)\s*\)$/.exec(decl);
    const valueType = map ? map[2]! : decl;
    const inputs = map ? [abiType(map[1]!, file)] : [];
    const st = resolveStruct(valueType.split(".").at(-1)!, file);
    // Solidity's public getter for a struct returns its members individually, omitting arrays and mappings.
    const outputs = st ? st.filter((f) => !/\[|mapping/.test(f.type)).map((f) => abiType(f.type, file)) : [abiType(valueType, file)];
    hits.push({ inputs, outputs, mut: "view", kind: `public variable in ${file}` });
  }
  return hits;
}

// ---- extraction -------------------------------------------------------------------------------------------
const out: Record<string, Record<string, string>> = {};
const problems: string[] = [];
for (const [group, { abi, sources }] of Object.entries(GROUPS)) {
  out[group] = {};
  for (const fn of abiFunctions(abi)) {
    let found: ReturnType<typeof findFunction> = [];
    let where = "";
    for (const src of sources) {
      const text = files.get(src);
      if (!text) { problems.push(`${group}: source ${src} not found`); continue; }
      found = findFunction(fn.name!, src, text);
      if (found.length) { where = src; break; }
    }
    if (found.length === 0) { problems.push(`${group}.${fn.name}: not found upstream in ${sources.join(", ")}`); continue; }
    if (found.length > 1) { problems.push(`${group}.${fn.name}: ambiguous (${found.length} declarations in ${where})`); continue; }
    const h = found[0]!;
    out[group]![fn.name!] = `${fn.name}(${h.inputs.join(",")})->(${h.outputs.join(",")})|${h.mut}`;
  }
}
if (problems.length) { console.error("Extraction problems:\n  " + problems.join("\n  ")); process.exit(1); }
const target = new URL("../test/fixtures/upstream-abi-signatures.json", import.meta.url);
writeFileSync(target, JSON.stringify({ _source: "liquity/bold contracts/src (parsed by scripts/extract-upstream-signatures.ts)", _commit: commit, groups: out }, null, 1) + "\n");
console.log(`wrote ${target.pathname} @ ${commit} (${Object.values(out).reduce((n, g) => n + Object.keys(g).length, 0)} functions)`);
