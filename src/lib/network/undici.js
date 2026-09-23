// Single choke point for the REAL undici package.
//
// Bun hijacks the bare "undici" specifier (both `import` and `require` resolve
// to its builtin, whose ProxyAgent/dispatcher support differs — proxied
// requests silently go DIRECT). Neither tsconfig `paths` nor a preload plugin
// overrides that for files outside the server root, so resolve the installed
// package by explicit relative path. This file lives at src/lib/network/,
// hence ../../../node_modules.
import {
  Agent,
  ProxyAgent,
  fetch,
  request,
  Client,
  Pool,
  BalancedPool,
} from "../../../node_modules/undici/index.js";

export { Agent, ProxyAgent, fetch, request, Client, Pool, BalancedPool };
export const undiciFetch = fetch;
