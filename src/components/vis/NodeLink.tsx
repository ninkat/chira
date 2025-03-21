import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import {
  InteractionEvent,
  InteractionEventHandler,
  InteractionPoint,
} from '@/types/interactionTypes';

// define types for our node and link data
interface Node extends d3.SimulationNodeDatum {
  id: string;
  group: number;
  x?: number;
  y?: number;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
  value: number;
}

interface GraphData {
  nodes: Node[];
  links: Link[];
}

// helper functions for link highlighting
// get node id from either string or node object
const getNodeId = (node: string | Node): string => {
  if (node === null || node === undefined) {
    console.error('getNodeId received null or undefined node');
    return '';
  }

  if (typeof node === 'string') {
    return node;
  }

  if (!node.id) {
    console.error('Node object has no id property:', node);
    return '';
  }

  return node.id;
};

// check if a link connects to a node
const isLinkConnectedToNode = (link: Link, nodeId: string): boolean => {
  const sourceId = getNodeId(link.source);
  const targetId = getNodeId(link.target);
  return sourceId === nodeId || targetId === nodeId;
};

// get the other end of a link given one node
const getOtherEnd = (link: Link, nodeId: string): string => {
  const sourceId = getNodeId(link.source);
  const targetId = getNodeId(link.target);
  return sourceId === nodeId ? targetId : sourceId;
};

// find all links connected to a node
const findConnectedLinks = (links: Link[], nodeId: string): Link[] => {
  const connectedLinks = links.filter((link) =>
    isLinkConnectedToNode(link, nodeId)
  );
  return connectedLinks;
};

// find shortest path between two nodes using breadth-first search
const findShortestPath = (
  links: Link[],
  startNodeId: string,
  endNodeId: string
): Link[] => {
  // use bfs to find shortest path
  const queue: { nodeId: string; path: Link[] }[] = [
    { nodeId: startNodeId, path: [] },
  ];
  const visited = new Set<string>([startNodeId]);

  while (queue.length > 0) {
    const { nodeId, path } = queue.shift()!;

    // find all links connected to current node
    const connectedLinks = findConnectedLinks(links, nodeId);

    for (const link of connectedLinks) {
      const nextNodeId = getOtherEnd(link, nodeId);

      // if we've found the target node, return the path
      if (nextNodeId === endNodeId) {
        return [...path, link];
      }

      // if we haven't visited this node yet, add it to the queue
      if (!visited.has(nextNodeId)) {
        visited.add(nextNodeId);
        queue.push({ nodeId: nextNodeId, path: [...path, link] });
      }
    }
  }

  // no path found
  return [];
};

// find induced subgraph between multiple nodes
const findInducedSubgraph = (links: Link[], nodeIds: string[]): Link[] => {
  // create a set of node ids for faster lookup
  const nodeIdSet = new Set(nodeIds);

  // Check if we have valid links
  if (!links || links.length === 0) {
    console.error('No links provided to findInducedSubgraph');
    return [];
  }

  // return links where both endpoints are in the set of nodes
  const inducedLinks = links.filter((link) => {
    const sourceId = getNodeId(link.source);
    const targetId = getNodeId(link.target);

    // Debug: check if source and target are in the set
    const sourceInSet = nodeIdSet.has(sourceId);
    const targetInSet = nodeIdSet.has(targetId);

    // for an induced subgraph, both endpoints must be in the set of nodes
    const isInduced = sourceInSet && targetInSet;

    return isInduced;
  });

  return inducedLinks;
};

