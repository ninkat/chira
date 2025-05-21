import React, { useContext, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsContext } from '@/context/YjsContext';
import * as d3 from 'd3';
import auspolData from '@/assets/auspol.json';
import { InteractionEvent, InteractionPoint } from '@/types/interactionTypes';

// define shared value types for y.map
type NodeMapValue = string | number | boolean | undefined;
type LinkMapValue = string | number; // source/target can be numbers (rep ids) or strings (policy names)

// d3 specific types - extend SimulationNodeDatum with our required properties
interface D3Node extends d3.SimulationNodeDatum {
  id: string | number; // string for policy_name, number for rep_id
  type: 'representative' | 'policy';
  name: string;
  party?: string;
  electoral_division?: string;
  is_party_leader?: boolean;
  uuid: string;
}

interface D3Link {
  source: D3Node;
  target: D3Node;
  type: 'supports';
  // index?: number; // d3 might add this if used with a simulation that assigns it
}

// helper function to compact/prune the yjs document
function pruneYDoc(doc: Y.Doc) {
  console.log('[Yjs] Running document compaction for AusPol...');
  const beforeSize = Y.encodeStateAsUpdate(doc).byteLength;

  try {
    // create a new temporary document
    const tempDoc = new Y.Doc();

    // get current data from original doc
    const originalNodes = doc.getArray<Y.Map<NodeMapValue>>('auspolNodes');
    const originalLinks = doc.getArray<Y.Map<LinkMapValue>>('auspolLinks');
    const originalSharedState = doc.getMap<string | boolean | null | number>(
      'auspolSharedState'
    );

    // get references to collections in temp doc
    const tempNodes = tempDoc.getArray<Y.Map<NodeMapValue>>('auspolNodes');
    const tempLinks = tempDoc.getArray<Y.Map<LinkMapValue>>('auspolLinks');
    const tempSharedState = tempDoc.getMap<string | boolean | null | number>(
      'auspolSharedState'
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
        (value: string | boolean | null | number, key: string) => {
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
        (_: string | boolean | null | number, key: string) =>
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
      `[Yjs] AusPol Compaction complete: ${beforeSize.toLocaleString()} bytes → ${afterSize.toLocaleString()} bytes (${reduction}% reduction)`
    );

    // cleanup temporary doc
    tempDoc.destroy();
  } catch (err) {
    console.error('[Yjs] AusPol Compaction failed:', err);
    // fallback
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
        `[Yjs] AusPol Simple compaction complete: ${beforeSize.toLocaleString()} bytes → ${afterSize.toLocaleString()} bytes (${reduction}% reduction)`
      );
    } catch (fallbackErr) {
      console.error(
        '[Yjs] AusPol Fallback compaction also failed:',
        fallbackErr
      );
    }
  }
}

