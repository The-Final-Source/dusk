// @intent db/no-raw-sql [no-raw-sql]
export function findUser(id: string): string {
  // @intent db/no-raw-sql [no-raw-sql]
  const query = `SELECT * FROM users WHERE id = '${id}'`; // SEEDED: verification/negative-raw-sql
  // @intent db/no-raw-sql [no-raw-sql]
  return query;
}
