import React, { useContext, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsContext } from '@/context/YjsContext';
import * as d3 from 'd3';
// import senateData from '@/assets/foafagain.json'; // removed senate data
import { InteractionEvent, InteractionPoint } from '@/types/interactionTypes';

// define shared value types for y.map
type NodeMapValue = string | number | boolean | undefined;
type LinkMapValue = string; // kept for potential future use

// d3 specific types - extend SimulationNodeDatum with our required properties
interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  type: string; // 'blue' or 'red'
  name: string; // e.g., "node 1"
  uuid: string;
  color: string; // e.g. '#3498db' or '#e74c3c'
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  type: string; // kept for potential future use
}

// helper function to compact/prune the yjs document
function pruneYDoc(doc: Y.Doc) {
  console.log('[Yjs] Running document compaction...');
  const beforeSize = Y.encodeStateAsUpdate(doc).byteLength;

  try {
    // create a new temporary document
    const tempDoc = new Y.Doc();

    // get current data from original doc
    const originalNodes = doc.getArray<Y.Map<NodeMapValue>>('courtNodes');
    const originalLinks = doc.getArray<Y.Map<LinkMapValue>>('courtLinks'); // kept for potential future use
    const originalSharedState = doc.getMap<string | boolean | null>(
      'courtSharedState'
    );

    // get references to collections in temp doc
    const tempNodes = tempDoc.getArray<Y.Map<NodeMapValue>>('courtNodes');
    const tempLinks = tempDoc.getArray<Y.Map<LinkMapValue>>('courtLinks');
    const tempSharedState = tempDoc.getMap<string | boolean | null>(
      'courtSharedState'
    );

    // copy nodes data
    tempDoc.transact(() => {
      // copy nodes
      for (let i = 0; i < originalNodes.length; i++) {
        const originalNode = originalNodes.get(i);
        const newNode = new Y.Map<NodeMapValue>();
        originalNode.forEach((value: NodeMapValue, key: string) => {
          newNode.set(key, value);
        });
        tempNodes.push([newNode]);
      }

      // copy links
      for (let i = 0; i < originalLinks.length; i++) {
        const originalLink = originalLinks.get(i);
        const newLink = new Y.Map<LinkMapValue>();
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

const Court: React.FC = () => {
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;
  const d3Container = useRef<HTMLDivElement | null>(null);

  const yNodes = doc!.getArray<Y.Map<NodeMapValue>>('courtNodes');
  const yLinks = doc!.getArray<Y.Map<LinkMapValue>>('courtLinks'); // kept for future use
  const ySharedState = doc!.getMap<string | boolean | null | string[] | number>(
    'courtSharedState'
  );
  const yClientClickSelections = doc!.getMap<string[]>('clientClickSelections');
  const isInitializedRef = useRef(false);
  const [currentTransform, setCurrentTransform] = useState<d3.ZoomTransform>(
    d3.zoomIdentity
  );
  const transformRef = useRef<{ k: number; x: number; y: number }>({
    k: 1,
    x: 0,
    y: 0,
  });

  const dragStateRef = useRef<{
    left: {
      nodeMap: Y.Map<NodeMapValue> | null;
      offset: { x: number; y: number } | null;
    };
    right: {
      nodeMap: Y.Map<NodeMapValue> | null;
      offset: { x: number; y: number } | null;
    };
  }>({
    left: { nodeMap: null, offset: null },
    right: { nodeMap: null, offset: null },
  });

  const [syncStatus, setSyncStatus] = useState<boolean>(false);
  const [userId] = useState<string>(() => crypto.randomUUID());

  const fixedWidth = 1280; // changed to match senate.tsx
  const fixedHeight = 720; // changed to match senate.tsx
  const tooltipWidth = fixedWidth * 0.25; // adjusted tooltip width based on new fixedwidth

  useEffect(() => {
    if (!doc) return;
    const timeout = setTimeout(() => {
      console.log('assuming sync after timeout for court visualization');
      setSyncStatus(true);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [doc]);

  useEffect(() => {
    if (!doc || !syncStatus) return;
    const yjsMonitor = setInterval(() => {
      const byteLength = Y.encodeStateAsUpdate(doc).byteLength;
      console.log(`[Yjs] Document size: ${byteLength} bytes`);
    }, 60000);
    const domMonitor = setInterval(() => {
      const nodeCount = document.querySelectorAll('g.node').length;
      const tooltipCount = document.querySelectorAll('g.tooltip').length;
      console.log(`[DOM] ${nodeCount} nodes, ${tooltipCount} tooltips in DOM`);
    }, 10000);
    const compactionInterval = setInterval(() => {
      pruneYDoc(doc);
    }, 300000);
    return () => {
      clearInterval(yjsMonitor);
      clearInterval(domMonitor);
      clearInterval(compactionInterval);
    };
  }, [doc, syncStatus]);

  // initialize graph data for court visualization
  useEffect(() => {
    if (!syncStatus || yNodes.length > 0) {
      return;
    }
    console.log('initializing court graph data');

    const initialNodes: Y.Map<NodeMapValue>[] = [];
    const defaultX = fixedWidth / 2;
    const defaultY = fixedHeight / 2;

    // create 5 blue nodes and 5 red nodes
    for (let i = 1; i <= 10; i++) {
      const yNode = new Y.Map<NodeMapValue>();
      const nodeType = i <= 5 ? 'blue' : 'red';
      const nodeColor = i <= 5 ? '#3498db' : '#e74c3c';

      yNode.set('id', `node-${i}`);
      yNode.set('name', `node ${i}`);
      yNode.set('type', nodeType);
      yNode.set('color', nodeColor);
      yNode.set('x', defaultX);
      yNode.set('y', defaultY);
      yNode.set('uuid', crypto.randomUUID());
      initialNodes.push(yNode);
    }

    // no initial links for court visualization
    const initialLinks: Y.Map<LinkMapValue>[] = [];

    doc!.transact(() => {
      yNodes.push(initialNodes);
      yLinks.push(initialLinks); // initialize empty links array
    });
  }, [syncStatus, doc, yNodes, yLinks]);

  // effect to sync transform state from yjs
  useEffect(() => {
    if (!doc || !syncStatus) return;
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
    const observer = () => {
      const scale = (ySharedState.get('zoomScale') as number) || 1;
      const x = (ySharedState.get('panX') as number) || 0;
      const y = (ySharedState.get('panY') as number) || 0;
      if (
        scale !== transformRef.current.k ||
        x !== transformRef.current.x ||
        y !== transformRef.current.y
      ) {
        transformRef.current = { k: scale, x, y };
        setCurrentTransform(d3.zoomIdentity.translate(x, y).scale(scale));
        const root = d3.select('#court-root');
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
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    console.log('initializing d3 court visualization');
    d3.select(d3Container.current).selectAll('*').remove();

    const svg = d3
      .select(d3Container.current)
      .append('svg')
      .attr('width', fixedWidth)
      .attr('height', fixedHeight)
      .attr('viewBox', [0, 0, fixedWidth, fixedHeight])
      .attr('style', 'background: transparent; max-width: 100%; height: auto;');

    const root = svg
      .append('g')
      .attr('class', 'root')
      .attr('id', 'court-root')
      .attr(
        'transform',
        `translate(${currentTransform.x}, ${currentTransform.y}) scale(${currentTransform.k})`
      );

    // add court.svg content as backdrop within the root group and scale it
    const courtBgGroup = root
      .append('g')
      .attr('class', 'court-background-group');

    const bgDisplayAreaX = tooltipWidth;
    const bgDisplayAreaY = 0;
    const bgDisplayWidth = fixedWidth - tooltipWidth;
    const bgDisplayHeight = fixedHeight;
    const bgScaleFactor = 1.2; // make svg content 20% larger

    courtBgGroup
      .append('image')
      .attr('xlink:href', '/court.svg')
      .attr('x', 0) // image starts at group's 0,0
      .attr('y', 100)
      .attr('width', bgDisplayWidth) // image intrinsic size matches display area before group transform
      .attr('height', bgDisplayHeight)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    // transform the group to scale the image around the center of its display area
    courtBgGroup.attr(
      'transform',
      `translate(${bgDisplayAreaX + bgDisplayWidth / 2}, ${bgDisplayAreaY + bgDisplayHeight / 2}) ` +
        `scale(${bgScaleFactor}) ` +
        `translate(${-bgDisplayWidth / 2}, ${-bgDisplayHeight / 2})`
    );
    courtBgGroup.lower(); // send to back

    const linkGroup = root.append('g').attr('class', 'links');
    const nodeGroup = root.append('g').attr('class', 'nodes');

    const handleNodeDrag = (
      point: InteractionPoint,
      handedness: 'left' | 'right',
      svgRect: DOMRect
    ) => {
      const dragState = dragStateRef.current[handedness];
      if (!dragState.nodeMap || !dragState.offset) return;
      const simulationX =
        (point.clientX - svgRect.left - transformRef.current.x) /
        transformRef.current.k;
      const simulationY =
        (point.clientY - svgRect.top - transformRef.current.y) /
        transformRef.current.k;
      const newX = simulationX + dragState.offset.x;
      const newY = simulationY + dragState.offset.y;
      doc!.transact(() => {
        dragState.nodeMap?.set('x', newX);
        dragState.nodeMap?.set('y', newY);
      });
      updateVisualization();
    };

    const handleInteraction = (event: InteractionEvent) => {
      const svgRect =
        d3Container.current?.getBoundingClientRect() || new DOMRect();
      switch (event.type) {
        case 'pointerdown': {
          const { element, point, handedness } = event;
          if (!handedness) return;
          const parentNode = element?.closest('g.node');
          if (!parentNode) return;
          const nodeId = parentNode.getAttribute('data-id');
          if (!nodeId) return;
          let nodeMap: Y.Map<NodeMapValue> | null = null;
          for (let i = 0; i < yNodes.length; i++) {
            const node = yNodes.get(i);
            if (node.get('id') === nodeId) {
              nodeMap = node;
              break;
            }
          }
          if (!nodeMap) return;
          const nodeX = (nodeMap.get('x') as number) || 0;
          const nodeY = (nodeMap.get('y') as number) || 0;
          const simulationX =
            (point.clientX - svgRect.left - transformRef.current.x) /
            transformRef.current.k;
          const simulationY =
            (point.clientY - svgRect.top - transformRef.current.y) /
            transformRef.current.k;
          dragStateRef.current[handedness] = {
            nodeMap,
            offset: {
              x: nodeX - simulationX,
              y: nodeY - simulationY,
            },
          };
          break;
        }
        case 'pointermove': {
          const { point, handedness } = event;
          if (!handedness) return;
          handleNodeDrag(point, handedness, svgRect);
          break;
        }
        case 'pointerup': {
          const { handedness } = event;
          if (!handedness) return;
          dragStateRef.current[handedness] = {
            nodeMap: null,
            offset: null,
          };
          break;
        }
        case 'pointerover': {
          console.log('pointerover');
          const element = event.element;
          if (!element || !(element instanceof SVGElement)) return;
          if (element.classList.contains('node-shape')) {
            const parentNode = element.closest('g.node');
            const nodeId = parentNode?.getAttribute('data-id');
            if (nodeId) {
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
          const element = event.element;
          if (!element || !(element instanceof SVGElement)) return;
          if (element.classList.contains('node-shape')) {
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
          const element = event.element;
          if (!element || !(element instanceof SVGElement)) return;
          if (element.classList.contains('node-shape')) {
            const parentNode = element.closest('g.node');
            const nodeId = parentNode?.getAttribute('data-id');
            if (nodeId) {
              const currentSelections =
                yClientClickSelections.get(userId) || [];
              if (currentSelections.includes(nodeId)) {
                yClientClickSelections.set(
                  userId,
                  currentSelections.filter((id) => id !== nodeId)
                );
              } else {
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
          if (event.transform) {
            const transform = event.transform as {
              x: number;
              y: number;
              scale?: number;
            };
            const { x, y } = transform;
            const scale = transform.scale || currentTransform.k;
            doc!.transact(() => {
              ySharedState.set('panX', x);
              ySharedState.set('panY', y);
              ySharedState.set('zoomScale', scale);
            });
            const newTransform = d3.zoomIdentity.translate(x, y).scale(scale);
            setCurrentTransform(newTransform);
            root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
          }
          break;
        }
        case 'zoom': {
          if (event.transform) {
            const { x, y, scale } = event.transform;
            doc!.transact(() => {
              ySharedState.set('panX', x);
              ySharedState.set('panY', y);
              ySharedState.set('zoomScale', scale);
            });
            const newTransform = d3.zoomIdentity.translate(x, y).scale(scale);
            setCurrentTransform(newTransform);
            root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
          }
          break;
        }
      }
    };

    const parent = d3Container.current?.parentElement;
    if (parent) {
      parent.addEventListener('interaction', ((
        e: CustomEvent<InteractionEvent>
      ) => handleInteraction(e.detail)) as EventListener);
    }

    // create tooltip group with modern styling
    const tooltip = svg
      .append('g')
      .attr('class', 'tooltip')
      .attr('transform', 'translate(0,0)'); // position tooltip at top-left

    const tooltipGradient = svg.append('defs').append('linearGradient');
    tooltipGradient
      .attr('id', 'tooltip-gradient-court') // unique id for court
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
      .attr('height', fixedHeight) // tooltip spans full height
      .attr('fill', 'url(#tooltip-gradient-court)')
      .attr('rx', 12)
      .attr('ry', 12);

    const tooltipContent = tooltip
      .append('g')
      .attr('transform', `translate(20, 40)`);

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
      .attr('class', 'tt-name')
      .attr('x', 0)
      .attr('y', 35)
      .attr('font-size', '24px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');
    tooltipContent
      .append('text')
      .attr('class', 'tt-type')
      .attr('x', 0)
      .attr('y', 70)
      .attr('font-size', '24px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');

    // adjust the main visualization area if tooltip is on the side
    linkGroup.attr('transform', `translate(${tooltipWidth}, 0)`);
    nodeGroup.attr('transform', `translate(${tooltipWidth}, 0)`);

    const mapNodesToD3 = (): D3Node[] => {
      const nodes: D3Node[] = [];
      for (let i = 0; i < yNodes.length; i++) {
        const node = yNodes.get(i);
        const id = node.get('id') as string;
        const type = node.get('type') as string; // 'blue' or 'red'
        const name = node.get('name') as string;
        const color = node.get('color') as string;
        const x = (node.get('x') as number) || fixedWidth / 2;
        const y = (node.get('y') as number) || fixedHeight / 2;
        const uuid = node.get('uuid') as string;
        nodes.push({ id, type, name, x, y, uuid, color });
      }
      return nodes;
    };

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

    const updateSelectedNodesInfo = (nodes: D3Node[] | D3Node | null) => {
      const nodesArray = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
      tooltip.select('.tt-title').text('');
      tooltip.select('.tt-name').text('');
      tooltip.select('.tt-type').text('');
      tooltipContent.selectAll('.node-list-item').remove();

      if (nodesArray.length === 0) {
        tooltip.select('.tt-title').text('court visualization');
        tooltip.select('.tt-name').text('hover over nodes for details');
      } else {
        tooltip
          .select('.tt-title')
          .text(
            `${nodesArray.length} ${
              nodesArray.length === 1 ? 'node' : 'nodes'
            } selected`
          );
        const maxToShow = 5;
        const namesToShow = nodesArray.slice(0, maxToShow);
        const additionalCount = nodesArray.length - maxToShow;
        const maxWidth = tooltipWidth - 40;
        const wrapText = (text: string, width: number): string[] => {
          const words = text.split(/\s+/);
          const lines: string[] = [];
          let line = '';
          for (const word of words) {
            const testLine = line + (line ? ' ' : '') + word;
            if (testLine.length * 10 > width) {
              // simplified width check
              lines.push(line);
              line = word;
            } else {
              line = testLine;
            }
          }
          if (line) lines.push(line);
          return lines;
        };
        let currentY = 35;
        const lineHeight = 30;
        namesToShow.forEach((node) => {
          const nameWithBullet = `• ${node.name} (${node.type})`;
          const wrappedLines = wrapText(nameWithBullet, maxWidth);
          const itemGroup = tooltipContent
            .append('g')
            .attr('class', 'node-list-item');
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
          currentY += wrappedLines.length * lineHeight + 10;
        });
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

    const updateVisualization = () => {
      const nodes = mapNodesToD3();
      const nodeMap = new Map<string, D3Node>();
      nodes.forEach((n) => nodeMap.set(n.id, n));
      const links = mapLinksToD3(nodeMap); // currently empty

      const linkKeyFn = (d: D3Link): string => {
        const source = d.source as D3Node;
        const target = d.target as D3Node;
        return `${source.id}-${target.id}-${d.type}`;
      };

      const link = linkGroup
        .selectAll<SVGLineElement, D3Link>('line')
        .data(links, linkKeyFn);
      link.exit().remove();
      const linkEnter = link.enter().append('line'); // basic link styling if any
      const linkMerge = linkEnter.merge(link);
      linkMerge
        .attr('x1', (d: D3Link) => (d.source as D3Node).x || 0)
        .attr('y1', (d: D3Link) => (d.source as D3Node).y || 0)
        .attr('x2', (d: D3Link) => (d.target as D3Node).x || 0)
        .attr('y2', (d: D3Link) => (d.target as D3Node).y || 0);

      const node = nodeGroup
        .selectAll<SVGGElement, D3Node>('g.node')
        .data(nodes, (d: D3Node) => d.uuid);
      node.exit().remove();
      const nodeEnter = node
        .enter()
        .append('g')
        .attr('class', 'node')
        .attr('data-id', (d) => d.id)
        .attr('data-uuid', (d) => d.uuid);

      // simple circle nodes for court
      nodeEnter
        .append('circle')
        .attr('r', 20) // increased node size
        .attr('fill', (d) => d.color)
        .attr('stroke', '#333')
        .attr('stroke-width', 2)
        .attr('class', 'node-shape')
        .attr('opacity', 0.8); // make nodes slightly transparent

      nodeEnter // node labels
        .append('text')
        .attr('dx', 18)
        .attr('dy', '.35em')
        .attr('font-size', '10px')
        .attr('text-anchor', 'start')
        .text((d) => d.name)
        .attr('opacity', 0)
        .attr('pointer-events', 'none');

      const nodeMerge = nodeEnter.merge(node);
      nodeMerge.attr(
        'transform',
        (d: D3Node) => `translate(${d.x || 0},${d.y || 0})`
      );

      const hoveredIds = (ySharedState.get('hoveredNodeIds') as string[]) || [];
      const allClickSelectedIds: string[] = [];
      yClientClickSelections.forEach((nodeIds: string[]) => {
        allClickSelectedIds.push(...nodeIds);
      });
      const allHighlightedIds = [
        ...new Set([...hoveredIds, ...allClickSelectedIds]),
      ];

      nodeMerge
        .select('.node-shape')
        .attr('stroke', '#333')
        .attr('stroke-width', 2);

      if (allHighlightedIds.length > 0) {
        if (hoveredIds.length > 0) {
          nodeMerge
            .filter((d: D3Node) => hoveredIds.includes(d.id))
            .select('.node-shape')
            .attr('stroke', '#f39c12') // orange for hover
            .attr('stroke-width', 3);
        }
        if (allClickSelectedIds.length > 0) {
          nodeMerge
            .filter((d: D3Node) => allClickSelectedIds.includes(d.id))
            .select('.node-shape')
            .attr('stroke', '#87ceeb') // sky blue for select
            .attr('stroke-width', 3);
        }
        const highlightedNodes = nodes.filter((n) =>
          allHighlightedIds.includes(n.id)
        );
        updateSelectedNodesInfo(highlightedNodes);
      } else {
        updateSelectedNodesInfo([]);
      }

      const needsInitialLayout = nodes.some(
        (node) => node.x === fixedWidth / 2 && node.y === fixedHeight / 2
      );
      if (needsInitialLayout) {
        initializeLayout(nodes);
      }
    };

    const initializeLayout = (nodes: D3Node[]) => {
      console.log('initializing court layout basketball formation');

      const courtAreaXStart = 0;
      const courtAreaWidth = fixedWidth - tooltipWidth;
      const courtAreaHeight = fixedHeight + 800;

      // estimated center and key points for node placement
      // assuming basket is near y=0 of the court graphic area after scaling and placement
      const centerX = courtAreaXStart + courtAreaWidth / 2;

      // y positions (0 is top of display area, fixedHeight is bottom)
      // basket is implied to be at the "top" of the half-court svg
      const pointGuardY = courtAreaHeight * 0.35;
      const wingY = courtAreaHeight * 0.25;
      const forwardY = courtAreaHeight * 0.15; // closer to basket / baseline

      // x spreads for wings/forwards
      const wingXSpread = courtAreaWidth * 0.3;
      const forwardXSpread = courtAreaWidth * 0.2;

      // defensive offset (closer to basket)
      const defensiveOffsetY = -courtAreaHeight * 0.02; // move "up" towards basket
      const defensiveSpreadFactor = 1.1; // slightly wider stance for defenders

      const blueNodes = nodes.filter((n) => n.type === 'blue');
      const redNodes = nodes.filter((n) => n.type === 'red');

      // offensive (blue) positions
      if (blueNodes.length >= 1) {
        // point guard
        blueNodes[0].x = centerX;
        blueNodes[0].y = pointGuardY;
      }
      if (blueNodes.length >= 2) {
        // right wing
        blueNodes[1].x = centerX + wingXSpread;
        blueNodes[1].y = wingY;
      }
      if (blueNodes.length >= 3) {
        // left wing
        blueNodes[2].x = centerX - wingXSpread;
        blueNodes[2].y = wingY;
      }
      if (blueNodes.length >= 4) {
        // right forward/corner
        blueNodes[3].x = centerX + forwardXSpread;
        blueNodes[3].y = forwardY;
      }
      if (blueNodes.length >= 5) {
        // left forward/corner
        blueNodes[4].x = centerX - forwardXSpread;
        blueNodes[4].y = forwardY;
      }

      // defensive (red) positions guarding blue players
      // node 6 guards 1, 7 guards 2, etc.
      for (let i = 0; i < redNodes.length; i++) {
        if (i < blueNodes.length) {
          // ensure there's a blue node to guard
          const offensivePlayer = blueNodes[i];
          redNodes[i].x = offensivePlayer.x!; // ! since we just set it
          redNodes[i].y = offensivePlayer.y! + defensiveOffsetY;

          // slightly adjust x for defenders on wings/forwards to not be perfectly aligned
          if (offensivePlayer.x! > centerX) {
            // player on right
            redNodes[i].x =
              offensivePlayer.x! * (1 - (defensiveSpreadFactor - 1) / 2);
          } else if (offensivePlayer.x! < centerX) {
            // player on left
            redNodes[i].x = offensivePlayer.x! * defensiveSpreadFactor;
          }
        } else {
          // if more red nodes than blue, place them generally
          redNodes[i].x =
            centerX + (Math.random() - 0.5) * courtAreaWidth * 0.1;
          redNodes[i].y =
            courtAreaHeight * 0.1 +
            (Math.random() - 0.5) * courtAreaHeight * 0.1; // near basket
        }
      }

      // ensure all nodes have some initial position if not covered (fallback)
      nodes.forEach((node) => {
        if (
          node.x === undefined ||
          node.y === undefined ||
          (node.x === fixedWidth / 2 && node.y === fixedHeight / 2)
        ) {
          // if still at default initial or undefined, place in center of court area
          node.x =
            courtAreaXStart + courtAreaWidth / 2 + (Math.random() - 0.5) * 50;
          node.y = courtAreaHeight / 2 + (Math.random() - 0.5) * 50;
        }
      });

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

      // optional: refine with force simulation if needed
      const nodeMap = new Map<string, D3Node>();
      nodes.forEach((n) => nodeMap.set(n.id, n));
      const links = mapLinksToD3(nodeMap); // currently empty

      const simulation = d3
        .forceSimulation<D3Node>(nodes)
        .force(
          'link',
          d3
            .forceLink<D3Node, D3Link>(links)
            .id((d) => d.id)
            .distance(50)
        ) // shorter distance for no links
        .force('charge', d3.forceManyBody().strength(-200)) // less repulsion
        .force(
          'x',
          d3
            .forceX<D3Node>()
            .x((d) => d.x || 0)
            .strength(0.2)
        ) // gentle force to initial x
        .force(
          'y',
          d3
            .forceY<D3Node>()
            .y((d) => d.y || 0)
            .strength(0.2)
        ) // gentle force to initial y
        .force('collision', d3.forceCollide<D3Node>().radius(30)) // increased collision radius for bigger nodes
        .stop();

      simulation.tick(100);

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
      updateVisualization();
    };

    updateVisualization();
    updateSelectedNodesInfo([]);

    const observer = () => updateVisualization();
    yNodes.observeDeep(observer);
    yLinks.observeDeep(observer);
    ySharedState.observe(observer);
    yClientClickSelections.observe(observer);

    if (ySharedState.get('zoomScale') === undefined) {
      doc!.transact(() => {
        ySharedState.set('zoomScale', 1);
        ySharedState.set('panX', 0);
        ySharedState.set('panY', 0);
      });
    }

    return () => {
      yNodes.unobserveDeep(observer);
      yLinks.unobserveDeep(observer);
      ySharedState.unobserve(observer);
      yClientClickSelections.unobserve(observer);
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
            court visualization
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

export default Court;
