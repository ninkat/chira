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
const dotSize = 4;
const dotSpacing = 10;

// constants for panel styling
const panelWidth = totalWidth / 4;
const panelBackground = 'rgba(33, 33, 33, 0.65)';
const panelTextColor = 'white';

const WorldMap: React.FC<WorldMapProps> = ({ getCurrentTransformRef }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement | null>(null); // main group for d3 transformations
  const animationFrameRef = useRef<number | null>(null);
  const activeLinesByPair = useRef<Map<string, SVGPathElement>>(new Map());

  // get doc from yjs context
  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;

  // unique user id for yjs interactions (if needed for specific logic)
  const [userId] = useState<string>(() => crypto.randomUUID());

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

  // ref to track current transform from yjs or local updates before sync
  const transformRef = useRef<{ k: number; x: number; y: number }>({
    k: 1,
    x: 0,
    y: 0,
  });

  // ref to track scroll drag state for flights list
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

  // ref for the flights list element
  const flightsListRef = useRef<HTMLDivElement>(null);

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

    activeLinesByPair.current.forEach((line) => {
      d3.select(line).attr('stroke-width', lineWidth / scale);
    });
  };

  // function to draw line between airports by iata codes
  const drawAirportLineByIATAs = (
    originIATA: string,
    destinationIATA: string,
    projection: d3.GeoProjection
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

    const lineGenerator = d3.line();
    const pathData = lineGenerator([
      [originCoords[0], originCoords[1]],
      [destCoords[0], destCoords[1]],
    ]);
    if (!pathData) return;

    const line = d3
      .select(gRef.current)
      .append('path')
      .attr('d', pathData)
      .attr('stroke', lineColor)
      .attr('stroke-width', lineWidth / transformRef.current.k) // use current transform
      .attr('fill', 'none')
      .style('stroke-dasharray', `${dotSize} ${dotSpacing}`)
      .style('stroke-linecap', 'round');

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

    effectiveLeftIATAs.forEach((originIATA) => {
      effectiveRightIATAs.forEach((destIATA) => {
        if (originIATA !== destIATA) {
          // prevent self-loops if an airport is somehow in both effective lists
          drawAirportLineByIATAs(originIATA, destIATA, projection);
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
      !ySelectedAirportIATAsRight
    )
      return;

    const infoPanel = d3.select('.info-panel');
    if (infoPanel.empty()) return;

    const hoveredLeftIATAs = yHoveredAirportIATAsLeft.toArray();
    const hoveredRightIATAs = yHoveredAirportIATAsRight.toArray();
    const selectedLeftIATAs = ySelectedAirportIATAsLeft.toArray();
    const selectedRightIATAs = ySelectedAirportIATAsRight.toArray();

    // display logic: selected items are primary. hovered items are secondary if not selected.
    // for flight filtering, selected items take precedence.
    const leftFilterIATAs =
      selectedLeftIATAs.length > 0 ? selectedLeftIATAs : hoveredLeftIATAs;
    const rightFilterIATAs =
      selectedRightIATAs.length > 0 ? selectedRightIATAs : hoveredRightIATAs;

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

    const originsBox = infoPanel.select('.origins-box .content');
    originsBox.selectAll('div').remove();

    const uniqueLeftDisplayIATAs = Array.from(
      new Set([...selectedLeftIATAs, ...hoveredLeftIATAs])
    );
    const leftAirportsToShow = uniqueLeftDisplayIATAs
      .map(getAirportByIATA)
      .filter(Boolean) as Airport[];

    const leftToShow = leftAirportsToShow.slice(0, 3);
    const leftRemaining = leftAirportsToShow.length - 3;

    leftToShow.forEach((airport) => {
      const isSelected = selectedLeftIATAs.includes(airport.IATA);
      // const isHovered = hoveredLeftIATAs.includes(airport.IATA) && !isSelected; // if needed for distinct hover style
      originsBox
        .append('div')
        .style('background', 'rgba(232, 27, 35, 0.3)')
        .style('padding', isSelected ? '2px 6px' : '4px 8px')
        .style(
          'border',
          isSelected ? `2px solid ${airportSelectedLeftStroke}` : 'none'
        )
        .style('borderRadius', '4px')
        .style('font-size', '14px')
        .style('font-weight', isSelected ? '700' : '500')
        .text(`${airport.IATA} (${airport.City})`);
    });
    if (leftRemaining > 0) {
      originsBox
        .append('div')
        .style('background', 'rgba(232, 27, 35, 0.3)')
        .style('padding', '4px 8px')
        .style('borderRadius', '4px')
        .style('font-size', '14px')
        .style('font-weight', '500')
        .style('opacity', '0.7')
        .text(`and ${leftRemaining} more...`);
    }

    const destinationsBox = infoPanel.select('.destinations-box .content');
    destinationsBox.selectAll('div').remove();

    const uniqueRightDisplayIATAs = Array.from(
      new Set([...selectedRightIATAs, ...hoveredRightIATAs])
    );
    const rightAirportsToShow = uniqueRightDisplayIATAs
      .map(getAirportByIATA)
      .filter(Boolean) as Airport[];

    const rightToShow = rightAirportsToShow.slice(0, 3);
    const rightRemaining = rightAirportsToShow.length - 3;

    rightToShow.forEach((airport) => {
      const isSelected = selectedRightIATAs.includes(airport.IATA);
      // const isHovered = hoveredRightIATAs.includes(airport.IATA) && !isSelected;
      destinationsBox
        .append('div')
        .style('background', 'rgba(0, 174, 243, 0.3)')
        .style('padding', isSelected ? '2px 6px' : '4px 8px')
        .style(
          'border',
          isSelected ? `2px solid ${airportSelectedRightStroke}` : 'none'
        )
        .style('borderRadius', '4px')
        .style('font-size', '14px')
        .style('font-weight', isSelected ? '700' : '500')
        .text(`${airport.IATA} (${airport.City})`);
    });
    if (rightRemaining > 0) {
      destinationsBox
        .append('div')
        .style('background', 'rgba(0, 174, 243, 0.3)')
        .style('padding', '4px 8px')
        .style('borderRadius', '4px')
        .style('font-size', '14px')
        .style('font-weight', '500')
        .style('opacity', '0.7')
        .text(`and ${rightRemaining} more...`);
    }

    // distributions and flights list rendering
    const distributionsContainer = infoPanel.select<HTMLDivElement>(
      '.distributions-container'
    );
    distributionsContainer.selectAll('*').remove();

    const flightsToAnalyze = currentFilteredFlights;
    const displayOriginsSelected =
      selectedLeftIATAs.length > 0 || hoveredLeftIATAs.length > 0;
    const displayDestinationsSelected =
      selectedRightIATAs.length > 0 || hoveredRightIATAs.length > 0;

    if (!displayOriginsSelected || !displayDestinationsSelected) {
      distributionsContainer
        .append('div')
        .style('color', 'rgba(255, 255, 255, 0.5)')
        .text(
          'hover over origins (left) and destinations (right) to see flight distributions.'
        );
    } else if (flightsToAnalyze.length === 0) {
      distributionsContainer
        .append('div')
        .style('color', 'rgba(255, 255, 255, 0.5)')
        .text('no flight data available for distribution analysis.');
    } else {
      const prices = flightsToAnalyze.map((f) => f.price);
      const durations = flightsToAnalyze.map((f) => f.duration);
      const dates = flightsToAnalyze.map((f) => new Date(f.date));

      const histHeight = 18;
      const histMargin = { top: 0, right: 10, bottom: 20, left: 0 }; // increased bottom margin for labels
      const numBins = 8;
      const histogramBarFill = 'rgba(255, 255, 255, 0.4)';

      // adjust histwidth to fit within the panel, considering margins and container padding
      const containerPaddingRight = 5; // as per distributions-container style
      const calculatedHistWidth =
        panelWidth - histMargin.left - histMargin.right - containerPaddingRight;

      const createLinearHistogram = (
        data: number[],
        title: string,
        unit: string = ''
      ) => {
        const histContainer = distributionsContainer
          .append('div')
          .style('display', 'flex')
          .style('flex-direction', 'column')
          .style('gap', '1px');
        histContainer
          .append('label')
          .style('color', 'rgba(255, 255, 255, 0.75)')
          .style('font-size', '12px')
          .style('font-weight', '500')
          .style('text-transform', 'lowercase')
          .style('letter-spacing', '0.05em')
          .text(title);
        const svg = histContainer
          .append('svg')
          .attr(
            'width',
            calculatedHistWidth + histMargin.left + histMargin.right
          ) // use calculated width for svg
          .attr('height', histHeight + histMargin.top + histMargin.bottom)
          .append('g')
          .attr('transform', `translate(${histMargin.left},${histMargin.top})`);
        const [minVal, maxVal] = d3.extent(data);
        if (minVal === undefined || maxVal === undefined) return;
        const xScale = d3
          .scaleLinear()
          .domain([minVal, maxVal])
          .range([0, calculatedHistWidth]); // use calculated width for scale range
        svg
          .append('g')
          .attr('transform', `translate(0,${histHeight})`)
          .call(
            d3
              .axisBottom(xScale)
              .ticks(4)
              .tickFormat(
                (d) =>
                  `${unit === '$' ? unit : ''}${d}${unit !== '$' ? unit : ''}`
              )
          )
          .selectAll('text')
          .style('fill', panelTextColor)
          .style('font-size', '10px');
        svg.selectAll('path, line').style('stroke', panelTextColor);
        const histogram = d3
          .histogram<number, number>()
          .value((d) => d)
          .domain([minVal, maxVal])
          .thresholds(xScale.ticks(numBins));
        const bins: d3.Bin<number, number>[] = histogram(data);
        if (!bins || bins.length === 0 || bins[0] === undefined) {
          console.warn('histogram bins calculation failed for linear data.');
          return;
        }
        const yMax = d3.max(bins, (d) => d.length) ?? 0;
        const yScale = d3
          .scaleLinear()
          .range([histHeight, 0])
          .domain([0, yMax]);
        svg
          .selectAll('rect')
          .data(bins)
          .join('rect')
          .attr('x', (d) => xScale(d.x0!) + 1)
          .attr('width', (d) => Math.max(0, xScale(d.x1!) - xScale(d.x0!) - 1))
          .attr('y', (d) => yScale(d.length))
          .attr('height', (d) => histHeight - yScale(d.length))
          .style('fill', histogramBarFill);
      };

      const createTimeHistogram = (data: Date[], title: string) => {
        const histContainer = distributionsContainer
          .append('div')
          .style('display', 'flex')
          .style('flex-direction', 'column')
          .style('gap', '1px');
        histContainer
          .append('label')
          .style('color', 'rgba(255, 255, 255, 0.75)')
          .style('font-size', '12px')
          .style('font-weight', '500')
          .style('text-transform', 'lowercase')
          .style('letter-spacing', '0.05em')
          .text(title);
        const svg = histContainer
          .append('svg')
          .attr(
            'width',
            calculatedHistWidth + histMargin.left + histMargin.right
          ) // use calculated width for svg
          .attr('height', histHeight + histMargin.top + histMargin.bottom)
          .append('g')
          .attr('transform', `translate(${histMargin.left},${histMargin.top})`);
        const [minVal, maxVal] = d3.extent(data);
        if (minVal === undefined || maxVal === undefined) return;
        const xScale = d3
          .scaleTime()
          .domain([minVal, maxVal])
          .range([0, calculatedHistWidth]); // use calculated width for scale range
        svg
          .append('g')
          .attr('transform', `translate(0,${histHeight})`)
          .call(
            d3
              .axisBottom(xScale)
              .ticks(4)
              .tickFormat(
                d3.timeFormat('%b %d') as (
                  domainValue: Date | d3.NumberValue,
                  index: number
                ) => string
              )
          )
          .selectAll('text')
          .style('fill', panelTextColor)
          .style('font-size', '10px');
        svg.selectAll('path, line').style('stroke', panelTextColor);
        const histogram = d3
          .histogram<Date, Date>()
          .value((d) => d)
          .domain([minVal, maxVal])
          .thresholds(xScale.ticks(numBins));
        const bins: d3.Bin<Date, Date>[] = histogram(data);
        if (!bins || bins.length === 0 || bins[0] === undefined) {
          console.warn('histogram bins calculation failed for time data.');
          return;
        }
        const yMax = d3.max(bins, (d) => d.length) ?? 0;
        const yScale = d3
          .scaleLinear()
          .range([histHeight, 0])
          .domain([0, yMax]);
        svg
          .selectAll('rect')
          .data(bins)
          .join('rect')
          .attr('x', (d) => xScale(d.x0!) + 1)
          .attr('width', (d) => Math.max(0, xScale(d.x1!) - xScale(d.x0!) - 1))
          .attr('y', (d) => yScale(d.length))
          .attr('height', (d) => histHeight - yScale(d.length))
          .style('fill', histogramBarFill);
      };

      createLinearHistogram(prices, 'price distribution', '$');
      createLinearHistogram(durations, 'flight time distribution', 'h');
      createTimeHistogram(dates, 'date');
    }

    const flightsListContainer =
      infoPanel.select<HTMLDivElement>('.flights-list');
    flightsListContainer.selectAll('*').remove();
    const flightsToShow = currentFilteredFlights;

    if (!displayOriginsSelected || !displayDestinationsSelected) {
      flightsListContainer
        .append('div')
        .style('color', 'rgba(255, 255, 255, 0.5)')
        .style('text-align', 'center')
        .style('padding-top', '20px')
        .style('pointer-events', 'none') // disable pointer events so gestures reach the flights-list container
        .text(
          'select origins (left) and destinations (right) to see available flights.'
        );
    } else if (flightsToShow.length === 0) {
      flightsListContainer
        .append('div')
        .style('color', 'rgba(255, 255, 255, 0.5)')
        .style('text-align', 'center')
        .style('padding-top', '20px')
        .style('pointer-events', 'none') // disable pointer events so gestures reach the flights-list container
        .text('no direct flights found for the current selection.');
    } else {
      flightsToShow.forEach((flight) => {
        const item = flightsListContainer
          .append('div')
          .attr('class', 'flight-item')
          .style('padding', '4px')
          .style('border-radius', '3px')
          .style('background', 'rgba(255, 255, 255, 0.07)')
          .style('display', 'flex')
          .style('flex-direction', 'column')
          .style('gap', '2px')
          .style('pointer-events', 'none'); // disable pointer events so gestures reach the flights-list container
        const header = item
          .append('div')
          .style('display', 'flex')
          .style('justify-content', 'space-between')
          .style('align-items', 'center');
        header
          .append('span')
          .style('font-weight', '600')
          .style('font-size', '12px')
          .text(`${flight.origin} → ${flight.destination}`);
        header
          .append('span')
          .style('color', 'rgba(255, 255, 255, 0.7)')
          .style('font-weight', '500')
          .style('font-size', '12px')
          .text(`$${flight.price.toFixed(2)}`);
        const details = item
          .append('div')
          .style('display', 'flex')
          .style('justify-content', 'space-between')
          .style('font-size', '10px')
          .style('color', 'rgba(255, 255, 255, 0.6)');
        details.append('span').text(`flight #${flight.id}`);
        details.append('span').text(`${flight.duration.toFixed(1)}h`);
        const flightDate = new Date(flight.date);
        const formattedDate = flightDate.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        item
          .append('div')
          .style('font-size', '10px')
          .style('color', 'rgba(255, 255, 255, 0.5)')
          .text(formattedDate);
      });
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
      !ySelectedAirportIATAsRight
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
      d3.json<WorldTopology>('/src/assets/world110.topo.json'),
      d3.json<Airport[]>('/src/assets/airports2.json'),
      d3.json<Flight[]>('/src/assets/flights2.json'),
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

          doc.transact(() => {
            switch (event.type) {
              case 'pointerover':
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
                break;

              case 'pointerout':
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

                // check if the element is the flights list
                if (
                  element.classList.contains('flights-list') &&
                  flightsListRef.current
                ) {
                  const scrollState = scrollDragStateRef.current[handedness];
                  scrollState.active = true;
                  scrollState.startY = point.clientY;
                  scrollState.startScrollTop = flightsListRef.current.scrollTop;
                }
                break;
              }

              case 'pointermove': {
                // handle scroll movement for flights list
                const { point, handedness } = event;
                if (!handedness) return;

                const scrollState = scrollDragStateRef.current[handedness];
                if (scrollState.active && flightsListRef.current) {
                  const deltaY = point.clientY - scrollState.startY;
                  // invert the delta to make dragging down scroll down (natural scrolling)
                  const newScrollTop = scrollState.startScrollTop - deltaY;

                  // clamp scroll position to valid range
                  const maxScroll =
                    flightsListRef.current.scrollHeight -
                    flightsListRef.current.clientHeight;
                  const clampedScrollTop = Math.max(
                    0,
                    Math.min(maxScroll, newScrollTop)
                  );

                  flightsListRef.current.scrollTop = clampedScrollTop;
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

    // main effect cleanup
    return () => {
      if (animationFrameRef.current)
        cancelAnimationFrame(animationFrameRef.current);
      clearAllLines();
      yHoveredAirportIATAsLeft?.unobserveDeep(yjsObserver);
      yHoveredAirportIATAsRight?.unobserveDeep(yjsObserver);
      ySelectedAirportIATAsLeft?.unobserveDeep(yjsObserver);
      ySelectedAirportIATAsRight?.unobserveDeep(yjsObserver);

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
    userId,
    yWorldMapState,
    yHoveredAirportIATAsLeft,
    yHoveredAirportIATAsRight,
    ySelectedAirportIATAsLeft,
    ySelectedAirportIATAsRight,
  ]);

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
      {/* info panel html structure (content filled by d3) */}
      <div
        className='info-panel'
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
          fontSize: '16px',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          pointerEvents: 'none', // disable pointer events for the entire panel
        }}
      >
        {/* section 1: current selections */}
        <div
          className='panel-section selections-section'
          style={{
            flex: '1 1 33%', // take 1/3rd of height
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            overflow: 'hidden', // prevent content from overflowing its 1/3rd boundary
          }}
        >
          <h2
            style={{
              margin: '0', // remove default h2 margin
              fontSize: '20px',
              color: 'rgba(255, 255, 255, 0.85)',
              fontWeight: 600,
              textTransform: 'lowercase',
              letterSpacing: '0.05em',
              flexShrink: 0, // prevent title from shrinking
            }}
          >
            current selections
          </h2>
          <div
            style={{
              display: 'flex',
              gap: '4px',
              flex: 1, // allow this div to take remaining space in the section
              overflow: 'hidden', // content within boxes should scroll
            }}
          >
            <div
              className='origins-box'
              style={{
                flex: 1,
                borderRadius: '6px',
                background: 'rgba(255, 255, 255, 0.07)',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                overflow: 'hidden', // content (list of airports) should scroll if needed
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: '16px',
                  color: 'rgba(255, 255, 255, 0.75)',
                  fontWeight: 500,
                  textTransform: 'lowercase',
                  letterSpacing: '0.05em',
                  flexShrink: 0, // prevent title from shrinking
                }}
              >
                origins
              </h3>
              <div
                className='content'
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  overflowY: 'auto', // enable vertical scrolling for this content
                  flex: 1, // take remaining space in origins-box
                  scrollbarWidth: 'thin',
                  scrollbarColor:
                    'rgba(255, 255, 255, 0.2) rgba(255, 255, 255, 0.05)',
                }}
              />
            </div>
            <div
              className='destinations-box'
              style={{
                flex: 1,
                borderRadius: '6px',
                background: 'rgba(255, 255, 255, 0.07)',
                padding: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                overflow: 'hidden', // content (list of airports) should scroll if needed
              }}
            >
              <h3
                style={{
                  margin: 0,
                  fontSize: '16px',
                  color: 'rgba(255, 255, 255, 0.75)',
                  fontWeight: 500,
                  textTransform: 'lowercase',
                  letterSpacing: '0.05em',
                  flexShrink: 0, // prevent title from shrinking
                }}
              >
                destinations
              </h3>
              <div
                className='content'
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  overflowY: 'auto', // enable vertical scrolling for this content
                  flex: 1, // take remaining space in destinations-box
                  scrollbarWidth: 'thin',
                  scrollbarColor:
                    'rgba(255, 255, 255, 0.2) rgba(255, 255, 255, 0.05)',
                }}
              />
            </div>
          </div>
        </div>

        {/* section 2: available flights */}
        <div
          className='panel-section flights-section'
          style={{
            flex: '1 1 33%', // take 1/3rd of height
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            overflow: 'hidden', // prevent content from overflowing its 1/3rd boundary
          }}
        >
          <h2
            style={{
              margin: '0', // remove default h2 margin
              fontSize: '20px',
              color: 'rgba(255, 255, 255, 0.85)',
              fontWeight: 600,
              textTransform: 'lowercase',
              letterSpacing: '0.05em',
              flexShrink: 0, // prevent title from shrinking
            }}
          >
            available flights
          </h2>
          <div
            ref={flightsListRef}
            className='flights-list'
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              overflowY: 'auto',
              flex: 1, // take remaining space in this section
              paddingRight: '5px', // add some padding for scrollbar
              scrollbarWidth: 'thin',
              scrollbarColor:
                'rgba(255, 255, 255, 0.2) rgba(255, 255, 255, 0.05)',
              position: 'relative', // for positioning the scroll indicator
              pointerEvents: 'all', // re-enable pointer events for the flights list
            }}
          ></div>
        </div>

        {/* section 3: flight distributions */}
        <div
          className='panel-section distributions-section'
          style={{
            flex: '1 1 33%', // take 1/3rd of height
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            overflow: 'hidden', // prevent content from overflowing its 1/3rd boundary
          }}
        >
          <h2
            style={{
              margin: '0', // remove default h2 margin
              fontSize: '20px',
              color: 'rgba(255, 255, 255, 0.85)',
              fontWeight: 600,
              textTransform: 'lowercase',
              letterSpacing: '0.05em',
              flexShrink: 0, // prevent title from shrinking
            }}
          >
            flight distributions
          </h2>
          <div
            className='distributions-container'
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              flex: 1, // take remaining space in this section
              overflowY: 'auto', // scroll if histograms exceed space
              paddingRight: '5px', // add some padding for scrollbar
              scrollbarWidth: 'thin',
              scrollbarColor:
                'rgba(255, 255, 255, 0.2) rgba(255, 255, 255, 0.05)',
            }}
          ></div>
        </div>
      </div>
    </>
  );
};

export default WorldMap;
