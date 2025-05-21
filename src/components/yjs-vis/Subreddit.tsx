import React, { useContext, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsContext } from '@/context/YjsContext';
import * as d3 from 'd3';
import subredditData from '@/assets/subreddit.json'; // data import for subreddits
import { InteractionEvent, InteractionPoint } from '@/types/interactionTypes';

// define shared value types for y.map
type NodeMapValue = string | number | boolean | undefined;
type LinkMapValue = string | number; // crossposts can be a number

// d3 specific types - extend SimulationNodeDatum with our required properties
interface D3BaseNode extends d3.SimulationNodeDatum {
  id: string;
  type: 'subreddit'; // specific node type
  name: string; // for subreddits: id
  uuid: string;
}

interface D3SubredditNode extends D3BaseNode {
  type: 'subreddit';
  group: number; // group from subreddit data
}

type D3Node = D3SubredditNode; // only one node type for now

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  type: 'crosspost'; // specific link type
  crossposts: number;
  shared_topic: string;
}

// constants for link styling
const DEFAULT_LINK_COLOR = '#aaa';
const DEFAULT_LINK_OPACITY = 0.5;
const DEFAULT_LINK_STROKE_WIDTH = 1.5;
const HIGHLIGHTED_LINK_COLOR = '#FFD700'; // gold
const HIGHLIGHTED_LINK_OPACITY = 1;
const HIGHLIGHTED_LINK_STROKE_WIDTH = 3;

// helper function to get node id from a link's source or target
function getNodeIdFromLinkEnd(node: D3Node | string | number): string {
  if (typeof node === 'object' && node !== null && 'id' in node) {
    // it's a D3Node object
    return (node as D3Node).id;
  }
  // it's a string or number (id directly)
  return String(node);
}

// helper function to check if a link is connected to a node
function isLinkConnectedToNode(link: D3Link, nodeId: string): boolean {
  const sourceId = getNodeIdFromLinkEnd(link.source);
  const targetId = getNodeIdFromLinkEnd(link.target);
  return sourceId === nodeId || targetId === nodeId;
}

// helper function to find all links connected to a node
function findConnectedLinks(allLinks: D3Link[], nodeId: string): D3Link[] {
  return allLinks.filter((link) => isLinkConnectedToNode(link, nodeId));
}

// helper function to compact/prune the yjs document
function pruneYDoc(doc: Y.Doc) {
  console.log('[Yjs] Running document compaction for subreddits...');
  const beforeSize = Y.encodeStateAsUpdate(doc).byteLength;

  try {
    // create a new temporary document
    const tempDoc = new Y.Doc();

    // get current data from original doc
    const originalNodes = doc.getArray<Y.Map<NodeMapValue>>(
      'subredditGraphNodes'
    );
    const originalLinks = doc.getArray<Y.Map<LinkMapValue>>(
      'subredditGraphLinks'
    );
    const originalSharedState = doc.getMap<
      string | boolean | null | number | string[]
    >('subredditGraphSharedState'); // allow string[] for hoveredNodeIds

    // get references to collections in temp doc
    const tempNodes = tempDoc.getArray<Y.Map<NodeMapValue>>(
      'subredditGraphNodes'
    );
    const tempLinks = tempDoc.getArray<Y.Map<LinkMapValue>>(
      'subredditGraphLinks'
    );
    const tempSharedState = tempDoc.getMap<
      string | boolean | null | number | string[]
    >('subredditGraphSharedState');

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
        (value: string | boolean | null | number | string[], key: string) => {
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
      originalSharedState.forEach(
        (_: string | boolean | null | number | string[], key: string) =>
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
      `[Yjs] Subreddit Compaction complete: ${beforeSize.toLocaleString()} bytes → ${afterSize.toLocaleString()} bytes (${reduction}% reduction)`
    );

    // cleanup temporary doc
    tempDoc.destroy();
  } catch (err) {
    console.error('[Yjs] Subreddit Compaction failed:', err);
    // fallback to simple snapshot-based compaction
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
        `[Yjs] Simple subreddit compaction complete: ${beforeSize.toLocaleString()} bytes → ${afterSize.toLocaleString()} bytes (${reduction}% reduction)`
      );
    } catch (fallbackErr) {
      console.error(
        '[Yjs] Fallback subreddit compaction also failed:',
        fallbackErr
      );
    }
  }
}

