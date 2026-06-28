// Normalize a command argument that may be a tree TreeItem element OR a webview payload.
// vscode-free → unit-testable.
export function sessionArg(a: any): { name: string; label?: string } | undefined {
  if (a && a.kind === "session" && a.node) return { name: a.node.name, label: a.node.label };
  if (a && typeof a.name === "string") return { name: a.name, label: a.label };
  return undefined;
}
export function groupArg(a: any): { id: string; name: string } | undefined {
  if (a && a.kind === "group") return { id: a.id, name: a.name };
  if (a && typeof a.id === "string") return { id: a.id, name: a.name };
  return undefined;
}
