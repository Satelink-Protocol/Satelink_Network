/** Topology model — passed in via props. The diagram renders whatever it's given. */
export type TopologyTone = 'primary' | 'secondary' | 'success' | 'info';
export type TopologyKind = 'source' | 'gateway' | 'edge' | 'sink';

export interface TopologyNode {
  id: string;
  label: string;
  sub?: string;
  x: number; // viewBox coords
  y: number;
  kind?: TopologyKind;
}

export interface TopologyLink {
  from: string;
  to: string;
  tone?: TopologyTone;
  /** Packet animation duration, e.g. "1.8s". */
  dur?: string;
}

export interface TopologyModel {
  nodes: TopologyNode[];
  links: TopologyLink[];
  width?: number;
  height?: number;
}
