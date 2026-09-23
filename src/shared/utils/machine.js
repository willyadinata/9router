import { getConsistentMachineId } from "./machineId";

// Get the per-run machine ID (random stand-in, salted)
export async function getMachineId() {
  return await getConsistentMachineId();
}
