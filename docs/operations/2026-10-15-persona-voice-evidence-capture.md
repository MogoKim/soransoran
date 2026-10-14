# Persona voice evidence capture

Status: code path only. Default OFF until the runtime has a valid secret salt.

## Purpose

Collect enough real, public comment-style observations to evaluate new Persona voices without changing the existing 30 Persona assignments. This is input to the append-only expansion planner; it does not create, activate, or publish as a Persona.

## Fixed boundaries

- Collection runs only during an existing Naver `--thin` detail pass. It opens no additional page and makes no additional request.
- Without `SORAN_VOICE_EVIDENCE_SALT` of at least 32 characters, the collector does not read the comment DOM and writes no evidence.
- The browser returns only author-label and comment-text strings. Profile links, member IDs, comment timestamps, images, and raw HTML are not read.
- Author labels are replaced in memory with HMAC-SHA256 identifiers. The raw label and salt are never written or logged.
- PII, unsafe text, identity or nickname leakage, lived experience, placeholders, and out-of-band lengths are discarded.
- Evidence is stored as mode `0600` JSONL and expires after 90 days.
- Reading fails closed when the member/Persona comparison set is unavailable. Exact N2-normalized member or Persona matches exclude the whole observed speaker.
- Existing production voice bundles must remain byte-for-byte unchanged. New evidence can only append bundles for new Persona codes.

## Operations

The salt is a runtime secret, not repository data. Do not print it or put it in a shell history argument. Removing the env value turns capture off before any comment DOM read.

Retention and erasure are dry-run by default:

```bash
npm run persona:voice-evidence-purge
npm run persona:voice-evidence-purge -- --speaker-hash=vs1:<64-lowercase-hex>
npm run persona:voice-evidence-purge -- --execute
```

Only files named `navercafe-voice-*.voice-evidence.jsonl` are eligible. Symlinks and unrelated files are ignored. Malformed rows are removed rather than allowed to reset their retention age.

## D20 interpretation

Passing capture checks does not make D20 ready. The canary needs 40 contract-valid Persona rows, so the ten proposed candidates must pass voice, card, name, diversity, cadence, create, seed, and activation gates. Current evidence has two free eligible speakers; eight more are required for the ten-person canary.

The old canonical corpus has speakers that are one observation short, but its original author-to-opaque-ID salt was intentionally not retained. New observations cannot be claimed as top-ups for those speakers. Readiness must count only newly demonstrated stable HMAC speakers or already eligible canonical speakers.
