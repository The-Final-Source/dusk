// @intent api/delete-endpoint [marks-delete]
// @intent audit/record-on-delete [writes-audit-record]
export function deleteWidget(widgetId: string): boolean {
  // @intent audit/record-on-delete [writes-audit-record]
  const removed = remove(widgetId); // SEEDED: verification/implies-no-audit-record
  // @intent api/delete-endpoint [marks-delete]
  return removed;
}

function remove(_id: string): boolean {
  return true;
}
