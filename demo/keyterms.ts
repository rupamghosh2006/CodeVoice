/**
 * Project-specific keyterms passed to AssemblyAI on session start.
 * These steer the speech model toward exact recognition of technical identifiers.
 * Max 100 terms per AssemblyAI docs.
 *
 * Format: each string is passed as a keyterm prompt entry.
 * AssemblyAI uses these as "hints" — they increase probability of these tokens
 * being recognized correctly in the transcript.
 */
export { KEYTERMS } from '../src/constants/keyterms';

