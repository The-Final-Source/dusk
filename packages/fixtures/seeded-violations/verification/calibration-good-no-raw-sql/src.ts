// @intent db/no-raw-sql [no-raw-sql]
export function findUser(id: string): { table: string; where: { id: string } } {
  // @intent db/no-raw-sql [no-raw-sql]
  return queryBuilder("users").where({ id });
}

function queryBuilder(table: string): { where: (clause: { id: string }) => { table: string; where: { id: string } } } {
  return { where: (clause) => ({ table, where: clause }) };
}
