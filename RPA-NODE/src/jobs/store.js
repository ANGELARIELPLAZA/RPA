const crypto = require("crypto");

const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

function createJob(payload) {
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();

    jobs.set(jobId, {
        id: jobId,
        payload,
        createdAt: now,
        updatedAt: now,
        status: "pending",
        result: null,
        error: null,
    });

    return getJob(jobId);
}

function getJob(jobId) {
    return jobs.get(jobId) || null;
}

function updateJob(jobId, updates) {
    const job = getJob(jobId);
    if (!job) {
        return null;
    }

    const nextJob = {
        ...job,
        ...updates,
        updatedAt: new Date().toISOString(),
    };

    jobs.set(jobId, nextJob);
    return nextJob;
}

function deleteExpiredJobs() {
    const now = Date.now();

    for (const [jobId, job] of jobs.entries()) {
        const updatedAt = Date.parse(job.updatedAt);
        if (!Number.isNaN(updatedAt) && now - updatedAt > JOB_TTL_MS) {
            jobs.delete(jobId);
        }
    }
}

function serializeJob(job) {
    if (!job) {
        return null;
    }

    return {
        id: job.id,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        status: job.status,
        error: job.error,
        result: job.result
            ? {
                consolePath: job.result.consolePath,
                elapsedSeconds: job.result.elapsedSeconds,
                screenshotPath: job.result.screenshotPath,
                videoPaths: job.result.videoPaths,
            }
            : null,
    };
}

module.exports = {
    createJob,
    deleteExpiredJobs,
    getJob,
    serializeJob,
    updateJob,
};
