import React, { useEffect, useRef, useContext, useState } from 'react';
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
  GeometryCollection as TopoGeometryCollection,
} from 'topojson-specification';
import * as Y from 'yjs';
import { YjsContext } from '@/context/YjsContext';
import { InteractionEvent } from '@/types/interactionTypes';

// local interface to handle potentially varying event detail structure for pointerover
interface PointerOverDetail {
  type: 'pointerover'; // or other relevant types from InteractionEvent
  handedness?: 'left' | 'right';
  elements?: Element[];
  element?: Element;
  // include other common properties from InteractionEvent if necessary, or make them optional
  // e.g., target?: EventTarget | null;
  // point?: { clientx: number; clienty: number };
}

// mapping of state names to their correct abbreviations
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
    tiles: TopoGeometryCollection;
  };
}

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
const defaultFill = 'rgba(170,170,170,0.4)';
const leftHandHoverFill = 'rgba(232, 27, 35, 0.6)';
const rightHandHoverFill = 'rgba(0, 174, 243, 0.6)';
const defaultStrokeWidth = 1.5;
const hoverStrokeWidth = 2.5;

// constants for line animation
const lineAnimationDuration = 5000;
const lineColor = 'rgba(116, 100, 139, 0.9)';
const lineWidth = 5;
const dotSize = 4;
const dotSpacing = 20;

// constants for layout
const totalWidth = 1280;
const totalHeight = 720;
const thirdWidth = totalWidth / 3;
const mapWidth = thirdWidth * 2;
const panelWidth = thirdWidth;

// constants for info panel styling (will be adapted for d3)
const panelBgColor = 'rgba(33, 33, 33, 0.65)';
const panelTxtColor = 'white';
const panelBorderRad = '8px';
const mainPadding = 36; // Define padding for consistency at a higher scope
const tooltipPanelWidth = panelWidth * 0.8; // Define tooltipPanelWidth at a higher scope

// interface for migration link info
interface MigrationLinkInfo {
  origin: string;
  destination: string;
  value: number;
}

