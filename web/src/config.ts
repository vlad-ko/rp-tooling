/** All env reads for web live here; defaults target local dev outside compose. */
export const config = {
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5432/postgres",
  port: Number(process.env.PORT ?? 8080),
};
