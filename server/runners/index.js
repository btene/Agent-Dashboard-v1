// Runner registry. To support a new kind of agent, add a module exporting
// { type, label, description, configFields, run({ agent, input, runId, log, signal }) }
// and register it here. `run` resolves to { output, tokensIn?, tokensOut?, costUsd? }.
import mock from './mock.js';
import http from './http.js';
import claude from './claude.js';
import command from './command.js';

export const runners = Object.fromEntries([mock, http, claude, command].map((r) => [r.type, r]));

export function describeRunners() {
  return Object.values(runners).map(({ type, label, description, configFields }) => ({ type, label, description, configFields }));
}
