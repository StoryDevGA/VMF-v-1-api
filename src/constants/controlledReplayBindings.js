// Deliberately empty: fixture authority/exclusion registration and native activation remain unverified.
export const CONTROLLED_REPLAY_BINDINGS = Object.freeze([])

// Real approval/exclusion records have no maintained verifier yet. Catalog
// declarations and VMF_UPDATE cannot replace those owners.
const unavailable = reason => { throw Object.assign(new Error('Controlled fixture authority remains unverified.'), {
  status: 409, code: 'CONFLICT', details: { reason },
}) }
export const verifyControlledReplayAuthority = () => unavailable('CONTROLLED_REPLAY_AUTHORITY_UNVERIFIED')
export const verifyControlledReplayExclusions = () => unavailable('CONTROLLED_REPLAY_PROTECTED_SCOPE_UNVERIFIED')
