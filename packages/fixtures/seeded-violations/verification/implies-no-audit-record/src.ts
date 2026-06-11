// @intent api/delete-endpoint [marks-delete]
// @intent audit/record-on-delete [writes-audit-record]
export function deleteWidget(widgetId: string): boolean {
  // @intent audit/record-on-delete [writes-audit-record]
  removeWidget(widgetId); // SEEDED: verification/implies-no-audit-record
  // @intent api/delete-endpoint [marks-delete]
  return true;
}

function removeWidget(_id: string): void {}
