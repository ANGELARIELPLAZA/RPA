const mongoose = require("mongoose");
const { MONGO_URI } = require("./env");
const logger = require("../utils/logger");

function redactMongoUri(uri) {
    try {
        // mongodb://user:pass@host/db -> mongodb://***@host/db
        return String(uri).replace(/mongodb(\+srv)?:\/\/([^@]+)@/i, (m, srv) => `mongodb${srv || ""}://***@`);
    } catch {
        return "mongodb://***";
    }
}

async function connectDb() {
    mongoose.set("strictQuery", true);
    await mongoose.connect(MONGO_URI);
    logger.info(`[db] connected ${redactMongoUri(MONGO_URI)}`);
}

module.exports = {
    connectDb,
};
