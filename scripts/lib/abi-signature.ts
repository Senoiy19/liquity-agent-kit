/** Canonical, name-independent signature strings, shared by the upstream extractor and the drift test. */
export interface AbiParam { type: string; components?: readonly AbiParam[] }
export interface AbiFn { type: string; name?: string; stateMutability?: string; inputs?: readonly AbiParam[]; outputs?: readonly AbiParam[] }

export function canonicalType(p: AbiParam): string {
  if (p.type.startsWith("tuple")) return `(${(p.components ?? []).map(canonicalType).join(",")})${p.type.slice("tuple".length)}`;
  return p.type;
}
/** `name(inputs)->(outputs)|mutability`, e.g. `getTroveStatus(uint256)->(uint8)|view`. */
export function canonicalFunction(f: AbiFn): string {
  return `${f.name}(${(f.inputs ?? []).map(canonicalType).join(",")})->(${(f.outputs ?? []).map(canonicalType).join(",")})|${f.stateMutability}`;
}
export function abiFunctions(abi: readonly AbiFn[]): AbiFn[] { return abi.filter((i) => i.type === "function"); }
