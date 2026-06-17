import { SectionLabel } from '../shared/SectionLabel';
import { StatusDot } from '../badges/StatusDot';
import type { Tone } from '../shared/types';
import styles from './EventStream.module.css';

export interface StreamEvent {
  id?: string | number;
  time: string;
  source: string;
  message: string;
  tone?: Tone;
}

export type StreamState = 'connecting' | 'live' | 'error';

export interface EventStreamProps {
  title: string;
  state: StreamState;
  events: StreamEvent[];
}

/** Live log/event feed. Driven entirely by real events passed in (e.g. SSE). */
export function EventStream({ title, state, events }: EventStreamProps): JSX.Element {
  const dotTone: Tone = state === 'live' ? 'success' : state === 'error' ? 'danger' : 'warn';
  return (
    <div className={styles.wrap}>
      <SectionLabel right={<StatusDot tone={dotTone} pulse />}>{title}</SectionLabel>
      {events.length === 0 && state !== 'error' ? (
        <div className={styles.note}>Connecting…</div>
      ) : null}
      {events.length === 0 && state === 'error' ? (
        <div className={styles.note}>Live feed unavailable. It will reconnect automatically.</div>
      ) : null}
      <div>
        {events.map((e, i) => (
          <div key={e.id ?? i} className={styles.row}>
            <span className={styles.time}>{e.time}</span>
            <span className={styles.source}>[{e.source}]</span>
            <span className={styles.msg}>{e.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
