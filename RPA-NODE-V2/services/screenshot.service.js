const fs = require("fs");
const path = require("path");
const { BASE_URL, SCREENSHOTS_DIR } = require("../config");

function safeSlug(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/gi, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
}

function formatFileDate(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}`;
}

async function takeTaskScreenshot(page, { taskId, etapaNombre } = {}) {
    if (!page) {
        return null;
    }

    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

    const stamp = formatFileDate(new Date());
    const etapa = safeSlug(etapaNombre || "error") || "error";
    const filename = `task_${taskId}_${stamp}_${etapa}.png`;
    const localPath = path.join(SCREENSHOTS_DIR, filename);

    await page.screenshot({
        path: localPath,
        type: "png",
        fullPage: true,
    });

    const url = `${BASE_URL}/screenshots/${encodeURIComponent(filename)}`;
    return { filename, localPath, url };
}

module.exports = {
    takeTaskScreenshot,
};