const NodeLink: React.FC = () => {
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

  // add ref for tracking link creation timer
  const linkTimerRef = useRef<number | null>(null);

  // add ref for tracking drag state per hand
  const dragStateRef = useRef<{
    left: { node: Node | null; offset: { x: number; y: number } | null };
    right: { node: Node | null; offset: { x: number; y: number } | null };
  }>({
    left: { node: null, offset: null },
    right: { node: null, offset: null },
  });

  // refs for tracking hover states for each mode and hand
  const neutralHoverRef = useRef<{ [key: string]: SVGCircleElement | null }>({
    left: null,
    right: null,
  });

  // ref for tracking all hovered nodes (for multi-node highlighting)
  const hoveredNodesRef = useRef<Set<SVGCircleElement>>(new Set());

  // add refs for storing original data
  const originalDataRef = useRef<GraphData | null>(null);

  // constants for dimensions and styling
  const width = 1920;
  const height = 1080;
  const hoverNodeColor = '#ff7f50'; // Coral - a vibrant orange shade
  const selectedNodeColor = '#87ceeb'; // Sky blue - keeping this as is
  const defaultNodeStrokeColor = '#fff'; // White border by default
  const defaultNodeStrokeWidth = 2; // Default border width
  const defaultLinkColor = '#999';
  const defaultLinkOpacity = 0.6;
  const highlightedLinkColor = '#ffa500'; // Orange - warm and visible highlight
  const highlightedLinkOpacity = 0.9;
  const baseNodeRadius = 25;

  // constants for visualization bounding box
  // create a centered 1280 x 720 box within the 1920 x 1080 canvas
  const visBoundingBoxWidth = 1280;
  const visBoundingBoxHeight = 720;
  const visBoundingBoxX = (width - visBoundingBoxWidth) / 2; // center horizontally
  const visBoundingBoxY = (height - visBoundingBoxHeight) / 2; // center vertically

  // ref for the bounding box element
  const boundingBoxRef = useRef<SVGRectElement | null>(null);

  // constants for removal box
  const boxWidth = 400;
  const boxHeight = 300;
  const boxX = width - boxWidth; // flush with right edge
  const boxY = height / 2 - boxHeight / 2;

  // constants for template nodes in blue box
  const templateNodeRadius = baseNodeRadius;
  const templateNodeSpacing = templateNodeRadius * 8;
  const templateNodeStartX = boxWidth / 2 - templateNodeSpacing / 2;

  // create color scale for groups
  const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

  // ref for animation frame
  const animationFrameRef = useRef<number>();

  // ref for simulation
  const simulationRef = useRef<d3.Simulation<Node, Link>>();

  // ref for boundary force function
  const boundaryForceRef = useRef<() => void>(() => {});

  useEffect(() => {
    // create svg and group elements
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // define drop shadow filter
    const defs = svg.append('defs');
    const filter = defs
      .append('filter')
      .attr('id', 'drop-shadow')
      .attr('height', '130%');

    filter
      .append('feGaussianBlur')
      .attr('in', 'SourceAlpha')
      .attr('stdDeviation', 3)
      .attr('result', 'blur');

    filter
      .append('feOffset')
      .attr('in', 'blur')
      .attr('dx', 2)
      .attr('dy', 2)
      .attr('result', 'offsetBlur');

    filter
      .append('feComponentTransfer')
      .append('feFuncA')
      .attr('type', 'linear')
      .attr('slope', 0.5);

    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'offsetBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Create a separate group for the bounding box that won't be transformed
    const boundingBoxGroup = svg
      .append('g')
      .attr('class', 'bounding-box-group');

    // Create the main group for the visualization that will be transformed
    const g = svg.append('g');
    gRef.current = g;

    // load graph data
    d3.json<GraphData>('./src/assets/fdg2.json')
      .then((data) => {
        if (!data) return;

        // store original data
        originalDataRef.current = JSON.parse(JSON.stringify(data));

        // create optimized force simulation
        const simulation = d3
          .forceSimulation<Node>(data.nodes)
          .force(
            'link',
            d3
              .forceLink<Node, Link>(data.links)
              .id((d) => d.id)
              .distance(150)
              .strength(0.07)
          )
          .force(
            'charge',
            d3.forceManyBody<Node>().strength(-300).theta(0.9).distanceMax(400)
          )
          .force(
            'center',
            d3
              .forceCenter(
                visBoundingBoxWidth / 2 + visBoundingBoxX,
                visBoundingBoxHeight / 2 + visBoundingBoxY
              )
              .strength(0.04)
          )
          .force(
            'collision',
            d3.forceCollide<Node>().radius(baseNodeRadius * 1.8)
          );

        // create a boundary force function that uses the current transform
        const createBoundaryForce = () => {
          return () => {
            // calculate the bounding box in simulation space
            const simBoxX = visBoundingBoxX;
            const simBoxY = visBoundingBoxY;
            const simBoxWidth = visBoundingBoxWidth;
            const simBoxHeight = visBoundingBoxHeight;

            // add padding to account for node radius
            const padding = baseNodeRadius;

            for (const node of data.nodes) {
              if (!node.x || !node.y) continue;

              // constrain x position in simulation space
              if (node.x < simBoxX + padding) {
                node.x = simBoxX + padding;
                node.vx = Math.abs(node.vx || 0) * 0.2; // bounce with reduced velocity
              } else if (node.x > simBoxX + simBoxWidth - padding) {
                node.x = simBoxX + simBoxWidth - padding;
                node.vx = -Math.abs(node.vx || 0) * 0.2; // bounce with reduced velocity
              }

              // constrain y position in simulation space
              if (node.y < simBoxY + padding) {
                node.y = simBoxY + padding;
                node.vy = Math.abs(node.vy || 0) * 0.2; // bounce with reduced velocity
              } else if (node.y > simBoxY + simBoxHeight - padding) {
                node.y = simBoxY + simBoxHeight - padding;
                node.vy = -Math.abs(node.vy || 0) * 0.2; // bounce with reduced velocity
              }
            }
          };
        };

        // initialize the boundary force
        boundaryForceRef.current = createBoundaryForce();

        // add the boundary force to the simulation
        simulation
          .force('boundary', boundaryForceRef.current)
          .alphaDecay(0.0005)
          .alphaMin(0.0001)
          .velocityDecay(0.35);

        // add a continuous reheat mechanism to keep the simulation active
        const reheatSimulation = () => {
          if (simulationRef.current) {
            // only reheat if alpha is below threshold
            if (simulationRef.current.alpha() < 0.05) {
              simulationRef.current.alpha(0.1).restart();
            }
            // schedule next reheat
            setTimeout(reheatSimulation, 5000); // reheat every 5 seconds if needed
          }
        };

        // start the reheat cycle
        reheatSimulation();

        simulationRef.current = simulation;

        // Create the removal box
        const box = svg
          .append('g')
          .attr('class', 'removal-box')
          .style('cursor', 'pointer')
          .on('click', () => {
            // ... existing click handler code ...
          });

        box
          .append('polygon')
          .attr('class', 'removal-box-polygon')
          .attr('points', () => {
            // create a rectangular shape using polygon
            const x = boxX;
            const y = boxY;
            const width = boxWidth;
            const height = boxHeight;

            return [
              [x, y], // top-left
              [x + width, y], // top-right
              [x + width, y + height], // bottom-right
              [x, y + height], // bottom-left
            ]
              .map((point) => point.join(','))
              .join(' ');
          })
          .attr('fill', 'rgba(255, 99, 71, 0.2)')
          .attr('stroke', '#ff6347')
          .attr('stroke-width', 2);

        box
          .append('text')
          .attr('x', boxX + boxWidth / 2)
          .attr('y', boxY + boxHeight / 2)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .style('font-size', '40px')
          .style('fill', '#333')
          .text('remove nodes here');

        // Create the blue box on the left
        const blueBox = svg
          .append('g')
          .attr('class', 'blue-box')
          .style('cursor', 'pointer');

        // Draw the visualization bounding box - this is now our dynamic bounding box
        boundingBoxRef.current = boundingBoxGroup
          .append('rect')
          .attr('class', 'vis-bounding-box')
          .attr('x', visBoundingBoxX)
          .attr('y', visBoundingBoxY)
          .attr('width', visBoundingBoxWidth)
          .attr('height', visBoundingBoxHeight)
          .attr('fill', 'none')
          .attr('stroke', '#ff0000') // changed to red for visibility
          .attr('stroke-width', 4) // increased width
          .attr('stroke-dasharray', '15,10') // changed dash pattern
          .attr('rx', 15) // increased corner radius
          .attr('ry', 15)
          .style('pointer-events', 'none') // ensure it doesn't interfere with interactions
          .node();

        blueBox
          .append('polygon')
          .attr('class', 'blue-box-polygon')
          .attr('points', () => {
            // create a rectangular shape using polygon
            const x = 0; // flush with left edge
            const y = height / 2 - boxHeight / 2;
            const w = boxWidth;
            const h = boxHeight;

            return [
              [x, y], // top-left
              [x + w, y], // top-right
              [x + w, y + h], // bottom-right
              [x, y + h], // bottom-left
            ]
              .map((point) => point.join(','))
              .join(' ');
          })
          .attr('fill', 'rgba(0, 122, 255, 0.2)')
          .attr('stroke', '#007AFF')
          .attr('stroke-width', 2);

        // add template nodes in the blue box
        const templateNodes = [1, 2, 3, 4].map((group, i) => ({
          id: `template-${group}`,
          group,
          // calculate positions to center within the blue box
          x: templateNodeStartX + (i % 2) * templateNodeSpacing,
          // add vertical offset to position relative to the blue box's top
          y: boxY + 80 + Math.floor(i / 2) * templateNodeSpacing,
          isTemplate: true,
        }));

        // create template nodes in blue box
        blueBox
          .selectAll('circle.template-node')
          .data(templateNodes)
          .join('circle')
          .attr('class', 'template-node')
          .attr('r', templateNodeRadius)
          .attr('cx', (d) => d.x)
          .attr('cy', (d) => d.y)
          .attr('fill', (d) => colorScale(String(d.group)))
          .attr('fill-opacity', 0.85)
          .attr('stroke', defaultNodeStrokeColor)
          .attr('stroke-width', defaultNodeStrokeWidth)
          .style('filter', 'url(#drop-shadow)')
          .style('cursor', 'pointer')
          .style('touch-action', 'none')
          .style('pointer-events', 'all');

        blueBox
          .append('text')
          .attr('x', boxWidth / 2)
          .attr('y', boxY + 40)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .style('font-size', '24px')
          .style('fill', '#333')
          .text('drag to create nodes');

        // Create initial node and link groups
        const links = g
          .append('g')
          .attr('class', 'links')
          .selectAll<SVGLineElement, Link>('line')
          .data(data.links)
          .join('line')
          .attr('stroke', defaultLinkColor)
          .attr('stroke-opacity', defaultLinkOpacity)
          .attr('stroke-width', (d) => Math.sqrt(d.value) * 2);

        g.append('g')
          .attr('class', 'nodes')
          .selectAll<SVGCircleElement, Node>('circle')
          .data(data.nodes)
          .join('circle')
          .attr('r', baseNodeRadius)
          .attr('fill', (d) => colorScale(String(d.group)))
          .attr('fill-opacity', 0.85)
          .attr('stroke', defaultNodeStrokeColor)
          .attr('stroke-width', defaultNodeStrokeWidth)
          .style('filter', 'url(#drop-shadow)')
          .style('cursor', 'pointer')
          .style('touch-action', 'none')
          .style('pointer-events', 'all');

        // Set up the tick function once
        simulation.on('tick', () => {
          // Update link positions
          links
            .attr('x1', (d) => (d.source as Node).x ?? 0)
            .attr('y1', (d) => (d.source as Node).y ?? 0)
            .attr('x2', (d) => (d.target as Node).x ?? 0)
            .attr('y2', (d) => (d.target as Node).y ?? 0);

          // Update node positions
          g.select('.nodes')
            .selectAll<SVGCircleElement, Node>('circle')
            .attr('cx', (d) => d.x ?? 0)
            .attr('cy', (d) => d.y ?? 0);

          // Update link highlighting immediately during simulation
          updateLinkHighlighting();
        });

        // handle gesture-based interactions
        const handleGestureDrag = (
          point: InteractionPoint,
          handedness: 'left' | 'right'
        ) => {
          // convert client coordinates to simulation space
          const transform = currentTransform.current;
          const svgRect =
            svgRef.current?.getBoundingClientRect() || new DOMRect();

          // calculate simulation coordinates
          const simulationX =
            (point.clientX - svgRect.left - transform.x) / transform.scale;
          const simulationY =
            (point.clientY - svgRect.top - transform.y) / transform.scale;

          // if we have a dragged node for this hand, update its position
          const dragState = dragStateRef.current[handedness];
          if (dragState.node && dragState.offset) {
            dragState.node.fx = simulationX + dragState.offset.x;
            dragState.node.fy = simulationY + dragState.offset.y;

            // check if node is over removal box
            const nodeScreenX =
              dragState.node.fx * transform.scale + transform.x;
            const nodeScreenY =
              dragState.node.fy * transform.scale + transform.y;

            if (
              nodeScreenX >= boxX &&
              nodeScreenX <= boxX + boxWidth &&
              nodeScreenY >= boxY &&
              nodeScreenY <= boxY + boxHeight
            ) {
              // highlight box
              svg
                .select('.removal-box-polygon')
                .attr('fill', 'rgba(255, 99, 71, 0.7)');
            } else {
              // reset box highlight
              svg
                .select('.removal-box-polygon')
                .attr('fill', 'rgba(255, 99, 71, 0.2)');
            }

            // update link highlighting during drag
            updateLinkHighlighting();

            // Also update link positions during drag to ensure they follow the nodes
            g.select('.links')
              .selectAll<SVGLineElement, Link>('line')
              .attr('x1', (d) => (d.source as Node).x ?? 0)
              .attr('y1', (d) => (d.source as Node).y ?? 0)
              .attr('x2', (d) => (d.target as Node).x ?? 0)
              .attr('y2', (d) => (d.target as Node).y ?? 0);
          }
        };

        // main interaction handler
        const handleInteraction: InteractionEventHandler = (event) => {
          switch (event.type) {
            case 'pointerover': {
              // handle hover interactions
              const { point, handedness } = event;
              if (!handedness) return;

              const element = document.elementFromPoint(
                point.clientX,
                point.clientY
              );
              if (element instanceof SVGCircleElement) {
                // store the newly hovered element for this hand
                neutralHoverRef.current[handedness] = element;

                // add to the set of all hovered nodes
                hoveredNodesRef.current.add(element);

                // highlight hovered node if not already selected
                d3.select(element)
                  .filter(function () {
                    return !d3.select(this).classed('selected');
                  })
                  .attr('stroke', hoverNodeColor)
                  .attr('stroke-width', defaultNodeStrokeWidth * 1.5);

                // highlight links based on hovered nodes immediately
                updateLinkHighlighting();
              }
              break;
            }
            case 'pointerout': {
              // handle pointer out
              const { handedness, element: eventElement } = event;
              if (!handedness) return;

              // use the element from the event if provided, otherwise use the stored hover element
              const hoveredElement =
                eventElement || neutralHoverRef.current[handedness];

              if (hoveredElement) {
                // check if the element is still being hovered by the other hand
                const otherHand = handedness === 'left' ? 'right' : 'left';
                const isHoveredByOtherHand =
                  neutralHoverRef.current[otherHand] === hoveredElement;

                // clear the hover reference for this hand
                if (neutralHoverRef.current[handedness] === hoveredElement) {
                  neutralHoverRef.current[handedness] = null;
                }

                // only remove from hoveredNodesRef and reset style if not hovered by other hand
                if (!isHoveredByOtherHand) {
                  // reset to group color if not selected
                  d3.select(hoveredElement)
                    .filter(function () {
                      return !d3.select(this).classed('selected');
                    })
                    .attr('stroke', defaultNodeStrokeColor)
                    .attr('stroke-width', defaultNodeStrokeWidth);

                  // remove from the set of all hovered nodes
                  if (hoveredElement instanceof SVGCircleElement) {
                    hoveredNodesRef.current.delete(hoveredElement);
                  }

                  // update link highlighting immediately after hover state changes
                  updateLinkHighlighting();
                }
              }
              break;
            }
            case 'pointerdown': {
              const { element, point, handedness } = event;
              if (element instanceof SVGCircleElement && handedness) {
                const d = d3.select(element).datum() as Node;

                // check if this is a template node
                if ('isTemplate' in d) {
                  // calculate the initial position in simulation space
                  const svgRect =
                    svgRef.current?.getBoundingClientRect() || new DOMRect();
                  const transform = currentTransform.current;
                  const simulationX =
                    (point.clientX - svgRect.left - transform.x) /
                    transform.scale;
                  const simulationY =
                    (point.clientY - svgRect.top - transform.y) /
                    transform.scale;

                  // create a new node based on the template but position it at the pointer
                  const newNode: Node = {
                    id: `node-${Date.now()}`, // unique id based on timestamp
                    group: d.group,
                    x: simulationX,
                    y: simulationY,
                    fx: simulationX, // fix position immediately
                    fy: simulationY,
                  };

                  // set up dragging for the new node
                  dragStateRef.current[handedness] = {
                    node: newNode,
                    offset: { x: 0, y: 0 },
                  };

                  // immediately add the node to the simulation
                  if (simulationRef.current) {
                    const simulation = simulationRef.current;

                    // add the node to the simulation
                    simulation.nodes([...simulation.nodes(), newNode]);

                    // update the visualization
                    const g = gRef.current;
                    if (g) {
                      g.select('.nodes')
                        .selectAll<SVGCircleElement, Node>('circle')
                        .data(simulation.nodes(), (d) => d.id)
                        .join('circle')
                        .attr('r', baseNodeRadius)
                        .attr('fill', (d) => colorScale(String(d.group)))
                        .attr('fill-opacity', 0.85)
                        .attr('stroke', defaultNodeStrokeColor)
                        .attr('stroke-width', defaultNodeStrokeWidth)
                        .style('filter', 'url(#drop-shadow)')
                        .style('cursor', 'pointer')
                        .style('touch-action', 'none')
                        .style('pointer-events', 'all');
                    }

                    // restart the simulation
                    simulation.alphaTarget(0.3).restart();

                    // update link highlighting immediately after simulation restart
                    updateLinkHighlighting();
                  }

                  return;
                }

                // when dragging a node, clear its hover state
                if (element) {
                  // clear from neutralHoverRef for this hand
                  neutralHoverRef.current[handedness] = null;

                  // check if the other hand is hovering this element
                  const otherHand = handedness === 'left' ? 'right' : 'left';
                  const isHoveredByOtherHand =
                    neutralHoverRef.current[otherHand] === element;

                  // only remove from hoveredNodesRef if not hovered by other hand
                  if (!isHoveredByOtherHand) {
                    hoveredNodesRef.current.delete(element);
                  }
                }

                // start the simulation when drag starts
                simulation.alphaTarget(0.3).restart();

                // update link highlighting immediately after simulation restart
                updateLinkHighlighting();

                // calculate and store the offset between pointer and node center
                const svgRect =
                  svgRef.current?.getBoundingClientRect() || new DOMRect();
                const transform = currentTransform.current;
                const pointerX =
                  (point.clientX - svgRect.left - transform.x) /
                  transform.scale;
                const pointerY =
                  (point.clientY - svgRect.top - transform.y) / transform.scale;

                dragStateRef.current[handedness] = {
                  node: d,
                  offset: {
                    x: (d.x ?? 0) - pointerX,
                    y: (d.y ?? 0) - pointerY,
                  },
                };

                // fix the node at its current position
                d.fx = d.x;
                d.fy = d.y;

                // check if both hands are now dragging nodes and start timer if needed
                const otherHand = handedness === 'left' ? 'right' : 'left';
                if (dragStateRef.current[otherHand].node) {
                  // create link between the two nodes immediately
                  const leftNode = dragStateRef.current.left.node;
                  const rightNode = dragStateRef.current.right.node;

                  if (leftNode && rightNode && simulationRef.current) {
                    const simulation = simulationRef.current;
                    const linkForce = simulation.force('link') as d3.ForceLink<
                      Node,
                      Link
                    >;

                    // check if link already exists
                    const existingLink = linkForce.links().find((link) => {
                      const sourceId =
                        typeof link.source === 'string'
                          ? link.source
                          : link.source.id;
                      const targetId =
                        typeof link.target === 'string'
                          ? link.target
                          : link.target.id;
                      return (
                        (sourceId === leftNode.id &&
                          targetId === rightNode.id) ||
                        (sourceId === rightNode.id && targetId === leftNode.id)
                      );
                    });

                    if (!existingLink) {
                      // create new link
                      const newLink: Link = {
                        source: leftNode,
                        target: rightNode,
                        value: 1,
                      };

                      // add link to simulation
                      if (linkForce) {
                        const currentLinks = linkForce.links();
                        linkForce.links([...currentLinks, newLink]);

                        // update visualization
                        const g = gRef.current;
                        if (g) {
                          // update links visualization
                          g.select('.links')
                            .selectAll<SVGLineElement, Link>('line')
                            .data(linkForce.links())
                            .join('line')
                            .attr('stroke', defaultLinkColor)
                            .attr('stroke-opacity', defaultLinkOpacity)
                            .attr('stroke-width', (d) => Math.sqrt(d.value) * 2)
                            .attr('x1', (d) => (d.source as Node).x ?? 0)
                            .attr('y1', (d) => (d.source as Node).y ?? 0)
                            .attr('x2', (d) => (d.target as Node).x ?? 0)
                            .attr('y2', (d) => (d.target as Node).y ?? 0);

                          // Set up the tick function to update link positions
                          simulation.on('tick', () => {
                            // Update link positions
                            g.select('.links')
                              .selectAll<SVGLineElement, Link>('line')
                              .attr('x1', (d) => (d.source as Node).x ?? 0)
                              .attr('y1', (d) => (d.source as Node).y ?? 0)
                              .attr('x2', (d) => (d.target as Node).x ?? 0)
                              .attr('y2', (d) => (d.target as Node).y ?? 0);

                            // Update node positions
                            g.select('.nodes')
                              .selectAll<SVGCircleElement, Node>('circle')
                              .attr('cx', (d) => d.x ?? 0)
                              .attr('cy', (d) => d.y ?? 0);

                            // Update link highlighting immediately
                            updateLinkHighlighting();
                          });
                        }

                        // restart simulation with higher alpha to make the new link more noticeable
                        simulation.alpha(0.5).restart();
                      }
                    }
                  }
                }
              }
              break;
            }
            case 'pointermove': {
              const { point, handedness } = event;
              if (handedness) {
                handleGestureDrag(point, handedness);
              }
              break;
            }
            case 'pointerup': {
              const { handedness, point } = event;
              if (handedness) {
                const dragState = dragStateRef.current[handedness];
                if (dragState.node) {
                  // clear link timer if it exists
                  if (linkTimerRef.current) {
                    clearTimeout(linkTimerRef.current);
                    linkTimerRef.current = null;
                  }

                  // check if node is over removal box
                  const transform = currentTransform.current;
                  const nodeScreenX =
                    dragState.node.fx! * transform.scale + transform.x;
                  const nodeScreenY =
                    dragState.node.fy! * transform.scale + transform.y;

                  const isOverRemovalBox =
                    nodeScreenX >= boxX &&
                    nodeScreenX <= boxX + boxWidth &&
                    nodeScreenY >= height / 2 - boxHeight / 2 &&
                    nodeScreenY <= height / 2 + boxHeight / 2;

                  if (isOverRemovalBox) {
                    // remove the node from the simulation
                    const simulation = simulationRef.current!;
                    const nodeId = dragState.node.id;

                    // get the current nodes and links
                    const currentNodes = simulation.nodes();
                    const linkForce = simulation.force('link') as d3.ForceLink<
                      Node,
                      Link
                    >;
                    const currentLinks = linkForce ? linkForce.links() : [];

                    // filter out the node to remove
                    const newNodes = currentNodes.filter(
                      (n) => n.id !== nodeId
                    );

                    // filter out links connected to the node
                    const newLinks = currentLinks.filter(
                      (link) =>
                        getNodeId(link.source) !== nodeId &&
                        getNodeId(link.target) !== nodeId
                    );

                    // update the simulation with the new nodes and links
                    simulation.nodes(newNodes);
                    if (linkForce) {
                      linkForce.links(newLinks);
                    }

                    const g = gRef.current;
                    if (g) {
                      // remove node from visualization
                      g.selectAll<SVGCircleElement, Node>('circle')
                        .data(simulation.nodes(), (d) => d.id)
                        .join('circle')
                        .attr('r', baseNodeRadius)
                        .attr('fill', (d) => colorScale(String(d.group)))
                        .attr('fill-opacity', 0.85)
                        .attr('stroke', defaultNodeStrokeColor)
                        .attr('stroke-width', defaultNodeStrokeWidth)
                        .style('filter', 'url(#drop-shadow)')
                        .style('cursor', 'pointer')
                        .style('touch-action', 'none')
                        .style('pointer-events', 'all');

                      // remove links from visualization
                      g.selectAll<SVGLineElement, Link>('line')
                        .data(linkForce ? linkForce.links() : [])
                        .join('line')
                        .attr('stroke', defaultLinkColor)
                        .attr('stroke-opacity', defaultLinkOpacity)
                        .attr('stroke-width', (d) => Math.sqrt(d.value) * 2);

                      // restart the simulation
                      simulation.alpha(0.3).restart();

                      // update link highlighting immediately after simulation restart
                      updateLinkHighlighting();
                    }
                  } else {
                    // if not over removal box, just release the node into the simulation
                    dragState.node.fx = null;
                    dragState.node.fy = null;

                    // check if the released node is under the pointer
                    if (point) {
                      const element = document.elementFromPoint(
                        point.clientX,
                        point.clientY
                      );

                      // if the pointer is over the released node, add it back to hover state
                      if (element instanceof SVGCircleElement) {
                        const nodeData = d3.select(element).datum() as Node;
                        if (nodeData.id === dragState.node.id) {
                          neutralHoverRef.current[handedness] = element;
                          hoveredNodesRef.current.add(element);

                          // highlight the node
                          d3.select(element)
                            .filter(function () {
                              return !d3.select(this).classed('selected');
                            })
                            .attr('stroke', hoverNodeColor)
                            .attr('stroke-width', defaultNodeStrokeWidth * 1.5);

                          // update link highlighting
                          updateLinkHighlighting();
                        }
                      }
                    }
                  }

                  // Always reset box highlight when node is dropped
                  svg
                    .select('.removal-box-polygon')
                    .attr('fill', 'rgba(255, 99, 71, 0.2)');

                  // clear drag state
                  dragStateRef.current[handedness] = {
                    node: null,
                    offset: null,
                  };

                  // we no longer stop the simulation when dragging ends
                  // removed: simulation.alphaTarget(0);
                }
              }
              break;
            }
            case 'pointerselect': {
              // handle selection
              const { element } = event;
              if (element instanceof SVGCircleElement) {
                const selection = d3.select<SVGCircleElement, Node>(element);
                const isSelected = selection.classed('selected');

                // First update the class
                selection.classed('selected', !isSelected);

                // Then update the fill color
                if (!isSelected) {
                  selection
                    .attr('stroke', selectedNodeColor)
                    .attr('stroke-width', defaultNodeStrokeWidth * 1.5);
                } else {
                  selection
                    .attr('stroke', defaultNodeStrokeColor)
                    .attr('stroke-width', defaultNodeStrokeWidth);
                }

                // Clear hover states for this element
                if (event.handedness) {
                  const otherHand =
                    event.handedness === 'left' ? 'right' : 'left';

                  // clear from neutralHoverRef for both hands
                  if (neutralHoverRef.current[event.handedness] === element) {
                    neutralHoverRef.current[event.handedness] = null;
                  }
                  if (neutralHoverRef.current[otherHand] === element) {
                    neutralHoverRef.current[otherHand] = null;
                  }

                  // also remove from hoveredNodesRef set
                  hoveredNodesRef.current.delete(element);
                }

                // update link highlighting after selection changes
                updateLinkHighlighting();
              }
              break;
            }
            case 'zoom':
            case 'drag': {
              // handle transform operations for both zoom and drag
              if (gRef.current) {
                // get transform values
                const transform =
                  event.type === 'zoom'
                    ? event.transform
                    : {
                        ...currentTransform.current, // Keep scale the same for drag
                        ...event.transform, // Update x,y from drag event
                      };

                // destructure values with defaults
                const {
                  x,
                  y,
                  scale = currentTransform.current.scale,
                } = transform;

                // apply transform to the visualization group
                gRef.current.attr(
                  'transform',
                  `translate(${x},${y}) scale(${scale})`
                );

                // update current transform state
                currentTransform.current = { scale, x, y };

                // update the bounding box to follow the zoom/pan
                if (boundingBoxRef.current) {
                  // calculate the new position and size of the bounding box in screen space
                  const scaledX = visBoundingBoxX * scale + x;
                  const scaledY = visBoundingBoxY * scale + y;
                  const scaledWidth = visBoundingBoxWidth * scale;
                  const scaledHeight = visBoundingBoxHeight * scale;

                  // update the bounding box visual representation
                  d3.select(boundingBoxRef.current)
                    .attr('x', scaledX)
                    .attr('y', scaledY)
                    .attr('width', scaledWidth)
                    .attr('height', scaledHeight);
                }

                // update the boundary force with the new transform
                if (simulationRef.current) {
                  // create a new boundary force function with the updated transform
                  boundaryForceRef.current = createBoundaryForce();

                  // update the force in the simulation
                  simulationRef.current.force(
                    'boundary',
                    boundaryForceRef.current
                  );

                  // restart the simulation to apply the new boundary force
                  simulationRef.current.alpha(0.1).restart();

                  // update link highlighting immediately after transform
                  updateLinkHighlighting();
                }
              }
              break;
            }
          }
        };

        // function to update link highlighting based on hovered nodes
        const updateLinkHighlighting = () => {
          // reset all links to default style
          g.select('.links')
            .selectAll<SVGLineElement, Link>('line')
            .attr('stroke', defaultLinkColor)
            .attr('stroke-opacity', defaultLinkOpacity)
            .attr('stroke-width', (d) => Math.sqrt(d.value) * 2);

          // get currently hovered nodes from the set
          const hoveredElements = Array.from(hoveredNodesRef.current);

          if (hoveredElements.length === 0) {
            return;
          }

          // get node data from hovered elements
          const hoveredNodes = hoveredElements
            .map((el) => {
              try {
                return d3.select(el).datum() as Node;
              } catch (error) {
                console.error('error getting datum from element:', error);
                return null;
              }
            })
            .filter((node) => node !== null) as Node[];

          // check if we have valid nodes
          if (hoveredNodes.length === 0) {
            return;
          }

          // get node ids
          const hoveredNodeIds = hoveredNodes.map((node) => node.id);

          // get all links from the simulation
          const linkForce = simulationRef.current?.force(
            'link'
          ) as d3.ForceLink<Node, Link>;
          const allLinks = linkForce ? linkForce.links() : [];

          let linksToHighlight: Link[] = [];

          // different highlighting behaviors based on number of hovered nodes:
          if (hoveredNodeIds.length === 1) {
            // case 1: one node hovered - highlight all its connected links
            linksToHighlight = findConnectedLinks(allLinks, hoveredNodeIds[0]);
          } else if (hoveredNodeIds.length === 2) {
            // case 2: two nodes hovered - highlight shortest path between them
            linksToHighlight = findShortestPath(
              allLinks,
              hoveredNodeIds[0],
              hoveredNodeIds[1]
            );
          } else {
            // case 3: more than two nodes - highlight induced subgraph
            linksToHighlight = findInducedSubgraph(allLinks, hoveredNodeIds);
          }

          // highlight the selected links by changing color, opacity and thickness
          g.select('.links')
            .selectAll<SVGLineElement, Link>('line')
            .filter((link) => linksToHighlight.includes(link))
            .attr('stroke', highlightedLinkColor)
            .attr('stroke-opacity', highlightedLinkOpacity)
            .attr('stroke-width', (d) => Math.sqrt(d.value) * 2);
        };

        // set up interaction event listener
        const parent = svg.node()?.parentElement;
        if (parent instanceof Element) {
          const handler = (e: CustomEvent<InteractionEvent>) =>
            handleInteraction(e.detail);
          parent.addEventListener('interaction', handler as EventListener);
          return () => {
            parent.removeEventListener('interaction', handler as EventListener);
          };
        }

        // cleanup function
        return () => {
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
          }
          if (simulationRef.current) {
            simulationRef.current.stop();
          }
        };
      })
      .catch((error) => {
        console.error('error loading or processing data:', error);
      });
  }, []);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{
        pointerEvents: 'all',
        touchAction: 'none',
        position: 'relative',
        cursor: 'pointer',
        overflow: 'visible',
      }}
    />
  );
};

export default NodeLink;