const Subreddit: React.FC = () => {
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;
  const d3Container = useRef<HTMLDivElement | null>(null);

  const yNodes = doc!.getArray<Y.Map<NodeMapValue>>('subredditGraphNodes');
  const yLinks = doc!.getArray<Y.Map<LinkMapValue>>('subredditGraphLinks');
  const ySharedState = doc!.getMap<string | boolean | null | string[] | number>( // allow string[] for hoveredNodeIds
    'subredditGraphSharedState'
  );
  const yClientClickSelections = doc!.getMap<string[]>(
    'clientClickSubredditSelections'
  );

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
  const fixedWidth = 1280;
  const fixedHeight = 720;
  const tooltipWidth = fixedWidth * 0.25;

  // color scale for subreddit groups
  const colorScale = d3.scaleOrdinal(d3.schemeCategory10);

  useEffect(() => {
    if (!doc) return;
    const timeout = setTimeout(() => {
      console.log('assuming sync after timeout for subreddit visualization');
      setSyncStatus(true);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [doc]);

  useEffect(() => {
    if (!doc || !syncStatus) return;

    const yjsMonitor = setInterval(() => {
      const byteLength = Y.encodeStateAsUpdate(doc).byteLength;
      console.log(`[Yjs Subreddit] Document size: ${byteLength} bytes`);
    }, 60000);

    const domMonitor = setInterval(() => {
      const nodeCount = document.querySelectorAll('g.node').length;
      const tooltipCount = document.querySelectorAll('g.tooltip').length;
      console.log(
        `[DOM Subreddit] ${nodeCount} nodes, ${tooltipCount} tooltips in DOM`
      );
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

  useEffect(() => {
    if (!syncStatus || yNodes.length > 0) {
      return;
    }

    console.log('initializing subreddit graph data from json');

    const initialNodes: Y.Map<NodeMapValue>[] = [];
    const initialLinks: Y.Map<LinkMapValue>[] = [];
    const nodeIds = new Set<string>();

    const defaultX = fixedWidth / 2;
    const defaultY = fixedHeight / 2;

    subredditData.nodes.forEach((node) => {
      if (nodeIds.has(node.id)) return;
      const yNode = new Y.Map<NodeMapValue>();
      yNode.set('id', node.id);
      yNode.set('name', node.id); // name is the id for subreddits
      yNode.set('type', 'subreddit');
      yNode.set('group', node.group);
      yNode.set('x', defaultX);
      yNode.set('y', defaultY);
      yNode.set('uuid', crypto.randomUUID());
      initialNodes.push(yNode);
      nodeIds.add(node.id);
    });

    subredditData.links.forEach((link) => {
      const yLink = new Y.Map<LinkMapValue>();
      yLink.set('source', link.source);
      yLink.set('target', link.target);
      yLink.set('type', 'crosspost');
      yLink.set('crossposts', link.crossposts);
      yLink.set('shared_topic', link.shared_topic);
      initialLinks.push(yLink);
    });

    doc!.transact(() => {
      yNodes.push(initialNodes);
      yLinks.push(initialLinks);
    });
  }, [syncStatus, doc, yNodes, yLinks]);

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
        const root = d3.select('#subreddit-root');
        if (!root.empty()) {
          root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
        }
      }
    };

    ySharedState.observe(observer);
    return () => ySharedState.unobserve(observer);
  }, [doc, syncStatus, ySharedState]);

  useEffect(() => {
    if (!syncStatus || !d3Container.current) return;
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    console.log('initializing d3 subreddit visualization');

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
      .attr('id', 'subreddit-root')
      .attr(
        'transform',
        `translate(${currentTransform.x}, ${currentTransform.y}) scale(${currentTransform.k})`
      );

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
          const element = event.element;
          if (!element || !(element instanceof SVGElement)) return;
          if (
            element.tagName === 'circle' &&
            element.classList.contains('node-shape')
          ) {
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
          if (
            element.tagName === 'circle' &&
            element.classList.contains('node-shape')
          ) {
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

    const defs = svg.append('defs');
    const filter = defs
      .append('filter')
      .attr('id', 'subreddit-drop-shadow')
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
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'offsetBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    const tooltip = svg
      .append('g')
      .attr('class', 'tooltip')
      .attr('transform', 'translate(0,0)');
    const tooltipGradient = svg.append('defs').append('linearGradient');
    tooltipGradient
      .attr('id', 'subreddit-tooltip-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    tooltipGradient
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#2d3748')
      .attr('stop-opacity', 0.98);
    tooltipGradient
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#1a202c')
      .attr('stop-opacity', 0.98);
    tooltip
      .append('rect')
      .attr('width', tooltipWidth)
      .attr('height', fixedHeight)
      .attr('fill', 'url(#subreddit-tooltip-gradient)')
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
      .attr('font-size', '26px')
      .attr('fill', '#e2e8f0')
      .attr('font-weight', '500');
    const textLineClasses = ['tt-info1', 'tt-info2', 'tt-info3', 'tt-info4'];
    textLineClasses.forEach((className, index) => {
      tooltipContent
        .append('text')
        .attr('class', className)
        .attr('x', 0)
        .attr('y', 30 + index * 30)
        .attr('font-size', '18px')
        .attr('fill', '#a0aec0')
        .attr('font-weight', '300');
    });

    linkGroup.attr('transform', `translate(${tooltipWidth}, 0)`);
    nodeGroup.attr('transform', `translate(${tooltipWidth}, 0)`);

    const mapNodesToD3 = (): D3Node[] => {
      const nodes: D3Node[] = [];
      for (let i = 0; i < yNodes.length; i++) {
        const node = yNodes.get(i);
        const id = node.get('id') as string;
        const name = node.get('name') as string;
        const x = (node.get('x') as number) || fixedWidth / 2;
        const y = (node.get('y') as number) || fixedHeight / 2;
        const uuid = node.get('uuid') as string;
        const group = node.get('group') as number;

        const d3Node: D3SubredditNode = {
          id,
          type: 'subreddit',
          name,
          x,
          y,
          uuid,
          group,
        };
        nodes.push(d3Node);
      }
      return nodes;
    };

    const mapLinksToD3 = (nodeMap: Map<string, D3Node>): D3Link[] => {
      const links: D3Link[] = [];
      for (let i = 0; i < yLinks.length; i++) {
        const link = yLinks.get(i);
        const sourceId = link.get('source') as string;
        const targetId = link.get('target') as string;
        const type = link.get('type') as 'crosspost';
        const crossposts = link.get('crossposts') as number;
        const shared_topic = link.get('shared_topic') as string;

        const source = nodeMap.get(sourceId) || sourceId;
        const target = nodeMap.get(targetId) || targetId;

        links.push({ source, target, type, crossposts, shared_topic });
      }
      return links;
    };

    const updateSelectedNodesInfo = (nodes: D3Node[] | D3Node | null) => {
      const nodesArray = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
      tooltip.select('.tt-title').text('');
      textLineClasses.forEach((cls) => tooltip.select(`.${cls}`).text(''));
      tooltipContent.selectAll('.node-list-item').remove();

      if (nodesArray.length === 0) {
        tooltip.select('.tt-title').text('subreddit graph explorer');
        tooltip.select('.tt-info1').text('hover over subreddits for details');
        tooltip.select('.tt-info2').text('select subreddits for more info');
      } else if (nodesArray.length === 1) {
        const node = nodesArray[0] as D3SubredditNode;
        tooltip.select('.tt-title').text(node.name);
        tooltip.select('.tt-info1').text(`type: ${node.type}`);
        tooltip.select('.tt-info2').text(`group: ${node.group}`);
      } else {
        tooltip
          .select('.tt-title')
          .text(
            `${nodesArray.length} ${
              nodesArray.length === 1 ? 'subreddit' : 'subreddits'
            } selected`
          );
        const maxToShow = 5;
        const namesToShow = nodesArray.slice(0, maxToShow);
        const additionalCount = nodesArray.length - maxToShow;
        const maxWidth = tooltipWidth - 40;
        const wrapText = (text: string, width: number): string[] => {
          const words = text.split(/\s+/);
          const lines: string[] = [];
          let currentLine = '';
          for (const word of words) {
            if ((currentLine + word).length * 8 > width) {
              lines.push(currentLine);
              currentLine = word;
            } else {
              currentLine += (currentLine ? ' ' : '') + word;
            }
          }
          if (currentLine) lines.push(currentLine);
          return lines;
        };
        let currentY = 35;
        const lineHeight = 25;
        namesToShow.forEach((node) => {
          const nameWithBullet = `• ${node.name} (group: ${(node as D3SubredditNode).group})`;
          const wrappedLines = wrapText(nameWithBullet, maxWidth);
          const itemGroup = tooltipContent
            .append('g')
            .attr('class', 'node-list-item');
          wrappedLines.forEach((line, lineIndex) => {
            itemGroup
              .append('text')
              .attr('x', 0)
              .attr('y', currentY + lineIndex * lineHeight)
              .attr('font-size', '16px')
              .attr('fill', '#a0aec0')
              .attr('font-weight', '300')
              .text(line);
          });
          currentY += wrappedLines.length * lineHeight + 8;
        });
        if (additionalCount > 0) {
          tooltipContent
            .append('text')
            .attr('class', 'node-list-item')
            .attr('x', 0)
            .attr('y', currentY)
            .attr('font-size', '14px')
            .attr('fill', '#a0aec0')
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
      const links = mapLinksToD3(nodeMap);

      const linkKeyFn = (d: D3Link): string => {
        const source = d.source as D3Node;
        const target = d.target as D3Node;
        return `${source.id}-${target.id}-${d.type}-${d.shared_topic}`; // added shared_topic for uniqueness
      };

      const link = linkGroup
        .selectAll<SVGLineElement, D3Link>('line')
        .data(links, linkKeyFn);
      link.exit().remove();
      const linkEnter = link.enter().append('line');
      const linkMerge = linkEnter.merge(link);

      linkMerge
        .attr('x1', (d: D3Link) => (d.source as D3Node).x || 0)
        .attr('y1', (d: D3Link) => (d.source as D3Node).y || 0)
        .attr('x2', (d: D3Link) => (d.target as D3Node).x || 0)
        .attr('y2', (d: D3Link) => (d.target as D3Node).y || 0);

      const node = nodeGroup
        .selectAll<SVGGElement, D3Node>('g.node')
        .data(nodes, (d) => d.uuid);
      node.exit().remove();
      const nodeEnter = node
        .enter()
        .append('g')
        .attr('class', 'node')
        .attr('data-id', (d) => d.id)
        .attr('data-uuid', (d) => d.uuid);

      nodeEnter
        .filter((d): d is D3SubredditNode => d.type === 'subreddit')
        .append('circle')
        .attr('r', 20) // increased node radius
        .attr('fill', (d) => colorScale(d.group.toString())) // color by group
        .attr('fill-opacity', 0.8)
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 2)
        .attr('class', 'node-shape')
        .style('filter', 'url(#subreddit-drop-shadow)');

      nodeEnter
        .append('text')
        .attr('dy', '.35em')
        .attr('font-size', '10px') // smaller font for subreddit names
        .attr('fill', '#000000')
        .attr('text-anchor', 'middle')
        .text((d) =>
          d.name.length > 10 ? d.name.substring(0, 8) + '...' : d.name
        )
        .attr('opacity', 0)
        .attr('pointer-events', 'none');

      const nodeMerge = nodeEnter.merge(node);
      nodeMerge.attr(
        'transform',
        (d: D3Node) => `translate(${d.x || 0},${d.y || 0})`
      );
      nodeMerge
        .select('text')
        .attr('opacity', transformRef.current.k >= 0.6 ? 1 : 0); // show text at slightly lower zoom due to bigger nodes

      const hoveredIds = (ySharedState.get('hoveredNodeIds') as string[]) || [];
      const allClickSelectedIds: string[] = [];
      yClientClickSelections.forEach((nodeIds: string[]) => {
        allClickSelectedIds.push(...nodeIds);
      });

      let linksToHighlight: D3Link[] = [];
      if (hoveredIds.length > 0) {
        // only highlight links if one node is hovered for simplicity (no shortest path)
        linksToHighlight = findConnectedLinks(links, hoveredIds[0]);
      }

      linkMerge
        .attr('stroke', (d) =>
          linksToHighlight.includes(d)
            ? HIGHLIGHTED_LINK_COLOR
            : DEFAULT_LINK_COLOR
        )
        .attr('stroke-opacity', (d) =>
          linksToHighlight.includes(d)
            ? HIGHLIGHTED_LINK_OPACITY
            : DEFAULT_LINK_OPACITY
        )
        .attr(
          'stroke-width',
          (d) =>
            linksToHighlight.includes(d)
              ? HIGHLIGHTED_LINK_STROKE_WIDTH
              : DEFAULT_LINK_STROKE_WIDTH * (d.crossposts / 5 + 0.5) // vary width by crossposts, adjusted scaling
        );

      const allHighlightedIds = [
        ...new Set([...hoveredIds, ...allClickSelectedIds]),
      ];

      nodeMerge
        .select('.node-shape')
        .attr('stroke', (d) =>
          colorScale((d as D3SubredditNode).group.toString())
        ) // border same as fill initially
        .attr('stroke-width', 1.5);

      if (allHighlightedIds.length > 0) {
        if (hoveredIds.length > 0) {
          nodeMerge
            .filter((d: D3Node) => hoveredIds.includes(d.id))
            .select('.node-shape')
            .attr('stroke', '#ECC94B') // yellow hover
            .attr('stroke-width', 3);
        }
        if (allClickSelectedIds.length > 0) {
          nodeMerge
            .filter((d: D3Node) => allClickSelectedIds.includes(d.id))
            .select('.node-shape')
            .attr('stroke', '#63B3ED') // blue select
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
      console.log('initializing subreddit layout with force simulation');
      const nodeMapForLinks = new Map<string, D3Node>();
      nodes.forEach((n) => nodeMapForLinks.set(n.id, n));
      const links = mapLinksToD3(nodeMapForLinks);
      const availableWidth = fixedWidth - tooltipWidth; // re-introduce availableWidth

      const simulation = d3
        .forceSimulation<D3Node>(nodes)
        .force(
          'link',
          d3
            .forceLink<D3Node, D3Link>(links)
            .id((d) => d.id)
            .distance((d: D3Link) => 180 - d.crossposts * 2.5) // adjusted link distance
            .strength(0.06) // slightly stronger link strength
        )
        .force('charge', d3.forceManyBody().strength(-450)) // adjusted charge
        .force(
          'center',
          d3.forceCenter(
            tooltipWidth, // shift center to the left edge of the main vis area
            fixedHeight / 2
          )
        )
        .force(
          'x',
          d3.forceX(tooltipWidth + availableWidth * 0.45).strength(0.025)
        ) // pull towards center of main vis area
        .force('y', d3.forceY(fixedHeight / 2).strength(0.025))
        .force('collision', d3.forceCollide<D3Node>().radius(40)) // collision radius based on r=20, with some buffer
        .stop();

      console.log(
        'running subreddit simulation for 200 ticks for initial layout' // align tick count with movies
      );
      simulation.tick(200); // align tick count with movies

      doc!.transact(() => {
        nodes.forEach((node) => {
          for (let i = 0; i < yNodes.length; i++) {
            const nodeMap = yNodes.get(i);
            if (nodeMap.get('id') === node.id) {
              if (node.x !== undefined && node.y !== undefined) {
                nodeMap.set('x', node.x);
                nodeMap.set('y', node.y);
              } else {
                console.warn(`simulation did not set x/y for node ${node.id}`);
              }
              break;
            }
          }
        });
      });
      updateVisualization();
    };

    updateVisualization();
    updateSelectedNodesInfo([]);

    const observer = () => {
      updateVisualization();
    };
    yNodes.observeDeep(observer);
    yLinks.observeDeep(observer);
    ySharedState.observe(observer);
    yClientClickSelections.observe(observer);

    if (ySharedState.get('zoomScale') === undefined) {
      doc!.transact(() => {
        ySharedState.set('zoomScale', 1.1); // slightly adjusted initial zoom
        ySharedState.set('panX', tooltipWidth * 0.1); // minor initial pan adjustment
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
    colorScale, // added colorScale to dependency array
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
            color: '#333',
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
            subreddit graph visualization
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

export default Subreddit;
