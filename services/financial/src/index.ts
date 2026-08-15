export { PostgresUnitOfWork } from './infrastructure/repositories/postgres/postgres-unit-of-work.js';

// M8 — authorization creation (capacity enforcement cutover).
export { getCapacity } from './application/queries/get-capacity.js';
export type { CapacityView } from './application/queries/get-capacity.js';
export {
  createAuthorization,
  CreateAuthorizationError,
  BASE_USDC_ADDRESS,
  BASE_CHAIN_ID,
} from './application/commands/create-authorization.js';
export type {
  CreateAuthorizationDeps,
  CreateAuthorizationView,
} from './application/commands/create-authorization.js';
export type {
  EnvelopeVerifier,
  SignedAuthorizationEnvelope,
  VerifiedEnvelope,
  EnvelopeDomain,
  EnvelopeMessage,
} from './application/ports/envelope-verifier.js';
export { EnvelopeVerificationError } from './application/ports/envelope-verifier.js';
export type {
  AuthorizationCreationUnitOfWork,
  AuthorizationCreationInput,
  AuthorizationCreationOutcome,
} from './application/ports/authorization-creation-unit-of-work.js';
export { ViemEip3009Verifier } from './infrastructure/adapters/viem-eip3009-verifier.js';
export { PostgresAuthorizationCreationUnitOfWork } from './infrastructure/repositories/postgres/postgres-authorization-creation-unit-of-work.js';
export { PostgresPrincipalRepository } from './infrastructure/repositories/postgres/postgres-principal-repository.js';
export { PostgresAuthorizationRepository } from './infrastructure/repositories/postgres/postgres-authorization-repository.js';
