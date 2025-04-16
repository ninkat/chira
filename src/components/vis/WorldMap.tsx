import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import {
  Topology as TopoTopology,
  GeometryCollection,
} from 'topojson-specification';
import {
  InteractionEvent,
  InteractionEventHandler,
} from '@/types/interactionTypes';

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

// constants for styling
const totalWidth = window.innerWidth;
const totalHeight = window.innerHeight;
const defaultFill = 'rgba(170, 170, 170, 0.6)'; // restore transparent fill
const strokeColor = '#fff'; // restore white stroke
const defaultStrokeWidth = 0.5;
const mapWidth = totalWidth * (3 / 4); // width of the map area (updated to match new panel width)

// constants for airport stylings
const airportRadius = 25;
const airportFill = '#1E90FF';
const airportStroke = '#ffffff';
const airportStrokeWidth = 1.5;
const airportHighlightFill = '#1E90FF';
const airportHighlightStroke = '#FFD580';
const airportHighlightStrokeWidth = 4;
const airportSelectedStroke = '#FFB6C1'; // new color for selected state
const airportSelectedStrokeWidth = 4; // new stroke width for selected state

// constants for line styling
const lineColor = 'rgba(116, 100, 139, 0.9)'; // purple color for lines
const lineWidth = 4;
const dotSize = 4; // size of dots in the line
const dotSpacing = 10; // spacing between dots

// constants for panel styling
const panelWidth = totalWidth / 4; // changed from 1/3 to 1/4
const panelBackground = 'rgba(33, 33, 33, 0.65)';
const panelTextColor = 'white';

