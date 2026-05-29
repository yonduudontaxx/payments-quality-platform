import { buildApp } from './app.js';

const PORT = Number(process.env.PORT ?? 3000);

async function start(): Promise<void> {
  const app = await buildApp();
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`Server listening on port ${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
