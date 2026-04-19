const { MAX_CONTEXTS } = require("../config");

if (!Number.isInteger(MAX_CONTEXTS) || MAX_CONTEXTS < 1) {
    throw new Error("MAX_CONTEXTS debe ser un entero mayor o igual a 1");
}

let activeCount = 0;
const pending = [];

function getActiveContextCount() {
    return activeCount;
}

function getPendingTaskCount() {
    return pending.length;
}

function runNext() {
    if (activeCount >= MAX_CONTEXTS || pending.length === 0) {
        return;
    }

    const next = pending.shift();
    activeCount += 1;

    Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
            activeCount -= 1;
            runNext();
        });
}

function enqueueContextTask(task) {
    return new Promise((resolve, reject) => {
        pending.push({ task, resolve, reject });
        runNext();
    });
}

module.exports = {
    enqueueContextTask,
    getActiveContextCount,
    getPendingTaskCount,
};
