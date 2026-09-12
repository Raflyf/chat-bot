import { assertRuntime } from './env.js';
import { startTelegram } from './telegram.js';
import { logInfo } from './logger.js';

function main(): void {
  assertRuntime();
  startTelegram();
  logInfo('[agentkit] bot asisten umum jalan. Ctrl+C untuk berhenti.');

  const stop = () => {
    logInfo('[agentkit] berhenti.');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
