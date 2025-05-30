import React, { useEffect, useRef, useContext, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import {
  Topology as TopoTopology,
  GeometryCollection,
} from 'topojson-specification';
import {
  InteractionEvent,
  // InteractionEventHandler, // unused, remove
} from '@/types/interactionTypes';
// import * as Y from 'yjs'; // removing to check if unused
import { YjsContext } from '@/context/YjsContext';
import { GetCurrentTransformFn } from '@/utils/interactionHandlers';

// define a non-null version of geojsonproperties for extension
type definedgeojsonproperties = Exclude<GeoJsonProperties, null>;

interface CountryProperties extends definedgeojsonproperties {
  name: string;
}

interface WorldTopology extends TopoTopology {
  objects: {
    countries: GeometryCollection<CountryProperties>;
  };
}

// define airport data structure
interface Airport {
  IATA: string;
  'Airport Name': string;
  City: string;
  Latitude: number;
  Longitude: number;
}

// define flight data structure
interface Flight {
  id: number;
  origin: string;
  destination: string;
  price: number;
  duration: number; // assuming duration is in hours
  date: string; // date string format 'yyyy-mm-dd'
  airline: {
    code: string;
    name: string;
    continent: string;
  };
}

// yjs shared value types
type WorldMapStateValue = string | number | boolean | null; // arrays will be y.array, not directly in map value for this type

// props interface for the WorldMap component
interface WorldMapProps {
  getCurrentTransformRef: React.MutableRefObject<GetCurrentTransformFn | null>;
}

// constants for styling
const totalWidth = 1280;
const totalHeight = 720;
const defaultFill = 'rgba(170, 170, 170, 0.6)';
const strokeColor = '#fff';
const defaultStrokeWidth = 0.5;
const mapWidth = totalWidth * (3 / 4);

// constants for airport stylings
const airportRadius = 25;
const airportFill = '#1E90FF';
const airportStroke = '#ffffff';
const airportStrokeWidth = 1.5;
const airportHighlightStroke = '#FFD580';
const airportHighlightStrokeWidth = 4;
const airportSelectedStrokeWidth = 4;
const airportSelectedLeftStroke = '#FFB6C1';
const airportSelectedRightStroke = '#ADD8E6';

// constants for line styling
const lineColor = 'rgba(116, 100, 139, 0.9)';
const lineWidth = 4;
const pinnedFlightColor = '#32CD32'; // bright green for pinned flights

// constants for panel styling
const panelWidth = totalWidth / 4;
const panelBackground = 'rgba(33, 33, 33, 0.2)';
const panelTextColor = 'white';

const WorldMap: React.FC<WorldMapProps> = ({ getCurrentTransformRef }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement | null>(null); // main group for d3 transformations
  const panelSvgRef = useRef<SVGSVGElement>(null); // ref for the info panel svg
  const animationFrameRef = useRef<number | null>(null);
  const activeLinesByPair = useRef<Map<string, SVGPathElement>>(new Map());

  // get doc from yjs context
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;

  // yjs shared state maps and arrays
  const yWorldMapState = doc?.getMap<WorldMapStateValue>('worldMapGlobalState');
  const yHoveredAirportIATAsLeft = doc?.getArray<string>(
    'worldMapHoveredIATAsLeft'
  );
  const yHoveredAirportIATAsRight = doc?.getArray<string>(
    'worldMapHoveredIATAsRight'
  );
  const ySelectedAirportIATAsLeft = doc?.getArray<string>(
    'worldMapSelectedIATAsLeft'
  );
  const ySelectedAirportIATAsRight = doc?.getArray<string>(
    'worldMapSelectedIATAsRight'
  );
  const yPanelState = doc?.getMap<WorldMapStateValue>('worldMapPanelState'); // panel svg state
  const yHoveredFlights = doc?.getArray<number>('worldMapHoveredFlights'); // track hovered flight ids globally
  const ySelectedFlights = doc?.getArray<number>('worldMapSelectedFlights'); // track pinned/selected flight ids (global)

  // ref to track current transform from yjs or local updates before sync
  const transformRef = useRef<{ k: number; x: number; y: number }>({
    k: 1,
    x: 0,
    y: 0,
  });

  // ref for scroll drag state for flights list
  const scrollDragStateRef = useRef<{
    left: {
      active: boolean;
      startY: number;
      startScrollTop: number;
    };
    right: {
      active: boolean;
      startY: number;
      startScrollTop: number;
    };
  }>({
    left: {
      active: false,
      startY: 0,
      startScrollTop: 0,
    },
    right: {
      active: false,
      startY: 0,
      startScrollTop: 0,
    },
  });

  // state for sync status
  const [syncStatus, setSyncStatus] = useState<boolean>(false);

  // state for flight data (loaded once)
  const allFlights = useRef<Flight[]>([]);
  // all airport data loaded once, used to map iatas to airport objects
  const allAirports = useRef<Airport[]>([]);

  // set up the getCurrentTransform function for interaction handlers
  useEffect(() => {
    getCurrentTransformRef.current = () => ({
      scale: transformRef.current.k,
      x: transformRef.current.x,
      y: transformRef.current.y,
    });

    // cleanup function to clear the ref when component unmounts
    return () => {
      getCurrentTransformRef.current = null;
    };
  }, [getCurrentTransformRef]);

  // track sync status (simple timeout approach)
  useEffect(() => {
    if (!doc) return;
    const timeout = setTimeout(() => {
      setSyncStatus(true);
      console.log('[worldmap] assuming sync after timeout');
    }, 2000);
    return () => clearTimeout(timeout);
  }, [doc]);

  // effect to sync transform state from yjs
  useEffect(() => {
    if (!doc || !syncStatus || !yWorldMapState) return;

    const updateLocalTransform = () => {
      const scale = (yWorldMapState.get('zoomScale') as number) || 1;
      const x = (yWorldMapState.get('panX') as number) || 0;
      const y = (yWorldMapState.get('panY') as number) || 0;

      if (
        scale !== transformRef.current.k ||
        x !== transformRef.current.x ||
        y !== transformRef.current.y
      ) {
        transformRef.current = { k: scale, x, y };
        if (gRef.current) {
          d3.select(gRef.current).attr(
            'transform',
            `translate(${x},${y}) scale(${scale})`
          );
          // also re-apply styles that depend on scale
          adjustStylesForTransform(scale);
        }
      }
    };

    yWorldMapState.observe(updateLocalTransform);
    updateLocalTransform(); // initial sync

    return () => yWorldMapState.unobserve(updateLocalTransform);
  }, [doc, syncStatus, yWorldMapState]);

  // function to get pair key for origin-destination
  const getPairKey = (origin: string, destination: string) =>
    `${origin}->${destination}`;

  // function to find airport data by iata code
  const getAirportByIATA = (iata: string): Airport | undefined => {
    return allAirports.current.find((ap) => ap.IATA === iata);
  };

  // function to adjust styles based on transform (e.g., stroke widths)
  const adjustStylesForTransform = (scale: number) => {
    if (
      !gRef.current ||
      !yWorldMapState ||
      !yHoveredAirportIATAsLeft ||
      !yHoveredAirportIATAsRight ||
      !ySelectedAirportIATAsLeft ||
      !ySelectedAirportIATAsRight
    )
      return;
    const svgRoot = d3.select(gRef.current);

    svgRoot
      .selectAll('circle.airport')
      .attr('r', airportRadius / scale)
      .attr('stroke-width', (d, i, nodes) => {
        const element = nodes[i] as SVGCircleElement;
        const airportIATA = (d3.select(element).datum() as Airport).IATA;
        const isSelectedLeft = ySelectedAirportIATAsLeft
          .toArray()
          .includes(airportIATA);
        const isSelectedRight = ySelectedAirportIATAsRight
          .toArray()
          .includes(airportIATA);

        if (isSelectedLeft || isSelectedRight) {
          return airportSelectedStrokeWidth / scale;
        }
        const isHovered =
          yHoveredAirportIATAsLeft.toArray().includes(airportIATA) ||
          yHoveredAirportIATAsRight.toArray().includes(airportIATA);
        if (isHovered) {
          return airportHighlightStrokeWidth / scale;
        }
        return airportStrokeWidth / scale;
      })
      .attr('stroke', (d, i, nodes) => {
        const element = nodes[i] as SVGCircleElement;
        const airportIATA = (d3.select(element).datum() as Airport).IATA;
        const isSelectedLeft = ySelectedAirportIATAsLeft
          .toArray()
          .includes(airportIATA);
        const isSelectedRight = ySelectedAirportIATAsRight
          .toArray()
          .includes(airportIATA);

        if (isSelectedLeft) {
          return airportSelectedLeftStroke;
        }
        if (isSelectedRight) {
          return airportSelectedRightStroke;
        }

        // if not selected by either, then check for hover
        const isHoveredLeft = yHoveredAirportIATAsLeft
          .toArray()
          .includes(airportIATA);
        const isHoveredRight = yHoveredAirportIATAsRight
          .toArray()
          .includes(airportIATA);

        if (isHoveredLeft || isHoveredRight) {
          return airportHighlightStroke;
        }
        return airportStroke;
      })
      .attr('fill', airportFill); // ensure fill is reset/set

    activeLinesByPair.current.forEach((line, pairKey) => {
      d3.select(line).attr('stroke-width', lineWidth / scale);

      // extract origin and destination from pair key (format: "ORIGIN->DESTINATION")
      const [originIATA, destinationIATA] = pairKey.split('->');

      // check if this line corresponds to any selected (pinned) flight
      const selectedFlights = ySelectedFlights?.toArray() || [];
      const selectedFlightData = selectedFlights
        .map((id) => allFlights.current.find((f) => f.id === id))
        .filter(Boolean) as Flight[];

      const isPinned = selectedFlightData.some(
        (flight) =>
          flight.origin === originIATA && flight.destination === destinationIATA
      );

      // check if this line corresponds to any hovered flight
      const hoveredFlights = yHoveredFlights?.toArray() || [];
      const hoveredFlightData = hoveredFlights
        .map((id) => allFlights.current.find((f) => f.id === id))
        .filter(Boolean) as Flight[];

      const isHighlighted = hoveredFlightData.some(
        (flight) =>
          flight.origin === originIATA && flight.destination === destinationIATA
      );

      // use pinned color if pinned, highlight color if highlighted, otherwise default
      const strokeColor = isPinned
        ? pinnedFlightColor
        : isHighlighted
          ? airportHighlightStroke
          : lineColor;
      d3.select(line).attr('stroke', strokeColor);
    });
  };

  // function to draw line between airports by iata codes
  const drawAirportLineByIATAs = (
    originIATA: string,
    destinationIATA: string,
    projection: d3.GeoProjection,
    highlight = false,
    pinned = false
  ) => {
    if (!gRef.current || !projection) return;

    const originAirport = getAirportByIATA(originIATA);
    const destAirport = getAirportByIATA(destinationIATA);

    if (!originAirport || !destAirport) return;

    const pairKey = getPairKey(originIATA, destinationIATA);
    if (activeLinesByPair.current.has(pairKey)) return;

    const originCoords = projection([
      originAirport.Longitude,
      originAirport.Latitude,
    ]);
    const destCoords = projection([
      destAirport.Longitude,
      destAirport.Latitude,
    ]);

    if (!originCoords || !destCoords) return;

    // calculate arc control point for curved flight path
    const midX = (originCoords[0] + destCoords[0]) / 2;
    const midY = (originCoords[1] + destCoords[1]) / 2;

    // calculate distance between points to determine arc height
    const distance = Math.sqrt(
      Math.pow(destCoords[0] - originCoords[0], 2) +
        Math.pow(destCoords[1] - originCoords[1], 2)
    );

    // arc height is proportional to distance (but capped for very long distances)
    const arcHeight = Math.min(distance * 0.2, 100);

    // control point is above the midpoint
    const controlX = midX;
    const controlY = midY - arcHeight;

    // create quadratic curve path
    const pathData = `M ${originCoords[0]} ${originCoords[1]} Q ${controlX} ${controlY} ${destCoords[0]} ${destCoords[1]}`;

    // use pinned color if pinned, highlight color if highlighted, otherwise use default line color
    const strokeColor = pinned
      ? pinnedFlightColor
      : highlight
        ? airportHighlightStroke
        : lineColor;

    const line = d3
      .select(gRef.current)
      .append('path')
      .attr('d', pathData)
      .attr('stroke', strokeColor)
      .attr('stroke-width', lineWidth / transformRef.current.k) // use current transform
      .attr('fill', 'none')
      .style('stroke-linecap', 'round')
      .style('pointer-events', 'none'); // make flight lines uninteractable

    activeLinesByPair.current.set(pairKey, line.node()!);
  };

  // function to clear all lines
  const clearAllLines = () => {
    activeLinesByPair.current.forEach((line) => {
      d3.select(line).remove();
    });
    activeLinesByPair.current.clear();
  };

  // function to redraw all lines based on yjs hovered airport iatas
  const redrawAllLinesFromYjs = (projection: d3.GeoProjection | null) => {
    if (
      !projection ||
      !yHoveredAirportIATAsLeft ||
      !yHoveredAirportIATAsRight ||
      !ySelectedAirportIATAsLeft ||
      !ySelectedAirportIATAsRight
    )
      return;
    clearAllLines();

    // first draw pinned flight lines (always visible in green)
    drawPinnedFlightLines(projection);

    const hoveredLeftIATAs = yHoveredAirportIATAsLeft.toArray();
    const hoveredRightIATAs = yHoveredAirportIATAsRight.toArray();
    const selectedLeftIATAs = ySelectedAirportIATAsLeft.toArray();
    const selectedRightIATAs = ySelectedAirportIATAsRight.toArray();

    // combine selected and hovered for line drawing
    const effectiveLeftIATAs = Array.from(
      new Set([...selectedLeftIATAs, ...hoveredLeftIATAs])
    );
    const effectiveRightIATAs = Array.from(
      new Set([...selectedRightIATAs, ...hoveredRightIATAs])
    );

    // get hovered flights to determine which routes should be highlighted
    const hoveredFlights = yHoveredFlights?.toArray() || [];
    const hoveredFlightData = hoveredFlights
      .map((id) => allFlights.current.find((f) => f.id === id))
      .filter(Boolean) as Flight[];

    effectiveLeftIATAs.forEach((originIATA) => {
      effectiveRightIATAs.forEach((destIATA) => {
        if (originIATA !== destIATA) {
          // prevent self-loops if an airport is somehow in both effective lists

          // check if this route corresponds to any hovered flight
          const isHighlighted = hoveredFlightData.some(
            (flight) =>
              flight.origin === originIATA && flight.destination === destIATA
          );

          drawAirportLineByIATAs(
            originIATA,
            destIATA,
            projection,
            isHighlighted
          );
        }
      });
    });
  };

  // function to update the info panel with hovered/selected airports from yjs
  const updateInfoPanelFromYjs = () => {
    if (
      !yWorldMapState ||
      !yHoveredAirportIATAsLeft ||
      !yHoveredAirportIATAsRight ||
      !ySelectedAirportIATAsLeft ||
      !ySelectedAirportIATAsRight ||
      !panelSvgRef.current ||
      !yPanelState
    )
      return;

    const panelSvg = d3.select(panelSvgRef.current);

    // clear existing content (keep defs)
    panelSvg.selectAll('g.panel-content').remove();

    const contentGroup = panelSvg.append('g').attr('class', 'panel-content');

    const hoveredLeftIATAs = yHoveredAirportIATAsLeft.toArray();
    const hoveredRightIATAs = yHoveredAirportIATAsRight.toArray();
    const selectedLeftIATAs = ySelectedAirportIATAsLeft.toArray();
    const selectedRightIATAs = ySelectedAirportIATAsRight.toArray();

    // display logic: selected items are primary. hovered items are secondary if not selected.
    // for flight filtering, combine selected and hovered items (pins are sticky hovers)
    const leftFilterIATAs = Array.from(
      new Set([...selectedLeftIATAs, ...hoveredLeftIATAs])
    );
    const rightFilterIATAs = Array.from(
      new Set([...selectedRightIATAs, ...hoveredRightIATAs])
    );

    let currentFilteredFlights: Flight[] = [];
    if (leftFilterIATAs.length > 0 && rightFilterIATAs.length > 0) {
      currentFilteredFlights = allFlights.current.filter(
        (flight) =>
          leftFilterIATAs.includes(flight.origin) &&
          rightFilterIATAs.includes(flight.destination)
      );
    } else if (leftFilterIATAs.length > 0) {
      currentFilteredFlights = allFlights.current.filter((flight) =>
        leftFilterIATAs.includes(flight.origin)
      );
    } else if (rightFilterIATAs.length > 0) {
      currentFilteredFlights = allFlights.current.filter((flight) =>
        rightFilterIATAs.includes(flight.destination)
      );
    }

    // svg panel layout constants
    const padding = 6;
    const sectionGap = 12; // consistent spacing between all sections
    // const sectionHeight = (totalHeight - 2 * padding - 2 * sectionGap) / 3; // properly account for gaps between sections // removing the 1/3 rule

    // calculate fixed height for origins/destinations boxes to fit exactly 4 entries
    const titleHeight = 20; // height for "origins"/"destinations" title
    const itemHeight = 35; // height per airport item
    const maxItems = 4; // exactly 4 entries
    const topPadding = 10; // padding above the boxes
    const bottomPadding = 10; // padding below the boxes to match top
    const boxHeight = titleHeight + 25 + maxItems * itemHeight - bottomPadding; // 25px padding after title, reduced by bottom padding for balance

    // section 1: current selections
    const selectionsY = padding;
    const selectionsGroup = contentGroup
      .append('g')
      .attr('class', 'selections-section');

    // origins and destinations boxes
    const boxY = selectionsY + topPadding; // use the defined topPadding constant
    // const boxHeight = sectionHeight - 10; // adjusted for removed title // removing this line since we have fixed height now
    const boxWidth = (panelWidth - 2 * padding - 8) / 2; // wider boxes with smaller gap

    // origins box background
    selectionsGroup
      .append('rect')
      .attr('x', padding)
      .attr('y', boxY)
      .attr('width', boxWidth)
      .attr('height', boxHeight)
      .attr('fill', 'rgba(255, 255, 255, 0.12)')
      .attr('rx', 6)
      .attr('ry', 6);

    // origins title
    selectionsGroup
      .append('text')
      .attr('x', padding + 8)
      .attr('y', boxY + 20)
      .attr('fill', 'rgba(255, 255, 255, 0.95)')
      .attr('font-size', '16px')
      .attr('font-weight', '500')
      .style('font-family', 'system-ui, sans-serif')
      .style('letter-spacing', '0.05em')
      .text('Origins');

    // origins content
    const uniqueLeftDisplayIATAs = Array.from(
      new Set([...selectedLeftIATAs, ...hoveredLeftIATAs])
    );
    const leftAirportsToShow = uniqueLeftDisplayIATAs
      .map(getAirportByIATA)
      .filter(Boolean) as Airport[];

    // show maximum 3 airports, reserve 4th slot for "more" if needed
    const maxAirportsToShow = 3;
    const leftToShow = leftAirportsToShow.slice(0, maxAirportsToShow);
    const leftRemaining = leftAirportsToShow.length - leftToShow.length;

    leftToShow.forEach((airport, index) => {
      const isSelected = selectedLeftIATAs.includes(airport.IATA);
      const itemY = boxY + 45 + index * 35;

      // background for airport item
      selectionsGroup
        .append('rect')
        .attr('x', padding + 4 + (isSelected ? 1 : 0)) // reduced padding from 8 to 4
        .attr('y', itemY - 17 + (isSelected ? 1 : 0)) // adjust for stroke width
        .attr('width', boxWidth - 8 - (isSelected ? 2 : 0)) // increased width from -16 to -8
        .attr('height', 30 - (isSelected ? 2 : 0)) // reduce height for stroke
        .attr('fill', 'rgba(232, 27, 35, 0.3)')
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('stroke', isSelected ? airportSelectedLeftStroke : 'none')
        .attr('stroke-width', isSelected ? 2 : 0);

      selectionsGroup
        .append('text')
        .attr('x', padding + 10) // adjusted text position for new padding
        .attr('y', itemY) // center vertically within container
        .attr('fill', panelTextColor)
        .attr('font-size', '15px') // reduced from 16px to 15px
        .attr('font-weight', '500') // consistent weight, no bold for selected
        .style('font-family', 'system-ui, sans-serif')
        .attr('dominant-baseline', 'middle') // center text vertically
        .text(`${airport.IATA} (${airport.City})`);
    });

    if (leftRemaining > 0) {
      const remainingY = boxY + 45 + leftToShow.length * 35;
      selectionsGroup
        .append('rect')
        .attr('x', padding + 4) // reduced padding from 8 to 4
        .attr('y', remainingY - 17)
        .attr('width', boxWidth - 8) // increased width from -16 to -8
        .attr('height', 30)
        .attr('fill', 'rgba(232, 27, 35, 0.3)')
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('opacity', 0.7);

      selectionsGroup
        .append('text')
        .attr('x', padding + 10) // adjusted text position for new padding
        .attr('y', remainingY) // center vertically within container
        .attr('fill', panelTextColor)
        .attr('font-size', '15px') // reduced from 16px to 15px
        .attr('font-weight', '500') // consistent weight, no bold for selected
        .style('font-family', 'system-ui, sans-serif')
        .attr('dominant-baseline', 'middle') // center text vertically
        .attr('opacity', 0.7)
        .text(`and ${leftRemaining} more...`);
    }

    // destinations box background (side by side with origins)
    const destBoxX = padding + boxWidth + 8; // 8px gap between boxes
    selectionsGroup
      .append('rect')
      .attr('x', destBoxX)
      .attr('y', boxY)
      .attr('width', boxWidth)
      .attr('height', boxHeight)
      .attr('fill', 'rgba(255, 255, 255, 0.15)')
      .attr('rx', 6)
      .attr('ry', 6);

    // destinations title
    selectionsGroup
      .append('text')
      .attr('x', destBoxX + 8)
      .attr('y', boxY + 20)
      .attr('fill', 'rgba(255, 255, 255, 0.95)')
      .attr('font-size', '16px')
      .attr('font-weight', '500')
      .style('font-family', 'system-ui, sans-serif')
      .style('letter-spacing', '0.05em')
      .text('Destinations');

    // destinations content
    const uniqueRightDisplayIATAs = Array.from(
      new Set([...selectedRightIATAs, ...hoveredRightIATAs])
    );
    const rightAirportsToShow = uniqueRightDisplayIATAs
      .map(getAirportByIATA)
      .filter(Boolean) as Airport[];

    // show maximum 3 airports, reserve 4th slot for "more" if needed
    const rightToShow = rightAirportsToShow.slice(0, maxAirportsToShow);
    const rightRemaining = rightAirportsToShow.length - rightToShow.length;

    rightToShow.forEach((airport, index) => {
      const isSelected = selectedRightIATAs.includes(airport.IATA);
      const itemY = boxY + 45 + index * 35;

      // background for airport item
      selectionsGroup
        .append('rect')
        .attr('x', destBoxX + 4 + (isSelected ? 1 : 0)) // reduced padding from 8 to 4
        .attr('y', itemY - 17 + (isSelected ? 1 : 0)) // adjust for stroke width
        .attr('width', boxWidth - 8 - (isSelected ? 2 : 0)) // increased width from -16 to -8
        .attr('height', 30 - (isSelected ? 2 : 0)) // reduce height for stroke
        .attr('fill', 'rgba(0, 174, 243, 0.3)')
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('stroke', isSelected ? airportSelectedRightStroke : 'none')
        .attr('stroke-width', isSelected ? 2 : 0);

      selectionsGroup
        .append('text')
        .attr('x', destBoxX + 10) // adjusted text position for new padding
        .attr('y', itemY) // center vertically within container
        .attr('fill', panelTextColor)
        .attr('font-size', '15px') // reduced from 16px to 15px
        .attr('font-weight', '500') // consistent weight, no bold for selected
        .style('font-family', 'system-ui, sans-serif')
        .attr('dominant-baseline', 'middle') // center text vertically
        .text(`${airport.IATA} (${airport.City})`);
    });

    if (rightRemaining > 0) {
      const remainingY = boxY + 45 + rightToShow.length * 35;
      selectionsGroup
        .append('rect')
        .attr('x', destBoxX + 4)
        .attr('y', remainingY - 17)
        .attr('width', boxWidth - 8)
        .attr('height', 30)
        .attr('fill', 'rgba(0, 174, 243, 0.3)')
        .attr('rx', 4)
        .attr('ry', 4)
        .attr('opacity', 0.7);

      selectionsGroup
        .append('text')
        .attr('x', destBoxX + 10)
        .attr('y', remainingY) // center vertically within container
        .attr('fill', panelTextColor)
        .attr('font-size', '15px') // reduced from 16px to 15px
        .attr('font-weight', '500') // consistent weight, no bold for selected
        .style('font-family', 'system-ui, sans-serif')
        .attr('dominant-baseline', 'middle') // center text vertically
        .attr('opacity', 0.7)
        .text(`and ${rightRemaining} more...`);
    }

    // section 2: available flights
    const flightsY = selectionsY + boxHeight + sectionGap;
    const flightsGroup = contentGroup
      .append('g')
      .attr('class', 'flights-section');

    // calculate space for distributions section (fixed size)
    const distributionsFixedHeight = 10 + 3 * 70; // 10px for content Y offset + space for 3 histograms at 70px each

    // flights content area - use all available space except what's reserved for distributions
    const flightsContentY = flightsY + 10; // reduced from flightsY + 40 since no title
    const flightsContentHeight =
      totalHeight -
      flightsContentY -
      distributionsFixedHeight -
      sectionGap -
      padding; // use all remaining space

    // get current scroll position from yjs or default to 0
    const scrollOffset = (yPanelState.get('flightsScrollY') as number) || 0;

    const displayOriginsSelected =
      selectedLeftIATAs.length > 0 || hoveredLeftIATAs.length > 0;
    const displayDestinationsSelected =
      selectedRightIATAs.length > 0 || hoveredRightIATAs.length > 0;

    if (!displayOriginsSelected || !displayDestinationsSelected) {
      // first line
      flightsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', flightsContentY + flightsContentHeight / 2 - 10)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('Select origins (left) and destinations (right)');

      // second line
      flightsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', flightsContentY + flightsContentHeight / 2 + 10)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('to see available flights.');
    } else if (currentFilteredFlights.length === 0) {
      flightsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', flightsContentY + flightsContentHeight / 2)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('No direct flights found for the current selection.');
    } else {
      // sort flights by price (cheapest first)
      const flightsToShow = currentFilteredFlights.sort(
        (a, b) => a.price - b.price
      );

      // create clipping path for flights list
      const clipId = 'flights-clip';
      panelSvg
        .select('defs')
        .append('clipPath')
        .attr('id', clipId)
        .append('rect')
        .attr('x', padding)
        .attr('y', flightsContentY)
        .attr('width', panelWidth - 2 * padding)
        .attr('height', flightsContentHeight);

      const flightsListGroup = flightsGroup
        .append('g')
        .attr('class', 'flights-list')
        .attr('clip-path', `url(#${clipId})`);

      const itemHeight = 80;
      const visibleItems = Math.ceil(flightsContentHeight / itemHeight) + 1;
      const startIndex = Math.max(0, Math.floor(scrollOffset / itemHeight));
      const endIndex = Math.min(
        flightsToShow.length,
        startIndex + visibleItems
      );

      for (let i = startIndex; i < endIndex; i++) {
        const flight = flightsToShow[i];
        const itemY = flightsContentY + i * itemHeight - scrollOffset;

        // get current hovered flights from yjs state
        const hoveredFlights = yHoveredFlights?.toArray() || [];
        const isHovered = hoveredFlights.includes(flight.id);

        // get current selected flights from yjs state
        const selectedFlights = ySelectedFlights?.toArray() || [];
        const isSelected = selectedFlights.includes(flight.id);

        // create a group for each flight item to make it interactable
        const flightGroup = flightsListGroup
          .append('g')
          .attr('class', 'flight-item')
          .attr('data-flight-id', flight.id.toString());

        // flight item background
        flightGroup
          .append('rect')
          .attr('x', padding + 4)
          .attr('y', itemY)
          .attr('width', panelWidth - 2 * padding - 8)
          .attr('height', itemHeight - 4)
          .attr('fill', 'rgba(255, 255, 255, 0.12)')
          .attr(
            'stroke',
            isSelected
              ? pinnedFlightColor
              : isHovered
                ? airportHighlightStroke
                : 'none'
          )
          .attr('stroke-width', isSelected || isHovered ? 2 : 0)
          .attr('rx', 3)
          .attr('ry', 3);

        // flight route and price
        flightGroup
          .append('text')
          .attr('x', padding + 8)
          .attr('y', itemY + 20)
          .attr('fill', panelTextColor)
          .attr('font-size', '22px')
          .attr('font-weight', '600')
          .style('font-family', 'system-ui, sans-serif')
          .text(`${flight.origin} → ${flight.destination}`);

        flightGroup
          .append('text')
          .attr('x', panelWidth - padding - 8)
          .attr('y', itemY + 20) // back to top line with route
          .attr('fill', panelTextColor)
          .attr('font-size', '22px') // back to 20px to match route
          .attr('font-weight', '600')
          .attr('text-anchor', 'end')
          .style('font-family', 'system-ui, sans-serif')
          .text(`$${flight.price.toFixed(2)}`);

        // airline information (full name only, no abbreviation)
        flightGroup
          .append('text')
          .attr('x', padding + 8)
          .attr('y', itemY + 40)
          .attr('fill', panelTextColor)
          .attr('font-size', '18px')
          .attr('font-weight', '600')
          .style('font-family', 'system-ui, sans-serif')
          .text(`${flight.airline.name}`);

        // flight duration (same styling as price)
        flightGroup
          .append('text')
          .attr('x', panelWidth - padding - 8)
          .attr('y', itemY + itemHeight - 12) // anchored to bottom with 12px margin
          .attr('fill', panelTextColor)
          .attr('font-size', '18px')
          .attr('font-weight', '600')
          .attr('text-anchor', 'end')
          .style('font-family', 'system-ui, sans-serif')
          .text(`${flight.duration.toFixed(1)}h`);

        // flight date (same size and styling as airline name)
        const flightDate = new Date(flight.date);
        const formattedDate = flightDate.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        flightGroup
          .append('text')
          .attr('x', padding + 8)
          .attr('y', itemY + itemHeight - 12) // anchored to bottom with 12px margin
          .attr('fill', panelTextColor)
          .attr('font-size', '18px')
          .attr('font-weight', '600')
          .style('font-family', 'system-ui, sans-serif')
          .text(formattedDate);
      }

      // add scrollbar if there are more flights than can be displayed
      const totalContentHeight = flightsToShow.length * itemHeight;
      if (totalContentHeight > flightsContentHeight) {
        const scrollbarWidth = 4;
        const scrollbarX = panelWidth - padding - scrollbarWidth;

        // scrollbar track
        flightsGroup
          .append('rect')
          .attr('x', scrollbarX)
          .attr('y', flightsContentY)
          .attr('width', scrollbarWidth)
          .attr('height', flightsContentHeight)
          .attr('fill', 'rgba(255, 255, 255, 0.1)')
          .attr('rx', 2)
          .attr('ry', 2);

        // scrollbar thumb
        const scrollRatio = Math.min(
          1,
          flightsContentHeight / totalContentHeight
        );
        const thumbHeight = flightsContentHeight * scrollRatio;
        const maxScrollForThumb = Math.max(
          0,
          totalContentHeight - flightsContentHeight
        );
        const thumbY =
          maxScrollForThumb > 0
            ? flightsContentY +
              (scrollOffset / maxScrollForThumb) *
                (flightsContentHeight - thumbHeight)
            : flightsContentY;

        flightsGroup
          .append('rect')
          .attr('x', scrollbarX)
          .attr('y', thumbY)
          .attr('width', scrollbarWidth)
          .attr('height', thumbHeight)
          .attr('fill', 'rgba(255, 255, 255, 0.4)')
          .attr('rx', 2)
          .attr('ry', 2);
      }
    }

    // section 3: flight distributions
    const distributionsY = flightsContentY + flightsContentHeight + sectionGap;
    const distributionsGroup = contentGroup
      .append('g')
      .attr('class', 'distributions-section');

    // distributions content
    const distributionsContentY = distributionsY + 10; // reduced from distributionsY + 40 since no title
    const flightsToAnalyze = currentFilteredFlights;

    if (!displayOriginsSelected || !displayDestinationsSelected) {
      // first line
      distributionsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', distributionsContentY + 40)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('Select origins (left) and destinations (right)');

      // second line
      distributionsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', distributionsContentY + 60)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('to see flight distributions.');
    } else if (flightsToAnalyze.length === 0) {
      distributionsGroup
        .append('text')
        .attr('x', panelWidth / 2)
        .attr('y', distributionsContentY + 50)
        .attr('fill', 'rgba(255, 255, 255, 0.5)')
        .attr('text-anchor', 'middle')
        .attr('font-size', '14px')
        .style('font-family', 'system-ui, sans-serif')
        .text('no flight data available for distribution analysis.');
    } else {
      const prices = flightsToAnalyze.map((f) => f.price);
      const durations = flightsToAnalyze.map((f) => f.duration);
      const dates = flightsToAnalyze.map((f) => new Date(f.date));

      const histHeight = 40; // increased from 32 for better visibility
      const numBins = 8;
      const histogramBarFill = 'rgba(255, 255, 255, 0.4)';
      const calculatedHistWidth = panelWidth - 2 * padding - 8; // match other sections' width calculation

      // histograms use <= for the last bin to include maximum values (edge case fix)

      // create histograms
      let currentHistY = distributionsContentY;

      // price histogram
      if (prices.length > 0) {
        const [minVal, maxVal] = d3.extent(prices);
        if (minVal !== undefined && maxVal !== undefined) {
          const histGroup = distributionsGroup
            .append('g')
            .attr('transform', `translate(${padding + 4}, ${currentHistY})`);

          const xScale = d3
            .scaleLinear()
            .domain([minVal, maxVal])
            .range([0, calculatedHistWidth]);

          const histogram = d3
            .histogram<number, number>()
            .value((d) => d)
            .domain([minVal, maxVal])
            .thresholds(xScale.ticks(numBins));

          const bins = histogram(prices);
          const yMax = d3.max(bins, (d) => d.length) ?? 0;
          const yScale = d3
            .scaleLinear()
            .range([histHeight, 0])
            .domain([0, yMax]);

          // calculate consistent bar width
          const barWidth = calculatedHistWidth / bins.length;

          // get hovered flights for highlighting
          const hoveredFlightIds = yHoveredFlights?.toArray() || [];
          const hoveredFlightsData = hoveredFlightIds
            .map((id) => flightsToAnalyze.find((f) => f.id === id))
            .filter(Boolean) as Flight[];

          // bars
          histGroup
            .selectAll('rect')
            .data(bins)
            .join('rect')
            .attr('x', (d, i) => i * barWidth)
            .attr('width', barWidth - 1) // subtract 1 for spacing between bars
            .attr('y', (d) => yScale(d.length))
            .attr('height', (d) => histHeight - yScale(d.length))
            .attr('fill', (d) => {
              // check if any hovered flight's price falls in this bin
              const binContainsHoveredFlight = hoveredFlightsData.some(
                (flight) => {
                  const binStart = d.x0!;
                  const binEnd = d.x1!;
                  // fix for edge values: use <= for the last bin to include max value
                  const isLastBin = bins.indexOf(d) === bins.length - 1;
                  return (
                    flight.price >= binStart &&
                    (isLastBin ? flight.price <= binEnd : flight.price < binEnd)
                  );
                }
              );
              return binContainsHoveredFlight
                ? airportHighlightStroke
                : histogramBarFill;
            });

          // x-axis
          const numTicks = Math.min(bins.length, 4);
          const tickIndices = [];
          if (numTicks === 1) {
            tickIndices.push(0);
          } else {
            for (let i = 0; i < numTicks; i++) {
              tickIndices.push(
                Math.round((i * (bins.length - 1)) / (numTicks - 1))
              );
            }
          }

          const xAxis = d3
            .axisBottom(
              d3
                .scaleLinear()
                .range([0, calculatedHistWidth])
                .domain([0, bins.length - 1])
            )
            .tickValues(tickIndices)
            .tickFormat((d) => {
              const binIndex = Math.round(d as number);
              if (binIndex >= 0 && binIndex < bins.length) {
                const bin = bins[binIndex];
                return `$${((bin.x0! + bin.x1!) / 2).toFixed(0)}`;
              }
              return '';
            });

          histGroup
            .append('g')
            .attr('transform', `translate(0, ${histHeight})`)
            .call(xAxis)
            .call((g) =>
              g
                .selectAll('.tick')
                .attr(
                  'transform',
                  (d) =>
                    `translate(${(d as number) * barWidth + barWidth / 2}, 0)`
                )
            )
            .selectAll('text')
            .attr('fill', panelTextColor)
            .attr('font-size', '18px')
            .style('font-family', 'system-ui, sans-serif');

          histGroup.selectAll('path, line').attr('stroke', panelTextColor);

          currentHistY += 70; // increased from 50 to accommodate taller histograms
        }
      }

      // duration histogram
      if (durations.length > 0) {
        const [minVal, maxVal] = d3.extent(durations);
        if (minVal !== undefined && maxVal !== undefined) {
          const histGroup = distributionsGroup
            .append('g')
            .attr('transform', `translate(${padding + 4}, ${currentHistY})`);

          const xScale = d3
            .scaleLinear()
            .domain([minVal, maxVal])
            .range([0, calculatedHistWidth]);

          const histogram = d3
            .histogram<number, number>()
            .value((d) => d)
            .domain([minVal, maxVal])
            .thresholds(xScale.ticks(numBins));

          const bins = histogram(durations);
          const yMax = d3.max(bins, (d) => d.length) ?? 0;
          const yScale = d3
            .scaleLinear()
            .range([histHeight, 0])
            .domain([0, yMax]);

          // calculate consistent bar width
          const barWidth = calculatedHistWidth / bins.length;

          // get hovered flights for highlighting
          const hoveredFlightIds = yHoveredFlights?.toArray() || [];
          const hoveredFlightsData = hoveredFlightIds
            .map((id) => flightsToAnalyze.find((f) => f.id === id))
            .filter(Boolean) as Flight[];

          // bars
          histGroup
            .selectAll('rect')
            .data(bins)
            .join('rect')
            .attr('x', (d, i) => i * barWidth)
            .attr('width', barWidth - 1) // subtract 1 for spacing between bars
            .attr('y', (d) => yScale(d.length))
            .attr('height', (d) => histHeight - yScale(d.length))
            .attr('fill', (d) => {
              // check if any hovered flight's duration falls in this bin
              const binContainsHoveredFlight = hoveredFlightsData.some(
                (flight) => {
                  const binStart = d.x0!;
                  const binEnd = d.x1!;
                  // fix for edge values: use <= for the last bin to include max value
                  const isLastBin = bins.indexOf(d) === bins.length - 1;
                  return (
                    flight.duration >= binStart &&
                    (isLastBin
                      ? flight.duration <= binEnd
                      : flight.duration < binEnd)
                  );
                }
              );
              return binContainsHoveredFlight
                ? airportHighlightStroke
                : histogramBarFill;
            });

          // x-axis
          const numTicks = Math.min(bins.length, 4);
          const tickIndices = [];
          if (numTicks === 1) {
            tickIndices.push(0);
          } else {
            for (let i = 0; i < numTicks; i++) {
              tickIndices.push(
                Math.round((i * (bins.length - 1)) / (numTicks - 1))
              );
            }
          }

          const xAxis = d3
            .axisBottom(
              d3
                .scaleLinear()
                .range([0, calculatedHistWidth])
                .domain([0, bins.length - 1])
            )
            .tickValues(tickIndices)
            .tickFormat((d) => {
              const binIndex = Math.round(d as number);
              if (binIndex >= 0 && binIndex < bins.length) {
                const bin = bins[binIndex];
                const hours = (bin.x0! + bin.x1!) / 2;
                // show half-hour precision for better granularity
                return `${hours.toFixed(1)}h`;
              }
              return '';
            });

          histGroup
            .append('g')
            .attr('transform', `translate(0, ${histHeight})`)
            .call(xAxis)
            .call((g) =>
              g
                .selectAll('.tick')
                .attr(
                  'transform',
                  (d) =>
                    `translate(${(d as number) * barWidth + barWidth / 2}, 0)`
                )
            )
            .selectAll('text')
            .attr('fill', panelTextColor)
            .attr('font-size', '16px')
            .style('font-family', 'system-ui, sans-serif');

          histGroup.selectAll('path, line').attr('stroke', panelTextColor);

          currentHistY += 70; // increased from 50 to accommodate taller histograms
        }
      }

      // date histogram
      if (dates.length > 0) {
        const [minVal, maxVal] = d3.extent(dates);
        if (minVal !== undefined && maxVal !== undefined) {
          const histGroup = distributionsGroup
            .append('g')
            .attr('transform', `translate(${padding + 4}, ${currentHistY})`);

          const xScale = d3
            .scaleTime()
            .domain([minVal, maxVal])
            .range([0, calculatedHistWidth]);

          // calculate number of days between earliest and latest dates for bins
          const daysBetween =
            Math.ceil(
              (maxVal.getTime() - minVal.getTime()) / (1000 * 60 * 60 * 24)
            ) + 1;

          const histogram = d3
            .histogram<Date, Date>()
            .value((d) => d)
            .domain([minVal, maxVal])
            .thresholds(xScale.ticks(daysBetween));

          const bins = histogram(dates);
          const yMax = d3.max(bins, (d) => d.length) ?? 0;
          const yScale = d3
            .scaleLinear()
            .range([histHeight, 0])
            .domain([0, yMax]);

          // calculate consistent bar width
          const barWidth = calculatedHistWidth / bins.length;

          // get hovered flights for highlighting
          const hoveredFlightIds = yHoveredFlights?.toArray() || [];
          const hoveredFlightsData = hoveredFlightIds
            .map((id) => flightsToAnalyze.find((f) => f.id === id))
            .filter(Boolean) as Flight[];

          // bars
          histGroup
            .selectAll('rect')
            .data(bins)
            .join('rect')
            .attr('x', (d, i) => i * barWidth)
            .attr('width', barWidth - 1) // subtract 1 for spacing between bars
            .attr('y', (d) => yScale(d.length))
            .attr('height', (d) => histHeight - yScale(d.length))
            .attr('fill', (d) => {
              // check if any hovered flight's date falls in this bin
              const binContainsHoveredFlight = hoveredFlightsData.some(
                (flight) => {
                  const flightDate = new Date(flight.date).getTime();
                  const binStart = d.x0!.getTime();
                  const binEnd = d.x1!.getTime();
                  // fix for edge values: use <= for the last bin to include max value
                  const isLastBin = bins.indexOf(d) === bins.length - 1;
                  return (
                    flightDate >= binStart &&
                    (isLastBin ? flightDate <= binEnd : flightDate < binEnd)
                  );
                }
              );
              return binContainsHoveredFlight
                ? airportHighlightStroke
                : histogramBarFill;
            });

          // x-axis
          const numTicks = Math.min(bins.length, 4);
          const tickIndices = [];
          if (numTicks === 1) {
            tickIndices.push(0);
          } else {
            for (let i = 0; i < numTicks; i++) {
              tickIndices.push(
                Math.round((i * (bins.length - 1)) / (numTicks - 1))
              );
            }
          }

          const xAxis = d3
            .axisBottom(
              d3
                .scaleLinear()
                .range([0, calculatedHistWidth])
                .domain([0, bins.length - 1])
            )
            .tickValues(tickIndices)
            .tickFormat((d) => {
              const binIndex = Math.round(d as number);
              if (binIndex >= 0 && binIndex < bins.length) {
                const bin = bins[binIndex];
                const date = new Date(bin.x0!);
                return `${date.getMonth() + 1}/${date.getDate()}`;
              }
              return '';
            });

          histGroup
            .append('g')
            .attr('transform', `translate(0, ${histHeight})`)
            .call(xAxis)
            .call((g) =>
              g
                .selectAll('.tick')
                .attr(
                  'transform',
                  (d) =>
                    `translate(${(d as number) * barWidth + barWidth / 2}, 0)`
                )
            )
            .selectAll('text')
            .attr('fill', panelTextColor)
            .attr('font-size', '16px')
            .style('font-family', 'system-ui, sans-serif');

          histGroup.selectAll('path, line').attr('stroke', panelTextColor);
        }
      }
    }
  };

  // store projection ref for use in handlers
  const projectionRef = useRef<d3.GeoProjection | null>(null);
  // store interaction handler ref for adding/removing listener
  const interactionHandlerRef = useRef<EventListener | null>(null);

  useEffect(() => {
    if (
      !doc ||
      !syncStatus ||
      !svgRef.current ||
      !yWorldMapState ||
      !yHoveredAirportIATAsLeft ||
      !yHoveredAirportIATAsRight ||
      !ySelectedAirportIATAsLeft ||
      !ySelectedAirportIATAsRight ||
      !yPanelState
    ) {
      return undefined; // ensure a value is returned for cleanup path
    }

    const currentSvg = svgRef.current;
    const svg = d3.select(currentSvg);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    defs
      .append('filter')
      .attr('id', 'map-shadow')
      .append('feDropShadow')
      .attr('dx', 0)
      .attr('dy', 2)
      .attr('stdDeviation', 3)
      .attr('flood-opacity', 0.5);
    defs
      .append('filter')
      .attr('id', 'airport-shadow')
      .append('feDropShadow')
      .attr('dx', 0)
      .attr('dy', 1)
      .attr('stdDeviation', 2)
      .attr('flood-opacity', 0.75);

    const g = svg.append('g');
    gRef.current = g.node();

    // apply initial transform from yjs state or default
    const initialScale = (yWorldMapState.get('zoomScale') as number) || 1;
    const initialX = (yWorldMapState.get('panX') as number) || 0;
    const initialY = (yWorldMapState.get('panY') as number) || 0;
    transformRef.current = { k: initialScale, x: initialX, y: initialY };
    g.attr(
      'transform',
      `translate(${initialX},${initialY}) scale(${initialScale})`
    );

    let parentElementForListener: HTMLElement | null = null;

    Promise.all([
      d3.json<WorldTopology>('/src/assets/traveldata/world110.topo.json'),
      d3.json<Airport[]>('/src/assets/situation/airports.json'),
      d3.json<Flight[]>('/src/assets/situation/flights.json'),
    ])
      .then(([topology, airportsData, flightsData]) => {
        if (
          !topology ||
          !topology.objects.countries ||
          !airportsData ||
          !flightsData
        ) {
          console.error('failed to load data.');
          return;
        }

        allFlights.current = flightsData;
        allAirports.current = airportsData; // store all airport data

        const geoFeature = topojson.feature(
          topology,
          topology.objects.countries
        ) as FeatureCollection<Geometry, CountryProperties>;

        const projection = d3
          .geoEqualEarth()
          .center([-75, 47])
          .translate([mapWidth / 2, totalHeight / 3.75])
          .scale(700);
        projectionRef.current = projection; // store projection
        const path = d3.geoPath().projection(projection);

        const mapGroup = g
          .append('g')
          .attr('class', 'map-features')
          .style('pointer-events', 'none')
          .style('filter', 'url(#map-shadow)');
        mapGroup
          .selectAll('path')
          .data(geoFeature.features)
          .join('path')
          .attr('d', path)
          .attr('fill', defaultFill)
          .attr('stroke', strokeColor)
          .attr('stroke-width', defaultStrokeWidth)
          .attr('class', 'country')
          .append('title')
          .text((d) => d.properties?.name ?? 'unknown');

        const airportsGroup = g
          .append('g')
          .attr('class', 'airports')
          .style('pointer-events', 'all')
          .style('filter', 'url(#airport-shadow)');

        airportsGroup
          .selectAll('circle')
          .data(airportsData) // use airportsData directly
          .join('circle')
          .attr('cx', (d) => {
            const coords = projection([d.Longitude, d.Latitude]);
            return coords ? coords[0] : 0;
          })
          .attr('cy', (d) => {
            const coords = projection([d.Longitude, d.Latitude]);
            return coords ? coords[1] : 0;
          })
          .attr('r', airportRadius / initialScale) // use initial scale
          .attr('fill', airportFill)
          .attr('stroke', airportStroke)
          .attr('stroke-width', airportStrokeWidth / initialScale) // use initial scale
          .attr('class', 'airport')
          .attr('data-iata', (d) => d.IATA) // add iata for easy selection
          .append('title')
          .text((d) => `${d['Airport Name']} (${d.IATA})`);

        // initial application of styles based on yjs state
        adjustStylesForTransform(initialScale);
        redrawAllLinesFromYjs(projection);
        updateInfoPanelFromYjs();

        // interaction handler for custom gesture events
        const handleInteractionLogic = (event: InteractionEvent) => {
          if (
            !doc ||
            !gRef.current ||
            !yWorldMapState ||
            !yHoveredAirportIATAsLeft ||
            !yHoveredAirportIATAsRight
          )
            return;

          let targetElement: SVGElement | null = null;
          let handedness: 'left' | 'right' | undefined;

          // type guard for events that carry element and handedness
          if (
            event.type === 'pointerover' ||
            event.type === 'pointerout' ||
            event.type === 'pointerselect' ||
            event.type === 'pointerdown' ||
            event.type === 'pointermove' ||
            event.type === 'pointerup'
          ) {
            const pointerEvent = event as InteractionEvent & {
              element?: Element;
              handedness?: 'left' | 'right';
            }; // more specific type assertion
            if (pointerEvent.element instanceof SVGElement) {
              targetElement = pointerEvent.element;
            }
            handedness = pointerEvent.handedness;
          }

          const airportIATA = targetElement
            ?.closest('.airport')
            ?.getAttribute('data-iata');

          // check for flight element
          const flightElement = targetElement?.closest('.flight-item');
          const flightId = flightElement?.getAttribute('data-flight-id');

          doc.transact(() => {
            switch (event.type) {
              case 'pointerover':
                // handle airport hover
                if (
                  airportIATA &&
                  handedness &&
                  yWorldMapState &&
                  yHoveredAirportIATAsLeft &&
                  yHoveredAirportIATAsRight
                ) {
                  const targetArray =
                    handedness === 'left'
                      ? yHoveredAirportIATAsLeft
                      : yHoveredAirportIATAsRight;
                  if (!targetArray.toArray().includes(airportIATA)) {
                    targetArray.push([airportIATA]);
                  }
                }
                // handle flight hover
                else if (flightId && yHoveredFlights) {
                  const flightIdNum = parseInt(flightId, 10);
                  if (!yHoveredFlights.toArray().includes(flightIdNum)) {
                    // allow multiple flights to be hovered simultaneously
                    yHoveredFlights.push([flightIdNum]);
                  }
                }
                break;

              case 'pointerout':
                // handle airport hover out
                if (
                  airportIATA &&
                  handedness &&
                  yWorldMapState &&
                  yHoveredAirportIATAsLeft &&
                  yHoveredAirportIATAsRight
                ) {
                  const targetArray =
                    handedness === 'left'
                      ? yHoveredAirportIATAsLeft
                      : yHoveredAirportIATAsRight;
                  const index = targetArray.toArray().indexOf(airportIATA);
                  if (index > -1) {
                    // only remove if not currently selected by this hand for stickiness
                    const selectedKey =
                      handedness === 'left'
                        ? 'selectedLeftAirportIATA'
                        : 'selectedRightAirportIATA';
                    if (yWorldMapState.get(selectedKey) !== airportIATA) {
                      targetArray.delete(index, 1);
                    }
                  }
                }
                // handle flight hover out
                else if (flightId && yHoveredFlights) {
                  const flightIdNum = parseInt(flightId, 10);
                  const index = yHoveredFlights.toArray().indexOf(flightIdNum);
                  if (index > -1) {
                    yHoveredFlights.delete(index, 1);
                  }
                }
                break;

              case 'pointerselect':
                if (
                  airportIATA &&
                  handedness &&
                  yWorldMapState &&
                  yHoveredAirportIATAsLeft &&
                  yHoveredAirportIATAsRight &&
                  ySelectedAirportIATAsLeft &&
                  ySelectedAirportIATAsRight
                ) {
                  const targetSelectionArray =
                    handedness === 'left'
                      ? ySelectedAirportIATAsLeft
                      : ySelectedAirportIATAsRight;

                  const currentSelectedIndex = targetSelectionArray
                    .toArray()
                    .indexOf(airportIATA);

                  if (currentSelectedIndex > -1) {
                    // airport is already selected by this hand, so deselect it
                    targetSelectionArray.delete(currentSelectedIndex, 1);
                  } else {
                    // airport is not selected by this hand, so select it
                    targetSelectionArray.push([airportIATA]);
                  }
                }
                // handle flight selection (pinning)
                else if (flightId && ySelectedFlights) {
                  const flightIdNum = parseInt(flightId, 10);
                  const currentSelectedFlights = ySelectedFlights.toArray();
                  const currentSelectedIndex =
                    currentSelectedFlights.indexOf(flightIdNum);

                  if (currentSelectedIndex > -1) {
                    // flight is already selected, so deselect it
                    ySelectedFlights.delete(currentSelectedIndex, 1);
                  } else {
                    // flight is not selected, so select it (with maximum of 2)
                    if (currentSelectedFlights.length >= 2) {
                      // remove the oldest selected flight to make room for the new one
                      ySelectedFlights.delete(0, 1);
                    }
                    ySelectedFlights.push([flightIdNum]);
                  }
                }
                break;

              case 'drag':
                if (event.transform && yWorldMapState) {
                  yWorldMapState.set('panX', event.transform.x);
                  yWorldMapState.set('panY', event.transform.y);
                  // k (scale) is not changed by drag in this setup
                }
                break;

              case 'zoom':
                if (event.transform && yWorldMapState) {
                  yWorldMapState.set('panX', event.transform.x);
                  yWorldMapState.set('panY', event.transform.y);
                  yWorldMapState.set('zoomScale', event.transform.scale);
                }
                break;

              case 'pointerdown': {
                // handle start of scroll operation for flights list
                const { point, handedness, element } = event;
                if (!handedness || !element) return;

                // check if the element is the panel svg or related to flights list
                if (
                  (element === panelSvgRef.current ||
                    panelSvgRef.current?.contains(element)) &&
                  yPanelState
                ) {
                  const scrollState = scrollDragStateRef.current[handedness];
                  scrollState.active = true;
                  scrollState.startY = point.clientY;
                  const currentScroll =
                    (yPanelState.get('flightsScrollY') as number) || 0;
                  scrollState.startScrollTop = currentScroll;
                }
                break;
              }

              case 'pointermove': {
                // handle scroll movement for flights list
                const { point, handedness } = event;
                if (!handedness) return;

                const scrollState = scrollDragStateRef.current[handedness];
                if (scrollState.active && yPanelState) {
                  const deltaY = point.clientY - scrollState.startY;
                  // invert the delta to make dragging down scroll down (natural scrolling)
                  const newScrollTop = scrollState.startScrollTop - deltaY;

                  // calculate filtered flights count for scroll limit
                  const hoveredLeftIATAsForScroll =
                    yHoveredAirportIATAsLeft?.toArray() || [];
                  const hoveredRightIATAsForScroll =
                    yHoveredAirportIATAsRight?.toArray() || [];
                  const selectedLeftIATAsForScroll =
                    ySelectedAirportIATAsLeft?.toArray() || [];
                  const selectedRightIATAsForScroll =
                    ySelectedAirportIATAsRight?.toArray() || [];

                  const leftFilterIATAsForScroll = Array.from(
                    new Set([
                      ...selectedLeftIATAsForScroll,
                      ...hoveredLeftIATAsForScroll,
                    ])
                  );
                  const rightFilterIATAsForScroll = Array.from(
                    new Set([
                      ...selectedRightIATAsForScroll,
                      ...hoveredRightIATAsForScroll,
                    ])
                  );

                  let filteredFlightsCount = 0;
                  if (
                    leftFilterIATAsForScroll.length > 0 &&
                    rightFilterIATAsForScroll.length > 0
                  ) {
                    filteredFlightsCount = allFlights.current.filter(
                      (flight) =>
                        leftFilterIATAsForScroll.includes(flight.origin) &&
                        rightFilterIATAsForScroll.includes(flight.destination)
                    ).length;
                  } else if (leftFilterIATAsForScroll.length > 0) {
                    filteredFlightsCount = allFlights.current.filter((flight) =>
                      leftFilterIATAsForScroll.includes(flight.origin)
                    ).length;
                  } else if (rightFilterIATAsForScroll.length > 0) {
                    filteredFlightsCount = allFlights.current.filter((flight) =>
                      rightFilterIATAsForScroll.includes(flight.destination)
                    ).length;
                  }

                  // clamp scroll position to valid range
                  // calculate flights content height for proper scroll bounds
                  const paddingForScroll = 6;
                  const sectionGapForScroll = 12;
                  const titleHeightForScroll = 20;
                  const itemHeightForScroll = 35;
                  const maxItemsForScroll = 4;
                  const bottomPaddingForScroll = 10;
                  const distributionsFixedHeightForScroll = 10 + 3 * 70; // same as calculated earlier
                  const selectionsYForScroll = paddingForScroll;
                  const boxHeightForScroll =
                    titleHeightForScroll +
                    25 +
                    maxItemsForScroll * itemHeightForScroll -
                    bottomPaddingForScroll; // replicate box height calculation
                  const flightsYForScroll =
                    selectionsYForScroll +
                    boxHeightForScroll +
                    sectionGapForScroll;
                  const flightsContentYForScroll = flightsYForScroll + 10;
                  const flightsContentHeightForScroll =
                    totalHeight -
                    flightsContentYForScroll -
                    distributionsFixedHeightForScroll -
                    sectionGapForScroll -
                    paddingForScroll;

                  const maxScroll = Math.max(
                    0,
                    filteredFlightsCount * 80 - flightsContentHeightForScroll
                  );
                  const clampedScrollTop = Math.max(
                    0,
                    Math.min(maxScroll, newScrollTop)
                  );

                  yPanelState.set('flightsScrollY', clampedScrollTop);
                }
                break;
              }

              case 'pointerup': {
                // handle end of scroll operation for flights list
                const { handedness } = event;
                if (!handedness) return;

                const scrollState = scrollDragStateRef.current[handedness];
                if (scrollState.active) {
                  scrollState.active = false;
                }
                break;
              }
            }
          });
        };

        parentElementForListener = currentSvg.parentElement;
        if (parentElementForListener) {
          // store the handler in a ref so it can be removed with the same reference
          interactionHandlerRef.current = ((e: CustomEvent<InteractionEvent>) =>
            handleInteractionLogic(e.detail)) as EventListener;
          parentElementForListener.addEventListener(
            'interaction',
            interactionHandlerRef.current
          );
        }
      })
      .catch((error) =>
        console.error('error loading or processing data:', error)
      );

    // setup observers for yjs changes to reflect in d3
    const yjsObserver = () => {
      const currentProj = projectionRef.current;
      if (
        !currentProj ||
        !yWorldMapState ||
        !yHoveredAirportIATAsLeft ||
        !yHoveredAirportIATAsRight
      )
        return;
      adjustStylesForTransform(transformRef.current.k); // re-apply styles based on current known scale
      redrawAllLinesFromYjs(currentProj);
      updateInfoPanelFromYjs();
    };

    yHoveredAirportIATAsLeft.observeDeep(yjsObserver);
    yHoveredAirportIATAsRight.observeDeep(yjsObserver);
    ySelectedAirportIATAsLeft.observeDeep(yjsObserver);
    ySelectedAirportIATAsRight.observeDeep(yjsObserver);
    yPanelState.observeDeep(yjsObserver); // observe panel state changes
    yHoveredFlights?.observeDeep(yjsObserver); // observe hovered flights changes
    ySelectedFlights?.observeDeep(yjsObserver); // observe selected flights changes

    // main effect cleanup
    return () => {
      if (animationFrameRef.current)
        cancelAnimationFrame(animationFrameRef.current);
      clearAllLines();
      yHoveredAirportIATAsLeft?.unobserveDeep(yjsObserver);
      yHoveredAirportIATAsRight?.unobserveDeep(yjsObserver);
      ySelectedAirportIATAsLeft?.unobserveDeep(yjsObserver);
      ySelectedAirportIATAsRight?.unobserveDeep(yjsObserver);
      yPanelState?.unobserveDeep(yjsObserver); // unobserve panel state changes
      yHoveredFlights?.unobserveDeep(yjsObserver); // unobserve hovered flights changes
      ySelectedFlights?.unobserveDeep(yjsObserver); // unobserve selected flights changes

      // cleanup scroll drag state
      scrollDragStateRef.current.left.active = false;
      scrollDragStateRef.current.right.active = false;

      // cleanup interaction listener
      if (parentElementForListener && interactionHandlerRef.current) {
        parentElementForListener.removeEventListener(
          'interaction',
          interactionHandlerRef.current
        );
        interactionHandlerRef.current = null; // clear the ref
      }
    };
  }, [
    doc,
    syncStatus,
    yWorldMapState,
    yHoveredAirportIATAsLeft,
    yHoveredAirportIATAsRight,
    ySelectedAirportIATAsLeft,
    ySelectedAirportIATAsRight,
    yPanelState,
    yHoveredFlights,
    ySelectedFlights,
  ]);

  // function to draw pinned flight lines (always visible in green)
  const drawPinnedFlightLines = (projection: d3.GeoProjection | null) => {
    if (!projection || !ySelectedFlights) return;

    const selectedFlights = ySelectedFlights.toArray();
    const selectedFlightData = selectedFlights
      .map((id) => allFlights.current.find((f) => f.id === id))
      .filter(Boolean) as Flight[];

    selectedFlightData.forEach((flight) => {
      const pairKey = getPairKey(flight.origin, flight.destination);
      // only draw if this line doesn't already exist
      if (!activeLinesByPair.current.has(pairKey)) {
        drawAirportLineByIATAs(
          flight.origin,
          flight.destination,
          projection,
          false,
          true
        );
      }
    });
  };

  if (
    !syncStatus ||
    !doc ||
    !ySelectedAirportIATAsLeft ||
    !ySelectedAirportIATAsRight
  ) {
    // ensure doc is also available for initial render
    return (
      <div
        style={{
          width: '100%', // Use 100% to fill parent like Senate
          height: '100%', // Use 100% to fill parent like Senate
          position: 'relative', // Relative for potential inner absolute elements
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: 'transparent', // Match Senate
          overflow: 'hidden', // Match Senate
          borderRadius: '8px', // Match Senate
          boxShadow: 'inset 0 0 10px rgba(0,0,0,0.05)', // Match Senate
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
            background: 'rgba(255,255,255,0.8)', // Match Senate
            borderRadius: '12px', // Match Senate
            boxShadow: '0 4px 20px rgba(0,0,0,0.08)', // Match Senate
          }}
        >
          <div
            style={{
              fontSize: '2rem',
              marginBottom: '0.5rem',
              fontWeight: 500,
              color: '#333', // Match Senate
            }}
          >
            Travel Map Visualization
          </div>
          <div
            style={{
              fontSize: '1.25rem',
              marginBottom: '1.5rem',
              color: '#555', // Match Senate
            }}
          >
            waiting for synchronization...
          </div>
          <div
            style={{
              marginTop: '1rem',
              width: '100%',
              height: '6px',
              background: '#eee', // Match Senate
              borderRadius: '8px', // Match Senate
              overflow: 'hidden', // Match Senate
            }}
          >
            <div
              style={{
                width: '40%',
                height: '100%',
                background: `linear-gradient(to right, #1E90FF, #1E90FF)`, // Adjusted color for WorldMap theme
                animation: 'progressAnimation 2s infinite',
                borderRadius: '8px', // Match Senate
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
    <>
      <svg
        ref={svgRef}
        width='100%'
        height='100%'
        style={{
          pointerEvents: 'all',
          touchAction: 'none',
          position: 'relative',
          cursor: 'pointer',
          overflow: 'hidden',
        }}
      />
      {/* info panel svg structure */}
      <svg
        ref={panelSvgRef}
        width={panelWidth}
        height={totalHeight}
        style={{
          position: 'fixed',
          top: '0',
          left: '0',
          background: panelBackground,
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          zIndex: 1000,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          backdropFilter: 'blur(12px)',
          pointerEvents: 'all',
        }}
      >
        <defs>
          <filter id='panel-text-shadow'>
            <feDropShadow dx='0' dy='1' stdDeviation='1' floodOpacity='0.3' />
          </filter>
        </defs>
      </svg>
    </>
  );
};

export default WorldMap;
