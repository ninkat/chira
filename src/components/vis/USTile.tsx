import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
} from 'geojson';
import {
  Topology as TopoTopology,
  GeometryCollection,
} from 'topojson-specification';
import { InteractionEvent } from '@/types/interactionTypes';

// mapping of state names to their correct abbreviations
// because tiles.topo.json doesn't have them
const stateAbbreviations: Record<string, string> = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  DELAWARE: 'DE',
  'DISTRICT OF COLUMBIA': 'DC',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  IOWA: 'IA',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MAINE: 'ME',
  MARYLAND: 'MD',
  MASSACHUSETTS: 'MA',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSISSIPPI: 'MS',
  MISSOURI: 'MO',
  MONTANA: 'MT',
  NEBRASKA: 'NE',
  NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VERMONT: 'VT',
  VIRGINIA: 'VA',
  WASHINGTON: 'WA',
  'WEST VIRGINIA': 'WV',
  WISCONSIN: 'WI',
  WYOMING: 'WY',
};

// types for topojson data
interface TileGeometry {
  type: string;
  id: string;
  properties: {
    name: string;
    tilegramValue: number;
  };
}

interface TileTopology extends TopoTopology {
  objects: {
    tiles: GeometryCollection;
  };
}

// type for handedness
type Handedness = 'left' | 'right';

// types for migration data
interface Migration {
  origin: string;
  destination: string;
  value: number;
}

interface MigrationData {
  migrations: Migration[];
}

// constants for hover and selection styling
const defaultFill = 'rgba(170,170,170,0.5)';
const leftHandHoverFill = 'rgba(232, 27, 35, 0.5)'; // light pink
const rightHandHoverFill = 'rgba(0, 174, 243, 0.5)'; // light blue
const defaultStrokeWidth = 1;
const hoverStrokeWidth = 2;

// constants for line animation
const lineAnimationDuration = 5000; // 2 seconds per animation
const lineColor = 'rgba(116, 100, 139, 0.9)'; // brighter blue color
const lineWidth = 5;
const dotSize = 4; // larger dots
const dotSpacing = 20; // closer spacing

