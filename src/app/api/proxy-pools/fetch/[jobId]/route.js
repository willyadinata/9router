import { NextResponse } from "next/server";
import { getFetchJob } from "../jobs.js";

// GET /api/proxy-pools/fetch/[jobId] - Poll a fetch-and-merge job.
export async function GET(request, { params }) {
  try {
    const { jobId } = await params;
    const job = getFetchJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Fetch job not found" }, { status: 404 });
    }
    return NextResponse.json({
      jobId: job.jobId,
      phase: job.phase,
      total: job.total,
      checked: job.checked,
      alive: job.alive,
      done: job.done,
      error: job.error,
      result: job.result,
      startedAt: job.startedAt,
    });
  } catch (error) {
    console.log("Error reading proxy fetch job:", error);
    return NextResponse.json({ error: "Failed to read fetch job" }, { status: 500 });
  }
}
