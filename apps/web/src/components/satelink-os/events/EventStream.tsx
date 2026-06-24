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

/** SigNoz log-explorer-style live event feed. Driven entirely by real SSE events. */
export function EventStream({ title, state, events }: EventStreamProps): JSX.Element {
  const dotTone: Tone = state === 'live' ? 'success' : state === 'error' ? 'danger' : 'warn';
  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <div className={styles.headerRight}>
          <StatusDot tone={dotTone} pulse />
          <span className={styles.stateLabel} data-state={state}>
            {state === 'live' ? 'LIVE' : state === 'error' ? 'ERROR' : 'CONNECTING'}
          </span>
        </div>
      </div>
      <div className={styles.feed}>
        {events.length === 0 && state !== 'error' ? (
          <div className={styles.note}>Waiting for events…</div>
        ) : null}
        {events.length === 0 && state === 'error' ? (
          <div className={styles.note} data-err="1">Live feed unavailable. Reconnecting…</div>
        ) : null}
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
