#!/usr/bin/env node
import 'dotenv/config';
import { runMigrations } from './migrate.js';

runMigrations().catch((err) => {
 console.error('[ch-migrate] FATAL:', err);
 process.exit(1);
});
