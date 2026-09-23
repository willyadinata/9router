// Browser stub for the `os` builtin pulled in by engine config modules the
// dashboard imports (open-sse/providers/shared.js platform/arch fingerprint).
// Runtime-derived so generated client configs match the operator's machine.
export function platform() {
  if (typeof navigator === "undefined") return "linux";
  const p = navigator.platform || navigator.userAgent || "";
  if (/mac/i.test(p)) return "darwin";
  if (/win/i.test(p)) return "win32";
  return "linux";
}

export function arch() {
  return "x64";
}

export default { platform, arch };