const WorldMap: React.FC = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  // reference to keep track of the main group for transformations
  const gRef = useRef<SVGGElement | null>(null);
  // reference to store the current transform state
  const transformRef = useRef<{ k: number; x: number; y: number }>({
    k: 1,
    x: 0,
    y: 0,
  });
  // reference to store animation frame id for cleanup
  const animationFrameRef = useRef<number | null>(null);
  // reference to store currently selected airport for each hand
  const selectedAirportsRef = useRef<{
    left: SVGCircleElement | null;
    right: SVGCircleElement | null;
  }>({ left: null, right: null });
  // reference to store hovered airports for each hand
  const hoveredAirportsRef = useRef<{
    left: Set<SVGCircleElement>;
    right: Set<SVGCircleElement>;
  }>({ left: new Set(), right: new Set() });

  // ref to track active lines between airports
  const activeLinesByPair = useRef<Map<string, SVGPathElement>>(new Map());

  // function to get pair key for origin-destination
  const getPairKey = (origin: string, destination: string) =>
    `${origin}->${destination}`;

  // function to draw line between airports
  const drawAirportLine = (
    origin: SVGCircleElement,
    destination: SVGCircleElement
  ) => {
    if (!gRef.current) return;

    const originData = d3.select(origin).datum() as Airport;
    const destData = d3.select(destination).datum() as Airport;
    const pairKey = getPairKey(originData.IATA, destData.IATA);

    // if line already exists for this pair, don't create a new one
    if (activeLinesByPair.current.has(pairKey)) {
      return;
    }

    const lineGenerator = d3.line();
    const pathData = lineGenerator([
      [
        parseFloat(origin.getAttribute('cx')!),
        parseFloat(origin.getAttribute('cy')!),
      ],
      [
        parseFloat(destination.getAttribute('cx')!),
        parseFloat(destination.getAttribute('cy')!),
      ],
    ]);
    if (!pathData) return;

    const line = d3
      .select(gRef.current)
      .append('path')
      .attr('d', pathData)
      .attr('stroke', lineColor)
      .attr('stroke-width', lineWidth / transformRef.current.k)
      .attr('fill', 'none')
      .style('stroke-dasharray', `${dotSize} ${dotSpacing}`)
      .style('stroke-linecap', 'round');

    // store the line element
    activeLinesByPair.current.set(pairKey, line.node()!);
  };

  // function to clear all lines
  const clearAllLines = () => {
    activeLinesByPair.current.forEach((line) => {
      d3.select(line).remove();
    });
    activeLinesByPair.current.clear();
  };

  // function to redraw all lines based on current hovered/selected airports
  const redrawAllLines = () => {
    clearAllLines();
    hoveredAirportsRef.current.left.forEach((origin) => {
      hoveredAirportsRef.current.right.forEach((dest) => {
        drawAirportLine(origin, dest);
      });
    });
  };

  // state for flight data - changed to refs
  const allFlights = useRef<Flight[]>([]);
  const filteredFlights = useRef<Flight[]>([]);

  // function to update the info panel with hovered airports, flights, and distributions
  const updateInfoPanel = () => {
    const infoPanel = d3.select('.info-panel');
    if (infoPanel.empty()) return;

    // get iata codes for origins and destinations
    const originIatas = Array.from(hoveredAirportsRef.current.left).map(
      (el) => (d3.select(el).datum() as Airport).IATA
    );
    const destinationIatas = Array.from(hoveredAirportsRef.current.right).map(
      (el) => (d3.select(el).datum() as Airport).IATA
    );

    // filter flights
    let currentFilteredFlights: Flight[] = [];
    if (originIatas.length > 0 && destinationIatas.length > 0) {
      currentFilteredFlights = allFlights.current.filter(
        (flight) =>
          originIatas.includes(flight.origin) &&
          destinationIatas.includes(flight.destination)
      );
    } else if (originIatas.length > 0) {
      // show flights originating from hovered left airports
      currentFilteredFlights = allFlights.current.filter((flight) =>
        originIatas.includes(flight.origin)
      );
    } else if (destinationIatas.length > 0) {
      // show flights destined for hovered right airports
      currentFilteredFlights = allFlights.current.filter((flight) =>
        destinationIatas.includes(flight.destination)
      );
    }
    // update react state for filtered flights - changed to update ref
    filteredFlights.current = currentFilteredFlights;

    // --- start d3 rendering (only for airport lists in this function) ---
    // update origins (left hand)
    const originsBox = infoPanel.select('.origins-box .content'); // select content div
    originsBox.selectAll('div').remove(); // clear previous items

    // get first 3 airports and count remaining
    const leftAirports = Array.from(hoveredAirportsRef.current.left);
    const leftToShow = leftAirports.slice(0, 3);
    const leftRemaining = leftAirports.length - 3;

    leftToShow.forEach((airport) => {
      const data = d3.select(airport).datum() as Airport;
      const isSelected = airport === selectedAirportsRef.current.left;
      originsBox
        .append('div')
        .style('background', 'rgba(232, 27, 35, 0.3)')
        // adjust padding and add border if selected
        .style('padding', isSelected ? '6px 10px' : '8px 12px')
        .style(
          'border',
          isSelected ? `2px solid ${airportSelectedStroke}` : 'none'
        )
        .style('borderRadius', '6px')
        .style('fontSize', '18px')
        .style('fontWeight', '600')
        .text(`${data.IATA} (${data.City})`);
    });

    // add "more" indicator if needed
    if (leftRemaining > 0) {
      originsBox
        .append('div')
        .style('background', 'rgba(232, 27, 35, 0.3)')
        .style('padding', '8px 12px')
        .style('borderRadius', '6px')
        .style('fontSize', '18px')
        .style('fontWeight', '600')
        .style('opacity', '0.7')
        .text(`and ${leftRemaining} more...`);
    }

    // update destinations (right hand)
    const destinationsBox = infoPanel.select('.destinations-box .content'); // select content div
    destinationsBox.selectAll('div').remove(); // clear previous items

    // get first 3 airports and count remaining
    const rightAirports = Array.from(hoveredAirportsRef.current.right);
    const rightToShow = rightAirports.slice(0, 3);
    const rightRemaining = rightAirports.length - 3;

    rightToShow.forEach((airport) => {
      const data = d3.select(airport).datum() as Airport;
      const isSelected = airport === selectedAirportsRef.current.right;
      destinationsBox
        .append('div')
        .style('background', 'rgba(0, 174, 243, 0.3)')
        // adjust padding and add border if selected
        .style('padding', isSelected ? '6px 10px' : '8px 12px')
        .style(
          'border',
          isSelected ? `2px solid ${airportSelectedStroke}` : 'none'
        )
        .style('borderRadius', '6px')
        .style('fontSize', '18px')
        .style('fontWeight', '600')
        .text(`${data.IATA} (${data.City})`);
    });

    // add "more" indicator if needed
    if (rightRemaining > 0) {
      destinationsBox
        .append('div')
        .style('background', 'rgba(0, 174, 243, 0.3)')
        .style('padding', '8px 12px')
        .style('borderRadius', '6px')
        .style('fontSize', '18px')
        .style('fontWeight', '600')
        .style('opacity', '0.7')
        .text(`and ${rightRemaining} more...`);
    }

    // --- d3 rendering for distributions (histograms) ---
    const distributionsContainer = infoPanel.select<HTMLDivElement>(
      '.distributions-container'
    );
    distributionsContainer.selectAll('*').remove(); // clear previous content

    const flightsToAnalyze = filteredFlights.current;
    const originsSelected = hoveredAirportsRef.current.left.size > 0;
    const destinationsSelected = hoveredAirportsRef.current.right.size > 0;

    if (!originsSelected || !destinationsSelected) {
      // message when not hovering both origins and destinations
      distributionsContainer
        .append('div')
        .style('color', 'rgba(255, 255, 255, 0.5)')
        .text(
          'hover over origins (left) and destinations (right) to see flight distributions.'
        );
    } else if (flightsToAnalyze.length === 0) {
      // message when airports selected but no flights match
      distributionsContainer
        .append('div')
        .style('color', 'rgba(255, 255, 255, 0.5)')
        .text('no flight data available for distribution analysis.');
    } else {
      // proceed with histogram generation
      const prices = flightsToAnalyze.map((f) => f.price);
      const durations = flightsToAnalyze.map((f) => f.duration);
      const dates = flightsToAnalyze.map((f) => new Date(f.date)); // use actual dates

      // histogram layout constants
      const histWidth = panelWidth; // adjust for padding/margins
      const histHeight = 40; // further reduced height
      const histMargin = { top: 0, right: 10, bottom: 25, left: 0 }; // increased bottom and left margins for larger labels
      const numBins = 10; // number of bins for histograms
      const histogramBarFill = 'rgba(255, 255, 255, 0.4)'; // uniform bar color

      // --- histogram helper functions ---

      // helper for linear scale histograms (price, duration)
      const createLinearHistogram = (
        data: number[],
        title: string,
        unit: string = ''
      ) => {
        const histContainer = distributionsContainer
          .append('div')
          .style('display', 'flex')
          .style('flex-direction', 'column')
          .style('gap', '2px');

        histContainer
          .append('label')
          .style('color', 'rgba(255, 255, 255, 0.75)')
          .style('font-size', '16px')
          .style('font-weight', '500')
          .style('text-transform', 'lowercase')
          .style('letter-spacing', '0.05em')
          .text(title);

        const svg = histContainer
          .append('svg')
          .attr('width', histWidth + histMargin.left + histMargin.right)
          .attr('height', histHeight + histMargin.top + histMargin.bottom)
          .append('g')
          .attr('transform', `translate(${histMargin.left},${histMargin.top})`);

        const [minVal, maxVal] = d3.extent(data);
        if (minVal === undefined || maxVal === undefined) return;

        const xScale = d3
          .scaleLinear()
          .domain([minVal, maxVal])
          .range([0, histWidth]);
        svg
          .append('g')
          .attr('transform', `translate(0,${histHeight})`)
          .call(
            d3
              .axisBottom(xScale)
              .ticks(5)
              .tickFormat(
                (d) =>
                  `${unit === '$' ? unit : ''}${d}${unit !== '$' ? unit : ''}`
              )
          )
          .selectAll('text')
          .style('fill', panelTextColor)
          .style('font-size', '14px');
        svg.selectAll('path, line').style('stroke', panelTextColor);

        // Explicitly type the histogram generator for numbers
        const histogram = d3
          .histogram<number, number>()
          .value((d) => d)
          .domain([minVal, maxVal])
          .thresholds(xScale.ticks(numBins));
        const bins: d3.Bin<number, number>[] = histogram(data);

        // Check if bins is empty or contains invalid data before proceeding
        if (!bins || bins.length === 0 || bins[0] === undefined) {
          console.warn('Histogram bins calculation failed for linear data.');
          return; // Avoid errors if bins are invalid
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

      // helper for time scale histograms (date)
      const createTimeHistogram = (data: Date[], title: string) => {
        const histContainer = distributionsContainer
          .append('div')
          .style('display', 'flex')
          .style('flex-direction', 'column')
          .style('gap', '2px');

        histContainer
          .append('label')
          .style('color', 'rgba(255, 255, 255, 0.75)')
          .style('font-size', '16px')
          .style('font-weight', '500')
          .style('text-transform', 'lowercase')
          .style('letter-spacing', '0.05em')
          .text(title);

        const svg = histContainer
          .append('svg')
          .attr('width', histWidth + histMargin.left + histMargin.right)
          .attr('height', histHeight + histMargin.top + histMargin.bottom)
          .append('g')
          .attr('transform', `translate(${histMargin.left},${histMargin.top})`);

        const [minVal, maxVal] = d3.extent(data);
        if (minVal === undefined || maxVal === undefined) return;

        const xScale = d3
          .scaleTime()
          .domain([minVal, maxVal])
          .range([0, histWidth]);
        svg
          .append('g')
          .attr('transform', `translate(0,${histHeight})`)
          // use a suitable time tick format
          .call(
            d3
              .axisBottom(xScale)
              .ticks(5)
              .tickFormat(
                d3.timeFormat('%b %d') as (
                  domainValue: Date | d3.NumberValue,
                  index: number
                ) => string
              )
          )
          .selectAll('text')
          .style('fill', panelTextColor)
          .style('font-size', '14px');
        svg.selectAll('path, line').style('stroke', panelTextColor);

        // using scale.ticks might be simpler for time thresholds
        const histogram = d3
          .histogram<Date, Date>()
          .value((d) => d)
          .domain([minVal, maxVal])
          .thresholds(xScale.ticks(numBins)); // use scale ticks for thresholds
        const bins: d3.Bin<Date, Date>[] = histogram(data);

        // Check if bins is empty or contains invalid data before proceeding
        if (!bins || bins.length === 0 || bins[0] === undefined) {
          console.warn('Histogram bins calculation failed for time data.');
          return; // Avoid errors if bins are invalid
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

      // --- end histogram helper functions ---

      // create the three histograms using specific helpers
      createLinearHistogram(prices, 'price distribution', '$');
      createLinearHistogram(durations, 'flight time distribution', 'h');
      createTimeHistogram(dates, 'date');
    }

    // --- d3 rendering for flights list ---
    const flightsListContainer =
      infoPanel.select<HTMLDivElement>('.flights-list');
    flightsListContainer.selectAll('*').remove(); // clear previous items

    const flightsToShow = filteredFlights.current;
    const numToShow = 10;

    if (
      hoveredAirportsRef.current.left.size === 0 ||
      hoveredAirportsRef.current.right.size === 0
    ) {
      // message when not hovering both origins and destinations
      flightsListContainer
        .append('div')
        .style('color', 'rgba(255, 255, 255, 0.5)')
        .style('text-align', 'center')
        .style('padding-top', '20px')
        .text(
          'select origins (left) and destinations (right) to see available flights.'
        );
    } else if (flightsToShow.length === 0) {
      // message when airports selected but no flights match
      flightsListContainer
        .append('div')
        .style('color', 'rgba(255, 255, 255, 0.5)')
        .style('text-align', 'center')
        .style('padding-top', '20px')
        .text('no direct flights found for the current selection.');
    } else {
      // render flight items using d3
      flightsToShow.slice(0, numToShow).forEach((flight) => {
        const item = flightsListContainer
          .append('div')
          .attr('class', 'flight-item')
          .style('padding', '12px')
          .style('border-radius', '6px')
          .style('background', 'rgba(255, 255, 255, 0.07)')
          .style('display', 'flex')
          .style('flex-direction', 'column')
          .style('gap', '8px');

        const header = item
          .append('div')
          .style('display', 'flex')
          .style('justify-content', 'space-between')
          .style('align-items', 'center');

        header
          .append('span')
          .style('font-weight', '600')
          .style('font-size', '16px')
          .text(`${flight.origin} → ${flight.destination}`);

        header
          .append('span')
          .style('color', 'rgba(255, 255, 255, 0.7)')
          .style('font-weight', '500')
          .style('font-size', '16px')
          .text(`$${flight.price.toFixed(2)}`);

        const details = item
          .append('div')
          .style('display', 'flex')
          .style('justify-content', 'space-between')
          .style('font-size', '14px')
          .style('color', 'rgba(255, 255, 255, 0.6)');

        // show flight id instead of airline placeholder
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
          .style('font-size', '14px')
          .style('color', 'rgba(255, 255, 255, 0.5)')
          .text(formattedDate);
      });

      if (flightsToShow.length > numToShow) {
        flightsListContainer
          .append('div')
          .style('color', 'rgba(255, 255, 255, 0.5)')
          .style('font-size', '14px')
          .style('text-align', 'center')
          .style('padding-top', '8px')
          .text(`... and ${flightsToShow.length - numToShow} more flights`);
      }
    }
    // --- end d3 rendering ---
  };

  useEffect(() => {
    // add guard clause for svg ref
    const currentSvg = svgRef.current;
    if (!currentSvg) {
      return;
    }
    const svg = d3.select(currentSvg);
    svg.selectAll('*').remove(); // clear previous renders

    // add filter definitions for drop shadows
    const defs = svg.append('defs');

    // map shadow filter
    defs
      .append('filter')
      .attr('id', 'map-shadow')
      .append('feDropShadow')
      .attr('dx', 0)
      .attr('dy', 2)
      .attr('stdDeviation', 3)
      .attr('flood-opacity', 0.5);

    // airport shadow filter
    defs
      .append('filter')
      .attr('id', 'airport-shadow')
      .append('feDropShadow')
      .attr('dx', 0)
      .attr('dy', 1)
      .attr('stdDeviation', 2)
      .attr('flood-opacity', 0.75);

    const g = svg.append('g'); // main group for transformations
    gRef.current = g.node();

    // load all three data files using Promise.all
    Promise.all([
      d3.json<WorldTopology>('/src/assets/world110.topo.json'),
      d3.json<Airport[]>('/src/assets/airports.json'),
      d3.json<Flight[]>('/src/assets/flights.json'), // load flight data
    ])
      .then(([topology, airports, flights]) => {
        // add flights to destructuring
        if (!topology || !topology.objects.countries || !airports || !flights) {
          // check flights
          console.error('failed to load data.');
          return;
        }

        // setAllFlights(flights); // store all flights in state - changed to ref
        allFlights.current = flights;

        // explicitly type the feature collection
        const geoFeature = topojson.feature(
          topology,
          topology.objects.countries
        ) as FeatureCollection<Geometry, CountryProperties>;

        // adjust projection for the new map width (2/3 of total)
        const projection = d3
          .geoEqualEarth()
          .center([-75, 47]) // center on north atlantic
          .translate([mapWidth / 2, totalHeight / 3.75]) // translate projection center to svg center
          .scale(800); // increased scale to zoom in on the north atlantic

        const path = d3.geoPath().projection(projection);

        // create a group for map features
        const mapGroup = g
          .append('g')
          .attr('class', 'map-features')
          .style('pointer-events', 'none')
          .style('filter', 'url(#map-shadow)'); // apply map shadow

        // render map features in the map group
        mapGroup
          .selectAll('path')
          .data(geoFeature.features)
          .join('path')
          .attr('d', path) // draw country paths
          .attr('fill', defaultFill) // set default country fill
          .attr('stroke', strokeColor) // set country border color
          .attr('stroke-width', defaultStrokeWidth) // set country border width
          .attr('class', 'country') // add class for potential styling/selection
          .append('title') // add tooltip for country name
          .text((d) => d.properties?.name ?? 'unknown'); // display country name or 'unknown'

        // create airports group after map features to ensure it's rendered on top
        const airportsGroup = g
          .append('g')
          .attr('class', 'airports')
          .style('pointer-events', 'all') // ensure tooltips work
          .style('filter', 'url(#airport-shadow)'); // apply airport shadow

        // add airports
        airportsGroup
          .selectAll('circle')
          .data(airports)
          .join('circle')
          .attr('cx', (d) => {
            const coords = projection([d.Longitude, d.Latitude]);
            return coords ? coords[0] : 0;
          })
          .attr('cy', (d) => {
            const coords = projection([d.Longitude, d.Latitude]);
            return coords ? coords[1] : 0;
          })
          .attr('r', airportRadius / transformRef.current.k)
          .attr('fill', airportFill)
          .attr('stroke', airportStroke)
          .attr('stroke-width', airportStrokeWidth / transformRef.current.k)
          .attr('class', 'airport')
          .append('title')
          .text((d) => `${d['Airport Name']} (${d.IATA})`);

        // interaction handler for custom gesture events
        const handleInteraction: InteractionEventHandler = (
          event: InteractionEvent
        ) => {
          if (!gRef.current) return;

          switch (event.type) {
            case 'pointerover':
              // handle hover over airports
              if (
                event.element &&
                event.element.classList.contains('airport') &&
                event.handedness
              ) {
                const airport = event.element as SVGCircleElement;

                // add to appropriate hand's set
                hoveredAirportsRef.current[event.handedness].add(airport);

                // redraw all lines based on updated hovered sets
                redrawAllLines();
                updateInfoPanel();

                // apply hover style only if not selected by the other hand
                if (
                  airport !== selectedAirportsRef.current.left &&
                  airport !== selectedAirportsRef.current.right
                ) {
                  d3.select(airport)
                    .attr('fill', airportHighlightFill)
                    .attr('stroke', airportHighlightStroke)
                    .attr(
                      'stroke-width',
                      airportHighlightStrokeWidth / transformRef.current.k
                    )
                    .raise(); // bring to front
                }
              }
              break;

            case 'pointerout':
              // handle hover out for airports
              if (
                event.element &&
                event.element.classList.contains('airport') &&
                event.handedness &&
                event.element !== selectedAirportsRef.current.left &&
                event.element !== selectedAirportsRef.current.right
              ) {
                const airport = event.element as SVGCircleElement;
                const otherHand =
                  event.handedness === 'left' ? 'right' : 'left';

                // remove from appropriate hand's set
                hoveredAirportsRef.current[event.handedness].delete(airport);

                // redraw all lines based on updated hovered sets
                redrawAllLines();
                updateInfoPanel();

                // only reset style if not selected by the other hand
                if (airport !== selectedAirportsRef.current[otherHand]) {
                  d3.select(airport)
                    .attr('fill', airportFill)
                    .attr('stroke', airportStroke)
                    .attr(
                      'stroke-width',
                      airportStrokeWidth / transformRef.current.k
                    );
                }
              }
              break;

            case 'pointerselect':
              // handle airport selection
              if (
                event.element &&
                event.element.classList.contains('airport') &&
                event.handedness // ensure handedness is defined
              ) {
                const selectedAirport = event.element as SVGCircleElement;
                const hand = event.handedness;
                const currentSelection = selectedAirportsRef.current[hand];

                // case 1: clicking the currently selected airport for this hand -> unselect
                if (selectedAirport === currentSelection) {
                  // reset style
                  d3.select(selectedAirport)
                    .attr('fill', airportFill)
                    .attr('stroke', airportStroke)
                    .attr(
                      'stroke-width',
                      airportStrokeWidth / transformRef.current.k
                    );
                  // remove from selected state
                  selectedAirportsRef.current[hand] = null;
                  // remove from hovered set
                  hoveredAirportsRef.current[hand].delete(selectedAirport);
                  // redraw lines and update panel
                  redrawAllLines();
                  updateInfoPanel();
                }
                // case 2: selecting a new airport (or the first one) for this hand
                else {
                  // unselect previous airport for this hand, if any
                  if (currentSelection) {
                    const otherHand = hand === 'left' ? 'right' : 'left';
                    // only reset style if not selected by the other hand
                    if (
                      currentSelection !==
                      selectedAirportsRef.current[otherHand]
                    ) {
                      d3.select(currentSelection)
                        .attr('fill', airportFill)
                        .attr('stroke', airportStroke)
                        .attr(
                          'stroke-width',
                          airportStrokeWidth / transformRef.current.k
                        );
                    }
                    // remove old selection from hovered set
                    hoveredAirportsRef.current[hand].delete(currentSelection);
                  }

                  // select the new airport
                  selectedAirportsRef.current[hand] = selectedAirport;
                  // add new selection to the hovered set (pinned)
                  hoveredAirportsRef.current[hand].add(selectedAirport);

                  // apply selected style
                  d3.select(selectedAirport)
                    .attr('fill', airportFill) // keep fill default
                    .attr('stroke', airportSelectedStroke)
                    .attr(
                      'stroke-width',
                      airportSelectedStrokeWidth / transformRef.current.k
                    )
                    .raise(); // bring to front

                  // redraw lines and update panel
                  redrawAllLines();
                  updateInfoPanel();
                }
              }
              break;

            case 'drag':
              // handle map panning with single-handed drag
              transformRef.current = {
                ...transformRef.current,
                x: event.transform.x,
                y: event.transform.y,
              };

              // apply the transform
              g.attr(
                'transform',
                `translate(${transformRef.current.x},${transformRef.current.y}) scale(${transformRef.current.k})`
              );

              // update line positions
              activeLinesByPair.current.forEach((line) => {
                d3.select(line).attr(
                  'stroke-width',
                  lineWidth / transformRef.current.k
                );
              });
              break;

            case 'zoom':
              // handle map zooming with two-handed gesture
              transformRef.current = {
                k: event.transform.scale,
                x: event.transform.x,
                y: event.transform.y,
              };

              // apply the transform to the main group
              g.attr(
                'transform',
                `translate(${transformRef.current.x},${transformRef.current.y}) scale(${transformRef.current.k})`
              );

              // adjust airport circle sizes and stroke width inversely to the zoom scale
              g.selectAll('circle.airport')
                .attr('r', airportRadius / transformRef.current.k)
                .attr('stroke-width', (d, i, nodes) => {
                  const element = nodes[i] as SVGCircleElement;
                  // check if selected by either hand
                  if (
                    element === selectedAirportsRef.current.left ||
                    element === selectedAirportsRef.current.right
                  ) {
                    return airportSelectedStrokeWidth / transformRef.current.k;
                  }
                  // check if hovered by a hand that doesn't have a selection
                  let isHoveredNotSelected = false;
                  if (
                    hoveredAirportsRef.current.left.has(element) &&
                    !selectedAirportsRef.current.left
                  ) {
                    isHoveredNotSelected = true;
                  }
                  if (
                    hoveredAirportsRef.current.right.has(element) &&
                    !selectedAirportsRef.current.right
                  ) {
                    isHoveredNotSelected = true;
                  }
                  if (isHoveredNotSelected) {
                    // note: this might override selection stroke if hovered by one hand and selected by the other
                    // selection stroke should take precedence, handled by the 'if' above.
                    // we only care about hover stroke if not selected.
                    return airportHighlightStrokeWidth / transformRef.current.k;
                  }
                  return airportStrokeWidth / transformRef.current.k;
                })
                .attr('stroke', (d, i, nodes) => {
                  const element = nodes[i] as SVGCircleElement;
                  if (
                    element === selectedAirportsRef.current.left ||
                    element === selectedAirportsRef.current.right
                  ) {
                    return airportSelectedStroke;
                  }
                  // check if hovered by a hand that doesn't have a selection
                  let isHoveredNotSelected = false;
                  if (
                    hoveredAirportsRef.current.left.has(element) &&
                    !selectedAirportsRef.current.left
                  ) {
                    isHoveredNotSelected = true;
                  }
                  if (
                    hoveredAirportsRef.current.right.has(element) &&
                    !selectedAirportsRef.current.right
                  ) {
                    isHoveredNotSelected = true;
                  }
                  if (isHoveredNotSelected) {
                    return airportHighlightStroke;
                  }
                  return airportStroke; // default stroke
                });

              // update line positions and widths
              activeLinesByPair.current.forEach((line) => {
                d3.select(line).attr(
                  'stroke-width',
                  lineWidth / transformRef.current.k
                );
              });
              break;

            default:
              break;
          }
        };

        // setup event listener to handle interaction events from parent
        const parent = currentSvg.parentElement;
        if (parent) {
          const handler = (e: CustomEvent<InteractionEvent>) =>
            handleInteraction(e.detail);

          parent.addEventListener('interaction', handler as EventListener);

          // return cleanup function for this listener
          return () => {
            parent.removeEventListener('interaction', handler as EventListener);
          };
        }

        // cleanup function
        return () => {
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
          }
          clearAllLines();
        };
      })
      .catch((error) => {
        console.error('error loading or processing data:', error);
      });
  }, []); // empty dependency array ensures this runs once on mount

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
          gap: '16px',
        }}
      >
        {/* current selections title */}
        <h2
          style={{
            margin: '0 0 -8px 0',
            fontSize: '20px',
            color: 'rgba(255, 255, 255, 0.85)',
            fontWeight: 600,
            textTransform: 'lowercase',
            letterSpacing: '0.05em',
          }}
        >
          current selections
        </h2>

        {/* origin and destination boxes section */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginTop: '8px',
          }}
        >
          {/* origins box */}
          <div
            className='origins-box'
            style={{
              flex: 1,
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.07)',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              height: '220px',
              overflow: 'hidden',
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
              }}
            >
              origins
            </h3>
            {/* origins box content rendered by d3 */}
            <div
              className='content'
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                overflow: 'hidden',
              }}
            />
          </div>

          {/* destinations box */}
          <div
            className='destinations-box'
            style={{
              flex: 1,
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.07)',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              height: '220px',
              overflow: 'hidden',
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
              }}
            >
              destinations
            </h3>
            {/* destinations box content rendered by d3 */}
            <div
              className='content'
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                overflow: 'hidden',
              }}
            />
          </div>
        </div>

        {/* available flights section */}
        <div
          style={{
            marginTop: '8px',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            overflow: 'hidden',
            paddingBottom: '10px',
            scrollbarWidth: 'thin',
            scrollbarColor:
              'rgba(255, 255, 255, 0.3) rgba(255, 255, 255, 0.05)',
          }}
        >
          <h2
            style={{
              margin: '0 0 -8px 0',
              fontSize: '20px',
              color: 'rgba(255, 255, 255, 0.85)',
              fontWeight: 600,
              textTransform: 'lowercase',
              letterSpacing: '0.05em',
            }}
          >
            available flights
          </h2>
          <div
            className='flights-list'
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              overflowY: 'auto',
              flex: 1,
            }}
          >
            {/* flight items rendered using d3 */}
          </div>
        </div>

        {/* flight distributions title */}
        <h2
          style={{
            margin: '0 0 -8px 0',
            fontSize: '20px',
            color: 'rgba(255, 255, 255, 0.85)',
            fontWeight: 600,
            textTransform: 'lowercase',
            letterSpacing: '0.05em',
          }}
        >
          flight distributions
        </h2>

        {/* distributions section */}
        <div
          className='distributions-container'
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
            height: `${totalHeight * 0.25}px`,
          }}
        >
          {/* distribution bars rendered by d3 */}
        </div>
      </div>
    </>
  );
};

export default WorldMap;