const AusPol: React.FC = () => {
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;
  const d3Container = useRef<HTMLDivElement | null>(null);

  const yNodes = doc!.getArray<Y.Map<NodeMapValue>>('auspolNodes');
  const yLinks = doc!.getArray<Y.Map<LinkMapValue>>('auspolLinks');
  const ySharedState = doc!.getMap<string | boolean | null | string[] | number>(
    'auspolSharedState'
  );
  const yClientClickSelections = doc!.getMap<string[]>(
    'clientClickSelectionsAusPol'
  ); // unique key for this visualization
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

  useEffect(() => {
    if (!doc) return;
    const timeout = setTimeout(() => {
      console.log('assuming sync after timeout for auspol visualization');
      setSyncStatus(true);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [doc]);

  useEffect(() => {
    if (!doc || !syncStatus) return;
    const yjsMonitor = setInterval(() => {
      const byteLength = Y.encodeStateAsUpdate(doc).byteLength;
      console.log(`[Yjs AusPol] Document size: ${byteLength} bytes`);
    }, 60000);
    const domMonitor = setInterval(() => {
      const nodeCount = document.querySelectorAll('g.node').length;
      const tooltipCount = document.querySelectorAll('g.tooltip').length;
      console.log(
        `[DOM AusPol] ${nodeCount} nodes, ${tooltipCount} tooltips in DOM`
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
    if (!syncStatus || yNodes.length > 0 || !doc) {
      return;
    }
    console.log('initializing auspol graph data from json');

    const initialNodes: Y.Map<NodeMapValue>[] = [];
    const initialLinks: Y.Map<LinkMapValue>[] = [];
    const defaultX = fixedWidth / 2;
    const defaultY = fixedHeight / 2;

    // process representatives as nodes
    auspolData.representatives.forEach((rep) => {
      const yNode = new Y.Map<NodeMapValue>();
      yNode.set('id', rep.id); // numeric id
      yNode.set('name', `${rep.first_name} ${rep.last_name}`);
      yNode.set('type', 'representative');
      yNode.set('party', rep.party);
      yNode.set('electoral_division', rep.electoral_division);
      yNode.set('is_party_leader', rep.is_party_leader);
      yNode.set('x', defaultX);
      yNode.set('y', defaultY);
      yNode.set('uuid', crypto.randomUUID());
      initialNodes.push(yNode);
    });

    // process policies as nodes and create links
    auspolData.policies.forEach((policy) => {
      const policyId = policy.policy_name; // use policy_name as id (string)
      const yNode = new Y.Map<NodeMapValue>();
      yNode.set('id', policyId);
      yNode.set('name', policy.policy_name);
      yNode.set('type', 'policy');
      yNode.set('x', defaultX);
      yNode.set('y', defaultY);
      yNode.set('uuid', crypto.randomUUID());
      initialNodes.push(yNode);

      // create links from policy to supporting representatives
      policy.supporters.forEach((supporterId) => {
        const yLink = new Y.Map<LinkMapValue>();
        yLink.set('source', policyId); // policy_name as source
        yLink.set('target', supporterId); // representative id as target
        yLink.set('type', 'supports');
        initialLinks.push(yLink);
      });
    });

    doc.transact(() => {
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
        const root = d3.select('#auspol-root');
        if (!root.empty()) {
          root.attr('transform', `translate(${x}, ${y}) scale(${scale})`);
        }
      }
    };
    ySharedState.observe(observer);
    return () => ySharedState.unobserve(observer);
  }, [doc, syncStatus, ySharedState]);

  useEffect(() => {
    if (!syncStatus || !d3Container.current || !doc) return;
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    console.log('initializing d3 visualization for auspol');
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
      .attr('id', 'auspol-root') // unique id for this root
      .attr(
        'transform',
        `translate(${currentTransform.x}, ${currentTransform.y}) scale(${currentTransform.k})`
      );

    const linkGroup = root.append('g').attr('class', 'links');
    const nodeGroup = root.append('g').attr('class', 'nodes');
    const nodeTextGroup = root.append('g').attr('class', 'node-texts'); // New group for all texts

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
      doc.transact(() => {
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
          const nodeIdAttr = parentNode.getAttribute('data-id'); // this is string | number
          if (!nodeIdAttr) return;

          // convert to correct type for matching
          const nodeId =
            parentNode.getAttribute('data-type') === 'policy'
              ? nodeIdAttr
              : parseInt(nodeIdAttr, 10);

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
            (element.tagName === 'circle' || element.tagName === 'rect') &&
            element.classList.contains('node-shape')
          ) {
            const parentNode = element.closest('g.node');
            const nodeId = parentNode?.getAttribute('data-id'); // string representation of id
            if (nodeId) {
              const currentHoveredNodeIds =
                (ySharedState.get('hoveredNodeIdsAusPol') as string[]) || []; // unique key
              if (!currentHoveredNodeIds.includes(nodeId)) {
                ySharedState.set('hoveredNodeIdsAusPol', [
                  // unique key
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
            (element.tagName === 'circle' || element.tagName === 'rect') &&
            element.classList.contains('node-shape')
          ) {
            const parentNode = element.closest('g.node');
            const nodeId = parentNode?.getAttribute('data-id'); // string representation of id
            if (nodeId) {
              const currentHoveredNodeIds =
                (ySharedState.get('hoveredNodeIdsAusPol') as string[]) || []; // unique key
              const updatedHoveredNodeIds = currentHoveredNodeIds.filter(
                (id) => id !== nodeId
              );
              ySharedState.set('hoveredNodeIdsAusPol', updatedHoveredNodeIds); // unique key
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
            const nodeId = parentNode?.getAttribute('data-id'); // string representation of id
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
        case 'drag':
        case 'zoom': {
          if (event.transform) {
            const { x, y } = event.transform;
            const scale =
              'scale' in event.transform
                ? event.transform.scale
                : transformRef.current.k;
            doc.transact(() => {
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

    const tooltip = svg
      .append('g')
      .attr('class', 'tooltip')
      .attr('transform', 'translate(0,0)');
    const tooltipGradient = svg.append('defs').append('linearGradient');
    tooltipGradient
      .attr('id', 'tooltip-gradient-auspol') // unique id
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
      .attr('fill', 'url(#tooltip-gradient-auspol)')
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
      .attr('font-size', '24px')
      .attr('fill', '#ffffff')
      .attr('font-weight', '500');
    tooltipContent
      .append('text')
      .attr('class', 'tt-line1')
      .attr('x', 0)
      .attr('y', 30)
      .attr('font-size', '18px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');
    tooltipContent
      .append('text')
      .attr('class', 'tt-line2')
      .attr('x', 0)
      .attr('y', 55)
      .attr('font-size', '18px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');
    tooltipContent
      .append('text')
      .attr('class', 'tt-line3')
      .attr('x', 0)
      .attr('y', 80)
      .attr('font-size', '18px')
      .attr('fill', '#cbd5e0')
      .attr('font-weight', '300');

    linkGroup.attr('transform', `translate(0, 0)`);
    nodeGroup.attr('transform', `translate(0, 0)`);
    nodeTextGroup.attr('transform', `translate(0,0)`); // Apply same transform as nodes/links if necessary

    const mapNodesToD3 = (): D3Node[] => {
      const nodes: D3Node[] = [];
      for (let i = 0; i < yNodes.length; i++) {
        const node = yNodes.get(i);
        const id = node.get('id') as string | number;
        const type = node.get('type') as 'representative' | 'policy';
        const name = node.get('name') as string;
        const x = (node.get('x') as number) || fixedWidth / 2;
        const y = (node.get('y') as number) || fixedHeight / 2;
        const uuid = node.get('uuid') as string;
        const d3Node: D3Node = { id, type, name, x, y, uuid };
        if (type === 'representative') {
          d3Node.party = node.get('party') as string;
          d3Node.electoral_division = node.get('electoral_division') as string;
          d3Node.is_party_leader = node.get('is_party_leader') as boolean;
        }
        nodes.push(d3Node);
      }
      return nodes;
    };

    const mapLinksToD3 = (nodeMap: Map<string | number, D3Node>): D3Link[] => {
      const links: D3Link[] = [];
      for (let i = 0; i < yLinks.length; i++) {
        const link = yLinks.get(i);
        const sourceId = link.get('source') as string | number;
        const targetId = link.get('target') as string | number;
        const type = link.get('type') as 'supports';
        const sourceNode = nodeMap.get(sourceId);
        const targetNode = nodeMap.get(targetId);
        if (sourceNode && targetNode) {
          links.push({ source: sourceNode, target: targetNode, type });
        } else {
          // console.warn(`could not find nodes for link: ${sourceid} -> ${targetid}`);
        }
      }
      return links;
    };

    const partyColors: { [key: string]: string } = {
      'australian labor party': '#de3533', // red
      'liberal party': '#0047ab', // blue
      'national party': '#00693c', // green
      'australian greens': '#009c48', // darker green
      "katter's australian party": '#ff6600', // orange
      'centre alliance': '#f3d000', // yellow
      independent: '#708090', // slate gray
      'liberal national party': '#2E62C5', // another blue
      cwm: '#A52A2A', // brown (country liberal party - assuming from "cwm") - this needs verification
      // add other parties as needed
    };
    const defaultPartyColor = '#cccccc'; // light grey for unknown/other parties

    const updateSelectedNodesInfo = (nodes: D3Node[] | D3Node | null) => {
      const nodesArray = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
      tooltip.select('.tt-title').text('');
      tooltip.select('.tt-line1').text('');
      tooltip.select('.tt-line2').text('');
      tooltip.select('.tt-line3').text('');
      tooltipContent.selectAll('.node-list-item').remove();

      if (nodesArray.length === 0) {
        tooltip.select('.tt-title').text('House of Representatives');
        tooltip.select('.tt-line1').text('47th Parliament of Australia');
        tooltip.select('.tt-line2').text('Hover over nodes for details.');
      } else if (nodesArray.length === 1) {
        const node = nodesArray[0];
        tooltip.select('.tt-title').text(node.name);
        if (node.type === 'representative') {
          tooltip
            .select('.tt-line1')
            .text(`Member for: ${node.electoral_division || 'n/a'}`);
          tooltip.select('.tt-line2').text(node.party || 'n/a');
        } else if (node.type === 'policy') {
          const policyLinks = mapLinksToD3(
            new Map(mapNodesToD3().map((n) => [n.id, n]))
          ).filter((l) => l.source.id === node.id);
          tooltip.select('.tt-line1').text('Insert Policy Details Here');
          tooltip.select('.tt-line2').text(`Supporters: ${policyLinks.length}`);
        }
      } else {
        tooltip
          .select('.tt-title')
          .text(
            `${nodesArray.length} ${nodesArray.length === 1 ? 'item' : 'items'} selected`
          );
        let currentY = 30;
        const lineHeight = 25;
        nodesArray.slice(0, 5).forEach((node) => {
          tooltipContent
            .append('text')
            .attr('class', 'node-list-item')
            .attr('x', 0)
            .attr('y', currentY)
            .attr('font-size', '16px')
            .attr('fill', '#cbd5e0')
            .text(
              `• ${node.name.substring(0, 25)}${node.name.length > 25 ? '...' : ''} (${node.type})`
            );
          currentY += lineHeight;
        });
        if (nodesArray.length > 5) {
          tooltipContent
            .append('text')
            .attr('class', 'node-list-item')
            .attr('x', 0)
            .attr('y', currentY)
            .attr('font-size', '14px')
            .attr('fill', '#cbd5e0')
            .style('font-style', 'italic')
            .text(`and ${nodesArray.length - 5} more...`);
        }
      }
    };

    const updateVisualization = () => {
      const d3Nodes = mapNodesToD3();
      const nodeMap = new Map<string | number, D3Node>();
      d3Nodes.forEach((n) => nodeMap.set(n.id, n));
      const d3Links = mapLinksToD3(nodeMap);

      const linkKeyFn = (d: D3Link): string => {
        // const source = d.source as D3Node; // No cast needed
        // const target = d.target as D3Node; // No cast needed
        return `${d.source.uuid}-${d.target.uuid}-${d.type}`; // use uuid for keying d3 elements
      };

      const link = linkGroup
        .selectAll<SVGLineElement, D3Link>('line')
        .data(d3Links, linkKeyFn);
      link.exit().remove();
      const linkEnter = link
        .enter()
        .append('line')
        .attr('stroke', '#bbb')
        .attr('stroke-width', 1.5);
      // .attr('marker-end', 'url(#arrowhead-auspol)'); // Removed arrowhead
      const linkMerge = linkEnter.merge(link);
      linkMerge
        .attr('x1', (d) => d.source.x || 0) // Direct access
        .attr('y1', (d) => d.source.y || 0) // Direct access
        .attr('x2', (d) => d.target.x || 0) // Direct access
        .attr('y2', (d) => d.target.y || 0); // Direct access

      const node = nodeGroup
        .selectAll<SVGGElement, D3Node>('g.node')
        .data(d3Nodes, (d) => d.uuid);
      node.exit().remove();
      const nodeEnter = node
        .enter()
        .append('g')
        .attr('class', 'node')
        .attr('data-id', (d) => d.id.toString()) // ensure data-id is string for attribute
        .attr('data-uuid', (d) => d.uuid)
        .attr('data-type', (d) => d.type);

      // representatives (circles)
      nodeEnter
        .filter((d) => d.type === 'representative')
        .append('rect') // Changed from circle to rect
        .attr('x', -8) // Centering the square: -size/2
        .attr('y', -8) // Centering the square: -size/2
        .attr('width', 16) // Representative node size
        .attr('height', 16) // Representative node size
        .attr(
          'fill',
          (d) => partyColors[d.party?.toLowerCase() || ''] || defaultPartyColor
        )
        .attr('class', 'node-shape');

      // policies (rectangles)
      nodeEnter
        .filter((d) => d.type === 'policy')
        .append('rect')
        .attr('x', -25) // policyNodeRenderWidth / 2
        .attr('y', -15) // policyNodeRenderHeight / 2
        .attr('width', 50) // policyNodeRenderWidth
        .attr('height', 30) // policyNodeRenderHeight
        .attr('fill', '#95a5a6') // neutral color for policies
        .attr('stroke', '#333')
        .attr('stroke-width', 1.5)
        .attr('class', 'node-shape');

      const nodeMerge = nodeEnter.merge(node);
      nodeMerge.attr('transform', (d) => `translate(${d.x || 0},${d.y || 0})`);

      // Handle text elements in their own group for Z-ordering
      const texts = nodeTextGroup
        .selectAll<SVGTextElement, D3Node>('text')
        .data(d3Nodes, (d) => d.uuid);

      texts.exit().remove();

      const textsEnter = texts
        .enter()
        .append('text')
        .attr('dx', 15)
        .attr('dy', '.35em')
        .attr('font-size', '10px')
        .text((d) => d.name.substring(0, 20))
        .attr('pointer-events', 'none');

      const textsMerge = textsEnter.merge(texts);
      textsMerge
        .attr('x', (d) => d.x || 0) // Position text based on node's x,y
        .attr('y', (d) => d.y || 0)
        .attr('opacity', 0); // Default to hidden

      const hoveredIds =
        (ySharedState.get('hoveredNodeIdsAusPol') as string[]) || []; // unique key
      const clientSelections = yClientClickSelections.get(userId) || [];
      const allHighlightedIds = [
        ...new Set([...hoveredIds, ...clientSelections]),
      ];

      // Apply default styles first, then highlights
      nodeMerge.select<SVGRectElement>('.node-shape').each(function (d) {
        const element = d3.select(this);
        if (d.type === 'representative' && d.is_party_leader) {
          element.attr('stroke', '#ffffff').attr('stroke-width', 2.5);
        } else {
          element.attr('stroke', '#333').attr('stroke-width', 1.5);
        }
      });

      textsMerge.attr('opacity', 0); // Reset all text opacity first

      if (allHighlightedIds.length > 0) {
        nodeMerge
          .filter((d) => allHighlightedIds.includes(d.id.toString()))
          .select('.node-shape')
          .attr('stroke', '#f39c12') // orange for general highlight
          .attr('stroke-width', 3.0); // Thicker highlight stroke
        textsMerge
          .filter((d) => allHighlightedIds.includes(d.id.toString()))
          .attr('opacity', 1); // Show text for highlighted nodes

        // specific color for clicked if needed
        nodeMerge
          .filter((d) => clientSelections.includes(d.id.toString()))
          .select('.node-shape')
          .attr('stroke', '#87ceeb') // sky blue for click selected
          .attr('stroke-width', 3.0); // Ensure click highlight is also thicker

        const highlightedD3Nodes = d3Nodes.filter((n) =>
          allHighlightedIds.includes(n.id.toString())
        );
        updateSelectedNodesInfo(highlightedD3Nodes);
      } else {
        updateSelectedNodesInfo([]);
      }

      const needsInitialLayout = d3Nodes.some(
        (n) => n.x === fixedWidth / 2 && n.y === fixedHeight / 2
      );
      if (needsInitialLayout) {
        initializeLayout(d3Nodes);
      }
    };

    const initializeLayout = (nodes: D3Node[]) => {
      console.log(
        'initializing auspol fixed rectangular block layout with sub-groups'
      );
      doc!.transact(() => {
        const laborPartyNames = ['australian labor party'];
        // Define coalition party groups and their display order
        const coalitionPartyGroups = {
          LNP: 'liberal national party',
          LIB: 'liberal party',
          NAT: 'national party',
          CWM: 'cwm',
        };
        const coalitionOrder: (keyof typeof coalitionPartyGroups)[] = [
          'LIB',
          'LNP',
          'NAT',
          'CWM',
        ];
        const allCoalitionPartyNames = Object.values(coalitionPartyGroups);

        // Define major crossbench parties and their display order
        const mainCrossbenchParties = {
          GRN: 'australian greens',
          KAP: "katter's australian party",
          CA: 'centre alliance',
        };
        const crossbenchOrder: (keyof typeof mainCrossbenchParties)[] = [
          'GRN',
          'KAP',
          'CA',
        ];
        const allMainCrossbenchPartyNames = Object.values(
          mainCrossbenchParties
        );

        const representatives = nodes.filter(
          (n) => n.type === 'representative'
        );
        const policies = nodes.filter((n) => n.type === 'policy');

        const laborReps = representatives.filter((r) =>
          laborPartyNames.includes(r.party?.toLowerCase() || '')
        );

        // Prepare coalition sub-groups
        const coalitionSubGroups: { [key: string]: D3Node[] } = {};
        coalitionOrder.forEach((key) => (coalitionSubGroups[key] = []));
        representatives.forEach((r) => {
          const partyLower = r.party?.toLowerCase() || '';
          const groupKey = coalitionOrder.find(
            (key) => coalitionPartyGroups[key] === partyLower
          );
          if (groupKey) {
            coalitionSubGroups[groupKey].push(r);
          }
        });

        // Prepare crossbench party groups
        const crossbenchPartySubGroups: { [key: string]: D3Node[] } = {};
        crossbenchOrder.forEach((key) => (crossbenchPartySubGroups[key] = []));
        const independentReps: D3Node[] = [];

        representatives.forEach((r) => {
          const partyLower = r.party?.toLowerCase() || '';
          if (
            laborPartyNames.includes(partyLower) ||
            allCoalitionPartyNames.includes(partyLower)
          )
            return;

          const groupKey = crossbenchOrder.find(
            (key) => mainCrossbenchParties[key] === partyLower
          );
          if (groupKey) {
            crossbenchPartySubGroups[groupKey].push(r);
          } else if (partyLower === 'independent') {
            independentReps.push(r);
          } else if (partyLower) {
            // other named minor parties
            if (!crossbenchPartySubGroups[partyLower]) {
              crossbenchPartySubGroups[partyLower] = [];
            }
            crossbenchPartySubGroups[partyLower].push(r);
            // Add to a temporary order if not a main one, to be sorted later
            if (
              !allMainCrossbenchPartyNames.includes(partyLower) &&
              !crossbenchOrder.some(
                (k) => mainCrossbenchParties[k] === partyLower
              )
            ) {
              // handled by collecting keys and sorting later
            }
          }
        });

        // Define order for other minor parties (alphabetical)
        const otherMinorPartyKeys = Object.keys(crossbenchPartySubGroups)
          .filter(
            (key) =>
              !crossbenchOrder.some((orderedKey) => orderedKey === key) &&
              key !== 'independent' // Type-safe check
          )
          .sort();

        const graphActualWidth = fixedWidth - tooltipWidth;
        const graphOriginX = tooltipWidth;
        const topPadding = 30;
        const sideBlockWidthRatio = 0.2;
        const bottomBlockHeightRatio = 0.25;
        const internalPadding = 15;
        const partyGroupSpacing = internalPadding; // spacing between sub-party blocks

        const sideBlockWidth = graphActualWidth * sideBlockWidthRatio;
        const bottomBlockHeight = fixedHeight * bottomBlockHeightRatio;
        const repNodeSize = 18;

        const layoutBlock = (
          repList: D3Node[],
          xStart: number,
          yStart: number,
          blockWidth: number,
          blockHeight: number,
          nodeSize: number
          // listName?: string // Unused
        ) => {
          if (repList.length === 0 || blockWidth <= 0 || blockHeight <= 0)
            return 0;
          let maxNodesPerRow = Math.floor(
            blockWidth / (nodeSize + internalPadding)
          );
          maxNodesPerRow = Math.max(1, maxNodesPerRow); // ensure at least 1 node per row if space allows

          const currentX = xStart;
          const currentY = yStart;
          let rowsFilled = 0;

          for (let i = 0; i < repList.length; i++) {
            const node = repList[i];
            const col = i % maxNodesPerRow;
            const row = Math.floor(i / maxNodesPerRow);

            if (row > rowsFilled) {
              rowsFilled = row;
            }

            node.x =
              currentX + col * (nodeSize + internalPadding) + nodeSize / 2;
            node.y =
              currentY + row * (nodeSize + internalPadding) + nodeSize / 2;

            // Boundary check - simple version, might need refinement if really tight
            if (node.y + nodeSize / 2 > yStart + blockHeight) {
              // console.warn(`Node overflow for ${listName || 'group'} - ${node.name}`);
            }
          }
          const totalHeightUsed =
            (rowsFilled + 1) * (nodeSize + internalPadding) - internalPadding;
          return Math.max(0, totalHeightUsed); // return height used by this block
        };

        // labor reps (left block) - remains as a single block
        const laborBlockX = graphOriginX + internalPadding;
        const laborBlockY = topPadding;
        const crossbenchEffectiveYStart =
          fixedHeight - bottomBlockHeight - internalPadding;
        const mainRepBlocksHeight =
          crossbenchEffectiveYStart - topPadding - internalPadding;
        layoutBlock(
          laborReps,
          laborBlockX,
          laborBlockY,
          sideBlockWidth,
          mainRepBlocksHeight,
          repNodeSize
          // 'Labor' // Unused
        );

        // coalition reps (right block) - with sub-groups
        const coalitionBlockX =
          graphOriginX + graphActualWidth - sideBlockWidth - internalPadding;
        let currentCoalitionY = topPadding;
        coalitionOrder.forEach((key) => {
          const group = coalitionSubGroups[key];
          if (group.length > 0) {
            // Calculate height needed for this group within the sideBlockWidth
            let maxNodesPerRow = Math.floor(
              sideBlockWidth / (repNodeSize + internalPadding)
            );
            maxNodesPerRow = Math.max(1, maxNodesPerRow);
            const numRows = Math.ceil(group.length / maxNodesPerRow);
            const subBlockHeight =
              numRows * (repNodeSize + internalPadding) -
              (numRows > 0 ? internalPadding : 0);

            if (
              currentCoalitionY + subBlockHeight <=
              topPadding + mainRepBlocksHeight
            ) {
              layoutBlock(
                group,
                coalitionBlockX,
                currentCoalitionY,
                sideBlockWidth,
                subBlockHeight,
                repNodeSize
                // `Coalition-${key}` // Unused
              );
              currentCoalitionY += subBlockHeight + partyGroupSpacing;
            } else {
              // console.warn(`Not enough space for coalition group ${key}`);
              // Attempt to layout what fits, or just skip if no space
              const remainingHeight =
                topPadding + mainRepBlocksHeight - currentCoalitionY;
              if (remainingHeight > repNodeSize) {
                layoutBlock(
                  group,
                  coalitionBlockX,
                  currentCoalitionY,
                  sideBlockWidth,
                  remainingHeight,
                  repNodeSize
                  // `Coalition-${key}-partial` // Unused
                );
                currentCoalitionY += remainingHeight + partyGroupSpacing;
              }
            }
          }
        });

        // policies (center block)
        const policyAreaXStart =
          graphOriginX + sideBlockWidth + internalPadding * 2;
        const policyAreaWidth =
          graphActualWidth - (sideBlockWidth + internalPadding * 2) * 2;
        const policyAreaYStart = topPadding;
        const policyAreaHeight = mainRepBlocksHeight;
        const policyNodeRenderWidth = 50;
        const policyNodeRenderHeight = 30;
        const policyNodeLayoutWidth = policyNodeRenderWidth; // Use render width for layout
        const policyNodeLayoutHeight = policyNodeRenderHeight; // Use render height for layout

        if (
          policies.length > 0 &&
          policyAreaWidth > 0 &&
          policyAreaHeight > 0
        ) {
          const policyCols = 5; // Fixed to 5 bills per level
          let policyRows = Math.ceil(policies.length / policyCols);
          policyRows = Math.max(1, policyRows);

          const actualPolicyGridWidth =
            policyCols * (policyNodeLayoutWidth + internalPadding) -
            internalPadding;
          const actualPolicyGridHeight =
            policyRows * (policyNodeLayoutHeight + internalPadding) -
            internalPadding;

          const policyXGridStart =
            policyAreaXStart + (policyAreaWidth - actualPolicyGridWidth) / 2;
          const policyYGridStart =
            policyAreaYStart + (policyAreaHeight - actualPolicyGridHeight) / 2;

          policies.forEach((node, i) => {
            const col = i % policyCols;
            const row = Math.floor(i / policyCols);
            node.x =
              policyXGridStart +
              col * (policyNodeLayoutWidth + internalPadding) +
              policyNodeLayoutWidth / 2;
            node.y =
              policyYGridStart +
              row * (policyNodeLayoutHeight + internalPadding) +
              policyNodeLayoutHeight / 2;
          });
        }

        // crossbench reps (bottom middle block) - with sub-groups L-R
        const crossbenchBlockTotalXStart = policyAreaXStart;
        const crossbenchBlockTotalWidth = policyAreaWidth;
        const crossbenchBlockY = crossbenchEffectiveYStart;
        const crossbenchAvailableHeight = bottomBlockHeight;
        // let currentCrossbenchX = crossbenchBlockTotalXStart; // Not needed for single block layout

        // Create a single sorted list of all crossbench reps
        const sortedCrossbenchReps: D3Node[] = [];
        crossbenchOrder.forEach((key) => {
          const group = crossbenchPartySubGroups[key];
          if (group) sortedCrossbenchReps.push(...group);
        });
        otherMinorPartyKeys.forEach((key) => {
          const group = crossbenchPartySubGroups[key];
          if (group) sortedCrossbenchReps.push(...group);
        });
        if (independentReps.length > 0) {
          sortedCrossbenchReps.push(...independentReps);
        }

        // Layout all crossbenchers in a single block, their sorted order will keep parties together
        // if (sortedCrossbenchReps.length > 0) {
        //   layoutBlock(
        //     sortedCrossbenchReps,
        //     crossbenchBlockTotalXStart,
        //     crossbenchBlockY,
        //     crossbenchBlockTotalWidth,
        //     crossbenchAvailableHeight,
        //     repNodeSize,
        //     'Crossbench-All'
        //   );
        // }

        const independentPartyName = 'independent';
        let firstIndependentIdx = -1;
        for (let i = 0; i < sortedCrossbenchReps.length; i++) {
          if (
            sortedCrossbenchReps[i].party?.toLowerCase() ===
            independentPartyName
          ) {
            firstIndependentIdx = i;
            break;
          }
        }

        let currentLayoutX = crossbenchBlockTotalXStart;
        let currentLayoutY = crossbenchBlockY;
        const nodeAndPadding = repNodeSize + internalPadding;
        let numNodesOnCurrentLine = 0;

        if (firstIndependentIdx === -1) {
          // no independents, or all are independents (if firstIndependentIdx is 0 and list is only independents)
          if (sortedCrossbenchReps.length > 0) {
            layoutBlock(
              sortedCrossbenchReps,
              crossbenchBlockTotalXStart,
              crossbenchBlockY,
              crossbenchBlockTotalWidth,
              crossbenchAvailableHeight,
              repNodeSize
              // 'Crossbench-All (No explicit Independents split)' // Unused
            );
          }
        } else {
          const preIndependentReps = sortedCrossbenchReps.slice(
            0,
            firstIndependentIdx
          );
          const independentRepsList =
            sortedCrossbenchReps.slice(firstIndependentIdx);

          // manual layout for pre-independent reps
          if (preIndependentReps.length > 0) {
            const maxNodesPerFullLine = Math.max(
              1,
              Math.floor(crossbenchBlockTotalWidth / nodeAndPadding)
            );

            for (let i = 0; i < preIndependentReps.length; i++) {
              const node = preIndependentReps[i];

              if (numNodesOnCurrentLine >= maxNodesPerFullLine) {
                currentLayoutX = crossbenchBlockTotalXStart;
                currentLayoutY += nodeAndPadding;
                numNodesOnCurrentLine = 0;
              }

              node.x = currentLayoutX + repNodeSize / 2;
              node.y = currentLayoutY + repNodeSize / 2;

              currentLayoutX += nodeAndPadding;
              numNodesOnCurrentLine++;
            }
          }
          // after loop, currentLayoutX is the x for the *next* spot. currentLayoutY is the y of the line just filled.

          let indyBlockXStart;
          let indyBlockYStart = currentLayoutY;

          if (currentLayoutX === crossbenchBlockTotalXStart) {
            // this case means:
            // 1. preIndependentReps was empty (firstIndependentIdx === 0).
            // 2. preIndependentReps filled lines perfectly and currentLayoutX was reset.
            indyBlockXStart = crossbenchBlockTotalXStart;
            // if preIndependentReps was empty, currentLayoutY is still initial crossbenchBlockY.
            // if preIndependentReps filled lines, currentLayoutY is already advanced to the next line or is the line they just filled.
            // if it's the line they just filled and it reset currentLayoutX, it means they ended at the exact end of the line.
            // so the next block (independents) should start on a new line if currentLayoutX was reset.
            // This condition for indyBlockYStart needs to be robust if preIndependentReps were laid out.
            if (
              preIndependentReps.length > 0 &&
              currentLayoutX === crossbenchBlockTotalXStart &&
              numNodesOnCurrentLine === 0
            ) {
              // This means the last pre-indy rep finished a line, and currentLayoutX was reset,
              // so indyBlockYStart should effectively be currentLayoutY (which is already correct for the new line).
            } else if (preIndependentReps.length === 0) {
              indyBlockYStart = crossbenchBlockY; // Ensure Y is reset if no pre-indy reps
            }
          } else if (
            currentLayoutX + repNodeSize >
            crossbenchBlockTotalXStart + crossbenchBlockTotalWidth
          ) {
            // pre-indy reps ended, and next spot (currentLayoutX) is effectively off the current line width.
            // so independents start a new line.
            indyBlockYStart += nodeAndPadding;
            indyBlockXStart = crossbenchBlockTotalXStart;
          } else {
            // space for inds on current line, after pre-indy reps
            indyBlockXStart = currentLayoutX;
          }

          if (independentRepsList.length > 0) {
            const indyBlockWidth =
              crossbenchBlockTotalXStart +
              crossbenchBlockTotalWidth -
              indyBlockXStart;
            const indyBlockHeight =
              crossbenchAvailableHeight - (indyBlockYStart - crossbenchBlockY);

            // ensure blockwidth and blockheight are not negative if indystart is beyond the area
            const effectiveIndyBlockWidth = Math.max(0, indyBlockWidth);
            const effectiveIndyBlockHeight = Math.max(0, indyBlockHeight);

            if (effectiveIndyBlockWidth > 0 && effectiveIndyBlockHeight > 0) {
              layoutBlock(
                independentRepsList,
                indyBlockXStart,
                indyBlockYStart,
                effectiveIndyBlockWidth,
                effectiveIndyBlockHeight,
                repNodeSize
                // 'Crossbench-Independents' // Unused
              );
            } else {
              // console.warn('no space to layout independents or list empty');
            }
          }
        }

        // --- Centering logic --- //
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        nodes.forEach((node) => {
          if (node.x === undefined || node.y === undefined) return; // Skip nodes not yet positioned
          minX = Math.min(
            minX,
            node.x -
              (node.type === 'policy'
                ? policyNodeRenderWidth / 2
                : repNodeSize / 2)
          );
          maxX = Math.max(
            maxX,
            node.x +
              (node.type === 'policy'
                ? policyNodeRenderWidth / 2
                : repNodeSize / 2)
          );
          minY = Math.min(
            minY,
            node.y -
              (node.type === 'policy'
                ? policyNodeRenderHeight / 2
                : repNodeSize / 2)
          );
          maxY = Math.max(
            maxY,
            node.y +
              (node.type === 'policy'
                ? policyNodeRenderHeight / 2
                : repNodeSize / 2)
          );
        });

        if (
          isFinite(minX) &&
          isFinite(maxX) &&
          isFinite(minY) &&
          isFinite(maxY)
        ) {
          const currentVisWidth = maxX - minX;
          const currentVisHeight = maxY - minY;
          const currentVisCenterX = minX + currentVisWidth / 2;
          const currentVisCenterY = minY + currentVisHeight / 2;

          const targetAreaWidth = fixedWidth - tooltipWidth;
          // const targetAreaHeight = fixedHeight; // Already full height by default
          const targetCenterX = tooltipWidth + targetAreaWidth / 2;
          const targetCenterY = fixedHeight / 2;

          const offsetX = targetCenterX - currentVisCenterX;
          const offsetY = targetCenterY - currentVisCenterY;

          nodes.forEach((node) => {
            if (node.x !== undefined && node.y !== undefined) {
              node.x += offsetX;
              node.y += offsetY;
            }
          });
        }
        // --- End Centering logic --- //

        // update yjs nodes
        nodes.forEach((node) => {
          for (let i = 0; i < yNodes.length; i++) {
            const nodeMap = yNodes.get(i);
            if (nodeMap.get('uuid') === node.uuid) {
              nodeMap.set('x', node.x);
              nodeMap.set('y', node.y);
              break;
            }
          }
        });
      });
      updateVisualization(); // re-render with new positions
    };

    updateVisualization();
    updateSelectedNodesInfo([]);

    const observer = () => updateVisualization();
    yNodes.observeDeep(observer);
    yLinks.observeDeep(observer);
    ySharedState.observe(observer);
    yClientClickSelections.observe(observer);

    if (ySharedState.get('zoomScale') === undefined) {
      doc.transact(() => {
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
    currentTransform.k,
    currentTransform.x,
    currentTransform.y,
  ]); // Added currentTransform dependencies to re-run if it changes from yjs

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
            Australian House of Representatives
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
              <style>{`@keyframes progressAnimation { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }`}</style>
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

export default AusPol;
