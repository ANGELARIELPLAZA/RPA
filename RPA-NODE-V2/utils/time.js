function pad2(value) {
    return String(value).padStart(2, "0");
}

function formatDateTime(date = new Date(), timeZone = process.env.TZ || "America/Mexico_City") {
    const parts = new Intl.DateTimeFormat("sv-SE", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).formatToParts(date);

    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function formatHhMmSs(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

function formatShortDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) return `${minutes}m${pad2(seconds)}s`;
    return formatHhMmSs(ms);
}

module.exports = {
    formatDateTime,
    formatHhMmSs,
    formatShortDuration,
};

