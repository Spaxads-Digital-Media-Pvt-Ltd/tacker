/**
 * "Created By" for rows stamped with the creating login's id (N2): the team member's name — or email —
 * from the API's `createdByName`; an id with no team member behind it (an account since removed, a
 * login with no team-member record) is "Unknown user"; no id at all means the system made it.
 */
export function createdByLabel(createdBy: unknown, createdByName: unknown): string {
  if (typeof createdByName === 'string' && createdByName.trim()) return createdByName.trim();
  return createdBy ? 'Unknown user' : 'System';
}
