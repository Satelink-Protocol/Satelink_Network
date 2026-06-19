import React from 'react';
import { EventStream, type StreamEvent, type StreamState } from '../events/EventStream';

export interface LiveEventStreamProps {
  title: string;
  state: StreamState;
  events: StreamEvent[];
}

export function LiveEventStream({ title, state, events }: LiveEventStreamProps): JSX.Element {
  return <EventStream title={title} state={state} events={events} />;
}
