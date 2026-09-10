import { config } from 'dotenv';
config({ path: '../.env' });

// Inject CH + fallback config so downstream modules see it on first evaluation
process.env.CLICKHOUSE_URL = 'http://127.0.0.1:8123/';
process.env.CLICKHOUSE_USER = 'default';
process.env.CLICKHOUSE_PASSWORD = '';
process.env.CLICKHOUSE_DATABASE = 'tracker';
process.env.CLICKHOUSE_REQUEST_TIMEOUT = '5000';
process.env.REPORTING_PROVIDER = 'clickhouse_with_fallback';
export {};
