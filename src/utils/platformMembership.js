/** Only an explicitly unscoped membership grants platform roles. */
export const isPlatformMembership = (membership) =>
  Boolean(membership) && (membership.customerId === null || membership.customerId === undefined)
