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

// constants for layout
const totalWidth = 1920;
const totalHeight = 1080;
const thirdWidth = totalWidth / 3;
const mapWidth = thirdWidth * 2;
const panelWidth = thirdWidth;

// constants for info panel styling
const panelBackground = 'rgba(33, 33, 33, 0.95)';
const panelTextColor = 'white';
const panelBorderRadius = '8px';
const panelPadding = '24px';

// interface for migration link info
interface MigrationLinkInfo {
  origin: string;
  destination: string;
  value: number;
}

const USTile: React.FC = () => {
  // refs for svg and group elements
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);

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

  // ref for active migration links info
  const activeMigrationLinksRef = useRef<MigrationLinkInfo[]>([]);

  // dimensions for the visualization
  const width = totalWidth;
  const height = totalHeight;

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

    // adjust centroids for panel offset
    const adjustedOriginCentroid: [number, number] = [
      originCentroid[0] + panelWidth,
      originCentroid[1],
    ];
    const adjustedDestCentroid: [number, number] = [
      destCentroid[0] + panelWidth,
      destCentroid[1],
    ];

    const lineGenerator = d3.line();
    const pathData = lineGenerator([
      adjustedOriginCentroid,
      adjustedDestCentroid,
    ]);
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

  // function to clear all lines
  const clearAllLines = () => {
    activeLinesByPair.current.forEach((line) => {
      d3.select(line).transition().duration(200).style('opacity', 0).remove();
    });
    activeLinesByPair.current.clear();
  };

  // function to format migration value
  const formatMigrationValue = (value: number): string => {
    return value.toLocaleString();
  };

  // function to update migration info
  const updateMigrationInfo = () => {
    // collect all origin and destination states
    const originStates = new Set<string>();
    const destStates = new Set<string>();

    hoveredElementsRef.current.left.forEach((element) => {
      const stateName = getStateName(element);
      if (stateName) originStates.add(stateName);
    });

    hoveredElementsRef.current.right.forEach((element) => {
      const stateName = getStateName(element);
      if (stateName) destStates.add(stateName);
    });

    // early return if no states selected
    if (originStates.size === 0 || destStates.size === 0) {
      clearAllLines();

      // update info panel to show default message
      const infoPanel = d3.select('.info-panel');
      if (!infoPanel.empty()) {
        infoPanel
          .select('.total-migration')
          .text('Select states to view data')
          .style('opacity', 0.5);

        infoPanel.select('.migration-links').selectAll('div').remove();
      }

      activeMigrationLinksRef.current = [];
      return 0;
    }

    // clear all lines and recreate them based on current hover state
    // this ensures the visualization stays in sync with hover state
    clearAllLines();

    // calculate total migration value and collect link info
    let totalValue = 0;
    const newMigrationLinks: MigrationLinkInfo[] = [];
    const migrationsByPair = new Map<string, number>();

    // find all valid migrations between selected states
    migrationDataRef.current.forEach((migration) => {
      if (
        originStates.has(migration.origin) &&
        destStates.has(migration.destination)
      ) {
        const pairKey = getPairKey(migration.origin, migration.destination);

        // if we already have this pair, add to its value
        if (migrationsByPair.has(pairKey)) {
          migrationsByPair.set(
            pairKey,
            migrationsByPair.get(pairKey)! + migration.value
          );
        } else {
          migrationsByPair.set(pairKey, migration.value);
        }

        totalValue += migration.value;
      }
    });

    // convert map to array for sorting
    migrationsByPair.forEach((value, pairKey) => {
      const [origin, destination] = pairKey.split('->');
      newMigrationLinks.push({
        origin,
        destination,
        value,
      });

      // create animation for this pair
      animateMigrationLine(origin, destination);
    });

    // sort migration links by value in descending order
    newMigrationLinks.sort((a, b) => b.value - a.value);

    // store top 10 migrations
    activeMigrationLinksRef.current = newMigrationLinks.slice(0, 10);

    // update info panel
    const infoPanel = d3.select('.info-panel');
    if (!infoPanel.empty()) {
      // update total migration
      infoPanel
        .select('.total-migration')
        .text(formatMigrationValue(totalValue))
        .style('opacity', 1);

      // completely replace migration links list for consistency
      const migrationLinksContainer = infoPanel.select('.migration-links');
      migrationLinksContainer.selectAll('div').remove();

      // add new links
      activeMigrationLinksRef.current.forEach((link) => {
        migrationLinksContainer
          .append('div')
          .style('opacity', 0)
          .style('margin-bottom', '8px')
          .style('padding', '8px 12px')
          .style('background', 'rgba(255, 255, 255, 0.05)')
          .style('border-radius', '6px')
          .html(
            `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-weight: 500;">${stateAbbreviations[link.origin]} → ${stateAbbreviations[link.destination]}</span>
              <span style="color: rgba(255, 255, 255, 0.7);">${formatMigrationValue(link.value)}</span>
            </div>
          `
          )
          .transition()
          .duration(200)
          .style('opacity', 1);
      });
    }

    return totalValue;
  };

  // update tooltip to properly reflect current state
  const updateTooltip = () => {
    const hasLeftHover = hoveredElementsRef.current.left.size > 0;
    const hasRightHover = hoveredElementsRef.current.right.size > 0;

    const infoPanel = d3.select('.info-panel');
    if (!infoPanel.empty()) {
      if (hasLeftHover && hasRightHover) {
        // update panel with migration info
        updateMigrationInfo();
        infoPanel.style('opacity', 1);
      } else {
        // reset to default state
        infoPanel
          .select('.total-migration')
          .text('Select states to view data')
          .style('opacity', 0.5);

        // clear migration links
        infoPanel.select('.migration-links').selectAll('div').remove();

        // keep panel visible but clear lines and links
        infoPanel.style('opacity', 1);
        clearAllLines();
        activeMigrationLinksRef.current = [];
      }
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
                  handedness === 'left' ? leftHandHoverFill : rightHandHoverFill
                )
                .attr('stroke-width', hoverStrokeWidth);

              // Update the information panel immediately
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

              // Update the information panel immediately
              updateTooltip();
            }
            break;
          }
        }
      }) as EventListener);
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

    // create main group with offset for tilemap
    const g = svg.append('g').attr('transform', `translate(${panelWidth}, 0)`);

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

      // calculate the maximum possible scale that fits in the right two-thirds
      // add a small padding (0.95) to ensure it doesn't touch the edges
      const scale = Math.min(mapWidth / bboxWidth, height / bboxHeight) * 0.95;

      // compute the center of the available space
      const centerX = mapWidth * 0.5;
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

      // draw tiles with larger stroke width for better visibility
      g.selectAll('path')
        .data(geoFeature.features)
        .join('path')
        .attr('class', 'tile')
        .attr('d', path)
        .attr('fill', defaultFill)
        .attr('stroke', '#fff')
        .attr('stroke-width', defaultStrokeWidth)
        .style('pointer-events', 'all');

      // add state labels with adjusted font size for better visibility
      g.selectAll('text')
        .data(geoFeature.features)
        .join('text')
        .attr('pointer-events', 'none')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', '#333')
        .attr('font-size', '14px') // slightly larger font
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
        className='info-panel'
        style={{
          position: 'fixed',
          top: '50%',
          left: `${totalWidth * 0.16666}px`,
          transform: 'translate(-50%, -50%)',
          background: panelBackground,
          color: panelTextColor,
          padding: panelPadding,
          borderRadius: panelBorderRadius,
          boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
          width: `${panelWidth * 0.8}px`,
          maxHeight: '90vh',
          zIndex: 1000,
          fontSize: '16px',
          border: '2px solid rgba(255, 255, 255, 0.2)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: '14px',
              color: 'rgba(255, 255, 255, 0.6)',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Total Migration
          </h3>
          <div
            className='total-migration'
            style={{
              fontSize: '32px',
              fontWeight: 600,
              background:
                'linear-gradient(135deg, #fff, rgba(255, 255, 255, 0.7))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              opacity: 0.5,
            }}
          >
            Select states to view data
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            flex: 1,
            minHeight: 0,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: '14px',
              color: 'rgba(255, 255, 255, 0.6)',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Migration Flows
          </h3>
          <div
            className='migration-links'
            style={{
              overflowY: 'auto',
              flex: 1,
              paddingRight: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          />
        </div>
      </div>
    </>
  );
};

export default USTile;
