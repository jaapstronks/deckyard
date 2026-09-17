import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './env.js';

// Synchronous initialization must finish before entrypoint dependencies read env.
// Do not import paths.js here: its static mounts already resolve the fork root.
loadDotEnv(fileURLToPath(new URL('../../', import.meta.url)));
