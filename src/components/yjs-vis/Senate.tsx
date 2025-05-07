import React, { useContext, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsContext } from '../context/YjsContext';
import * as d3 from 'd3';
import senateData from '../../assets/foafagain.json';
import { InteractionEvent } from '@/types/interactionTypes';

// define shared value types for y.map
type NodeMapValue = string | number | boolean | undefined;
type LinkMapValue = string;

// d3 specific types - extend SimulationNodeDatum with our required properties
interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  type: string;
  name: string;
  party?: string;
  state?: string;
  status?: string;
  uuid: string;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  type: string;
}

// helper function to compact/prune the yjs document
function pruneYDoc(doc: Y.Doc) {
  console.log('[Yjs] Running document compaction...');
  const beforeSize = Y.encodeStateAsUpdate(doc).byteLength;

  try {
    // create a new temporary document
    const tempDoc = new Y.Doc();

    // get current data from original doc
    const originalNodes = doc.getArray<Y.Map<NodeMapValue>>('senateNodes');
    const originalLinks = doc.getArray<Y.Map<LinkMapValue>>('senateLinks');
    const originalSharedState = doc.getMap<string | boolean | null>(
      'senateSharedState'
    );

    // get references to collections in temp doc
    const tempNodes = tempDoc.getArray<Y.Map<NodeMapValue>>('senateNodes');
    const tempLinks = tempDoc.getArray<Y.Map<LinkMapValue>>('senateLinks');
    const tempSharedState = tempDoc.getMap<string | boolean | null>(
      'senateSharedState'
    );

    // copy nodes data
    tempDoc.transact(() => {
      // copy nodes
      for (let i = 0; i < originalNodes.length; i++) {
        const originalNode = originalNodes.get(i);
        const newNode = new Y.Map<NodeMapValue>();

        // copy all properties
        originalNode.forEach((value: NodeMapValue, key: string) => {
          newNode.set(key, value);
        });

        tempNodes.push([newNode]);
      }

      // copy links
      for (let i = 0; i < originalLinks.length; i++) {
        const originalLink = originalLinks.get(i);
        const newLink = new Y.Map<LinkMapValue>();

        // copy all properties
        originalLink.forEach((value: LinkMapValue, key: string) => {
          newLink.set(key, value);
        });

        tempLinks.push([newLink]);
      }

      // copy shared state
      originalSharedState.forEach(
        (value: string | boolean | null, key: string) => {
          tempSharedState.set(key, value);
        }
      );
    });

    // create snapshot of the cleaned data
    const cleanSnapshot = Y.encodeStateAsUpdate(tempDoc);

    // clear original doc
    doc.transact(() => {
      while (originalNodes.length > 0) originalNodes.delete(0);
      while (originalLinks.length > 0) originalLinks.delete(0);
      originalSharedState.forEach((_: string | boolean | null, key: string) =>
        originalSharedState.delete(key)
      );
    });

    // apply clean snapshot to original doc
    Y.applyUpdate(doc, cleanSnapshot);

    const afterSize = Y.encodeStateAsUpdate(doc).byteLength;
    const reduction = Math.max(
      0,
      Math.round((1 - afterSize / beforeSize) * 100)
    );
    console.log(
      `[Yjs] Compaction complete: ${beforeSize.toLocaleString()} bytes → ${afterSize.toLocaleString()} bytes (${reduction}% reduction)`
    );

    // cleanup temporary doc
    tempDoc.destroy();
  } catch (err) {
    console.error('[Yjs] Compaction failed:', err);

    // fallback to simple snapshot-based compaction if the more aggressive approach fails
    try {
      const snapshot = Y.encodeStateAsUpdate(doc);
      doc.transact(() => {
        Y.applyUpdate(doc, snapshot);
      });

      const afterSize = Y.encodeStateAsUpdate(doc).byteLength;
      const reduction = Math.max(
        0,
        Math.round((1 - afterSize / beforeSize) * 100)
      );
      console.log(
        `[Yjs] Simple compaction complete: ${beforeSize.toLocaleString()} bytes → ${afterSize.toLocaleString()} bytes (${reduction}% reduction)`
      );
    } catch (fallbackErr) {
      console.error('[Yjs] Fallback compaction also failed:', fallbackErr);
    }
  }
}

