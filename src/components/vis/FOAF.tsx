import React, { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import {
  InteractionEvent,
  InteractionEventHandler,
} from '@/types/interactionTypes';

// define types for our node and link data
interface Node extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  group: number;
  type: 'senator' | 'bill';
  state?: string;
  party?: string;
  status?: string;
  x?: number;
  y?: number;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
  value: number;
  type: 'sponsor' | 'cosponsor';
}

interface GraphData {
  nodes: Node[];
  links: Link[];
}

// constants for styling
const width = 1920;
const height = 1080;
const panelWidth = width / 4;
const graphWidth = (width * 3) / 4;
const panelBackground = 'rgba(33, 33, 33, 0.65)';
const panelTextColor = 'white';

const FOAF: React.FC = () => {
  // refs for managing svg and d3 elements
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  > | null>(null);

  // ref for tracking current transform state
  const currentTransform = useRef({ scale: 1, x: 0, y: 0 });

  // refs for tracking hover states for each hand
  const hoveredNodesRef = useRef<{
    left: Set<SVGCircleElement>;
    right: Set<SVGCircleElement>;
  }>({
    left: new Set(),
    right: new Set(),
  });

  // ref for tracking selected nodes
  const selectedNodesRef = useRef<{
    left: SVGCircleElement | null;
    right: SVGCircleElement | null;
  }>({
    left: null,
    right: null,
  });

  // ref for tracking all hovered nodes (for multi-node highlighting)
  const allHoveredNodesRef = useRef<Set<SVGCircleElement>>(new Set());

  // ref for storing original data
  const originalDataRef = useRef<GraphData | null>(null);

  // state for info panel
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null);
  const [hoveredNodes, setHoveredNodes] = useState<Node[]>([]);

  // constants for dimensions and styling
  const selectedNodeColor = '#87ceeb'; // Sky blue
  const hoveredNodeColor = '#ffa500'; // Orange for hovered nodes
  const defaultNodeStrokeColor = '#fff';
  const defaultNodeStrokeWidth = 2;
  const defaultLinkOpacity = 0.6;
  const highlightedLinkColor = '#ffa500';
  const highlightedLinkOpacity = 0.9;
  const senatorNodeRadius = 25;
  const billNodeRadius = 20;
  const sponsorLinkColor = '#FFD700'; // Gold for sponsor links
  const cosponsorLinkColor = '#999'; // Neutral gray for cosponsor links

  // ref for animation frame
  const animationFrameRef = useRef<number>();

  // ref for simulation
  const simulationRef = useRef<d3.Simulation<Node, Link>>();

  // function to update link highlighting based on hovered/selected nodes
  const updateLinkHighlighting = () => {
    if (!gRef.current) return;

    const allHoveredNodes = new Set([
      ...hoveredNodesRef.current.left,
      ...hoveredNodesRef.current.right,
    ]);

    // update node highlighting
    gRef.current
      .selectAll<SVGCircleElement, Node>('circle.node')
      .attr('stroke', (d) => {
        const node = gRef.current?.select(`circle[data-id="${d.id}"]`).node();
        return node && allHoveredNodes.has(node as SVGCircleElement)
          ? hoveredNodeColor
          : defaultNodeStrokeColor;
      })
      .attr('stroke-width', (d) => {
        const node = gRef.current?.select(`circle[data-id="${d.id}"]`).node();
        return node && allHoveredNodes.has(node as SVGCircleElement)
          ? '4'
          : defaultNodeStrokeWidth.toString();
      });

    // update link highlighting
    gRef.current
      .selectAll<SVGLineElement, Link>('line')
      .attr('stroke', (d) => {
        const source = typeof d.source === 'string' ? d.source : d.source.id;
        const target = typeof d.target === 'string' ? d.target : d.target.id;
        const sourceNode = gRef.current
          ?.select(`circle[data-id="${source}"]`)
          .node();
        const targetNode = gRef.current
          ?.select(`circle[data-id="${target}"]`)
          .node();

        if (
          (sourceNode && allHoveredNodes.has(sourceNode as SVGCircleElement)) ||
          (targetNode && allHoveredNodes.has(targetNode as SVGCircleElement))
        ) {
          return highlightedLinkColor;
        }
        return d.type === 'sponsor' ? sponsorLinkColor : cosponsorLinkColor;
      })
      .attr('stroke-opacity', (d) => {
        const source = typeof d.source === 'string' ? d.source : d.source.id;
        const target = typeof d.target === 'string' ? d.target : d.target.id;
        const sourceNode = gRef.current
          ?.select(`circle[data-id="${source}"]`)
          .node();
        const targetNode = gRef.current
          ?.select(`circle[data-id="${target}"]`)
          .node();

        if (
          (sourceNode && allHoveredNodes.has(sourceNode as SVGCircleElement)) ||
          (targetNode && allHoveredNodes.has(targetNode as SVGCircleElement))
        ) {
          return highlightedLinkOpacity;
        }
        return defaultLinkOpacity;
      });
  };

  // function to calculate node statistics
  const calculateNodeStats = (node: Node) => {
    if (!originalDataRef.current) return null;

    const links = originalDataRef.current.links;
    const nodes = originalDataRef.current.nodes;

    if (node.type === 'senator') {
      // For sponsored bills, we look for links where the senator is the source
      const sponsoredBills = links
        .filter((link) => {
          const source =
            typeof link.source === 'string' ? link.source : link.source.id;
          return source === node.id && link.type === 'sponsor';
        })
        .map((link) => {
          const target =
            typeof link.target === 'string' ? link.target : link.target.id;
          return nodes.find((n) => n.id === target);
        })
        .filter((n): n is Node => n !== undefined);

      // For co-sponsored bills, we look for links where the senator is the source
      const coSponsoredBills = links
        .filter((link) => {
          const source =
            typeof link.source === 'string' ? link.source : link.source.id;
          return source === node.id && link.type === 'cosponsor';
        })
        .map((link) => {
          const target =
            typeof link.target === 'string' ? link.target : link.target.id;
          return nodes.find((n) => n.id === target);
        })
        .filter((n): n is Node => n !== undefined);

      return {
        sponsoredBills,
        coSponsoredBills,
      };
    } else if (node.type === 'bill') {
      // For sponsors, we look for links where the bill is the target
      const sponsors = links
        .filter((link) => {
          const target =
            typeof link.target === 'string' ? link.target : link.target.id;
          return target === node.id && link.type === 'sponsor';
        })
        .map((link) => {
          const source =
            typeof link.source === 'string' ? link.source : link.source.id;
          return nodes.find((n) => n.id === source);
        })
        .filter((n): n is Node => n !== undefined);

      // For co-sponsors, we look for links where the bill is the target
      const coSponsors = links
        .filter((link) => {
          const target =
            typeof link.target === 'string' ? link.target : link.target.id;
          return target === node.id && link.type === 'cosponsor';
        })
        .map((link) => {
          const source =
            typeof link.source === 'string' ? link.source : link.source.id;
          return nodes.find((n) => n.id === source);
        })
        .filter((n): n is Node => n !== undefined);

      const partyBreakdown = [...sponsors, ...coSponsors].reduce(
        (acc, senator) => {
          if (senator.party === 'D') acc.democrats++;
          else if (senator.party === 'R') acc.republicans++;
          else if (senator.party === 'I') acc.independents++;
          return acc;
        },
        { democrats: 0, republicans: 0, independents: 0 }
      );

      return {
        sponsors,
        coSponsors,
        partyBreakdown,
      };
    }

    return null;
  };

  // function to calculate group statistics
  const calculateGroupStats = (nodes: Node[]) => {
    if (!originalDataRef.current) return null;

    const links = originalDataRef.current.links;
    const allNodes = originalDataRef.current.nodes;
    const nodeIds = new Set(nodes.map((n) => n.id));

    // calculate total connections
    const totalConnections = links.reduce((sum, link) => {
      const source =
        typeof link.source === 'string' ? link.source : link.source.id;
      const target =
        typeof link.target === 'string' ? link.target : link.target.id;
      if (nodeIds.has(source) && nodeIds.has(target)) {
        return sum + 1;
      }
      return sum;
    }, 0);

    // calculate party breakdown
    const partyBreakdown = nodes.reduce(
      (acc, node) => {
        if (node.type === 'senator') {
          if (node.party === 'D') acc.democrats++;
          else if (node.party === 'R') acc.republicans++;
          else if (node.party === 'I') acc.independents++;
        }
        return acc;
      },
      { democrats: 0, republicans: 0, independents: 0 }
    );

    // find shared bills
    const sharedBills = new Map<string, { bill: Node; senators: string[] }>();
    links.forEach((link) => {
      const source =
        typeof link.source === 'string' ? link.source : link.source.id;
      const target =
        typeof link.target === 'string' ? link.target : link.target.id;
      if (nodeIds.has(source)) {
        const bill = allNodes.find((n) => n.id === target);
        if (bill && bill.type === 'bill') {
          const key = bill.id;
          if (!sharedBills.has(key)) {
            sharedBills.set(key, { bill, senators: [] });
          }
          const senator = allNodes.find((n) => n.id === source);
          if (senator && senator.type === 'senator') {
            sharedBills.get(key)!.senators.push(senator.name.split(' ').pop()!);
          }
        }
      }
    });

    // find most frequent collaborations
    const collaborations = new Map<
      string,
      { senators: [Node, Node]; bills: Node[] }
    >();
    links.forEach((link) => {
      const source =
        typeof link.source === 'string' ? link.source : link.source.id;
      const target =
        typeof link.target === 'string' ? link.target : link.target.id;
      if (nodeIds.has(source) && nodeIds.has(target)) {
        const senator1 = allNodes.find((n) => n.id === source);
        const senator2 = allNodes.find((n) => n.id === target);
        if (
          senator1 &&
          senator2 &&
          senator1.type === 'senator' &&
          senator2.type === 'senator'
        ) {
          const key = [senator1.id, senator2.id].sort().join('-');
          if (!collaborations.has(key)) {
            collaborations.set(key, {
              senators: [senator1, senator2],
              bills: [],
            });
          }
          const bill = allNodes.find((n) => n.id === target);
          if (bill && bill.type === 'bill') {
            collaborations.get(key)!.bills.push(bill);
          }
        }
      }
    });

    return {
      totalConnections,
      partyBreakdown,
      senators: nodes.filter((n) => n.type === 'senator').map((n) => n.name),
      sharedBills: Array.from(sharedBills.values())
        .filter((b) => b.senators.length > 1)
        .sort((a, b) => b.senators.length - a.senators.length)
        .slice(0, 3),
      collaborations: Array.from(collaborations.entries())
        .map(([, { senators, bills }]) => ({
          senator1: senators[0],
          senator2: senators[1],
          count: bills.length,
          bills: bills.slice(0, 3),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
    };
  };

  useEffect(() => {
    // create svg and group elements
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // add filter definitions for drop shadows
    const defs = svg.append('defs');

    // node shadow filter
    defs
      .append('filter')
      .attr('id', 'drop-shadow')
      .append('feDropShadow')
      .attr('dx', 0)
      .attr('dy', 2)
      .attr('stdDeviation', 3)
      .attr('flood-opacity', 0.5);

    const g = svg.append('g');
    gRef.current = g;

    // load the data
    d3.json<GraphData>('./src/assets/foafagain.json')
      .then((data) => {
        if (!data) return;

        // store original data
        originalDataRef.current = data;

        // create the simulation
        const simulation = d3
          .forceSimulation<Node>(data.nodes)
          .force(
            'link',
            d3
              .forceLink<Node, Link>(data.links)
              .id((d) => d.id)
              .distance(100)
          )
          .force('charge', d3.forceManyBody().strength(-300))
          .force('center', d3.forceCenter(graphWidth / 2, height / 2))
          .force('collision', d3.forceCollide().radius(50))
          .force(
            'x',
            d3
              .forceX<Node>()
              .x((d) => {
                if (d.type === 'bill') return graphWidth / 2;
                return d.party === 'D' ? graphWidth * 0.2 : graphWidth * 0.8;
              })
              .strength(0.5)
          )
          .force(
            'y',
            d3
              .forceY<Node>()
              .y(height / 2)
              .strength(0.1)
          );

        simulationRef.current = simulation;

        // create links
        const link = g
          .selectAll<SVGLineElement, Link>('line')
          .data(data.links)
          .join('line')
          .attr('stroke', (d) =>
            d.type === 'sponsor' ? sponsorLinkColor : cosponsorLinkColor
          )
          .attr('stroke-opacity', defaultLinkOpacity)
          .attr('stroke-width', 2);

        // create nodes
        const node = g
          .selectAll<SVGCircleElement, Node>('circle')
          .data(data.nodes)
          .join('circle')
          .attr('r', (d: Node) =>
            d.type === 'senator' ? senatorNodeRadius : billNodeRadius
          )
          .attr('fill', (d: Node) => {
            if (d.type === 'bill') return '#999';
            return d.party === 'D' ? '#1E90FF' : '#FF4444';
          })
          .attr('fill-opacity', 0.85)
          .attr('stroke', defaultNodeStrokeColor)
          .attr('stroke-width', defaultNodeStrokeWidth)
          .style('filter', 'url(#drop-shadow)')
          .style('cursor', 'pointer')
          .style('touch-action', 'none')
          .style('pointer-events', 'all')
          .attr('data-id', (d) => d.id)
          .attr('class', 'node');

        // update positions on each tick
        simulation.on('tick', () => {
          link
            .attr('x1', (d) => (d.source as Node).x!)
            .attr('y1', (d) => (d.source as Node).y!)
            .attr('x2', (d) => (d.target as Node).x!)
            .attr('y2', (d) => (d.target as Node).y!);

          node.attr('cx', (d) => d.x!).attr('cy', (d) => d.y!);
        });

        // handle interaction events
        const handleInteraction: InteractionEventHandler = (event) => {
          if (!gRef.current) return;

          switch (event.type) {
            case 'pointerover':
              if (
                event.element &&
                event.element.classList.contains('node') &&
                event.handedness
              ) {
                const node = event.element as SVGCircleElement;
                hoveredNodesRef.current[event.handedness].add(node);
                allHoveredNodesRef.current.add(node);
                updateLinkHighlighting();
                const nodeData = d3.select(node).datum() as Node;
                setHoveredNode(nodeData);
                setHoveredNodes(
                  Array.from(hoveredNodesRef.current[event.handedness]).map(
                    (n) => d3.select(n).datum() as Node
                  )
                );
              }
              break;

            case 'pointerout':
              if (
                event.element &&
                event.element.classList.contains('node') &&
                event.handedness
              ) {
                const node = event.element as SVGCircleElement;
                hoveredNodesRef.current[event.handedness].delete(node);
                allHoveredNodesRef.current.delete(node);
                updateLinkHighlighting();
                if (hoveredNodesRef.current[event.handedness].size === 0) {
                  setHoveredNode(null);
                }
                setHoveredNodes(
                  Array.from(hoveredNodesRef.current[event.handedness]).map(
                    (n) => d3.select(n).datum() as Node
                  )
                );
              }
              break;

            case 'pointerselect':
              if (
                event.element &&
                event.element.classList.contains('node') &&
                event.handedness
              ) {
                const node = event.element as SVGCircleElement;
                const hand = event.handedness;
                const currentSelection = selectedNodesRef.current[hand];

                if (node === currentSelection) {
                  // deselect
                  node.setAttribute('stroke', defaultNodeStrokeColor);
                  node.setAttribute(
                    'stroke-width',
                    defaultNodeStrokeWidth.toString()
                  );
                  selectedNodesRef.current[hand] = null;
                } else {
                  // select new node
                  if (currentSelection) {
                    currentSelection.setAttribute(
                      'stroke',
                      defaultNodeStrokeColor
                    );
                    currentSelection.setAttribute(
                      'stroke-width',
                      defaultNodeStrokeWidth.toString()
                    );
                  }
                  node.setAttribute('stroke', selectedNodeColor);
                  node.setAttribute('stroke-width', '4');
                  selectedNodesRef.current[hand] = node;
                }
              }
              break;

            case 'drag':
              currentTransform.current = {
                ...currentTransform.current,
                x: event.transform.x,
                y: event.transform.y,
              };
              g.attr(
                'transform',
                `translate(${currentTransform.current.x},${currentTransform.current.y}) scale(${currentTransform.current.scale})`
              );
              break;

            case 'zoom':
              currentTransform.current = {
                scale: event.transform.scale,
                x: event.transform.x,
                y: event.transform.y,
              };
              g.attr(
                'transform',
                `translate(${currentTransform.current.x},${currentTransform.current.y}) scale(${currentTransform.current.scale})`
              );
              break;
          }
        };

        // setup event listener
        const parent = svgRef.current?.parentElement;
        if (parent) {
          const handler = (e: CustomEvent<InteractionEvent>) =>
            handleInteraction(e.detail);
          parent.addEventListener('interaction', handler as EventListener);
          return () => {
            parent.removeEventListener('interaction', handler as EventListener);
          };
        }
      })
      .catch((error) => {
        console.error('Error loading FOAF data:', error);
      });

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // render info panel
  const renderInfoPanel = () => {
    const nodeStats = hoveredNode ? calculateNodeStats(hoveredNode) : null;
    const groupStats =
      hoveredNodes.length > 1 ? calculateGroupStats(hoveredNodes) : null;

    return (
      <div
        style={{
          position: 'fixed',
          top: '0',
          left: '0',
          bottom: '0',
          width: `${panelWidth}px`,
          background: panelBackground,
          color: panelTextColor,
          padding: '24px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          zIndex: 1000,
          fontSize: '24px',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        <h2 style={{ margin: '0 0 16px 0', fontSize: '32px' }}>
          {hoveredNodes.length > 1
            ? 'Senator Group Breakdown'
            : hoveredNode
              ? hoveredNode.name
              : 'Hover over nodes to see details'}
        </h2>

        {hoveredNodes.length > 1 && groupStats ? (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
          >
            <div>
              <strong>Selected Senators:</strong>
              <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                {groupStats.senators.map((name, i) => (
                  <li key={i}>{name}</li>
                ))}
              </ul>
            </div>
            <div>
              <strong>Party Breakdown:</strong>
              <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                <li>Democrats: {groupStats.partyBreakdown.democrats}</li>
                <li>Republicans: {groupStats.partyBreakdown.republicans}</li>
                <li>Independents: {groupStats.partyBreakdown.independents}</li>
              </ul>
            </div>
            {groupStats.sharedBills.length > 0 && (
              <div>
                <strong>Top Shared Bills:</strong>
                <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                  {groupStats.sharedBills.map(({ bill, senators }, i) => (
                    <li key={i}>
                      {bill.name} ({senators.join(', ')})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {groupStats.collaborations.length > 0 && (
              <div>
                <strong>Top Collaborations:</strong>
                <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                  {groupStats.collaborations.map(
                    ({ senator1, senator2, count, bills }, i) =>
                      senator1 && senator2 ? (
                        <li key={i}>
                          {senator1.name.split(' ').pop()} &{' '}
                          {senator2.name.split(' ').pop()} ({count} bills)
                          <ul style={{ margin: '4px 0', paddingLeft: '20px' }}>
                            {bills.map((bill, j) => (
                              <li key={j}>{bill.name}</li>
                            ))}
                          </ul>
                        </li>
                      ) : null
                  )}
                </ul>
              </div>
            )}
          </div>
        ) : hoveredNode && nodeStats ? (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
          >
            {hoveredNode.type === 'senator' && nodeStats && (
              <>
                <div>
                  <strong>State:</strong> {hoveredNode.state}
                </div>
                <div>
                  <strong>Party:</strong> {hoveredNode.party}
                </div>
                <div>
                  <strong>Sponsored Bills:</strong>
                  <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                    {nodeStats.sponsoredBills?.map((bill, i) => (
                      <li key={i}>
                        {bill.name} ({bill.status})
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Co-Sponsored Bills:</strong>
                  <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                    {nodeStats.coSponsoredBills?.map((bill, i) => (
                      <li key={i}>
                        {bill.name} ({bill.status})
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
            {hoveredNode.type === 'bill' && nodeStats && (
              <>
                <div>
                  <strong>Status:</strong> {hoveredNode.status}
                </div>
                <div>
                  <strong>Sponsors:</strong>
                  <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                    {nodeStats.sponsors?.map((senator, i) => (
                      <li key={i}>
                        {senator.name} ({senator.party}-{senator.state})
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Co-Sponsors:</strong>
                  <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                    {nodeStats.coSponsors?.map((senator, i) => (
                      <li key={i}>
                        {senator.name} ({senator.party}-{senator.state})
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <strong>Party Breakdown:</strong>
                  <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                    <li>
                      Democrats: {nodeStats.partyBreakdown?.democrats ?? 0}
                    </li>
                    <li>
                      Republicans: {nodeStats.partyBreakdown?.republicans ?? 0}
                    </li>
                    <li>
                      Independents:{' '}
                      {nodeStats.partyBreakdown?.independents ?? 0}
                    </li>
                  </ul>
                </div>
              </>
            )}
          </div>
        ) : (
          <div style={{ color: 'rgba(255, 255, 255, 0.7)' }}>
            Hover over nodes to see their details and connections.
            <div style={{ marginTop: '16px' }}>
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <div
                  style={{
                    width: '16px',
                    height: '2px',
                    background: sponsorLinkColor,
                  }}
                />
                <span>Sponsor</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '8px',
                }}
              >
                <div
                  style={{
                    width: '16px',
                    height: '2px',
                    background: cosponsorLinkColor,
                  }}
                />
                <span>Co-Sponsor</span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <svg
        ref={svgRef}
        width={graphWidth}
        height={height}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          pointerEvents: 'all',
          touchAction: 'none',
        }}
      />
      {renderInfoPanel()}
    </>
  );
};

export default FOAF;
