// Runs a local script/CLI (Python agent, shell script, `claude -p`, …).
// The input is passed on stdin and in the AGENT_INPUT env var; stdout is the
// output. A final stdout line of the form
//   ##usage {"tokensIn":1,"tokensOut":2,"costUsd":0.01}
// is parsed for analytics.
//
// Disabled unless ALLOW_COMMAND_RUNNER=true, since it executes commands on the
// server host.
import { spawn } from 'node:child_process';

export const commandRunnerEnabled = () => process.env.ALLOW_COMMAND_RUNNER === 'true';

export default {
  type: 'command',
  label: 'Local command / script',
  description: 'Runs a command on the dashboard server (e.g. `python my_agent.py`). Requires ALLOW_COMMAND_RUNNER=true.',
  configFields: [
    { key: 'command', label: 'Command', type: 'text', required: true, placeholder: 'python agents/research.py' },
    { key: 'cwd', label: 'Working directory', type: 'text', placeholder: '(server cwd)' },
    { key: 'timeoutMs', label: 'Timeout (ms)', type: 'number', default: 600000 },
  ],
  run({ agent, input, runId, log, signal }) {
    if (!commandRunnerEnabled()) {
      throw new Error('Command runner is disabled. Set ALLOW_COMMAND_RUNNER=true on the server to enable it.');
    }
    const { command, cwd, timeoutMs = 600000 } = agent.config || {};
    if (!command) throw new Error('No command configured for this agent');

    return new Promise((resolve, reject) => {
      log('info', `$ ${command}`);
      const child = spawn(command, {
        shell: true,
        cwd: cwd || undefined,
        env: { ...process.env, AGENT_INPUT: input ?? '', AGENT_RUN_ID: runId, AGENT_ID: agent.id },
        signal,
        timeout: Number(timeoutMs) || undefined,
      });
      let stdout = '';
      let stderrTail = '';
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => {
        const s = d.toString();
        stderrTail = (stderrTail + s).slice(-4000);
        for (const line of s.split('\n')) if (line.trim()) log('warn', line);
      });
      child.on('error', reject);
      child.on('close', (code, sig) => {
        if (code !== 0) return reject(new Error(`Command exited with ${sig || code}${stderrTail ? `: ${stderrTail.slice(-500)}` : ''}`));
        let usage = {};
        const lines = stdout.trimEnd().split('\n');
        if (lines.at(-1)?.startsWith('##usage ')) {
          try { usage = JSON.parse(lines.pop().slice(8)); } catch { /* ignore malformed usage line */ }
        }
        resolve({
          output: lines.join('\n'),
          tokensIn: Number(usage.tokensIn) || 0,
          tokensOut: Number(usage.tokensOut) || 0,
          costUsd: Number(usage.costUsd) || 0,
        });
      });
      child.stdin.end(input ?? '');
    });
  },
};
