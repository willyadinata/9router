import crypto from "node:crypto";

let cachedRawId = null;

// 64-hex stand-in for the hardware id — same shape as node-machine-id's default output,
// never read from the machine. Prefers the id the server stamped for this run so
// engine-side ids (grok-cli deviceId) stay consistent with the rest of the process.
function loadRawMachineId() {
  if (cachedRawId) return cachedRawId;
  cachedRawId = process.env.NINEROUTER_MACHINE_ID || crypto.randomBytes(32).toString("hex");
  return cachedRawId;
}

export async function getConsistentMachineId(salt = "endpoint-proxy-salt") {
  const rawId = loadRawMachineId();
  return crypto.createHash("sha256").update(rawId + salt).digest("hex").substring(0, 16);
}