const USTile: React.FC = () => {
  // refs for svg and group elements
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // ref for migration data instead of state
  const migrationDataRef = useRef<Migration[]>([]);

  // refs for tracking hover states for each hand
  const hoveredElementsRef = useRef<Record<Handedness, Set<SVGPathElement>>>({
    left: new Set(),
    right: new Set(),
  });

  // ref for storing state name to centroid mapping
  const stateCentroidsRef = useRef<Record<string, [number, number]>>({});

  // ref to track active migration lines
  const activeLinesByPair = useRef<Map<string, SVGPathElement>>(new Map());

  // dimensions
  const width = 1920;
  const height = 1080;

  // function to get state name from path element
  const getStateName = (element: SVGPathElement): string | null => {
    const datum = d3.select(element).datum() as Feature<
      Geometry,
      TileGeometry['properties']
    >;
    return datum?.properties?.name || null;
  };

  // function to get pair key for origin-destination
  const getPairKey = (origin: string, destination: string) =>
    `${origin}->${destination}`;

  // function to animate migration line
  const animateMigrationLine = (origin: string, destination: string) => {
    if (!svgRef.current) return;

    const pairKey = getPairKey(origin, destination);

    // if line already exists for this pair, don't create a new one
    if (activeLinesByPair.current.has(pairKey)) {
      return;
    }

    const originCentroid = stateCentroidsRef.current[origin];
    const destCentroid = stateCentroidsRef.current[destination];
    if (!originCentroid || !destCentroid) return;

    const lineGenerator = d3.line();
    const pathData = lineGenerator([originCentroid, destCentroid]);
    if (!pathData) return;

    const svg = d3.select(svgRef.current);
    const line = svg
      .append('path')
      .attr('d', pathData)
      .attr('stroke', lineColor)
      .attr('stroke-width', lineWidth)
      .attr('fill', 'none')
      .style('stroke-dasharray', `${dotSize} ${dotSpacing}`)
      .style('stroke-linecap', 'round')
      .attr('pathLength', 1000);

    // Store the line element
    activeLinesByPair.current.set(pairKey, line.node()!);

    // Create flowing animation that repeats
    const animate = () => {
      line
        .style('stroke-dashoffset', 1000)
        .transition()
        .duration(lineAnimationDuration)
        .ease(d3.easeLinear)
        .style('stroke-dashoffset', 0) // animate to zero offset
        .on('end', animate); // repeat animation
    };

    animate();
  };

  // function to clear lines that are no longer needed
  const clearUnusedLines = (
    currentOrigins: Set<string>,
    currentDestinations: Set<string>
  ) => {
    // remove lines whose origin or destination is no longer hovered
    for (const [key, line] of activeLinesByPair.current.entries()) {
      const [origin, destination] = key.split('->');
      if (
        !currentOrigins.has(origin) ||
        !currentDestinations.has(destination)
      ) {
        d3.select(line).transition().duration(200).style('opacity', 0).remove();
        activeLinesByPair.current.delete(key);
      }
    }
  };

  // function to clear all lines
  const clearAllLines = () => {
    activeLinesByPair.current.forEach((line) => {
      d3.select(line).transition().duration(200).style('opacity', 0).remove();
    });
    activeLinesByPair.current.clear();
  };

  // function to calculate total migration value
  const calculateMigrationValue = () => {
    const originStates = new Set<string>();
    const destStates = new Set<string>();

    // collect all origin and destination states
    hoveredElementsRef.current.left.forEach((element) => {
      const stateName = getStateName(element);
      if (stateName) originStates.add(stateName);
    });

    hoveredElementsRef.current.right.forEach((element) => {
      const stateName = getStateName(element);
      if (stateName) destStates.add(stateName);
    });

    // clear lines that are no longer valid
    clearUnusedLines(originStates, destStates);

    // calculate total migration value
    let totalValue = 0;
    originStates.forEach((origin) => {
      destStates.forEach((destination) => {
        const migration = migrationDataRef.current.find(
          (m) => m.origin === origin && m.destination === destination
        );
        if (migration) {
          totalValue += migration.value;
          animateMigrationLine(origin, destination);
        }
      });
    });

    return totalValue;
  };

  // function to update tooltip
  const updateTooltip = () => {
    if (!tooltipRef.current) return;

    const hasLeftHover = hoveredElementsRef.current.left.size > 0;
    const hasRightHover = hoveredElementsRef.current.right.size > 0;

    if (hasLeftHover && hasRightHover) {
      const totalValue = calculateMigrationValue();
      tooltipRef.current.textContent = `Total Migration: ${totalValue.toLocaleString()}`;
      tooltipRef.current.style.display = 'block';
    } else {
      tooltipRef.current.style.display = 'none';
      // Clear all lines if either hand has no hovers
      clearAllLines();
    }
  };

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;

    // Load migration data only once and store in ref
    if (migrationDataRef.current.length === 0) {
      d3.json<MigrationData>('./src/assets/migration.json')
        .then((data) => {
          if (data) {
            migrationDataRef.current = data.migrations;
          }
        })
        .catch((error) => {
          console.error('Error loading migration data:', error);
        });
    }

    // Clear any existing lines when component mounts/unmounts
    return () => {
      clearAllLines();
    };
  }, []);

  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;

    // clear previous content
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // create main group
    const g = svg.append('g');

    // load and render tilemap
    d3.json('/src/assets/tiles.topo.json').then((topology) => {
      if (!topology) return;

      // convert topojson to geojson
      const geoFeature = topojson.feature(
        topology as TileTopology,
        (topology as TileTopology).objects.tiles
      ) as unknown as FeatureCollection<Geometry, GeoJsonProperties>;

      // get the bounds from the topology transform
      const topoBbox = (topology as TileTopology).bbox;

      if (!topoBbox) return;

      // calculate scale to fit the svg while maintaining aspect ratio
      const bboxWidth = topoBbox[2] - topoBbox[0];
      const bboxHeight = topoBbox[3] - topoBbox[1];
      const scale = Math.min(width / bboxWidth, height / bboxHeight) * 0.8;

      // compute the center by taking into account the actual bounds
      const centerX = width * 0.5;
      const centerY = height * 0.5;

      // calculate the offset to center the map based on its actual bounds
      const xOffset = (topoBbox[0] + topoBbox[2]) / 2;
      const yOffset = (topoBbox[1] + topoBbox[3]) / 2;

      // create a custom projection that just scales and translates
      const projection = d3
        .geoIdentity()
        .scale(scale)
        .reflectY(true)
        .translate([centerX - xOffset * scale, centerY + yOffset * scale]);

      // path generator for map features
      const path = d3.geoPath().projection(projection);

      // store centroids for each state
      geoFeature.features.forEach((feature) => {
        const stateName = feature.properties?.name;
        if (stateName) {
          const centroid = path.centroid(feature);
          if (!isNaN(centroid[0]) && !isNaN(centroid[1])) {
            stateCentroidsRef.current[stateName] = centroid;
          }
        }
      });

      // draw tiles
      g.selectAll('path')
        .data(geoFeature.features)
        .join('path')
        .attr('class', 'tile')
        .attr('d', path)
        .attr('fill', defaultFill)
        .attr('stroke', '#fff')
        .attr('stroke-width', defaultStrokeWidth)
        .style('pointer-events', 'all'); // enable pointer events

      // add state labels
      g.selectAll('text')
        .data(geoFeature.features)
        .join('text')
        .attr('pointer-events', 'none')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', '#333')
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .attr('x', (d) => {
          const centroid = path.centroid(d);
          return isNaN(centroid[0]) ? 0 : centroid[0];
        })
        .attr('y', (d) => {
          const centroid = path.centroid(d);
          return isNaN(centroid[1]) ? 0 : centroid[1];
        })
        .text((d) => {
          const feature = d as Feature<Geometry, TileGeometry['properties']>;
          return feature.properties?.name
            ? stateAbbreviations[feature.properties.name] || ''
            : '';
        });

      // add event listeners for the svg element
      const svgElement = svgRef.current;
      if (svgElement) {
        // handle interaction events
        svgElement.addEventListener('interaction', ((
          event: CustomEvent<InteractionEvent>
        ) => {
          const detail = event.detail;

          switch (detail.type) {
            case 'pointerover': {
              const { handedness } = detail;
              if (
                !handedness ||
                (handedness !== 'left' && handedness !== 'right')
              )
                return;

              const element = document.elementFromPoint(
                detail.point.clientX,
                detail.point.clientY
              );

              if (element instanceof SVGPathElement) {
                // add to set of hovered elements for this hand
                hoveredElementsRef.current[handedness].add(element);

                // highlight the tile with hand-specific color
                d3.select(element)
                  .attr(
                    'fill',
                    handedness === 'left'
                      ? leftHandHoverFill
                      : rightHandHoverFill
                  )
                  .attr('stroke-width', hoverStrokeWidth);

                updateTooltip();
              }
              break;
            }
            case 'pointerout': {
              const { handedness, element: eventElement } = detail;
              if (
                !handedness ||
                (handedness !== 'left' && handedness !== 'right')
              )
                return;

              // use the element from the event if provided
              const hoveredElement =
                eventElement ||
                Array.from(hoveredElementsRef.current[handedness])[0];

              if (hoveredElement instanceof SVGPathElement) {
                // remove from set of hovered elements for this hand
                hoveredElementsRef.current[handedness].delete(hoveredElement);

                // check if the element is still being hovered by the other hand
                const otherHand: Handedness =
                  handedness === 'left' ? 'right' : 'left';
                const isHoveredByOtherHand =
                  hoveredElementsRef.current[otherHand].has(hoveredElement);

                // only reset style if not hovered by other hand
                if (!isHoveredByOtherHand) {
                  d3.select(hoveredElement)
                    .attr('fill', defaultFill)
                    .attr('stroke-width', defaultStrokeWidth);
                }

                updateTooltip();
              }
              break;
            }
          }
        }) as EventListener);
      }
    });
  }, []);

  return (
    <>
      <svg
        ref={svgRef}
        width='100%'
        height='100%'
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio='xMidYMid meet'
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '100%',
          height: '100%',
          overflow: 'visible',
        }}
      >
        <g ref={gRef} />
      </svg>
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          top: '40px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(33, 33, 33, 0.95)',
          color: 'white',
          padding: '16px 24px',
          borderRadius: '8px',
          boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
          display: 'none',
          zIndex: 1000,
          fontSize: '24px',
          fontWeight: 'bold',
          border: '2px solid rgba(255, 255, 255, 0.2)',
          minWidth: '300px',
          textAlign: 'center',
          backdropFilter: 'blur(4px)',
        }}
      />
    </>
  );
};

export default USTile;
