// Trading agent — paper subdomain (Stage 14). See ./README.md.
// Simulated book only; not mounted; nothing starts a paper run.
export const DOMAIN = 'paper';
export const TABLES = Object.freeze(['backtests']); // mode 'paper', label 'simulated'
export const FLAGS = Object.freeze(['TRADING_AGENT']);
export const STATUS = 'skeleton';

export { PaperRunner, startPaperRun, stopPaperRun, newPaperRunId } from './runner.mjs';