const USTileYjs: React.FC = () => {
  const svgRef = useRef<SVGSVGElement>(null);
  const migrationDataRef = useRef<Migration[]>([]);
  const stateCentroidsRef = useRef<Record<string, [number, number]>>({});
  const activeLinesByPair = useRef<Map<string, SVGPathElement>>(new Map());
  const isInitializedRef = useRef(false);
  const tooltipRef = useRef<SVGGElement | null>(null);

  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;
  const [syncStatus, setSyncStatus] = useState<boolean>(false);
  const [migrationDataLoaded, setMigrationDataLoaded] = useState(false);

  const yHoveredLeftStates = doc?.getArray<string>('usTileHoveredLeftStates');
  const yHoveredRightStates = doc?.getArray<string>('usTileHoveredRightStates');
  const yActiveMigrationLinks = doc?.getArray<Y.Map<unknown>>(
    'usTileActiveMigrationLinks'
  );
  const yTotalMigrationValue = doc?.getMap<string | number>(
    'usTileTotalMigrationValue'
  );

  const width = totalWidth;
  const height = totalHeight;

  useEffect(() => {
    if (!doc) return;
    const timeout = setTimeout(() => {
      console.log('assuming sync for ustileyjs visualization');
      setSyncStatus(true);
    }, 1500);
    return () => clearTimeout(timeout);
  }, [doc]);

  const getStateName = (element: SVGPathElement): string | null => {
    const datum = d3.select(element).datum() as Feature<
      Geometry,
      TileGeometry['properties']
    >;
    return datum?.properties?.name || null;
  };

  const getPairKey = (origin: string, destination: string): string =>
    `${origin}->${destination}`;

  const formatMigrationValue = (value: number | string): string => {
    if (typeof value === 'number') return value.toLocaleString();
    return String(value);
  };

  const animateMigrationLine = (origin: string, destination: string) => {
    if (!svgRef.current) return;
    const pairKey = getPairKey(origin, destination);
    if (activeLinesByPair.current.has(pairKey)) return;

    const originCentroid = stateCentroidsRef.current[origin];
    const destCentroid = stateCentroidsRef.current[destination];
    if (!originCentroid || !destCentroid) return;

    const adjustedOriginCentroid: [number, number] = [
      originCentroid[0] + panelWidth,
      originCentroid[1] - totalHeight * 0.1,
    ];
    const adjustedDestCentroid: [number, number] = [
      destCentroid[0] + panelWidth,
      destCentroid[1] - totalHeight * 0.1,
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
      .attr('class', 'migration-line')
      .attr('d', pathData)
      .attr('stroke', lineColor)
      .attr('stroke-width', lineWidth)
      .attr('fill', 'none')
      .style('stroke-dasharray', `${dotSize} ${dotSpacing}`)
      .style('stroke-linecap', 'round')
      .attr('pathLength', 1000);

    activeLinesByPair.current.set(pairKey, line.node()!);

    const animate = () => {
      line
        .style('stroke-dashoffset', 1000)
        .transition()
        .duration(lineAnimationDuration)
        .ease(d3.easeLinear)
        .style('stroke-dashoffset', 0)
        .on('end', () => {
          if (activeLinesByPair.current.has(pairKey)) animate();
          else line.remove();
        });
    };
    animate();
  };

  const clearAllD3MigrationLines = () => {
    d3.select(svgRef.current).selectAll('path.migration-line').remove();
    activeLinesByPair.current.clear();
  };

  useEffect(() => {
    if (
      !doc ||
      !syncStatus ||
      !yHoveredLeftStates ||
      !yHoveredRightStates ||
      !yActiveMigrationLinks ||
      !yTotalMigrationValue ||
      migrationDataRef.current.length === 0
    )
      return;

    const calculateAndStoreMigrations = () => {
      const currentLeftHovered = yHoveredLeftStates.toArray();
      const currentRightHovered = yHoveredRightStates.toArray();
      const originStates = new Set<string>(currentLeftHovered);
      const destStates = new Set<string>(currentRightHovered);

      doc.transact(() => {
        if (originStates.size === 0 || destStates.size === 0) {
          if (yActiveMigrationLinks.length > 0) {
            yActiveMigrationLinks.delete(0, yActiveMigrationLinks.length);
          }
          yTotalMigrationValue.set('value', 'select states to view data');
        } else {
          let totalValue = 0;
          const newMigrationLinksInfo: MigrationLinkInfo[] = [];
          const migrationsByPair = new Map<string, number>();

          migrationDataRef.current.forEach((migration) => {
            if (
              originStates.has(migration.origin) &&
              destStates.has(migration.destination)
            ) {
              const pairKey = getPairKey(
                migration.origin,
                migration.destination
              );
              migrationsByPair.set(
                pairKey,
                (migrationsByPair.get(pairKey) || 0) + migration.value
              );
              totalValue += migration.value;
            }
          });

          migrationsByPair.forEach((value, pairKey) => {
            const [origin, destination] = pairKey.split('->');
            newMigrationLinksInfo.push({ origin, destination, value });
          });

          newMigrationLinksInfo.sort((a, b) => b.value - a.value);
          const topLinks = newMigrationLinksInfo.slice(0, 10);

          const currentYLinks = yActiveMigrationLinks.map(
            (m) => m.toJSON() as MigrationLinkInfo
          );
          if (JSON.stringify(currentYLinks) !== JSON.stringify(topLinks)) {
            yActiveMigrationLinks.delete(0, yActiveMigrationLinks.length);
            const yMapsToAdd = topLinks.map((link) => {
              const yMap = new Y.Map();
              Object.entries(link).forEach(([key, val]) => yMap.set(key, val));
              return yMap;
            });
            if (yMapsToAdd.length > 0) yActiveMigrationLinks.push(yMapsToAdd);
          }

          if (yTotalMigrationValue.get('value') !== totalValue) {
            yTotalMigrationValue.set('value', totalValue);
          }
        }
      }, 'update-migration-calculations');
    };

    yHoveredLeftStates.observeDeep(calculateAndStoreMigrations);
    yHoveredRightStates.observeDeep(calculateAndStoreMigrations);
    calculateAndStoreMigrations();

    return () => {
      yHoveredLeftStates.unobserveDeep(calculateAndStoreMigrations);
      yHoveredRightStates.unobserveDeep(calculateAndStoreMigrations);
    };
  }, [
    doc,
    syncStatus,
    yHoveredLeftStates,
    yHoveredRightStates,
    yActiveMigrationLinks,
    yTotalMigrationValue,
    migrationDataLoaded,
  ]);

  const renderVisuals = () => {
    if (
      !doc ||
      !svgRef.current ||
      !isInitializedRef.current ||
      !tooltipRef.current
    )
      return;

    const currentLeftHovered = yHoveredLeftStates?.toArray() || [];
    const currentRightHovered = yHoveredRightStates?.toArray() || [];
    const currentActiveLinks =
      yActiveMigrationLinks?.map(
        (ymap) => ymap.toJSON() as MigrationLinkInfo
      ) || [];
    const totalMigrationDisplayValue = formatMigrationValue(
      yTotalMigrationValue?.get('value') || 'select states to view data'
    );

    d3.select(svgRef.current)
      .select('g#map-group')
      .selectAll('path.tile')
      .each(function () {
        const tileElement = this as SVGPathElement;
        const stateName = d3.select(tileElement).attr('data-statename');
        const isLeftHover = stateName
          ? currentLeftHovered.includes(stateName)
          : false;
        const isRightHover = stateName
          ? currentRightHovered.includes(stateName)
          : false;
        let fill = defaultFill;
        let strokeWidth = defaultStrokeWidth;
        if (isLeftHover) {
          fill = leftHandHoverFill;
          strokeWidth = hoverStrokeWidth;
        }
        if (isRightHover) {
          fill = rightHandHoverFill;
          strokeWidth = hoverStrokeWidth;
        }
        if (isLeftHover && isRightHover) {
          fill = leftHandHoverFill;
        }
        d3.select(tileElement)
          .attr('fill', fill)
          .attr('stroke-width', strokeWidth);
      });

    const currentLineKeys = new Set(
      currentActiveLinks.map((l) => getPairKey(l.origin, l.destination))
    );
    activeLinesByPair.current.forEach((lineElement, pairKey) => {
      if (!currentLineKeys.has(pairKey)) {
        d3.select(lineElement).remove();
        activeLinesByPair.current.delete(pairKey);
      }
    });
    currentActiveLinks.forEach((link) => {
      if (link.origin && link.destination)
        animateMigrationLine(link.origin, link.destination);
    });

    const tooltip = d3.select(tooltipRef.current);
    tooltip
      .select('.tooltip-total-migration-value')
      .text(totalMigrationDisplayValue)
      .style(
        'font-size',
        totalMigrationDisplayValue === 'select states to view data'
          ? '24px'
          : '48px'
      )
      .style(
        'opacity',
        totalMigrationDisplayValue === 'select states to view data' ||
          totalMigrationDisplayValue === '0'
          ? 0.5
          : 1
      );

    const migrationLinksGroup = tooltip.select('.tooltip-migration-links');
    migrationLinksGroup.selectAll('*').remove();

    currentActiveLinks.forEach((link, i) => {
      const linkGroup = migrationLinksGroup
        .append('g')
        .attr('transform', `translate(0, ${i * 45})`);

      linkGroup
        .append('text')
        .attr('x', 0)
        .attr('y', 20)
        .style('font-size', '18px')
        .style('font-weight', '600')
        .style('fill', 'rgba(255, 255, 255, 0.9)')
        .text(
          `${stateAbbreviations[link.origin] || link.origin} → ${stateAbbreviations[link.destination] || link.destination}`
        );

      linkGroup
        .append('text')
        .attr('x', tooltipPanelWidth - 2 * mainPadding)
        .attr('y', 20)
        .attr('text-anchor', 'end')
        .style('font-size', '18px')
        .style('font-weight', '500')
        .style('fill', 'rgba(255, 255, 255, 0.8)')
        .text(formatMigrationValue(link.value));
    });
  };

  useEffect(() => {
    if (!syncStatus || !doc || !svgRef.current || isInitializedRef.current)
      return;
    console.log('ustileyjs: initializing base d3 map and tooltip structure');

    if (migrationDataRef.current.length === 0) {
      d3.json<MigrationData>('./src/assets/migration.json')
        .then((data) => {
          if (data) {
            migrationDataRef.current = data.migrations;
            setMigrationDataLoaded(true);
            if (isInitializedRef.current) renderVisuals();
          }
        })
        .catch((error) =>
          console.error('error loading migration data:', error)
        );
    }

    const svg = d3.select(svgRef.current);
    svg.selectAll('g#map-group').remove();
    svg.selectAll('g.d3-tooltip-container').remove();

    const mapGroup = svg
      .append('g')
      .attr('id', 'map-group')
      .attr('transform', `translate(${panelWidth}, ${-totalHeight * 0.1})`);

    const tooltipPanelHeight = 720;
    const tooltipX = 0;
    const tooltipY = totalHeight / 2 - tooltipPanelHeight / 2;

    const d3tooltip = svg
      .append('g')
      .attr('class', 'd3-tooltip-container')
      .attr('transform', `translate(${tooltipX}, ${tooltipY})`)
      .style('pointer-events', 'none');

    tooltipRef.current = d3tooltip.node();

    d3tooltip
      .append('rect')
      .attr('width', tooltipPanelWidth)
      .attr('height', tooltipPanelHeight)
      .attr('fill', panelBgColor)
      .attr('rx', panelBorderRad)
      .attr('ry', panelBorderRad)
      .style('box-shadow', '0 8px 32px rgba(0,0,0,0.25)')
      .style('border', '1px solid rgba(255, 255, 255, 0.15)');

    d3tooltip
      .append('text')
      .attr('class', 'tooltip-title-total')
      .attr('x', mainPadding)
      .attr('y', mainPadding + 24) // Adjusted y: padding + font-size
      .style('font-size', '24px') // Increased font-size
      .style('fill', 'rgba(255, 255, 255, 0.75)')
      .style('font-weight', '500')
      .text('total migration');

    d3tooltip
      .append('text')
      .attr('class', 'tooltip-total-migration-value')
      .attr('x', mainPadding)
      .attr('y', mainPadding + 24 + 15 + 48) // Adjusted y: prev_y_baseline + gap + font-size
      .style('font-size', '48px') // Increased font-size
      .style('font-weight', '700')
      .style('fill', panelTxtColor)
      .text('select states to view data');

    d3tooltip
      .append('text')
      .attr('class', 'tooltip-title-flows')
      .attr('x', mainPadding)
      .attr('y', mainPadding + 24 + 15 + 48 + 35 + 24) // Adjusted y: prev_y_baseline + gap + font-size
      .style('font-size', '24px') // Increased font-size
      .style('fill', 'rgba(255, 255, 255, 0.75)')
      .style('font-weight', '500')
      .text('migration flows');

    d3tooltip
      .append('g')
      .attr('class', 'tooltip-migration-links')
      .attr(
        'transform',
        `translate(${mainPadding}, ${mainPadding + 24 + 15 + 48 + 35 + 24 + 15})` // Adjusted y: prev_y_baseline + gap
      );

    d3.json('/src/assets/tiles.topo.json').then((topology) => {
      if (!topology) return;
      const geoFeature = topojson.feature(
        topology as TileTopology,
        (topology as TileTopology).objects.tiles
      ) as unknown as FeatureCollection<Geometry, GeoJsonProperties>;
      const topoBbox = (topology as TileTopology).bbox;
      if (!topoBbox) return;

      const bboxWidth = topoBbox[2] - topoBbox[0];
      const bboxHeight = topoBbox[3] - topoBbox[1];
      const scale = Math.min(mapWidth / bboxWidth, height / bboxHeight) * 0.95;
      const centerX = mapWidth * 0.5;
      const centerY = height * 0.5;
      const xOffset = (topoBbox[0] + topoBbox[2]) / 2;
      const yOffset = (topoBbox[1] + topoBbox[3]) / 2;
      const projection = d3
        .geoIdentity()
        .scale(scale)
        .reflectY(true)
        .translate([centerX - xOffset * scale, centerY + yOffset * scale]);
      const pathGenerator = d3.geoPath().projection(projection);

      stateCentroidsRef.current = {};
      geoFeature.features.forEach((feature) => {
        const stateName = feature.properties?.name;
        if (stateName) {
          const centroid = pathGenerator.centroid(feature);
          if (!isNaN(centroid[0]) && !isNaN(centroid[1]))
            stateCentroidsRef.current[stateName] = centroid;
        }
      });

      mapGroup
        .selectAll('path.tile')
        .data(geoFeature.features)
        .join('path')
        .attr('class', 'tile')
        .attr(
          'data-statename',
          (d) => (d.properties as TileGeometry['properties'])?.name || 'unknown'
        )
        .attr('d', pathGenerator)
        .attr('fill', defaultFill)
        .attr('stroke', '#fff')
        .attr('stroke-width', defaultStrokeWidth)
        .style('pointer-events', 'all')
        .style('filter', 'drop-shadow(0px 2px 3px rgba(0, 0, 0, 0.2))');

      mapGroup
        .selectAll('text.state-label')
        .data(geoFeature.features)
        .join('text')
        .attr('class', 'state-label')
        .attr('pointer-events', 'none')
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', '#333')
        .attr('font-size', '16px')
        .attr('font-weight', '600')
        .attr('text-shadow', '0 1px 1px rgba(255, 255, 255, 0.5)')
        .attr('x', (d) => {
          const c = pathGenerator.centroid(d);
          return isNaN(c[0]) ? 0 : c[0];
        })
        .attr('y', (d) => {
          const c = pathGenerator.centroid(d);
          return isNaN(c[1]) ? 0 : c[1];
        })
        .text((d) =>
          (d.properties as TileGeometry['properties'])?.name
            ? stateAbbreviations[
                (d.properties as TileGeometry['properties']).name
              ] || ''
            : ''
        );

      isInitializedRef.current = true;
      renderVisuals();
    });

    const visualObserver = () => renderVisuals();
    yHoveredLeftStates?.observeDeep(visualObserver);
    yHoveredRightStates?.observeDeep(visualObserver);
    yActiveMigrationLinks?.observeDeep(visualObserver);
    yTotalMigrationValue?.observe(visualObserver);

    doc.transact(() => {
      if (yTotalMigrationValue && !yTotalMigrationValue.has('value')) {
        yTotalMigrationValue.set('value', 'select states to view data');
      }
    }, 'init-yjs-values');

    return () => {
      yHoveredLeftStates?.unobserveDeep(visualObserver);
      yHoveredRightStates?.unobserveDeep(visualObserver);
      yActiveMigrationLinks?.unobserveDeep(visualObserver);
      yTotalMigrationValue?.unobserve(visualObserver);
      clearAllD3MigrationLines();
      isInitializedRef.current = false;
    };
  }, [
    syncStatus,
    doc,
    yHoveredLeftStates,
    yHoveredRightStates,
    yActiveMigrationLinks,
    yTotalMigrationValue,
    migrationDataLoaded,
  ]);

  useEffect(() => {
    if (
      !doc ||
      !svgRef.current ||
      !syncStatus ||
      !yHoveredLeftStates ||
      !yHoveredRightStates
    )
      return;

    const svgElement = svgRef.current;
    const handleInteraction = (event: CustomEvent<InteractionEvent>) => {
      const detail = event.detail;
      const handedness = detail.handedness as 'left' | 'right' | undefined;

      switch (detail.type) {
        case 'pointerover': {
          if (!handedness) return;

          const pointerOverDetail = detail as PointerOverDetail;

          const statesToAdd: string[] = [];
          const processElement = (el: Element | null | undefined) => {
            if (el instanceof SVGPathElement && el.classList.contains('tile')) {
              const stateName = getStateName(el);
              if (stateName) {
                statesToAdd.push(stateName);
              }
            }
          };

          if (
            pointerOverDetail.elements &&
            pointerOverDetail.elements.length > 0
          ) {
            pointerOverDetail.elements.forEach(processElement);
          } else if (pointerOverDetail.element) {
            processElement(pointerOverDetail.element);
          }

          if (statesToAdd.length > 0) {
            doc.transact(() => {
              const targetArray =
                handedness === 'left'
                  ? yHoveredLeftStates
                  : yHoveredRightStates;
              if (targetArray) {
                const currentStates = new Set(targetArray.toArray());
                statesToAdd.forEach((stateName) => {
                  if (!currentStates.has(stateName)) {
                    targetArray.push([stateName]);
                  }
                });
              }
            }, 'pointerover-interaction');
          }
          break;
        }
        case 'pointerout': {
          if (!handedness) return;
          const element = detail.element;
          if (
            element instanceof SVGPathElement &&
            element.classList.contains('tile')
          ) {
            const stateName = getStateName(element);
            if (stateName) {
              doc.transact(() => {
                const targetArray =
                  handedness === 'left'
                    ? yHoveredLeftStates
                    : yHoveredRightStates;
                const index = targetArray?.toArray().indexOf(stateName);
                if (targetArray && index !== undefined && index > -1)
                  targetArray.delete(index, 1);
              }, 'pointerout-interaction');
            }
          }
          break;
        }
      }
    };

    svgElement.addEventListener(
      'interaction',
      handleInteraction as EventListener
    );
    return () =>
      svgElement.removeEventListener(
        'interaction',
        handleInteraction as EventListener
      );
  }, [doc, syncStatus, yHoveredLeftStates, yHoveredRightStates]);

  if (!syncStatus) {
    return (
      <div
        style={{
          width: totalWidth,
          height: totalHeight,
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
            US Tilegram Migration Visualizer
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
      {/* d3 map and tooltip will be appended here by effects */}
    </svg>
  );
};

export default USTileYjs;
