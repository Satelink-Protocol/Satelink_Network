# trading_agent/credentials

**Status:** skeleton (Stage 09). No routes, no jobs, no reads or writes yet.

**Responsibility:** Broker credential lifecycle. Metadata and ciphertext are stored in separate tables; secrets are envelope-encrypted with a KMS-wrapped data key (audit/06 §6, audit/08 §5). No plaintext secret ever touches the database, logs or an LLM context.

**Tables** (database/migrations/021_trading_foundation.sql): `broker_credentials_metadata`, `broker_credential_ciphertexts`

**Flags** (all default OFF; see ../flags.mjs): `BYOK`

**Rules:**
- Money is NUMERIC minor units + currency + decimals; never JS floats in new code (use `libs/kernel` Money semantics).
- No side effects unless the relevant flag is on and the deterministic policy in `risk/` + `mandates/` allows it.
- LLM output is data (signals/proposals), never a command.
