import { assertRuntime } from './env.js';
import { startTelegram } from './telegram.js';

function main(): void {
  assertRuntime();
  startTelegram();
  console.log('[agentkit] bot asisten umum jalan. Ctrl+C untuk berhenti.');

  const stop = () => {
    console.log('\n[agentkit] berhenti.');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main();
