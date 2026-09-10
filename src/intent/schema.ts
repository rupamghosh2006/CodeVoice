/**
 * Intent schema — all types the Intent Router can produce.
 * The Git Agent is a typed dispatch table over GitIntent — no free-form shell.
 */

// ── Code intents ──────────────────────────────────────────────────────────────

export interface CodeGenerationIntent {
  type: 'code_generation';
  /** Natural language instruction for what code to create */
  instruction: string;
}

export interface CodeEditIntent {
  type: 'code_edit';
  /** Natural language instruction for how to modify existing code */
  instruction: string;
}

export interface CodeExplainIntent {
  type: 'code_explain';
  /** What to explain (function name, concept, etc.) */
  instruction: string;
}

export type CodeIntent = CodeGenerationIntent | CodeEditIntent | CodeExplainIntent;

// ── Git intents ───────────────────────────────────────────────────────────────

export interface GitBranchIntent {
  type: 'git_branch';
  /** Branch name to create and checkout */
  name: string;
}

export interface GitCommitIntent {
  type: 'git_commit';
  /** Commit message */
  message: string;
}

export interface GitStatusIntent {
  type: 'git_status';
}

export interface GitDiffIntent {
  type: 'git_diff';
}

export interface GitLogIntent {
  type: 'git_log';
}

export interface GitAddIntent {
  type: 'git_add';
}

export interface GitCheckoutIntent {
  type: 'git_checkout';
  /** Branch name to switch to */
  branch: string;
}

export type GitIntent =
  | GitBranchIntent
  | GitCommitIntent
  | GitStatusIntent
  | GitDiffIntent
  | GitLogIntent
  | GitAddIntent
  | GitCheckoutIntent;

// ── File switch intent ────────────────────────────────────────────────────────

export interface FileSwitchIntent {
  type: 'file_switch';
  /** File path or name to set as currently active */
  path: string;
}

// ── Union ─────────────────────────────────────────────────────────────────────

export type Intent = CodeIntent | GitIntent | FileSwitchIntent;

// ── Type guards ───────────────────────────────────────────────────────────────

export function isCodeIntent(intent: Intent): intent is CodeIntent {
  return (
    intent.type === 'code_generation' ||
    intent.type === 'code_edit' ||
    intent.type === 'code_explain'
  );
}

export function isGitIntent(intent: Intent): intent is GitIntent {
  return (
    intent.type === 'git_branch' ||
    intent.type === 'git_commit' ||
    intent.type === 'git_status' ||
    intent.type === 'git_diff' ||
    intent.type === 'git_log' ||
    intent.type === 'git_add' ||
    intent.type === 'git_checkout'
  );
}

export function isFileSwitchIntent(intent: Intent): intent is FileSwitchIntent {
  return intent.type === 'file_switch';
}

/** Intents that are potentially destructive and require UI confirmation */
export const DESTRUCTIVE_KEYWORDS = [
  'delete',
  'remove branch',
  'force push',
  'force-push',
  'reset --hard',
  'rebase -i',
  'drop commit',
];
