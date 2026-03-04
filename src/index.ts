import "dotenv/config";
import { app } from "./app";
import { setupDatabase, teardownDatabase } from "./database/connection";

const PORT = Number(process.env.PORT ?? 3000);

async function bootstrap() {
    await setupDatabase();

    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);
    });

    const gracefulShutdown = async () => {
        await teardownDatabase();
        process.exit(0);
    };

    process.on("SIGINT", gracefulShutdown);
    process.on("SIGTERM", gracefulShutdown);
}

void bootstrap();
