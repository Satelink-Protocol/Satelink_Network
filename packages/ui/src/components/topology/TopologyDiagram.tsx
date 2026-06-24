import { Fragment } from 'react';

import type { TopologyLink, TopologyModel, TopologyNode } from './types';
import styles from './TopologyDiagram.module.css';

export interface TopologyDiagramProps {
  model: TopologyModel;
  /** Optional caption clarifying this is architecture, not live data. */
  caption?: string;
}

const PACKETS = [0, 0.33, 0.66];

function nodeById(nodes: TopologyNode[], id: string): TopologyNode | undefined {
  return nodes.find((n) => n.id === id);
}

/** Smooth cubic path between two node centers. */
function pathFor(a: TopologyNode, b: TopologyNode): string {
  const my = (a.y + b.y) / 2;
  return `M${a.x},${a.y} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
}

/**
 * Data-driven topology diagram. Renders exactly the nodes/links provided — no
 * hardcoded providers, counts, or metrics. Decorative architecture art.
 */
export function TopologyDiagram({ model, caption }: TopologyDiagramProps): JSX.Element {
  const { nodes, links } = model;
  const w = model.width ?? 680;
  const h = model.height ?? 220;

  const resolved = links
    .map((l, i) => {
      const a = nodeById(nodes, l.from);
      const b = nodeById(nodes, l.to);
      if (!a || !b) return null;
      return { id: `sat-tp-${i}`, d: pathFor(a, b), link: l };
    })
    .filter((x): x is { id: string; d: string; link: TopologyLink } => x !== null);

  return (
    <div>
      <svg className={styles.svg} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="network architecture">
        <defs>
          {resolved.map((p) => (
            <path key={p.id} id={p.id} d={p.d} fill="none" />
          ))}
          <filter id="sat-tp-glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {resolved.map((p) => (
          <use key={`l-${p.id}`} href={`#${p.id}`} className={styles.link} data-tone={p.link.tone ?? 'info'} />
        ))}

        {resolved.map((p) =>
          PACKETS.map((begin) => (
            <circle
              key={`${p.id}-${begin}`}
              r="2.5"
              className={styles.packet}
              data-tone={p.link.tone ?? 'info'}
              filter="url(#sat-tp-glow)"
            >
              <animateMotion
                dur={p.link.dur ?? '1.8s'}
                repeatCount="indefinite"
                begin={`${begin * parseFloat(p.link.dur ?? '1.8s')}s`}
              >
                <mpath href={`#${p.id}`} />
              </animateMotion>
            </circle>
          )),
        )}

        {nodes.map((n) => (
          <Fragment key={n.id}>
            <circle cx={n.x} cy={n.y} r={n.kind === 'gateway' ? 10 : 8} className={styles.nodeRing} data-kind={n.kind ?? 'edge'} />
            <circle cx={n.x} cy={n.y} r={n.kind === 'gateway' ? 4 : 3} className={styles.nodeCore} data-kind={n.kind ?? 'edge'} />
            <text x={n.x} y={n.y - 14} textAnchor="middle" className={styles.nodeLabel}>
              {n.label}
            </text>
            {n.sub ? (
              <text x={n.x} y={n.y + 22} textAnchor="middle" className={styles.nodeSub}>
                {n.sub}
              </text>
            ) : null}
          </Fragment>
        ))}
      </svg>
      {caption ? <div className={styles.caption}>{caption}</div> : null}
    </div>
  );
}
