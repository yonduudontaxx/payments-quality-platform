import { buildApp } from './app.js';
import sql from './db/client.js';

async function start(): Promise<void> {
  const app = await buildApp();

  const port = parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  try {
    await app.listen({ port, host });
    console.log(`Server listening on ${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    await sql.end();
    process.exit(1);
  }
}

start();
