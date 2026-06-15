import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function setup() {
  // Return a teardown function that Vitest will execute once all tests have finished
  return () => {
    const tempProjectsDir = path.join(__dirname, 'temp-projects');
    if (fs.existsSync(tempProjectsDir)) {
      try {
        fs.rmSync(tempProjectsDir, { recursive: true, force: true });
      } catch (_e) {
        // Ignore if directory cannot be deleted
      }
    }
  };
}
