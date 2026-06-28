// Pure: given a container's current visible order, produce the new order after
// inserting `names` before `beforeName` (or at the end when null). vscode-free → unit-testable.
export function computeContainerOrder(visible: string[], names: string[], beforeName: string | null): string[] {
  const moving = new Set(names);
  const base = visible.filter((n) => !moving.has(n));
  let at = base.length;
  if (beforeName) { const i = base.indexOf(beforeName); if (i >= 0) at = i; }
  return [...base.slice(0, at), ...names, ...base.slice(at)];
}
