const crypto = require("crypto");

const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

function createJob(payload) {
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();

    jobs.set(taskId, {
        id: taskId,
        payload,
        createdAt: now,
        updatedAt: now,
        status: "pending",
        result: null,
        error: null,
    });

    return getJob(taskId);
}

function getJob(taskId) {
    return jobs.get(taskId) || null;
}

function updateJob(taskId, updates) {
    const job = getJob(taskId);
    if (!job) {
        return null;
    }

    const nextJob = {
        ...job,
        ...updates,
        updatedAt: new Date().toISOString(),
    };

    jobs.set(taskId, nextJob);
    return nextJob;
}

function deleteExpiredJobs() {
    const now = Date.now();

    for (const [taskId, job] of jobs.entries()) {
        const updatedAt = Date.parse(job.updatedAt);
        if (!Number.isNaN(updatedAt) && now - updatedAt > JOB_TTL_MS) {
            jobs.delete(taskId);
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
                vehiclePriceTax: job.result.vehiclePriceTax || null,
                vehicleTotalAmount: job.result.vehicleTotalAmount || null,
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
