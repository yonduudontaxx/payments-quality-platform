import postgres from 'postgres';

const sql = postgres(
  process.env.DATABASE_URL ?? 'postgres://payments:payments@localhost:5432/payments_dev'
);

export function toJson(value: Record<string, unknown>): postgres.JSONValue {
  return value as unknown as postgres.JSONValue;
}

export default sql;
