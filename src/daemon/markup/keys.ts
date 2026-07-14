// Deterministic element keys. A key is the element's position in the compiled
// tree — the chain of child indices from the root — prefixed with its component
// type for legibility. Identical markup therefore compiles to identical keys on
// every push, so RFC 6902 patches and edit round-trips address the same element
// across re-renders. The root is always "root".

const ROOT_KEY = "root";

export function elementKeyFor(componentType: string, indexPath: readonly number[]): string {
  if (indexPath.length === 0) return ROOT_KEY;
  const typeSlug = componentType.toLowerCase();
  return `${typeSlug}-${indexPath.join("-")}`;
}

export { ROOT_KEY };
