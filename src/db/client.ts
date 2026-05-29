import postgres from 'postgres';

const sql = postgres(
  process.env.DATABASE_URL ?? 'postgres://payments:payments@localhost:5432/payments_dev'
);

export default sql;
