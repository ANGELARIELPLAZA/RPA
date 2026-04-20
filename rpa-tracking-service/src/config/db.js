const mongoose = require("mongoose");
const { MONGO_URI } = require("./env");
const logger = require("../utils/logger");

async function connectDb() {
    mongoose.set("strictQuery", true);
    await mongoose.connect(MONGO_URI);
    logger.info(`[db] connected ${MONGO_URI}`);
}

module.exports = {
    connectDb,
};

