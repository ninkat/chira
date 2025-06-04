import React, { useContext, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsContext } from '@/context/YjsContext';
import * as d3 from 'd3';
import moviesData from '@/assets/movies/movies2.json';
import { InteractionEvent, InteractionPoint } from '@/types/interactionTypes';
import { GetCurrentTransformFn } from '@/utils/interactionHandlers';

// define shared value types for y.map
type NodeMapValue = string | number | boolean | undefined | string[];
type LinkMapValue = string;

// d3 specific types - extend SimulationNodeDatum with our required properties
interface D3BaseNode extends d3.SimulationNodeDatum {
  id: string;
  type: 'movie' | 'actor' | 'director';
  name: string;
  uuid: string;
}

interface D3MovieNode extends D3BaseNode {
  type: 'movie';
  released?: number;
  tagline?: string;
  genre?: string[];
}

interface D3ActorNode extends D3BaseNode {
  type: 'actor';
  born?: number;
}

interface D3DirectorNode extends D3BaseNode {
  type: 'director';
  born?: number;
}

type D3Node = D3MovieNode | D3ActorNode | D3DirectorNode;

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  type: 'acts_in' | 'directed';
}

// constants for link styling
const DEFAULT_LINK_COLOR = '#aaa';
const DIRECTED_LINK_COLOR = '#777';
const DEFAULT_LINK_OPACITY = 0.5;
const DEFAULT_LINK_STROKE_WIDTH = 3;
const HIGHLIGHTED_LINK_COLOR = '#FFD700';
const HIGHLIGHTED_LINK_OPACITY = 1;
const HIGHLIGHTED_LINK_STROKE_WIDTH = 4;

// tutorial section types
type TutorialSection =
  | 'single-hover'
  | 'coarse-hover'
  | 'click'
  | 'drag'
  | 'pan'
  | 'zoom';

// props interface for the Tutorial component
interface TutorialProps {
  getCurrentTransformRef: React.MutableRefObject<GetCurrentTransformFn | null>;
}

// helper function to get node id from a link's source or target
function getNodeIdFromLinkEnd(node: D3Node | string | number): string {
  if (typeof node === 'object' && node !== null && 'id' in node) {
    return (node as D3Node).id;
  }
  return String(node);
}

// helper function to check if a link is connected to a node
function isLinkConnectedToNode(link: D3Link, nodeId: string): boolean {
  const sourceId = getNodeIdFromLinkEnd(link.source);
  const targetId = getNodeIdFromLinkEnd(link.target);
  return sourceId === nodeId || targetId === nodeId;
}

// helper function to find all links connected to a node (adjacent links only)
function findConnectedLinks(allLinks: D3Link[], nodeId: string): D3Link[] {
  return allLinks.filter((link) => isLinkConnectedToNode(link, nodeId));
}

// helper function to compact/prune the yjs document
function pruneYDoc(doc: Y.Doc) {
  console.log('[Yjs] Running document compaction for tutorial...');
  const beforeSize = Y.encodeStateAsUpdate(doc).byteLength;

  try {
    const tempDoc = new Y.Doc();
    const originalNodes =
      doc.getArray<Y.Map<NodeMapValue>>('tutorialGraphNodes');
    const originalLinks =
      doc.getArray<Y.Map<LinkMapValue>>('tutorialGraphLinks');
    const originalSharedState = doc.getMap<string | boolean | null | number>(
      'tutorialGraphSharedState'
    );

    const tempNodes =
      tempDoc.getArray<Y.Map<NodeMapValue>>('tutorialGraphNodes');
    const tempLinks =
      tempDoc.getArray<Y.Map<LinkMapValue>>('tutorialGraphLinks');
    const tempSharedState = tempDoc.getMap<string | boolean | null | number>(
      'tutorialGraphSharedState'
    );

    tempDoc.transact(() => {
      for (let i = 0; i < originalNodes.length; i++) {
        const originalNode = originalNodes.get(i);
        const newNode = new Y.Map<NodeMapValue>();
        originalNode.forEach((value: NodeMapValue, key: string) => {
          newNode.set(key, value);
        });
        tempNodes.push([newNode]);
      }

      for (let i = 0; i < originalLinks.length; i++) {
        const originalLink = originalLinks.get(i);
        const newLink = new Y.Map<LinkMapValue>();
        originalLink.forEach((value: LinkMapValue, key: string) => {
          newLink.set(key, value);
        });
        tempLinks.push([newLink]);
      }

      originalSharedState.forEach(
        (value: string | boolean | null | number, key: string) => {
          tempSharedState.set(key, value);
        }
      );
    });

    const cleanSnapshot = Y.encodeStateAsUpdate(tempDoc);

    doc.transact(() => {
      while (originalNodes.length > 0) originalNodes.delete(0);
      while (originalLinks.length > 0) originalLinks.delete(0);
      originalSharedState.forEach(
        (_: string | boolean | null | number, key: string) =>
          originalSharedState.delete(key)
      );
    });

    Y.applyUpdate(doc, cleanSnapshot);

    const afterSize = Y.encodeStateAsUpdate(doc).byteLength;
    const reduction = Math.max(
      0,
      Math.round((1 - afterSize / beforeSize) * 100)
    );
    console.log(
      `[Yjs] Tutorial Compaction complete: ${beforeSize.toLocaleString()} bytes → ${afterSize.toLocaleString()} bytes (${reduction}% reduction)`
    );

    tempDoc.destroy();
  } catch (err) {
    console.error('[Yjs] Tutorial Compaction failed:', err);
  }
}

