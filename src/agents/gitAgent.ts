import { execFile } from 'child_process';
import { promisify } from 'util';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import type {
  GitIntent,
  GitBranchIntent,
  GitCommitIntent,
  GitCheckoutIntent,
} from '../intent/schema';

const execFileAsync = promisify(execFile);

// ── Input sanitizers ──────────────────────────────────────────────────────────

/**
 * Sanitizes a branch name to [a-zA-Z0-9/_.-] only, max 100 chars.
 * Prevents any shell injection — but note we use execFile (array args),
 * not exec (shell string), so this is defence-in-depth.
 */
function sanitizeBranchName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9/_.\-]/g, '-')
    .replace(/--+/g, '-')
    .slice(0, 100);
}

/**
 * Sanitizes a commit message — strips leading/trailing whitespace,
 * limits length. Safe to pass as arg[2] to execFile.
 */
function sanitizeCommitMessage(msg: string): string {
  return msg.trim().slice(0, 500);
}

// ── Allowlisted Git operations ────────────────────────────────────────────────

/**
 * The ONLY Git commands CodeVoice will ever execute.
 * Each entry maps to a typed function — no free-form shell, no LLM-generated
 * shell strings. execFile (not exec) ensures args never pass through a shell.
 */
async function gitExec(args: string[]): Promise<string> {
  logger.info('git', args.join(' '));
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: config.app.gitCwd,
      maxBuffer: 1024 * 1024, // 1MB
    });
    if (stderr && !stdout) return stderr.trim();
    return stdout.trim();
  } catch (err: any) {
    const msg = err?.stderr ?? err?.message ?? String(err);
    throw new Error(`git ${args[0]} failed: ${msg}`);
  }
}

export function resolveGitArgs(intent: GitIntent): string[] {
  switch (intent.type) {
    case 'git_branch':
      return ['checkout', '-b', sanitizeBranchName(intent.name)];
    case 'git_commit':
      return ['commit', '-m', sanitizeCommitMessage(intent.message)];
    case 'git_status':
      return ['status'];
    case 'git_diff':
      return ['diff'];
    case 'git_log':
      return ['log', '-n', '5', '--oneline'];
    case 'git_add':
      return ['add', '.'];
    case 'git_checkout':
      return ['checkout', sanitizeBranchName(intent.branch)];
    default:
      throw new Error(`Git operation not in allowlist: ${(intent as any).type}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GitResult {
  operation: GitIntent['type'];
  commandString: string;
  output: string;
  success: boolean;
}

/**
 * Execute a validated GitIntent through the allowlist.
 * If the intent type is not in GIT_OPS, throws — this should never happen
 * in practice because the intent router only emits known types.
 */
export async function executeGit(intent: GitIntent): Promise<GitResult> {
  const args = resolveGitArgs(intent);
  const commandString = `git ${args.join(' ')}`;

  try {
    const output = await gitExec(args);
    logger.info(`Git success [${intent.type}]:`, output.substring(0, 200));
    return { operation: intent.type, commandString, output, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Git failed [${intent.type}]:`, message);
    return { operation: intent.type, commandString, output: message, success: false };
  }
}
