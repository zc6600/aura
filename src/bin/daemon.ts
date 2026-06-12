import path from 'node:path';
import { DaemonServer } from '../daemon/server.js';

// Get target project path from command arguments (defaults to process.cwd())
const projectPath = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const server = new DaemonServer(projectPath);

const cleanup = () => {
  server.stop();
  process.exit(0);
};

process.once('exit', () => {
  server.stop();
});
process.once('SIGINT', cleanup);
process.once('SIGTERM', cleanup);

server.start().catch((err) => {
  console.error('Daemon failed to start:', err);
  process.exit(1);
});