const Tutorial: React.FC<TutorialProps> = ({ getCurrentTransformRef }) => {
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;
  const d3Container = useRef<HTMLDivElement | null>(null);

  // setup yjs shared arrays
  const yNodes = doc!.getArray<Y.Map<NodeMapValue>>('tutorialGraphNodes');
  const yLinks = doc!.getArray<Y.Map<LinkMapValue>>('tutorialGraphLinks');
  const ySharedState = doc!.getMap<string | boolean | null | string[] | number>(
    'tutorialGraphSharedState'
  );
  const yClientClickSelections = doc!.getMap<string[]>(
    'clientClickTutorialSelections'
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

  // tutorial section state
  const [currentTutorialSection, setCurrentTutorialSection] =
    useState<TutorialSection>('single-hover');
  const [isManualMode, setIsManualMode] = useState<boolean>(false);

  const fixedWidth = 1280;
  const fixedHeight = 720;
  const tutorialPanelWidth = fixedWidth * 0.25;

  // set up the getCurrentTransform function for interaction handlers
  useEffect(() => {
    getCurrentTransformRef.current = () => ({
      scale: transformRef.current.k,
      x: transformRef.current.x,
      y: transformRef.current.y,
    });

    return () => {
      getCurrentTransformRef.current = null;
    };
  }, [getCurrentTransformRef]);

  // tutorial section cycling - alternates between 6 sections every X seconds (only when not in manual mode)
  useEffect(() => {
    if (isManualMode || !syncStatus) return; // don't cycle if in manual mode or not synced yet

    const tutorialSections: TutorialSection[] = [
      'single-hover',
      'coarse-hover',
      'click',
      'drag',
      'pan',
      'zoom',
    ];

    let currentIndex = 0;
    const interval = setInterval(() => {
      currentIndex = (currentIndex + 1) % tutorialSections.length;
      setCurrentTutorialSection(tutorialSections[currentIndex]);
    }, 5000); // should be 5 seconds, but is 2 seconds for testing

    return () => clearInterval(interval);
  }, [isManualMode, syncStatus]); // added syncStatus as dependency

  // track sync status
  useEffect(() => {
    if (!doc) return;
    const timeout = setTimeout(() => {
      console.log('assuming sync after timeout for tutorial visualization');
      setSyncStatus(true);
    }, 2000);
    return () => clearTimeout(timeout);
  }, [doc]);

  // ensure initial tutorial section content is rendered when sync becomes available
  useEffect(() => {
    if (syncStatus && !isManualMode) {
      // trigger a re-render of the initial tutorial section content
      setCurrentTutorialSection('single-hover');
    }
  }, [syncStatus]); // only run when syncStatus changes

  // performance monitoring intervals and compaction
  useEffect(() => {
    if (!doc || !syncStatus) return;

    const yjsMonitor = setInterval(() => {
      const byteLength = Y.encodeStateAsUpdate(doc).byteLength;
      console.log(`[Yjs Tutorial] Document size: ${byteLength} bytes`);
    }, 60000);

    const domMonitor = setInterval(() => {
      const nodeCount = document.querySelectorAll('g.node').length;
      console.log(`[DOM Tutorial] ${nodeCount} nodes in DOM`);
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

  // initialize graph data from json if yNodes is empty after sync
  useEffect(() => {
    if (!syncStatus || yNodes.length > 0) {
      return;
    }

    console.log('initializing tutorial graph data from json');

    const initialNodes: Y.Map<NodeMapValue>[] = [];
    const initialLinks: Y.Map<LinkMapValue>[] = [];
    const nodeIds = new Set<string>();

    const defaultX = fixedWidth / 2;
    const defaultY = fixedHeight / 2;

    // process movies
    moviesData.movies.forEach((movie) => {
      if (nodeIds.has(movie.id)) return;
      const yNode = new Y.Map<NodeMapValue>();
      yNode.set('id', movie.id);
      yNode.set('name', movie.title);
      yNode.set('type', 'movie');
      yNode.set('released', movie.released);
      yNode.set('tagline', movie.tagline);
      yNode.set('genre', movie.genre as string[]);
      yNode.set('x', defaultX);
      yNode.set('y', defaultY);
      yNode.set('uuid', crypto.randomUUID());
      initialNodes.push(yNode);
      nodeIds.add(movie.id);
    });

    // process actors
    moviesData.actors.forEach((actor) => {
      if (nodeIds.has(actor.id)) return;
      const yNode = new Y.Map<NodeMapValue>();
      yNode.set('id', actor.id);
      yNode.set('name', actor.name);
      yNode.set('type', 'actor');
      yNode.set('born', actor.born);
      yNode.set('x', defaultX);
      yNode.set('y', defaultY);
      yNode.set('uuid', crypto.randomUUID());
      initialNodes.push(yNode);
      nodeIds.add(actor.id);
    });

    // process directors
    moviesData.directors.forEach((director) => {
      if (nodeIds.has(director.id)) return;
      const yNode = new Y.Map<NodeMapValue>();
      yNode.set('id', director.id);
      yNode.set('name', director.name);
      yNode.set('type', 'director');
      if (director.born !== undefined) {
        yNode.set('born', director.born);
      }
      yNode.set('x', defaultX);
      yNode.set('y', defaultY);
      yNode.set('uuid', crypto.randomUUID());
      initialNodes.push(yNode);
      nodeIds.add(director.id);
    });

    // process links
    moviesData.actors.forEach((actor) => {
      actor.roles.forEach((role) => {
        const yLink = new Y.Map<LinkMapValue>();
        yLink.set('source', actor.id);
        yLink.set('target', role.movie_id);
        yLink.set('type', 'acts_in');
        initialLinks.push(yLink);
      });
    });

    moviesData.directors.forEach((director) => {
      director.movies.forEach((movieId) => {
        const yLink = new Y.Map<LinkMapValue>();
        yLink.set('source', director.id);
        yLink.set('target', movieId);
        yLink.set('type', 'directed');
        initialLinks.push(yLink);
      });
    });

    doc!.transact(() => {
      yNodes.push(initialNodes);
      yLinks.push(initialLinks);
    });
  }, [syncStatus, doc, yNodes, yLinks]);

  // separate effect to update tutorial content when section changes
  useEffect(() => {
    if (!syncStatus || !d3Container.current) return;

    // find the tutorial panel and update its content
    const svg = d3.select(d3Container.current).select('svg');
    const tutorialPanel = svg.select('.tutorial-panel');

    if (!tutorialPanel.empty()) {
      const titles = {
        'single-hover': 'Single Hover',
        'coarse-hover': 'Coarse Hover',
        click: 'Click',
        drag: 'Drag',
        pan: 'Pan',
        zoom: 'Zoom',
      };

      const subtitles = {
        'single-hover':
          "Make the 'one' gesture to hover over individual elements with your index finger.",
        'coarse-hover':
          "Make the 'grabbing' gesture to hover over elements enclosed in a circle.",
        click:
          "Clicking can be done by forming a 'thumb index' gesture, followed by a 'one' gesture.",
        drag: "Make and maintain an 'ok' gesture (seen left) to drag an element. To release, make a 'grip' (seen right) gesture.",
        pan: 'Make a fist with one hand to pan across the visualization.',
        zoom: 'Make a fist with both hands to zoom on a specific point of the visualization.',
      };

      // function to wrap text with proper line breaks
      const wrapText = (text: string, charLimit: number): string[] => {
        const words = text.split(/\s+/);
        const lines: string[] = [];
        let line = '';

        for (const word of words) {
          const testLine = line + (line ? ' ' : '') + word;
          if (testLine.length > charLimit) {
            if (line) {
              lines.push(line);
              line = word;
            } else {
              // if single word is longer than limit, just add it
              lines.push(word);
            }
          } else {
            line = testLine;
          }
        }

        if (line) {
          lines.push(line);
        }

        return lines;
      };

      // helper function to render subtitle with wrapping
      const renderSubtitle = (text: string, startY: number): number => {
        const wrappedLines = wrapText(text, 30); // character limit for tutorial panel width
        const lineHeight = 28;

        // clear any existing subtitle elements
        tutorialPanel.selectAll('.tutorial-subtitle-line').remove();

        wrappedLines.forEach((line, index) => {
          tutorialPanel
            .select('.tutorial-content')
            .append('text')
            .attr('class', 'tutorial-subtitle-line')
            .attr('x', 0) // align with title
            .attr('y', startY + index * lineHeight)
            .attr('font-size', '20px') // increased to 20px
            .attr('fill', '#e0e7ff')
            .attr('font-weight', '500')
            .text(line);
        });

        return startY + wrappedLines.length * lineHeight + 15; // extra spacing after subtitle
      };

      tutorialPanel
        .select('.tutorial-title')
        .text(titles[currentTutorialSection]);

      // render the subtitle with wrapping
      renderSubtitle(subtitles[currentTutorialSection], 50); // start at y=50

      // clear all instruction lines and images first
      const instructionLineClasses = [
        'instruction-1',
        'instruction-2',
        'instruction-3',
        'instruction-4',
        'instruction-5',
        'instruction-6',
      ];

      instructionLineClasses.forEach((cls) => {
        tutorialPanel.select(`.${cls}`).text('');
      });

      // remove any existing tutorial images and arrows
      tutorialPanel.selectAll('.tutorial-image').remove();
      tutorialPanel.selectAll('.tutorial-arrow').remove();

      // add content specific to the current tutorial section
      if (currentTutorialSection === 'single-hover') {
        // standardized gesture image dimensions - all svgs are 667x667
        const gestureImageSize = 200; // increased size for single gestures
        const gestureStartY = 180; // moved lower from 140

        // center the single gesture in the panel (panel content width ~280px)
        const centerX = (tutorialPanelWidth - 40 - gestureImageSize) / 2; // account for padding

        // add the one.svg image
        tutorialPanel
          .append('image')
          .attr('class', 'tutorial-image')
          .attr('x', 20 + centerX)
          .attr('y', gestureStartY)
          .attr('width', gestureImageSize)
          .attr('height', gestureImageSize)
          .attr('href', '/src/assets/tutorial/one.svg');
      } else if (currentTutorialSection === 'coarse-hover') {
        // standardized gesture image dimensions for dual gestures
        const gestureImageSize = 150; // increased size for dual display
        const gestureStartY = 180; // moved lower from 140
        const spacing = 20; // space between the two gestures

        // center the dual gesture group in the panel
        const totalWidth = gestureImageSize * 2 + spacing;
        const startX = (tutorialPanelWidth - 40 - totalWidth) / 2; // account for padding

        // add the grabbing.svg image (left side)
        tutorialPanel
          .append('image')
          .attr('class', 'tutorial-image')
          .attr('x', 20 + startX)
          .attr('y', gestureStartY)
          .attr('width', gestureImageSize)
          .attr('height', gestureImageSize)
          .attr('href', '/src/assets/tutorial/grabbing.svg');

        // add the palm.svg image (right side)
        tutorialPanel
          .append('image')
          .attr('class', 'tutorial-image')
          .attr('x', 20 + startX + gestureImageSize + spacing)
          .attr('y', gestureStartY)
          .attr('width', gestureImageSize)
          .attr('height', gestureImageSize)
          .attr('href', '/src/assets/tutorial/palm.svg');
      } else if (currentTutorialSection === 'click') {
        // standardized gesture image dimensions for sequence
        const gestureImageSize = 140; // smaller size for 3-image sequence
        const gestureStartY = 180; // moved lower from 140
        const arrowGap = -15; // gap between image and arrow
        const arrowWidth = 15; // width of arrow

        // center the three gesture sequence group in the panel
        const totalWidth = gestureImageSize * 3 + arrowWidth * 2 + arrowGap * 4;
        const startX = (tutorialPanelWidth - 40 - totalWidth) / 2; // account for padding

        // first image: one.svg
        tutorialPanel
          .append('image')
          .attr('class', 'tutorial-image')
          .attr('x', 20 + startX)
          .attr('y', gestureStartY)
          .attr('width', gestureImageSize)
          .attr('height', gestureImageSize)
          .attr('href', '/src/assets/tutorial/one.svg');

        // first arrow: triangle pointing right
        const firstArrowX = 20 + startX + gestureImageSize + arrowGap;
        const arrowY = gestureStartY + gestureImageSize / 2;
        tutorialPanel
          .append('polygon')
          .attr('class', 'tutorial-arrow')
          .attr(
            'points',
            `${firstArrowX},${arrowY - 8} ${firstArrowX + arrowWidth},${arrowY} ${firstArrowX},${arrowY + 8}`
          )
          .attr('fill', '#ffffff');

        // second image: thumb_index.svg
        const secondImageX = firstArrowX + arrowWidth + arrowGap;
        tutorialPanel
          .append('image')
          .attr('class', 'tutorial-image')
          .attr('x', secondImageX)
          .attr('y', gestureStartY)
          .attr('width', gestureImageSize)
          .attr('height', gestureImageSize)
          .attr('href', '/src/assets/tutorial/thumb_index.svg');

        // second arrow: triangle pointing right
        const secondArrowX = secondImageX + gestureImageSize + arrowGap;
        tutorialPanel
          .append('polygon')
          .attr('class', 'tutorial-arrow')
          .attr(
            'points',
            `${secondArrowX},${arrowY - 8} ${secondArrowX + arrowWidth},${arrowY} ${secondArrowX},${arrowY + 8}`
          )
          .attr('fill', '#ffffff');

        // third image: one.svg
        const thirdImageX = secondArrowX + arrowWidth + arrowGap;
        tutorialPanel
          .append('image')
          .attr('class', 'tutorial-image')
          .attr('x', thirdImageX)
          .attr('y', gestureStartY)
          .attr('width', gestureImageSize)
          .attr('height', gestureImageSize)
          .attr('href', '/src/assets/tutorial/one.svg');
      } else if (currentTutorialSection === 'drag') {
        // standardized gesture image dimensions for dual sequence
        const gestureImageSize = 150; // increased size for 2-image sequence
        const gestureStartY = 180; // moved lower from 140
        const arrowGap = 15; // gap between image and arrow
        const arrowWidth = 15; // width of arrow

        // center the dual gesture sequence group in the panel
        const totalWidth = gestureImageSize * 2 + arrowWidth + arrowGap * 2;
        const startX = (tutorialPanelWidth - 40 - totalWidth) / 2; // account for padding

        // first image: ok.svg
        tutorialPanel
          .append('image')
          .attr('class', 'tutorial-image')
          .attr('x', 20 + startX)
          .attr('y', gestureStartY)
          .attr('width', gestureImageSize)
          .attr('height', gestureImageSize)
          .attr('href', '/src/assets/tutorial/ok.svg');

        // arrow: triangle pointing right
        const firstArrowX = 20 + startX + gestureImageSize + arrowGap;
        const arrowY = gestureStartY + gestureImageSize / 2;
        tutorialPanel
          .append('polygon')
          .attr('class', 'tutorial-arrow')
          .attr(
            'points',
            `${firstArrowX},${arrowY - 8} ${firstArrowX + arrowWidth},${arrowY} ${firstArrowX},${arrowY + 8}`
          )
          .attr('fill', '#ffffff');

        // second image: grip.svg
        const secondImageX = firstArrowX + arrowWidth + arrowGap;
        tutorialPanel
          .append('image')
          .attr('class', 'tutorial-image')
          .attr('x', secondImageX)
          .attr('y', gestureStartY)
          .attr('width', gestureImageSize)
          .attr('height', gestureImageSize)
          .attr('href', '/src/assets/tutorial/grip.svg');
      } else if (currentTutorialSection === 'pan') {
        // standardized gesture image dimensions for single gesture
        const gestureImageSize = 200; // increased size for single gestures
        const gestureStartY = 180; // moved lower from 140

        // center the single gesture in the panel
        const centerX = (tutorialPanelWidth - 40 - gestureImageSize) / 2; // account for padding

        // fist image: fist.svg
        tutorialPanel
          .append('image')
          .attr('class', 'tutorial-image')
          .attr('x', 20 + centerX)
          .attr('y', gestureStartY)
          .attr('width', gestureImageSize)
          .attr('height', gestureImageSize)
          .attr('href', '/src/assets/tutorial/fist.svg');
      } else if (currentTutorialSection === 'zoom') {
        // standardized gesture image dimensions for dual gestures
        const gestureImageSize = 150; // increased size for dual display
        const gestureStartY = 180; // moved lower from 140
        const spacing = 30; // space between the two fists

        // center the dual gesture group in the panel
        const totalWidth = gestureImageSize * 2 + spacing;
        const startX = (tutorialPanelWidth - 40 - totalWidth) / 2; // account for padding

        // left fist image: fist.svg mirrored
        tutorialPanel
          .append('image')
          .attr('class', 'tutorial-image')
          .attr('x', 20 + startX)
          .attr('y', gestureStartY)
          .attr('width', gestureImageSize)
          .attr('height', gestureImageSize)
          .attr('href', '/src/assets/tutorial/fist.svg')
          .attr(
            'transform',
            `scale(-1, 1) translate(${-2 * (20 + startX + gestureImageSize / 2)}, 0)`
          ); // mirror horizontally

        // right fist image: fist.svg normal
        tutorialPanel
          .append('image')
          .attr('class', 'tutorial-image')
          .attr('x', 20 + startX + gestureImageSize + spacing)
          .attr('y', gestureStartY)
          .attr('width', gestureImageSize)
          .attr('height', gestureImageSize)
          .attr('href', '/src/assets/tutorial/fist.svg');
      } else {
        // placeholder instructions for other sections - these will be filled in later
        tutorialPanel.select('.instruction-1').text('instruction line 1...');
        tutorialPanel.select('.instruction-2').text('instruction line 2...');
        tutorialPanel.select('.instruction-3').text('instruction line 3...');
      }

      // update navigation button styles to show active section
      if (!tutorialPanel.empty()) {
        // reset all button styles
        tutorialPanel
          .selectAll('.nav-button rect')
          .attr('fill', '#374151')
          .attr('stroke', '#4b5563');

        tutorialPanel.selectAll('.nav-button text').attr('fill', '#e5e7eb');

        // highlight current section button
        tutorialPanel
          .select(`.nav-button-${currentTutorialSection} rect`)
          .attr('fill', '#1d4ed8')
          .attr('stroke', '#1e40af');

        tutorialPanel
          .select(`.nav-button-${currentTutorialSection} text`)
          .attr('fill', '#ffffff');

        // highlight auto-cycle button if in auto mode
        if (!isManualMode) {
          tutorialPanel
            .select('.nav-button-auto rect')
            .attr('fill', '#047857')
            .attr('stroke', '#065f46');
        } else {
          tutorialPanel
            .select('.nav-button-auto rect')
            .attr('fill', '#6b7280')
            .attr('stroke', '#4b5563');

          tutorialPanel.select('.nav-button-auto text').attr('fill', '#d1d5db');
        }
      }
    }
  }, [currentTutorialSection, syncStatus, isManualMode]);

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

        const root = d3.select('#tutorial-root');
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

    console.log('initializing d3 tutorial visualization');

    d3.select(d3Container.current).selectAll('*').remove();

    const svg = d3
      .select(d3Container.current)
      .append('svg')
      .attr('width', fixedWidth)
      .attr('height', fixedHeight)
      .attr('viewBox', [0, 0, fixedWidth, fixedHeight])
      .attr('style', 'background: transparent; max-width: 100%; height: auto;');

    const initialScale = (ySharedState.get('zoomScale') as number) || 1;
    const initialX = (ySharedState.get('panX') as number) || 0;
    const initialY = (ySharedState.get('panY') as number) || 0;
    transformRef.current = { k: initialScale, x: initialX, y: initialY };

    const root = svg
      .append('g')
      .attr('class', 'root')
      .attr('id', 'tutorial-root')
      .attr(
        'transform',
        `translate(${initialX}, ${initialY}) scale(${initialScale})`
      );

    const linkGroup = root.append('g').attr('class', 'links');
    const nodeGroup = root.append('g').attr('class', 'nodes');

    // handle node dragging
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

    // create tutorial panel with cycling content
    const tutorialPanel = svg
      .append('g')
      .attr('class', 'tutorial-panel')
      .attr('transform', 'translate(0,0)');

    // add gradient for tutorial panel
    const tutorialGradient = svg.append('defs').append('linearGradient');

    tutorialGradient
      .attr('id', 'tutorial-panel-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    tutorialGradient
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#6b7280')
      .attr('stop-opacity', 0.9);

    tutorialGradient
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#4b5563')
      .attr('stop-opacity', 0.9);

    // create panel background with rounded corners only on the right side
    const cornerRadius = 12;
    const panelPath = `M 0,0 L ${tutorialPanelWidth - cornerRadius},0 Q ${tutorialPanelWidth},0 ${tutorialPanelWidth},${cornerRadius} L ${tutorialPanelWidth},${fixedHeight - cornerRadius} Q ${tutorialPanelWidth},${fixedHeight} ${tutorialPanelWidth - cornerRadius},${fixedHeight} L 0,${fixedHeight} Z`;

    tutorialPanel
      .append('path')
      .attr('d', panelPath)
      .attr('fill', 'url(#tutorial-panel-gradient)');

    // tutorial panel content container
    const tutorialContent = tutorialPanel
      .append('g')
      .attr('class', 'tutorial-content')
      .attr('transform', `translate(20, 40)`);

    // add title text element
    tutorialContent
      .append('text')
      .attr('class', 'tutorial-title')
      .attr('x', 0)
      .attr('y', 0)
      .attr('font-size', '30px')
      .attr('fill', '#ffffff')
      .attr('font-weight', '800');

    // note: subtitle is now dynamically created with wrapping in the effect

    // instruction text lines
    const instructionLineClasses = [
      'instruction-1',
      'instruction-2',
      'instruction-3',
      'instruction-4',
      'instruction-5',
      'instruction-6',
    ];

    instructionLineClasses.forEach((className, index) => {
      tutorialContent
        .append('text')
        .attr('class', className)
        .attr('x', 0)
        .attr('y', 80 + index * 25)
        .attr('font-size', '14px')
        .attr('fill', '#cbd5e1')
        .attr('font-weight', '300');
    });

    // add navigation buttons container
    const navigationContainer = tutorialContent
      .append('g')
      .attr('class', 'tutorial-navigation')
      .attr('transform', `translate(0, ${fixedHeight - 200})`);

    // define the tutorial sections and button data
    const tutorialSections: TutorialSection[] = [
      'single-hover',
      'coarse-hover',
      'click',
      'drag',
      'pan',
      'zoom',
    ];

    const buttonLabels = {
      'single-hover': 'Single',
      'coarse-hover': 'Coarse',
      click: 'Click',
      drag: 'Drag',
      pan: 'Pan',
      zoom: 'Zoom',
    };

    // create navigation buttons for each section
    const buttonWidth = (tutorialPanelWidth - 60) / 3; // 3 buttons per row
    const buttonHeight = 35;
    const buttonSpacing = 10;

    tutorialSections.forEach((section, index) => {
      const row = Math.floor(index / 3);
      const col = index % 3;
      const x = col * (buttonWidth + buttonSpacing);
      const y = row * (buttonHeight + buttonSpacing);

      const buttonGroup = navigationContainer
        .append('g')
        .attr('class', `nav-button nav-button-${section}`)
        .attr('transform', `translate(${x}, ${y})`)
        .style('cursor', 'pointer');

      // button background
      buttonGroup
        .append('rect')
        .attr('width', buttonWidth)
        .attr('height', buttonHeight)
        .attr('rx', 6)
        .attr('ry', 6)
        .attr('fill', '#374151')
        .attr('stroke', '#4b5563')
        .attr('stroke-width', 1);

      // button text
      buttonGroup
        .append('text')
        .attr('x', buttonWidth / 2)
        .attr('y', buttonHeight / 2 + 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', '12px')
        .attr('fill', '#e5e7eb')
        .attr('font-weight', '500')
        .text(buttonLabels[section]);

      // click handler for section buttons
      buttonGroup.on('click', () => {
        setIsManualMode(true);
        setCurrentTutorialSection(section);
      });
    });

    // add auto-cycle button on the third row
    const autoCycleY = 2 * (buttonHeight + buttonSpacing);
    const autoCycleButtonGroup = navigationContainer
      .append('g')
      .attr('class', 'nav-button nav-button-auto')
      .attr('transform', `translate(0, ${autoCycleY})`)
      .style('cursor', 'pointer');

    // auto-cycle button background (wider to span full width)
    autoCycleButtonGroup
      .append('rect')
      .attr('width', buttonWidth * 3 + 20)
      .attr('x', 0)
      .attr('height', buttonHeight)
      .attr('rx', 6)
      .attr('ry', 6)
      .attr('fill', '#059669')
      .attr('stroke', '#047857')
      .attr('stroke-width', 1);

    // auto-cycle button text
    autoCycleButtonGroup
      .append('text')
      .attr('x', (buttonWidth * 3 + 20) / 2)
      .attr('y', buttonHeight / 2 + 4)
      .attr('text-anchor', 'middle')
      .attr('font-size', '12px')
      .attr('fill', '#ffffff')
      .attr('font-weight', '600')
      .text('Auto Cycle');

    // click handler for auto-cycle button
    autoCycleButtonGroup.on('click', () => {
      setIsManualMode(false);
    });

    linkGroup.attr('transform', `translate(${tutorialPanelWidth}, 0)`);
    nodeGroup.attr('transform', `translate(${tutorialPanelWidth}, 0)`);

    // custom event handler for gesture interactions
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
            (element.tagName === 'circle' ||
              element.tagName === 'rect' ||
              element.tagName === 'ellipse') &&
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
            (element.tagName === 'circle' ||
              element.tagName === 'rect' ||
              element.tagName === 'ellipse') &&
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

    // add event listener for custom interaction events
    const parent = d3Container.current?.parentElement;
    if (parent) {
      parent.addEventListener('interaction', ((
        e: CustomEvent<InteractionEvent>
      ) => handleInteraction(e.detail)) as EventListener);
    }

    // create arrow marker for directed links
    svg
      .append('defs')
      .append('marker')
      .attr('id', 'tutorial-arrowhead')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 40)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#777');

    // define a drop shadow filter
    const defs = svg.select('defs');

    // add arrow marker for tutorial sequences
    defs
      .append('marker')
      .attr('id', 'tutorial-arrow-marker')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 10)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 8)
      .attr('markerHeight', 8)
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#ffffff');

    const filter = defs
      .append('filter')
      .attr('id', 'tutorial-drop-shadow')
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

    // helper function to convert node maps to d3 nodes
    const mapNodesToD3 = (): D3Node[] => {
      const nodes: D3Node[] = [];
      for (let i = 0; i < yNodes.length; i++) {
        const node = yNodes.get(i);
        const id = node.get('id') as string;
        const type = node.get('type') as 'movie' | 'actor' | 'director';
        const name = node.get('name') as string;
        const x = (node.get('x') as number) || fixedWidth / 2;
        const y = (node.get('y') as number) || fixedHeight / 2;
        const uuid = node.get('uuid') as string;

        let d3Node: D3Node;

        if (type === 'movie') {
          d3Node = {
            id,
            type,
            name,
            x,
            y,
            uuid,
            released: node.get('released') as number | undefined,
            tagline: node.get('tagline') as string | undefined,
            genre: node.get('genre') as string[] | undefined,
          };
        } else if (type === 'actor') {
          d3Node = {
            id,
            type,
            name,
            x,
            y,
            uuid,
            born: node.get('born') as number | undefined,
          };
        } else {
          d3Node = {
            id,
            type,
            name,
            x,
            y,
            uuid,
            born: node.get('born') as number | undefined,
          };
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
        const type = link.get('type') as 'acts_in' | 'directed';

        const source = nodeMap.get(sourceId) || sourceId;
        const target = nodeMap.get(targetId) || targetId;

        links.push({ source, target, type });
      }
      return links;
    };

    // function to update the visualization
    const updateVisualization = () => {
      const nodes = mapNodesToD3();
      const nodeMap = new Map<string, D3Node>();
      nodes.forEach((n) => nodeMap.set(n.id, n));
      const links = mapLinksToD3(nodeMap);

      const linkKeyFn = (d: D3Link): string => {
        const source = d.source as D3Node;
        const target = d.target as D3Node;
        return `${source.id}-${target.id}-${d.type}`;
      };

      const link = linkGroup
        .selectAll<SVGLineElement, D3Link>('line')
        .data(links, linkKeyFn);

      link.exit().remove();

      const linkEnter = link.enter().append('line');
      const linkMerge = linkEnter.merge(link);

      // apply dynamic positions
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

      // node handling
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

      // movie nodes (circles)
      nodeEnter
        .filter((d): d is D3MovieNode => d.type === 'movie')
        .append('circle')
        .attr('r', 35)
        .attr('fill', '#FFC0CB')
        .attr('fill-opacity', 0.7)
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 5)
        .attr('class', 'node-shape')
        .style('filter', 'url(#tutorial-drop-shadow)');

      // actor nodes (circles)
      nodeEnter
        .filter((d): d is D3ActorNode => d.type === 'actor')
        .append('circle')
        .attr('r', 35)
        .attr('fill', '#FFA500')
        .attr('fill-opacity', 0.7)
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 5)
        .attr('class', 'node-shape')
        .style('filter', 'url(#tutorial-drop-shadow)');

      // director nodes (circles)
      nodeEnter
        .filter((d): d is D3DirectorNode => d.type === 'director')
        .append('circle')
        .attr('r', 35)
        .attr('fill', '#ADD8E6')
        .attr('fill-opacity', 0.7)
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 5)
        .attr('class', 'node-shape')
        .style('filter', 'url(#tutorial-drop-shadow)');

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

      // link highlighting logic - adjacent links for both hovered and selected nodes
      let linksToHighlight: D3Link[] = [];
      const allHighlightedNodeIds = [
        ...new Set([...hoveredIds, ...allClickSelectedIds]),
      ];

      allHighlightedNodeIds.forEach((nodeId) => {
        const connectedLinks = findConnectedLinks(links, nodeId);
        linksToHighlight.push(...connectedLinks);
      });

      // remove duplicates
      linksToHighlight = [...new Set(linksToHighlight)];

      // apply link styles without arrows
      linkMerge
        .attr('stroke', (d) =>
          linksToHighlight.includes(d)
            ? HIGHLIGHTED_LINK_COLOR
            : d.type === 'directed'
              ? DIRECTED_LINK_COLOR
              : DEFAULT_LINK_COLOR
        )
        .attr('stroke-opacity', (d) =>
          linksToHighlight.includes(d)
            ? HIGHLIGHTED_LINK_OPACITY
            : DEFAULT_LINK_OPACITY
        )
        .attr('stroke-width', (d) =>
          linksToHighlight.includes(d)
            ? HIGHLIGHTED_LINK_STROKE_WIDTH
            : DEFAULT_LINK_STROKE_WIDTH
        );

      const allHighlightedIds = [
        ...new Set([...hoveredIds, ...allClickSelectedIds]),
      ];

      nodeMerge
        .select('.node-shape')
        .attr('stroke', '#1A202C')
        .attr('stroke-width', 1.5);

      if (allHighlightedIds.length > 0) {
        if (hoveredIds.length > 0) {
          nodeMerge
            .filter((d: D3Node) => hoveredIds.includes(d.id))
            .select('.node-shape')
            .attr('stroke', '#ECC94B')
            .attr('stroke-width', 2.5);
        }

        if (allClickSelectedIds.length > 0) {
          nodeMerge
            .filter((d: D3Node) => allClickSelectedIds.includes(d.id))
            .select('.node-shape')
            .attr('stroke', '#63B3ED')
            .attr('stroke-width', 2.5);
        }
      }

      const needsInitialLayout = nodes.some(
        (node) => node.x === fixedWidth / 2 && node.y === fixedHeight / 2
      );

      if (needsInitialLayout) {
        initializeLayout(nodes);
      }
    };

    // function to initialize layout
    const initializeLayout = (nodes: D3Node[]) => {
      console.log('initializing tutorial layout with force simulation');

      const nodeMapForLinks = new Map<string, D3Node>();
      nodes.forEach((n) => nodeMapForLinks.set(n.id, n));
      const links = mapLinksToD3(nodeMapForLinks);

      const availableWidth = fixedWidth - tutorialPanelWidth;

      const simulation = d3
        .forceSimulation<D3Node>(nodes)
        .force(
          'link',
          d3
            .forceLink<D3Node, D3Link>(links)
            .id((d) => d.id)
            .distance(80)
            .strength(0.1)
        )
        .force('charge', d3.forceManyBody().strength(-600))
        .force('center', d3.forceCenter(tutorialPanelWidth, fixedHeight / 2))
        .force(
          'x',
          d3.forceX(tutorialPanelWidth + availableWidth * 0.35).strength(0.03)
        )
        .force('y', d3.forceY(fixedHeight / 2).strength(0.1))
        .force('collision', d3.forceCollide<D3Node>().radius(55))
        .stop();

      console.log(
        'running tutorial simulation for 200 ticks for initial layout'
      );
      simulation.tick(200);

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

    const observer = () => {
      updateVisualization();
    };

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
    currentTutorialSection,
    isManualMode,
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
            Tutorial Visualization
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

export default Tutorial;
