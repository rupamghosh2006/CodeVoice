import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.join(process.cwd(), '.env') });

import { routeIntent, DestructiveIntentError } from '../src/intent/router';
import { handleCodeIntent } from '../src/agents/codeAgent';
import { executeGit } from '../src/agents/gitAgent';
import { isCodeIntent, isGitIntent } from '../src/intent/schema';

async function runTests() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  CodeVoice — Intent & Agent Pipeline Test    ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // Test 1: Hinglish code generation routing
  console.log('Test 1: Routing Hinglish Code Gen...');
  const genIntent = await routeIntent('Ek function banao jo email validate kare');
  console.log('Result:', JSON.stringify(genIntent, null, 2));
  if (genIntent.type !== 'code_generation') {
    throw new Error(`Expected code_generation, got ${genIntent.type}`);
  }
  console.log('[PASS] Test 1 Passed\n');
  await new Promise((r) => setTimeout(r, 2000));

  // Test 2: Hinglish code edit routing
  console.log('Test 2: Routing Hinglish Code Edit...');
  const editIntent = await routeIntent('useEffect ke andar API call add karo');
  console.log('Result:', JSON.stringify(editIntent, null, 2));
  if (editIntent.type !== 'code_edit') {
    throw new Error(`Expected code_edit, got ${editIntent.type}`);
  }
  console.log('[PASS] Test 2 Passed\n');
  await new Promise((r) => setTimeout(r, 2000));

  // Test 3: Hinglish Git branch routing
  console.log('Test 3: Routing Hinglish Git Branch...');
  const branchIntent = await routeIntent('Nayi branch banao feature-email');
  console.log('Result:', JSON.stringify(branchIntent, null, 2));
  if (branchIntent.type !== 'git_branch' || !('name' in branchIntent)) {
    throw new Error(`Expected git_branch, got ${branchIntent.type}`);
  }
  console.log('[PASS] Test 3 Passed\n');

  // Test 4: Destructive intent protection
  console.log('Test 4: Destructive Intent Interception...');
  let intercepted = false;
  try {
    await routeIntent('force push master branch');
  } catch (err) {
    if (err instanceof DestructiveIntentError) {
      intercepted = true;
      console.log(`[OK] Successfully intercepted: "${err.matchedKeyword}"`);
    } else {
      throw err;
    }
  }
  if (!intercepted) throw new Error('Failed to intercept destructive keyword');
  console.log('[PASS] Test 4 Passed\n');

  // Test 5: Code Agent Execution on demo/sample.ts
  console.log('Test 5: Executing Code Agent with Gemini...');
  const initialContent = fs.readFileSync('demo/sample.ts', 'utf-8');
  console.log('Initial demo/sample.ts length:', initialContent.length);

  const codeResult = await handleCodeIntent({
    type: 'code_generation',
    instruction: 'Create an email validation function named validateEmail that checks email regex and returns a boolean',
  });
  console.log('Generated Code:\n', codeResult.output);

  const updatedContent = fs.readFileSync('demo/sample.ts', 'utf-8');
  if (!updatedContent.includes('validateEmail')) {
    throw new Error('demo/sample.ts was not updated with generated code');
  }
  console.log('[PASS] Test 5 Passed (demo/sample.ts successfully written!)\n');

  // Test 6: Git Agent Execution (Status)
  console.log('Test 6: Executing Git Agent (git status)...');
  const gitResult = await executeGit({ type: 'git_status' });
  console.log('Git output:\n', gitResult.output);
  if (!gitResult.success) {
    throw new Error(`Git status failed: ${gitResult.output}`);
  }
  console.log('[PASS] Test 6 Passed\n');
  await new Promise((r) => setTimeout(r, 2000));

  // Test 7: File switch routing
  console.log('Test 7: Routing File Switch Intent...');
  const switchIntent = await routeIntent('Switch to src/auth.ts');
  console.log('Result:', JSON.stringify(switchIntent, null, 2));
  if (switchIntent.type !== 'file_switch' || !('path' in switchIntent)) {
    throw new Error(`Expected file_switch, got ${switchIntent.type}`);
  }
  console.log('[PASS] Test 7 Passed\n');
  await new Promise((r) => setTimeout(r, 2000));

  // Test 8: File delete routing with skipSafetyGate
  console.log('Test 8: Routing File Delete Intent with skipSafetyGate...');
  const deleteIntent = await routeIntent('Delete demo.ts', { skipSafetyGate: true });
  console.log('Result:', JSON.stringify(deleteIntent, null, 2));
  if (deleteIntent.type !== 'file_delete' || !('path' in deleteIntent)) {
    throw new Error(`Expected file_delete, got ${deleteIntent.type}`);
  }
  console.log('[PASS] Test 8 Passed\n');
  await new Promise((r) => setTimeout(r, 2000));

  // Test 9: Git branch delete routing and execution
  console.log('Test 9: Git Branch Delete (Routing, Safety & Execution)...');
  // 9a: Intercepted by safety gate
  let branchDeleteIntercepted = false;
  try {
    await routeIntent('Delete branch feature-temp');
  } catch (err) {
    if (err instanceof DestructiveIntentError) {
      branchDeleteIntercepted = true;
      console.log(`[OK] Successfully intercepted branch deletion: "${err.matchedKeyword}"`);
    } else {
      throw err;
    }
  }
  if (!branchDeleteIntercepted) throw new Error('Failed to intercept branch delete');

  // 9b: Routed with skipSafetyGate
  const branchDelIntent = await routeIntent('Delete branch feature-temp', { skipSafetyGate: true });
  console.log('Result:', JSON.stringify(branchDelIntent, null, 2));
  if (branchDelIntent.type !== 'git_branch_delete' || !('name' in branchDelIntent)) {
    throw new Error(`Expected git_branch_delete, got ${branchDelIntent.type}`);
  }

  // 9c: Execution with git
  await executeGit({ type: 'git_branch', name: 'feature-temp' });
  await executeGit({ type: 'git_checkout', branch: 'main' });
  const delResult = await executeGit({ type: 'git_branch_delete', name: 'feature-temp' });
  console.log('Git branch delete output:', delResult.output);
  if (!delResult.success) {
    throw new Error(`Git branch delete failed: ${delResult.output}`);
  }
  console.log('[PASS] Test 9 Passed\n');

  console.log('[SUCCESS] ALL TESTS PASSED! Intent router, Code agent, Git agent, and File operations are fully functioning.');
}

runTests().catch((err) => {
  console.error('[FAIL] Test failed:', err);
  if (err?.cause) console.error('Cause:', err.cause);
  process.exit(1);
});
