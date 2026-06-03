#!/usr/bin/env node
/**
 * Satelink Event Watcher
 * Watches agent/memory/events/ACTIVE_EVENTS.md for NEW events
 * Routes to correct commander based on event type prefix
 * This is the cascade trigger mechanism.
 */

import { watch, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const EVENTS_FILE = path.join(REPO_ROOT, 'agent/memory/events/ACTIVE_EVENTS.md');

const ROUTING = {
  'deployment.': 'ENGINEERING_COMMANDER',
  'qa.': 'ENGINEERING_COMMANDER',
  'incident.': 'ENGINEERING_COMMANDER',
  'sre.': 'ENGINEERING_COMMANDER',
  'revenue.': 'ECONOMY_COMMANDER',
  'customer.': 'ECONOMY_COMMANDER',
  'funnel.': 'ECONOMY_COMMANDER',
  'cost.': 'ECONOMY_COMMANDER',
  'security.': 'SECURITY_COMMANDER',
  'treasury.': 'SECURITY_COMMANDER',
  'secret.': 'SECURITY_COMMANDER',
  'founder.': 'AUTONOMY_COMMANDER',
};

let lastContent = '';

function parseNewEvents(content) {
  const lines = content.split('\n');
  const events = [];
  for (const line of lines) {
    if (!line.startsWith('|') || line.includes('Event ID') || line.includes('---')) continue;
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length < 5) continue;
    const [id, type, severity, owner, status] = cols;
    if (status === 'NEW') {
      events.push({ id, type, severity, owner, status });
    }
  }
  return events;
}

function routeEvent(event) {
  for (const [prefix, commander] of Object.entries(ROUTING)) {
    if (event.type.startsWith(prefix)) return commander;
  }
  return event.owner || 'CEO';
}

function triggerCommander(commander, eventId, eventType) {
  console.log(`[EVENT-WATCHER] ${new Date().toISOString()} | Trigger: ${commander} | Event: ${eventId} | Type: ${eventType}`);

  // Write trigger log so founder can see what needs manual activation in Paperclip
  const triggerLog = path.join(REPO_ROOT, 'agent/memory/events/PENDING_TRIGGERS.md');
  const entry = `TRIGGER | ${new Date().toISOString()} | ${commander} | ${eventId} | ${eventType} | AWAITING_ACTIVATION\n`;

  try {
    const existing = readFileSync(triggerLog, 'utf8');
    writeFileSync(triggerLog, existing + entry);
  } catch {
    writeFileSync(triggerLog, `# PENDING TRIGGERS\n# Commander activations queued by event watcher\n\n${entry}`);
  }
}

function checkEvents() {
  try {
    const content = readFileSync(EVENTS_FILE, 'utf8');
    if (content === lastContent) return;
    lastContent = content;

    const newEvents = parseNewEvents(content);
    for (const event of newEvents) {
      const commander = routeEvent(event);
      triggerCommander(commander, event.id, event.type);
    }
  } catch (err) {
    // File may not exist yet — silent
  }
}

console.log('[EVENT-WATCHER] Starting — monitoring', EVENTS_FILE);
checkEvents();

watch(EVENTS_FILE, { persistent: false }, () => {
  setTimeout(checkEvents, 500); // debounce
});

// Also poll every 60s as fallback
setInterval(checkEvents, 60000);