const Senate: React.FC = () => {
  // get doc from context (no awareness)
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;

  // reference to the d3 container
  const d3Container = useRef<HTMLDivElement | null>(null);

  // setup yjs shared arrays
  const yNodes = doc!.getArray<Y.Map<NodeMapValue>>('senateNodes');
  const yLinks = doc!.getArray<Y.Map<LinkMapValue>>('senateLinks');

  // add shared state with yjs
  const ySharedState = doc!.getMap<string | boolean | null | string[] | number>(
    'senateSharedState'
  );

  // add client click selections map - maps userId to array of selected node ids
  const yClientClickSelections = doc!.getMap<string[]>('clientClickSelections');

  // reference to track initialization
  const isInitializedRef = useRef(false);

  // track current transform for gestures
  const [currentTransform, setCurrentTransform] = useState<d3.ZoomTransform>(
    d3.zoomIdentity
  );
  // ref to track current transform values without triggering effect re-runs
  const transformRef = useRef<{ k: number; x: number; y: number }>({
    k: 1,
    x: 0,
    y: 0,
  });

  // only keep states for non-d3 related variables
  const [syncStatus, setSyncStatus] = useState<boolean>(false);
  const [userId] = useState<string>(() => crypto.randomUUID());

  // fixed dimensions for the svg canvas
  const fixedWidth = 1920;
  const fixedHeight = 1080;

  // left panel width for tooltip/info
  const tooltipWidth = fixedWidth * 0.25;

  // track sync status (simple timeout approach)
  useEffect(() => {
    if (!doc) return;
    // assume synced after a short delay
    const timeout = setTimeout(() => {
      console.log('assuming sync after timeout for senate visualization');
      setSyncStatus(true);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [doc]);

  // performance monitoring intervals and compaction
  useEffect(() => {
    if (!doc || !syncStatus) return;

    // monitor yjs document size
    const yjsMonitor = setInterval(() => {
      const byteLength = Y.encodeStateAsUpdate(doc).byteLength;
      console.log(`[Yjs] Document size: ${byteLength} bytes`);
    }, 60000); // every 60 seconds

    // monitor DOM elements
    const domMonitor = setInterval(() => {
      const nodeCount = document.querySelectorAll('g.node').length;
      const tooltipCount = document.querySelectorAll('g.tooltip').length;
      console.log(`[DOM] ${nodeCount} nodes, ${tooltipCount} tooltips in DOM`);
    }, 10000);

    // periodic document compaction to prevent unbounded growth
    const compactionInterval = setInterval(() => {
      pruneYDoc(doc);
    }, 300000); // every 5 minutes

    // cleanup intervals on unmount
    return () => {
      clearInterval(yjsMonitor);
      clearInterval(domMonitor);
      clearInterval(compactionInterval);
    };
  }, [doc, syncStatus]);

  // initialize graph data from json if ynodes is empty after sync
  useEffect(() => {
    // wait for sync and check if nodes are empty
    if (!syncStatus || yNodes.length > 0) {
      return;
    }

    console.log('initializing senate graph data from json');

    const initialNodes: Y.Map<NodeMapValue>[] = [];
    const initialLinks: Y.Map<LinkMapValue>[] = [];

    // we'll set positions later with d3 layout
    const defaultX = fixedWidth / 2;
    const defaultY = fixedHeight / 2;

    // process nodes from json
    senateData.nodes.forEach((node) => {
      const yNode = new Y.Map<NodeMapValue>();
      yNode.set('id', node.id);
      yNode.set('name', node.name);
      yNode.set('type', node.type);
      // just set initial positions - d3 will update these
      yNode.set('x', defaultX);
      yNode.set('y', defaultY);
      yNode.set('uuid', crypto.randomUUID()); // stable react key

      if (node.type === 'senator') {
        yNode.set('party', node.party?.toLowerCase() || 'i'); // ensure lowercase, default independent
        yNode.set('state', node.state);
      } else if (node.type === 'bill') {
        yNode.set('status', node.status);
      }
      initialNodes.push(yNode);
    });

    // process links from json
    senateData.links.forEach((link) => {
      const yLink = new Y.Map<LinkMapValue>();
      yLink.set('source', link.source);
      yLink.set('target', link.target);
      yLink.set('type', link.type);
      initialLinks.push(yLink);
    });

    // use transaction to batch updates
    doc!.transact(() => {
      yNodes.push(initialNodes);
      yLinks.push(initialLinks);
    });
  }, [syncStatus, doc, yNodes, yLinks]);

  // effect to sync transform state from yjs
  useEffect(() => {
    if (!doc || !syncStatus) return;

    // get initial transform from yjs or set default
    const initialTransform = {
      k: (ySharedState.get('zoomScale') as number) || 1,
      x: (ySharedState.get('panX') as number) || 0,
      y: (ySharedState.get('panY') as number) || 0,
    };

    transformRef.current = initialTransform;
    setCurrentTransform(
      d3.zoomIdentity
        .translate(initialTransform.x, initialTransform.y)
        .scale(initialTransform.k)
    );

    // observe zoom/pan changes
    const observer = () => {
      const scale = (ySharedState.get('zoomScale') as number) || 1;
      const x = (ySharedState.get('panX') as number) || 0;
      const y = (ySharedState.get('panY') as number) || 0;

      // only update if values are different to avoid loops
      if (
        scale !== transformRef.current.k ||
        x !== transformRef.current.x ||
        y !== transformRef.current.y
      ) {
        transformRef.current = { k: scale, x, y };
        setCurrentTransform(d3.zoomIdentity.translate(x, y).scale(scale));

        // apply transform to root if it exists
        const root = d3.select('#senate-root');
        if (!root.empty()) {
          root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
        }
      }
    };

    ySharedState.observe(observer);
    return () => ySharedState.unobserve(observer);
  }, [doc, syncStatus, ySharedState]);

  // d3 visualization setup and update
  useEffect(() => {
    if (!syncStatus || !d3Container.current) return;

    // Only initialize once
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    console.log('initializing d3 visualization');

    // clear any existing content
    d3.select(d3Container.current).selectAll('*').remove();

    // create svg element
    const svg = d3
      .select(d3Container.current)
      .append('svg')
      .attr('width', fixedWidth)
      .attr('height', fixedHeight)
      .attr('viewBox', [0, 0, fixedWidth, fixedHeight])
      .attr('style', 'background: transparent; max-width: 100%; height: auto;');

    // create a root group for all content that will be transformed
    const root = svg
      .append('g')
      .attr('class', 'root')
      .attr('id', 'senate-root')
      .attr(
        'transform',
        `translate(${currentTransform.x}, ${currentTransform.y}) scale(${currentTransform.k})`
      );

    // create groups for links and nodes
    const linkGroup = root.append('g').attr('class', 'links');
    const nodeGroup = root.append('g').attr('class', 'nodes');

    // Create a custom event handler for gesture interactions
    const handleInteraction = (event: InteractionEvent) => {
      switch (event.type) {
        case 'pointerover': {
          // Handle hover events (from handleOne or handleGrabbing)
          const element = event.element;

          if (!element || !(element instanceof SVGElement)) return;

          // Get data from the element if it's a node
          if (
            (element.tagName === 'circle' || element.tagName === 'rect') &&
            element.classList.contains('node-shape')
          ) {
            // find the parent node group element that contains the data-id
            const parentNode = element.closest('g.node');
            const nodeId = parentNode?.getAttribute('data-id');
            if (nodeId) {
              // get current hovered node ids and add this one if not already in the list
              const currentHoveredNodeIds =
                (ySharedState.get('hoveredNodeIds') as string[]) || [];
              if (!currentHoveredNodeIds.includes(nodeId)) {
                ySharedState.set('hoveredNodeIds', [
                  ...currentHoveredNodeIds,
                  nodeId,
                ]);
                updateVisualization();
              }
            }
          }
          break;
        }

        case 'pointerout': {
          // Handle hover end events (from handleOne or handleGrabbing)
          const element = event.element;
          if (!element || !(element instanceof SVGElement)) return;

          // If this is a node, remove only this specific node ID from the hovered list
          if (
            (element.tagName === 'circle' || element.tagName === 'rect') &&
            element.classList.contains('node-shape')
          ) {
            // find the parent node group element that contains the data-id
            const parentNode = element.closest('g.node');
            const nodeId = parentNode?.getAttribute('data-id');

            if (nodeId) {
              const currentHoveredNodeIds =
                (ySharedState.get('hoveredNodeIds') as string[]) || [];
              const updatedHoveredNodeIds = currentHoveredNodeIds.filter(
                (id) => id !== nodeId
              );
              ySharedState.set('hoveredNodeIds', updatedHoveredNodeIds);
              updateVisualization();
            }
          }
          break;
        }

        case 'pointerselect': {
          // Handle selection events (from handleThumbIndex)
          const element = event.element;
          if (!element || !(element instanceof SVGElement)) return;

          if (element.classList.contains('node-shape')) {
            // find the parent node group element that contains the data-id
            const parentNode = element.closest('g.node');
            const nodeId = parentNode?.getAttribute('data-id');
            if (nodeId) {
              // toggle selection
              const currentSelections =
                yClientClickSelections.get(userId) || [];
              if (currentSelections.includes(nodeId)) {
                // remove node from selections
                yClientClickSelections.set(
                  userId,
                  currentSelections.filter((id) => id !== nodeId)
                );
              } else {
                // add node to selections
                yClientClickSelections.set(userId, [
                  ...currentSelections,
                  nodeId,
                ]);
              }
              updateVisualization();
            }
          }
          break;
        }

        case 'drag': {
          // Handle drag events for panning
          if (event.transform) {
            const transform = event.transform as {
              x: number;
              y: number;
              scale?: number;
            };
            const { x, y } = transform;
            const scale = transform.scale || currentTransform.k;

            // update shared transform via yjs
            doc!.transact(() => {
              ySharedState.set('panX', x);
              ySharedState.set('panY', y);
              ySharedState.set('zoomScale', scale);
            });

            // Update current transform state
            const newTransform = d3.zoomIdentity.translate(x, y).scale(scale);
            setCurrentTransform(newTransform);

            // Apply the transform to the root group
            root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
          }
          break;
        }

        case 'zoom': {
          // Handle zoom events
          if (event.transform) {
            const { x, y, scale } = event.transform;

            // update shared transform via yjs
            doc!.transact(() => {
              ySharedState.set('panX', x);
              ySharedState.set('panY', y);
              ySharedState.set('zoomScale', scale);
            });

            // Update current transform state
            const newTransform = d3.zoomIdentity.translate(x, y).scale(scale);
            setCurrentTransform(newTransform);

            // Apply the transform to the root group
            root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
          }
          break;
        }
      }
    };

    // Add event listener for custom interaction events
    const parent = d3Container.current?.parentElement;
    if (parent) {
      parent.addEventListener('interaction', ((
        e: CustomEvent<InteractionEvent>
      ) => handleInteraction(e.detail)) as EventListener);
    }

    // create arrow marker for sponsor links
    svg
      .append('defs')
      .append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#555');

    // create tooltip group with modern styling
    const tooltip = svg
      .append('g')
      .attr('class', 'tooltip')
      .attr('transform', 'translate(0,0)');

    // add gradient for tooltip
    const tooltipGradient = svg.append('defs').append('linearGradient');

    tooltipGradient
      .attr('id', 'tooltip-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    tooltipGradient
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#1a202c')
      .attr('stop-opacity', 0.98);

    tooltipGradient
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#171923')
      .attr('stop-opacity', 0.98);

    tooltip
      .append('rect')
      .attr('width', tooltipWidth)
      .attr('height', fixedHeight)
      .attr('fill', 'url(#tooltip-gradient)')
      .attr('rx', 12)
      .attr('ry', 12);

    // tooltip content containers with text wrapping
    const tooltipContent = tooltip
      .append('g')
      .attr('transform', `translate(20, 40)`);

    // add title text element with proper styling
    tooltipContent
      .append('text')
      .attr('class', 'tt-title')
      .attr('x', 0)
      .attr('y', 0)
      .attr('font-size', '28px')
      .attr('fill', '#ffffff')
      .attr('font-weight', '500');

    tooltipContent
      .append('text')
      .attr('class', 'tt-id')
      .attr('x', 0)
      .attr('y', 0)
      .attr('font-size', '24px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');

    tooltipContent
      .append('text')
      .attr('class', 'tt-name')
      .attr('x', 0)
      .attr('y', 35) // increased spacing for larger text
      .attr('font-size', '24px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');

    tooltipContent
      .append('text')
      .attr('class', 'tt-type')
      .attr('x', 0)
      .attr('y', 70) // increased spacing
      .attr('font-size', '24px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');

    tooltipContent
      .append('text')
      .attr('class', 'tt-detail1')
      .attr('x', 0)
      .attr('y', 105) // increased spacing
      .attr('font-size', '24px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');

    tooltipContent
      .append('text')
      .attr('class', 'tt-detail2')
      .attr('x', 0)
      .attr('y', 140) // increased spacing
      .attr('font-size', '24px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');

    // adjust the main visualization area
    linkGroup.attr('transform', `translate(${tooltipWidth}, 0)`);
    nodeGroup.attr('transform', `translate(${tooltipWidth}, 0)`);

    // helper function to convert node maps to d3 nodes
    const mapNodesToD3 = (): D3Node[] => {
      const nodes: D3Node[] = [];
      for (let i = 0; i < yNodes.length; i++) {
        const node = yNodes.get(i);
        const id = node.get('id') as string;
        const type = node.get('type') as string;
        const name = node.get('name') as string;
        const x = (node.get('x') as number) || fixedWidth / 2;
        const y = (node.get('y') as number) || fixedHeight / 2;
        const uuid = node.get('uuid') as string;

        const d3Node: D3Node = {
          id,
          type,
          name,
          x,
          y,
          uuid,
        };

        if (type === 'senator') {
          d3Node.party = node.get('party') as string;
          d3Node.state = node.get('state') as string;
        } else if (type === 'bill') {
          d3Node.status = node.get('status') as string;
        }

        nodes.push(d3Node);
      }
      return nodes;
    };

    // helper function to convert link maps to d3 links
    const mapLinksToD3 = (nodeMap: Map<string, D3Node>): D3Link[] => {
      const links: D3Link[] = [];
      for (let i = 0; i < yLinks.length; i++) {
        const link = yLinks.get(i);
        const sourceId = link.get('source') as string;
        const targetId = link.get('target') as string;
        const type = link.get('type') as string;

        const source = nodeMap.get(sourceId) || sourceId;
        const target = nodeMap.get(targetId) || targetId;

        links.push({ source, target, type });
      }
      return links;
    };

    // function to update the tooltip content
    const updateSelectedNodesInfo = (nodes: D3Node[] | D3Node | null) => {
      // Convert single node to array or use empty array if null
      const nodesArray = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];

      // Clear all text elements first
      tooltip.select('.tt-title').text('');
      tooltip.select('.tt-id').text('');
      tooltip.select('.tt-name').text('');
      tooltip.select('.tt-type').text('');
      tooltip.select('.tt-detail1').text('');
      tooltip.select('.tt-detail2').text('');

      // Always remove all list items no matter what state we're in
      tooltipContent.selectAll('.node-list-item').remove();

      if (nodesArray.length === 0) {
        // show default tooltip message when no nodes are selected
        tooltip.select('.tt-title').text('118th US Congress');
        tooltip.select('.tt-name').text('1st Session, Senate');
        tooltip.select('.tt-type').text('hover over nodes for details');
      } else {
        // multiple nodes - show count as title
        tooltip
          .select('.tt-title')
          .text(
            `${nodesArray.length} ${
              nodesArray.length === 1 ? 'node' : 'nodes'
            } selected`
          );

        // Show up to 5 node names as a bullet list
        const maxToShow = 5;
        const namesToShow = nodesArray.slice(0, maxToShow);
        const additionalCount = nodesArray.length - maxToShow;

        // Define text wrapping width
        const maxWidth = tooltipWidth - 40; // Padding on both sides

        // Function to wrap text with proper line breaks
        const wrapText = (text: string, width: number): string[] => {
          const words = text.split(/\s+/);
          const lines: string[] = [];
          let line = '';

          for (const word of words) {
            const testLine = line + (line ? ' ' : '') + word;
            // Simple estimation of width since we can't measure SVG text easily
            if (testLine.length * 10 > width) {
              // Rough approximation
              lines.push(line);
              line = word;
            } else {
              line = testLine;
            }
          }

          if (line) {
            lines.push(line);
          }

          return lines;
        };

        // Track vertical position for next item
        let currentY = 35;
        const lineHeight = 30;

        // Add each name as a separate text element with proper spacing
        namesToShow.forEach((node) => {
          const nameWithBullet = `• ${node.name}`;
          const wrappedLines = wrapText(nameWithBullet, maxWidth);

          // Create a group for this list item
          const itemGroup = tooltipContent
            .append('g')
            .attr('class', 'node-list-item');

          // Add each line of wrapped text
          wrappedLines.forEach((line, lineIndex) => {
            itemGroup
              .append('text')
              .attr('x', 0)
              .attr('y', currentY + lineIndex * lineHeight)
              .attr('font-size', '25px')
              .attr('fill', '#cbd5e0')
              .attr('font-weight', '300')
              .text(line);
          });

          // Update vertical position for next item
          currentY += wrappedLines.length * lineHeight + 10; // Add spacing between items
        });

        // Show "and X more..." at the bottom of the list if needed
        if (additionalCount > 0) {
          tooltipContent
            .append('text')
            .attr('class', 'node-list-item')
            .attr('x', 0)
            .attr('y', currentY)
            .attr('font-size', '22px')
            .attr('fill', '#cbd5e0')
            .attr('font-weight', '300')
            .attr('font-style', 'italic')
            .text(`and ${additionalCount} more...`);
        }
      }
    };

    // function to update the visualization
    const updateVisualization = () => {
      // get current data
      const nodes = mapNodesToD3();

      // create a node map for resolving links
      const nodeMap = new Map<string, D3Node>();
      nodes.forEach((n) => nodeMap.set(n.id, n));

      // resolve links
      const links = mapLinksToD3(nodeMap);

      // create a key function for links
      const linkKeyFn = (d: D3Link): string => {
        const source = d.source as D3Node;
        const target = d.target as D3Node;
        return `${source.id}-${target.id}-${d.type}`;
      };

      // update links
      const link = linkGroup
        .selectAll<SVGLineElement, D3Link>('line')
        .data(links, linkKeyFn);

      // handle removed links
      link.exit().remove();

      // handle new links
      const linkEnter = link
        .enter()
        .append('line')
        .attr('stroke', (d) => (d.type === 'sponsor' ? '#555' : '#bbb'))
        .attr('stroke-width', (d) => (d.type === 'sponsor' ? 3 : 1.5))
        .attr('stroke-dasharray', (d) =>
          d.type === 'cosponsor' ? '5,5' : 'none'
        )
        .attr('marker-end', (d) =>
          d.type === 'sponsor' ? 'url(#arrowhead)' : ''
        );

      // merge links
      const linkMerge = linkEnter.merge(link);

      // update link positions
      linkMerge
        .attr('x1', (d: D3Link) => {
          const source = d.source as D3Node;
          return source.x || 0;
        })
        .attr('y1', (d: D3Link) => {
          const source = d.source as D3Node;
          return source.y || 0;
        })
        .attr('x2', (d: D3Link) => {
          const target = d.target as D3Node;
          return target.x || 0;
        })
        .attr('y2', (d: D3Link) => {
          const target = d.target as D3Node;
          return target.y || 0;
        });

      // update nodes
      const node = nodeGroup
        .selectAll<SVGGElement, D3Node>('g.node')
        .data(nodes, (d: D3Node) => d.uuid);

      // handle removed nodes
      node.exit().remove();

      // handle new nodes
      const nodeEnter = node
        .enter()
        .append('g')
        .attr('class', 'node')
        .attr('data-id', (d) => d.id)
        .attr('data-uuid', (d) => d.uuid);

      // create senator nodes with larger radius
      nodeEnter
        .filter((d) => d.type === 'senator')
        .append('circle')
        .attr('r', 15)
        .attr('fill', (d) =>
          d.party === 'd' ? '#3498db' : d.party === 'r' ? '#e74c3c' : '#95a5a6'
        )
        .attr('stroke', '#333')
        .attr('stroke-width', 2)
        .attr('class', 'node-shape');

      // create bill nodes with larger size
      nodeEnter
        .filter((d) => d.type === 'bill')
        .append('rect')
        .attr('x', -12)
        .attr('y', -12)
        .attr('width', 24)
        .attr('height', 24)
        .attr('fill', '#95a5a6')
        .attr('stroke', '#333')
        .attr('stroke-width', 2)
        .attr('class', 'node-shape');

      // add text labels with larger font
      nodeEnter
        .append('text')
        .attr('dx', 20)
        .attr('dy', '.35em')
        .attr('font-size', '12px')
        .attr('text-anchor', 'start')
        .text((d) => d.name)
        .attr('opacity', 0) // initially hidden
        .attr('pointer-events', 'none');

      // merge nodes
      const nodeMerge = nodeEnter.merge(node);

      // update node positions
      nodeMerge.attr(
        'transform',
        (d: D3Node) => `translate(${d.x || 0},${d.y || 0})`
      );

      // get hover state from yjs
      const hoveredIds = (ySharedState.get('hoveredNodeIds') as string[]) || [];

      // collect all click selections from the shared map
      const allClickSelectedIds: string[] = [];
      yClientClickSelections.forEach((nodeIds: string[]) => {
        allClickSelectedIds.push(...nodeIds);
      });

      // combine hover and click selections
      const allHighlightedIds = [
        ...new Set([...hoveredIds, ...allClickSelectedIds]),
      ];

      // reset all visual states
      nodeMerge
        .select('.node-shape')
        .attr('stroke', '#333')
        .attr('stroke-width', 2);

      // apply highlight colors
      if (allHighlightedIds.length > 0) {
        // Highlight hovered nodes with orange color
        if (hoveredIds.length > 0) {
          nodeMerge
            .filter((d: D3Node) => hoveredIds.includes(d.id))
            .select('.node-shape')
            .attr('stroke', '#f39c12')
            .attr('stroke-width', 3);
        }

        // Apply different color to clicked/selected nodes
        if (allClickSelectedIds.length > 0) {
          nodeMerge
            .filter((d: D3Node) => allClickSelectedIds.includes(d.id))
            .select('.node-shape')
            .attr('stroke', '#87ceeb') // sky blue
            .attr('stroke-width', 3);
        }

        // update tooltip content with all highlighted nodes
        const highlightedNodes = nodes.filter((n) =>
          allHighlightedIds.includes(n.id)
        );
        updateSelectedNodesInfo(highlightedNodes);
      } else {
        // show default tooltip message when no node is highlighted
        updateSelectedNodesInfo([]);
      }

      // check if initialization is needed
      const needsInitialLayout = nodes.some(
        (node) => node.x === fixedWidth / 2 && node.y === fixedHeight / 2
      );

      if (needsInitialLayout) {
        initializeLayout(nodes);
      }
    };

    // function to initialize layout
    const initializeLayout = (nodes: D3Node[]) => {
      console.log('initializing layout');

      const demNodes = nodes.filter(
        (n) => n.type === 'senator' && n.party === 'd'
      );
      const repNodes = nodes.filter(
        (n) => n.type === 'senator' && n.party === 'r'
      );
      const billNodes = nodes.filter((n) => n.type === 'bill');

      // define columns - adjusted for tooltip width and better centering
      const availableWidth = fixedWidth - tooltipWidth;
      const graphCenter = tooltipWidth + availableWidth * 0.18; // moved center point left
      const spread = availableWidth * 0.45; // significantly increased spread

      const leftColumnX = graphCenter - spread;
      const rightColumnX = graphCenter + spread;
      const centerColumnX = graphCenter;

      // adjust bill grid width to match new spread
      const billGridWidth = availableWidth * 0.4; // increased bill grid width
      const billGridHeight = fixedHeight * 0.85; // increased height for more vertical spread

      // set vertical spacing for each party with better vertical centering
      const verticalPadding = fixedHeight * 0.1; // reduced padding to use more vertical space
      const demSpacing =
        (fixedHeight - 2 * verticalPadding) / (demNodes.length + 1);
      const repSpacing =
        (fixedHeight - 2 * verticalPadding) / (repNodes.length + 1);

      // set vertical spacing for bills
      const billRows = Math.ceil(Math.sqrt(billNodes.length));
      const billCols = Math.ceil(billNodes.length / billRows);

      const billColSpacing = billGridWidth / (billCols || 1);
      const billRowSpacing = billGridHeight / (billRows || 1);

      // center grid
      const billGridLeft = centerColumnX - billGridWidth / 2;
      const billGridTop = fixedHeight * 0.15;

      // position democratic senators in left column
      demNodes.forEach((node, i) => {
        const verticalPos = verticalPadding + (i + 1) * demSpacing;
        node.x = leftColumnX;
        node.y = verticalPos;
      });

      // position republican senators in right column
      repNodes.forEach((node, i) => {
        const verticalPos = verticalPadding + (i + 1) * repSpacing;
        node.x = rightColumnX;
        node.y = verticalPos;
      });

      // position bills in a grid in the center
      billNodes.forEach((node, i) => {
        const row = Math.floor(i / billCols);
        const col = i % billCols;

        node.x = billGridLeft + (col + 0.5) * billColSpacing;
        node.y = billGridTop + (row + 0.5) * billRowSpacing;
      });

      // sync with yjs
      doc!.transact(() => {
        nodes.forEach((node) => {
          for (let i = 0; i < yNodes.length; i++) {
            const nodeMap = yNodes.get(i);
            if (nodeMap.get('id') === node.id) {
              nodeMap.set('x', node.x);
              nodeMap.set('y', node.y);
              break;
            }
          }
        });
      });

      // then refine with force simulation
      const nodeMap = new Map<string, D3Node>();
      nodes.forEach((n) => nodeMap.set(n.id, n));

      const links = mapLinksToD3(nodeMap);

      const simulation = d3
        .forceSimulation<D3Node>(nodes)
        .force(
          'link',
          d3
            .forceLink<D3Node, D3Link>(links)
            .id((d) => d.id)
            .distance(150) // increased link distance
        )
        .force('charge', d3.forceManyBody().strength(-300)) // increased repulsion
        .force(
          'x',
          d3
            .forceX<D3Node>()
            .x((d) => {
              // keep nodes in their assigned columns
              return d.x || 0;
            })
            .strength(0.5)
        )
        .force(
          'y',
          d3
            .forceY<D3Node>()
            .y((d) => {
              // keep nodes near their assigned rows
              return d.y || 0;
            })
            .strength(0.3)
        )
        .force(
          'collision',
          d3
            .forceCollide<D3Node>()
            .radius((d) => (d.type === 'senator' ? 35 : 30)) // increased collision radius
        )
        .stop();

      // run for a fixed number of ticks
      console.log('running simulation for 100 ticks');
      simulation.tick(100);

      // update yjs after simulation
      doc!.transact(() => {
        nodes.forEach((node) => {
          for (let i = 0; i < yNodes.length; i++) {
            const nodeMap = yNodes.get(i);
            if (nodeMap.get('id') === node.id) {
              nodeMap.set('x', node.x);
              nodeMap.set('y', node.y);
              break;
            }
          }
        });
      });

      // update visualization
      updateVisualization();
    };

    // initial update to show visualization
    updateVisualization();

    // initialize tooltip with default message
    updateSelectedNodesInfo([]);

    // set up observeDeep to update visualization when yjs data changes
    const observer = () => {
      updateVisualization();
    };

    // observe all relevant yjs data
    yNodes.observeDeep(observer);
    yLinks.observeDeep(observer);
    ySharedState.observe(observer);
    yClientClickSelections.observe(observer);

    // initialize transform values in yjs if not already set
    if (ySharedState.get('zoomScale') === undefined) {
      doc!.transact(() => {
        ySharedState.set('zoomScale', 1);
        ySharedState.set('panX', 0);
        ySharedState.set('panY', 0);
      });
    }

    // cleanup observers when component unmounts
    return () => {
      yNodes.unobserveDeep(observer);
      yLinks.unobserveDeep(observer);
      ySharedState.unobserve(observer);
      yClientClickSelections.unobserve(observer);

      // Remove custom interaction event listener
      if (parent) {
        parent.removeEventListener('interaction', ((
          e: CustomEvent<InteractionEvent>
        ) => handleInteraction(e.detail)) as EventListener);
      }
    };
  }, [
    syncStatus,
    doc,
    yNodes,
    yLinks,
    ySharedState,
    userId,
    yClientClickSelections,
  ]);

  // if placeholder rendering is needed due to no sync, make that transparent too
  if (!syncStatus) {
    return (
      <div
        style={{
          width: fixedWidth,
          height: fixedHeight,
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'transparent',
          overflow: 'hidden',
          borderRadius: '8px',
          boxShadow: 'inset 0 0 10px rgba(0,0,0,0.05)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '2rem',
            maxWidth: '600px',
            background: 'rgba(255,255,255,0.8)',
            borderRadius: '12px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          }}
        >
          <div
            style={{
              fontSize: '2rem',
              marginBottom: '0.5rem',
              fontWeight: 500,
              color: '#333',
            }}
          >
            senate visualization
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              marginBottom: '1.5rem',
              color: '#555',
            }}
          >
            waiting for synchronization...
          </div>
          <div
            style={{
              marginTop: '1rem',
              width: '100%',
              height: '6px',
              background: '#eee',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: '40%',
                height: '100%',
                background: `linear-gradient(to right, #2980b9, #2980b9)`,
                animation: 'progressAnimation 2s infinite',
                borderRadius: '8px',
              }}
            >
              <style>
                {`
                  @keyframes progressAnimation {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(250%); }
                  }
                `}
              </style>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // just return the container for d3
  return (
    <div
      style={{
        width: fixedWidth,
        height: fixedHeight,
        position: 'relative',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div ref={d3Container} style={{ width: '100%', height: '100%' }} />
    </div>
  );
};

export default Senate;
