import { setTimeout as delay } from "node:timers/promises";
const secret = process.env.MOBILE_WORKER_SECRET;
if (!secret || secret.length < 32) throw new Error("Set MOBILE_WORKER_SECRET before starting the worker.");
const endpoint = new URL("/api/internal/mobile-worker", process.env.MOBILE_WORKER_URL || "http://leadscope:3000");
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
while (!stopping) {
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "x-worker-secret": secret }, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`worker_http_${response.status}`);
    const result = await response.json();
    await delay(result.state === "idle" ? 5000 : 1500);
  } catch (error) {
    console.error(JSON.stringify({ event: "mobile_worker_retry", code: error instanceof Error ? error.message : "request_failed" }));
    await delay(10000);
  }
}
