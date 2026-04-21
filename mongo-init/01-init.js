/* eslint-disable no-undef */
// Inicializa usuario de aplicacion para el DB de tracking.
// Se ejecuta SOLO la primera vez (cuando /data/db esta vacio).

const appDb = process.env.MONGO_APP_DB || "rpa_tracking";
const appUser = process.env.MONGO_APP_USERNAME;
const appPass = process.env.MONGO_APP_PASSWORD;

if (!appUser || !appPass) {
    print("[mongo-init] Skipping app user creation (MONGO_APP_USERNAME/MONGO_APP_PASSWORD missing).");
} else {
    print(`[mongo-init] Creating app user "${appUser}" on db "${appDb}"...`);
    const dbRef = db.getSiblingDB(appDb);
    dbRef.createUser({
        user: appUser,
        pwd: appPass,
        roles: [{ role: "readWrite", db: appDb }],
    });
    print("[mongo-init] App user created.");
}

