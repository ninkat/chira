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
import { GetCurrentTransformFn } from '@/utils/interactionHandlers';

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

// era types
type Era = '1960s' | '1990s' | '2020s';

// constants for hover and selection styling
const defaultFill = 'rgba(170,170,170,0.4)';
const leftHandHoverFill = 'rgba(232, 27, 35, 0.6)';
const rightHandHoverFill = 'rgba(0, 174, 243, 0.6)';
const pinnedStroke = '#FFD700'; // gold stroke for all pinned states
const defaultStrokeWidth = 1.5;
const hoverStrokeWidth = 2.5;
const pinnedStrokeWidth = 3;

// constants for line styling
const lineColor = 'rgba(160, 64, 255, 1)';
const minLineWidth = 3; // minimum line width for smallest values
const maxLineWidth = 6; // maximum line width for highest values
const lineDashArray = '8,8'; // dotted pattern for arcs with more spacing

// constants for layout
const totalWidth = 1280;
const totalHeight = 720;
const thirdWidth = totalWidth / 3;
const mapWidth = thirdWidth * 2;
const panelWidth = thirdWidth;
const mapLeftOffset = panelWidth - 50; // move map 50px more to the left

// constants for info panel styling (will be adapted for d3)
const panelBgColor = 'rgba(33, 33, 33, 0.65)';
const panelTxtColor = 'white';
const mainPadding = 24; // reduced from 36 for tighter layout
const tooltipPanelWidth = panelWidth * 0.8; // define tooltipPanelWidth at a higher scope

// systematic spacing constants for info panel
const sectionSpacing = 20; // space between major sections
const titleSpacing = 12; // space between title and content
const itemSpacing = 48; // space for each migration flow item (increased from 45)
const buttonSectionHeight = 40; // era button height

// constants for era buttons
const buttonHeight = 48;
const buttonSpacing = 10;

// interface for migration link info
interface MigrationLinkInfo {
  origin: string;
  destination: string;
  value: number;
}

// define a non-null version of geojsonproperties for extension
// yjs shared value types (removed unused types)

// props interface for the USTileYjs component
interface USTileYjsProps {
  getCurrentTransformRef: React.MutableRefObject<GetCurrentTransformFn | null>;
}

const USTileYjs: React.FC<USTileYjsProps> = ({ getCurrentTransformRef }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const migrationDataByEra = useRef<Record<Era, Migration[]>>({
    '1960s': [],
    '1990s': [],
    '2020s': [],
  });
  const stateCentroidsRef = useRef<Record<string, [number, number]>>({});
  const activeLinesByPair = useRef<Map<string, SVGPathElement>>(new Map());
  const isInitializedRef = useRef(false);
  const tooltipRef = useRef<SVGGElement | null>(null);
  const buttonContainerRef = useRef<SVGGElement | null>(null);
  const currentEraRef = useRef<Era>('2020s');
  const calculateAndStoreMigrationsRef = useRef<(() => void) | null>(null);
  // removed unused gRef

  const yjsContext = useContext(YjsContext);
  const doc = yjsContext?.doc;
  const [syncStatus, setSyncStatus] = useState<boolean>(false);
  const [migrationDataLoaded, setMigrationDataLoaded] = useState(false);
  const [currentEra, setCurrentEra] = useState<Era>('2020s');

  const yHoveredLeftStates = doc?.getArray<string>('usTileHoveredLeftStates');
  const yHoveredRightStates = doc?.getArray<string>('usTileHoveredRightStates');
  const yPinnedLeftStates = doc?.getArray<string>('usTilePinnedLeftStates');
  const yPinnedRightStates = doc?.getArray<string>('usTilePinnedRightStates');
  const yActiveMigrationLinks = doc?.getArray<Y.Map<unknown>>(
    'usTileActiveMigrationLinks'
  );
  const yTotalMigrationValue = doc?.getMap<string | number>(
    'usTileTotalMigrationValue'
  );
  const ySharedState = doc?.getMap<string | boolean | null | string[] | number>(
    'usTileSharedState'
  );

  const width = totalWidth;
  const height = totalHeight;

  // ref to track current transform from yjs or local updates before sync
  const transformRef = useRef<{ k: number; x: number; y: number }>({
    k: 1,
    x: 0,
    y: 0,
  });

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

  useEffect(() => {
    if (!doc) return;
    const timeout = setTimeout(() => {
      console.log('assuming sync for ustileyjs visualization');
      setSyncStatus(true);
    }, 1500);
    return () => clearTimeout(timeout);
  }, [doc]);

  // effect to sync transform state from yjs (for consistency with other components)
  useEffect(() => {
    if (!doc || !syncStatus || !ySharedState) return;

    const updateLocalTransform = () => {
      const scale = (ySharedState.get('zoomScale') as number) || 1;
      const x = (ySharedState.get('panX') as number) || 0;
      const y = (ySharedState.get('panY') as number) || 0;

      if (
        scale !== transformRef.current.k ||
        x !== transformRef.current.x ||
        y !== transformRef.current.y
      ) {
        transformRef.current = { k: scale, x, y };
        // note: ustile doesn't currently use pan/zoom transforms on the map group
        // but this maintains consistency with other components
      }
    };

    ySharedState.observe(updateLocalTransform);
    updateLocalTransform(); // initial sync

    return () => ySharedState.unobserve(updateLocalTransform);
  }, [doc, syncStatus, ySharedState]);

  // load all three era migration files
  useEffect(() => {
    const loadMigrationData = async () => {
      try {
        const [data1960s, data1990s, data2020s] = await Promise.all([
          d3.json<MigrationData>(
            '/src/assets/domesticmigration/migration_1960s.json'
          ),
          d3.json<MigrationData>(
            '/src/assets/domesticmigration/migration_1990s.json'
          ),
          d3.json<MigrationData>(
            '/src/assets/domesticmigration/migration_2020s.json'
          ),
        ]);

        if (data1960s && data1990s && data2020s) {
          migrationDataByEra.current = {
            '1960s': data1960s.migrations,
            '1990s': data1990s.migrations,
            '2020s': data2020s.migrations,
          };
          setMigrationDataLoaded(true);
          console.log('all migration era data loaded successfully');
        }
      } catch (error) {
        console.error('error loading migration era data:', error);
      }
    };

    loadMigrationData();
  }, []);

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

  const createStaticMigrationLine = (
    origin: string,
    destination: string,
    lineWidth: number = maxLineWidth
  ) => {
    if (!svgRef.current) return;
    const pairKey = getPairKey(origin, destination);
    if (activeLinesByPair.current.has(pairKey)) return;

    const originCentroid = stateCentroidsRef.current[origin];
    const destCentroid = stateCentroidsRef.current[destination];
    if (!originCentroid || !destCentroid) return;

    const adjustedOriginCentroid: [number, number] = [
      originCentroid[0] + mapLeftOffset,
      originCentroid[1] - totalHeight * 0.1,
    ];
    const adjustedDestCentroid: [number, number] = [
      destCentroid[0] + mapLeftOffset,
      destCentroid[1] - totalHeight * 0.1,
    ];

    // calculate control point for arc
    const midX = (adjustedOriginCentroid[0] + adjustedDestCentroid[0]) / 2;
    const midY = (adjustedOriginCentroid[1] + adjustedDestCentroid[1]) / 2;

    // calculate distance between points to determine arc height
    const distance = Math.sqrt(
      Math.pow(adjustedDestCentroid[0] - adjustedOriginCentroid[0], 2) +
        Math.pow(adjustedDestCentroid[1] - adjustedOriginCentroid[1], 2)
    );

    // arc height proportional to distance (creates more pronounced arcs for longer distances)
    const arcHeight = Math.min(distance * 0.3, 100);

    // control point offset perpendicular to the line
    const dx = adjustedDestCentroid[0] - adjustedOriginCentroid[0];
    const dy = adjustedDestCentroid[1] - adjustedOriginCentroid[1];
    const perpX = -dy / distance;
    const perpY = dx / distance;

    const controlX = midX + perpX * arcHeight;
    const controlY = midY + perpY * arcHeight;

    // create quadratic bezier curve path
    const pathData = `M ${adjustedOriginCentroid[0]},${adjustedOriginCentroid[1]} Q ${controlX},${controlY} ${adjustedDestCentroid[0]},${adjustedDestCentroid[1]}`;

    const svg = d3.select(svgRef.current);
    const line = svg
      .append('path')
      .attr('class', 'migration-line')
      .attr('d', pathData)
      .attr('stroke', lineColor)
      .attr('stroke-width', lineWidth)
      .attr('stroke-dasharray', lineDashArray)
      .attr('fill', 'none')
      .style('stroke-linecap', 'round')
      .style('pointer-events', 'none'); // make migration lines uninteractable

    activeLinesByPair.current.set(pairKey, line.node()!);
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
      !yPinnedLeftStates ||
      !yPinnedRightStates ||
      !yActiveMigrationLinks ||
      !yTotalMigrationValue ||
      migrationDataByEra.current[currentEraRef.current].length === 0
    )
      return;

    const calculateAndStoreMigrations = () => {
      const currentLeftHovered = yHoveredLeftStates.toArray();
      const currentRightHovered = yHoveredRightStates.toArray();
      const currentLeftPinned = yPinnedLeftStates?.toArray() || [];
      const currentRightPinned = yPinnedRightStates?.toArray() || [];

      // combine hovered and pinned states
      const originStates = new Set<string>([
        ...currentLeftHovered,
        ...currentLeftPinned,
      ]);
      const destStates = new Set<string>([
        ...currentRightHovered,
        ...currentRightPinned,
      ]);

      doc.transact(() => {
        // case 1: no states selected at all
        if (originStates.size === 0 && destStates.size === 0) {
          if (yActiveMigrationLinks.length > 0) {
            yActiveMigrationLinks.delete(0, yActiveMigrationLinks.length);
          }
          yTotalMigrationValue.set('value', 'select states to view data');
        }
        // case 2: only origins selected (left hand hover)
        else if (originStates.size > 0 && destStates.size === 0) {
          let totalValue = 0;
          const newMigrationLinksInfo: MigrationLinkInfo[] = [];
          const migrationsByPair = new Map<string, number>();

          // calculate migration from selected origins to all other states (excluding origins)
          migrationDataByEra.current[currentEraRef.current].forEach(
            (migration) => {
              if (
                originStates.has(migration.origin) &&
                !originStates.has(migration.destination)
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
            }
          );

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
        // case 3: only destinations selected (right hand hover)
        else if (originStates.size === 0 && destStates.size > 0) {
          let totalValue = 0;
          const newMigrationLinksInfo: MigrationLinkInfo[] = [];
          const migrationsByPair = new Map<string, number>();

          // calculate migration from all other states (excluding destinations) to selected destinations
          migrationDataByEra.current[currentEraRef.current].forEach(
            (migration) => {
              if (
                !destStates.has(migration.origin) &&
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
            }
          );

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
        // case 4: both origins and destinations selected (existing logic)
        else {
          let totalValue = 0;
          const newMigrationLinksInfo: MigrationLinkInfo[] = [];
          const migrationsByPair = new Map<string, number>();

          // use current era data
          migrationDataByEra.current[currentEraRef.current].forEach(
            (migration) => {
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
            }
          );

          migrationsByPair.forEach((value, pairKey) => {
            const [origin, destination] = pairKey.split('->');
            newMigrationLinksInfo.push({ origin, destination, value });
          });

          newMigrationLinksInfo.sort((a, b) => b.value - a.value);
          const topLinks = newMigrationLinksInfo.slice(0, 5);

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

    // store the function in ref so it can be called manually when era changes
    calculateAndStoreMigrationsRef.current = calculateAndStoreMigrations;

    yHoveredLeftStates.observeDeep(calculateAndStoreMigrations);
    yHoveredRightStates.observeDeep(calculateAndStoreMigrations);
    yPinnedLeftStates.observeDeep(calculateAndStoreMigrations);
    yPinnedRightStates.observeDeep(calculateAndStoreMigrations);
    calculateAndStoreMigrations();

    return () => {
      yHoveredLeftStates.unobserveDeep(calculateAndStoreMigrations);
      yHoveredRightStates.unobserveDeep(calculateAndStoreMigrations);
      yPinnedLeftStates.unobserveDeep(calculateAndStoreMigrations);
      yPinnedRightStates.unobserveDeep(calculateAndStoreMigrations);
    };
  }, [
    doc,
    syncStatus,
    yHoveredLeftStates,
    yHoveredRightStates,
    yPinnedLeftStates,
    yPinnedRightStates,
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
    const currentLeftPinned = yPinnedLeftStates?.toArray() || [];
    const currentRightPinned = yPinnedRightStates?.toArray() || [];
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
        const isLeftPinned = stateName
          ? currentLeftPinned.includes(stateName)
          : false;
        const isRightPinned = stateName
          ? currentRightPinned.includes(stateName)
          : false;

        let fill = defaultFill;
        let strokeWidth = defaultStrokeWidth;
        let strokeColor = '#fff'; // default stroke color

        // treat pinned states as permanently hovered for fill color
        const effectiveLeftHover = isLeftHover || isLeftPinned;
        const effectiveRightHover = isRightHover || isRightPinned;

        // apply hover styling (including pinned as permanent hover)
        if (effectiveLeftHover) {
          fill = leftHandHoverFill;
          strokeWidth = hoverStrokeWidth;
        }
        if (effectiveRightHover) {
          fill = rightHandHoverFill;
          strokeWidth = hoverStrokeWidth;
        }
        if (effectiveLeftHover && effectiveRightHover) {
          fill = leftHandHoverFill;
        }

        // apply pinned styling (overrides stroke color and width)
        if (isLeftPinned || isRightPinned) {
          strokeColor = pinnedStroke;
          strokeWidth = pinnedStrokeWidth;
        }

        d3.select(tileElement)
          .attr('fill', fill)
          .attr('stroke', strokeColor)
          .attr('stroke-width', strokeWidth);
      });

    const currentLineKeys = new Set(
      currentActiveLinks
        .slice(0, 5)
        .map((l) => getPairKey(l.origin, l.destination)) // only top 5 for lines
    );
    activeLinesByPair.current.forEach((lineElement, pairKey) => {
      if (!currentLineKeys.has(pairKey)) {
        d3.select(lineElement).remove();
        activeLinesByPair.current.delete(pairKey);
      }
    });

    // calculate line widths based on migration values for top 5 flows
    const top5Links = currentActiveLinks.slice(0, 5);
    if (top5Links.length > 0) {
      const maxValue = Math.max(...top5Links.map((link) => link.value));
      const minValue = Math.min(...top5Links.map((link) => link.value));

      top5Links.forEach((link) => {
        if (link.origin && link.destination) {
          // calculate scaled line width using logarithmic scaling
          let scaledWidth: number;
          if (maxValue === minValue) {
            // if all values are the same, use maximum width
            scaledWidth = maxLineWidth;
          } else {
            // logarithmic scaling between min and max line widths
            // add 1 to avoid log(0) and ensure positive values
            const logValue = Math.log(link.value + 1);
            const logMin = Math.log(minValue + 1);
            const logMax = Math.log(maxValue + 1);
            const normalizedLogValue = (logValue - logMin) / (logMax - logMin);
            scaledWidth =
              minLineWidth + normalizedLogValue * (maxLineWidth - minLineWidth);
          }

          createStaticMigrationLine(link.origin, link.destination, scaledWidth);
        }
      });
    }

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

    // display all 10 migration flows in the info panel
    currentActiveLinks.forEach((link, i) => {
      const linkGroup = migrationLinksGroup
        .append('g')
        .attr('transform', `translate(0, ${i * itemSpacing})`); // use systematic item spacing

      linkGroup
        .append('text')
        .attr('x', 0)
        .attr('y', 26) // increased from 24 for slightly bigger entries
        .style('font-size', '22px') // increased from 20px for slightly bigger entries
        .style('font-weight', '600')
        .style('fill', 'rgba(255, 255, 255, 0.9)')
        .text(
          `${stateAbbreviations[link.origin] || link.origin} → ${stateAbbreviations[link.destination] || link.destination}`
        );

      linkGroup
        .append('text')
        .attr('x', tooltipPanelWidth - 2 * mainPadding)
        .attr('y', 26) // increased from 24 for slightly bigger entries
        .attr('text-anchor', 'end')
        .style('font-size', '22px') // increased from 20px for slightly bigger entries
        .style('font-weight', '500')
        .style('fill', 'rgba(255, 255, 255, 0.8)')
        .text(formatMigrationValue(link.value));
    });

    // update era buttons
    if (buttonContainerRef.current) {
      const buttonContainer = d3.select(buttonContainerRef.current);

      buttonContainer.selectAll('g.era-button').each(function () {
        const buttonGroup = d3.select(this);
        const era = buttonGroup.attr('data-era') as Era;
        const isActive = era === currentEraRef.current;

        buttonGroup
          .select('rect')
          .attr(
            'fill',
            isActive ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.2)'
          )
          .attr(
            'stroke',
            isActive ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.4)'
          );

        buttonGroup
          .select('text')
          .style(
            'fill',
            isActive ? 'rgba(33, 33, 33, 0.9)' : 'rgba(255, 255, 255, 0.9)'
          )
          .style('font-weight', isActive ? '700' : '500');
      });
    }
  };

  useEffect(() => {
    if (!syncStatus || !doc || !svgRef.current || isInitializedRef.current)
      return;
    console.log('ustileyjs: initializing base d3 map and tooltip structure');

    const svg = d3.select(svgRef.current);
    svg.selectAll('g#map-group').remove();
    svg.selectAll('g.d3-tooltip-container').remove();

    const mapGroup = svg
      .append('g')
      .attr('id', 'map-group')
      .attr('transform', `translate(${mapLeftOffset}, ${-totalHeight * 0.1})`);

    const tooltipPanelHeight = 720;
    const tooltipX = 0;
    const tooltipY = totalHeight / 2 - tooltipPanelHeight / 2;

    const d3tooltip = svg
      .append('g')
      .attr('class', 'd3-tooltip-container')
      .attr('transform', `translate(${tooltipX}, ${tooltipY})`)
      .style('pointer-events', 'none');

    tooltipRef.current = d3tooltip.node();

    // create custom panel background with square left corners and rounded right corners
    const borderRadius = 8; // convert panelBorderRad to number
    const panelPath = `
      M 0,0
      L ${tooltipPanelWidth - borderRadius},0
      Q ${tooltipPanelWidth},0 ${tooltipPanelWidth},${borderRadius}
      L ${tooltipPanelWidth},${tooltipPanelHeight - borderRadius}
      Q ${tooltipPanelWidth},${tooltipPanelHeight} ${tooltipPanelWidth - borderRadius},${tooltipPanelHeight}
      L 0,${tooltipPanelHeight}
      Z
    `;

    d3tooltip
      .append('path')
      .attr('d', panelPath)
      .attr('fill', panelBgColor)
      .style('box-shadow', '0 8px 32px rgba(0,0,0,0.25)')
      .style('border', '1px solid rgba(255, 255, 255, 0.15)');

    // add era title at the top
    d3tooltip
      .append('text')
      .attr('class', 'tooltip-title-era')
      .attr('x', mainPadding)
      .attr('y', mainPadding + 16) // era title at top with consistent spacing
      .style('font-size', '20px') // made same size as migration flows title
      .style('fill', 'rgba(255, 255, 255, 0.75)')
      .style('font-weight', '500')
      .text('migration era');

    // create era buttons at the top
    const buttonContainerY = mainPadding + 16 + titleSpacing; // below era title with systematic spacing

    const buttonContainer = d3tooltip
      .append('g')
      .attr('class', 'd3-button-container')
      .attr('transform', `translate(${mainPadding}, ${buttonContainerY})`)
      .style('pointer-events', 'all');

    buttonContainerRef.current = buttonContainer.node();

    const eras: Era[] = ['1960s', '1990s', '2020s'];
    const buttonWidth =
      (tooltipPanelWidth - 2 * mainPadding - buttonSpacing * 2) / 3;

    eras.forEach((era, i) => {
      const buttonGroup = buttonContainer
        .append('g')
        .attr('class', 'era-button')
        .attr('data-era', era)
        .attr('transform', `translate(${i * (buttonWidth + buttonSpacing)}, 0)`)
        .style('cursor', 'pointer');

      const isActive = era === currentEraRef.current;

      buttonGroup
        .append('rect')
        .attr('class', 'era-button-rect')
        .attr('width', buttonWidth)
        .attr('height', buttonHeight)
        .attr('rx', 6)
        .attr('ry', 6)
        .attr(
          'fill',
          isActive ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.2)'
        )
        .attr(
          'stroke',
          isActive ? 'rgba(255, 255, 255, 1)' : 'rgba(255, 255, 255, 0.4)'
        );

      buttonGroup
        .append('text')
        .attr('x', buttonWidth / 2)
        .attr('y', buttonHeight / 2 + 6)
        .attr('text-anchor', 'middle')
        .style('font-size', '18px')
        .style('font-weight', isActive ? '700' : '500')
        .style(
          'fill',
          isActive ? 'rgba(33, 33, 33, 0.9)' : 'rgba(255, 255, 255, 0.9)'
        )
        .style('pointer-events', 'none')
        .text(era);

      buttonGroup.on('click', (event) => {
        event.stopPropagation();
        console.log(`era button clicked: ${era}`);

        // update ref immediately for instant response
        currentEraRef.current = era;

        // update state for react consistency
        setCurrentEra(era);

        // the calculateAndStoreMigrations function will automatically recalculate
        // based on current hover states and the new era - no need to clear manually

        // trigger recalculation with new era data
        if (calculateAndStoreMigrationsRef.current) {
          calculateAndStoreMigrationsRef.current();
        }

        // trigger immediate visual update
        renderVisuals();
      });
    });

    // total migration section - systematic spacing after era buttons
    const totalMigrationY =
      buttonContainerY + buttonSectionHeight + sectionSpacing;

    d3tooltip
      .append('text')
      .attr('class', 'tooltip-title-total')
      .attr('x', mainPadding)
      .attr('y', totalMigrationY + 20) // total migration title
      .style('font-size', '20px')
      .style('fill', 'rgba(255, 255, 255, 0.75)')
      .style('font-weight', '500')
      .text('total migration');

    d3tooltip
      .append('text')
      .attr('class', 'tooltip-total-migration-value')
      .attr('x', mainPadding)
      .attr('y', totalMigrationY + 20 + titleSpacing + 40) // total migration value with systematic spacing
      .style('font-size', '40px')
      .style('font-weight', '700')
      .style('fill', panelTxtColor)
      .text('select states to view data');

    // migration flows section - systematic spacing after total migration
    const migrationFlowsY =
      totalMigrationY + 20 + titleSpacing + 40 + sectionSpacing;

    d3tooltip
      .append('text')
      .attr('class', 'tooltip-title-flows')
      .attr('x', mainPadding)
      .attr('y', migrationFlowsY + 20) // migration flows title
      .style('font-size', '20px')
      .style('fill', 'rgba(255, 255, 255, 0.75)')
      .style('font-weight', '500')
      .text('migration flows');

    d3tooltip
      .append('g')
      .attr('class', 'tooltip-migration-links')
      .attr(
        'transform',
        `translate(${mainPadding}, ${migrationFlowsY + 20 + titleSpacing})` // migration links list with systematic spacing
      );

    d3.json('/src/assets/domesticmigration/tiles2.topo.json').then(
      (topology) => {
        if (!topology) return;
        const geoFeature = topojson.feature(
          topology as TileTopology,
          (topology as TileTopology).objects.tiles
        ) as unknown as FeatureCollection<Geometry, GeoJsonProperties>;
        const topoBbox = (topology as TileTopology).bbox;
        if (!topoBbox) return;

        const bboxWidth = topoBbox[2] - topoBbox[0];
        const bboxHeight = topoBbox[3] - topoBbox[1];
        const scale =
          Math.min(mapWidth / bboxWidth, height / bboxHeight) * 1.06;
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
            (d) =>
              (d.properties as TileGeometry['properties'])?.name || 'unknown'
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
          .attr('font-size', '20px')
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
      }
    );

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
    yPinnedLeftStates,
    yPinnedRightStates,
    yActiveMigrationLinks,
    yTotalMigrationValue,
    migrationDataLoaded,
  ]);

  // re-render when currentEra changes
  useEffect(() => {
    console.log(`currentEra changed to: ${currentEra}`);
    if (isInitializedRef.current) {
      renderVisuals();
    }
  }, [currentEra]);

  // sync ref with state
  useEffect(() => {
    currentEraRef.current = currentEra;
  }, [currentEra]);

  useEffect(() => {
    if (
      !doc ||
      !svgRef.current ||
      !syncStatus ||
      !yHoveredLeftStates ||
      !yHoveredRightStates ||
      !yPinnedLeftStates ||
      !yPinnedRightStates
    )
      return;

    const svgElement = svgRef.current;
    const handleInteraction = (event: CustomEvent<InteractionEvent>) => {
      const detail = event.detail;
      const handedness = detail.handedness as 'left' | 'right' | undefined;

      switch (detail.type) {
        case 'pointerover': {
          if (!handedness) return;
          console.log('ustileyjs: pointerover interaction');
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
        case 'pointerselect': {
          // handle selection events (from handleThumbIndex) for era buttons and tile pinning
          const element = detail.element;
          if (!element || !(element instanceof SVGElement)) return;

          // check if this is an era button
          if (element.classList.contains('era-button-rect')) {
            // find the parent era button group element that contains the data-era
            const parentButton = element.closest('g.era-button');
            const era = parentButton?.getAttribute('data-era') as Era;

            if (era && ['1960s', '1990s', '2020s'].includes(era)) {
              console.log(`era button gesture-selected: ${era}`);

              // update ref immediately for instant response
              currentEraRef.current = era;

              // update state for react consistency
              setCurrentEra(era);

              // the calculateAndStoreMigrations function will automatically recalculate
              // based on current hover states and the new era - no need to clear manually

              // trigger recalculation with new era data
              if (calculateAndStoreMigrationsRef.current) {
                calculateAndStoreMigrationsRef.current();
              }

              // trigger immediate visual update
              renderVisuals();
            }
          }
          // check if this is a tile for pinning
          else if (element.classList.contains('tile')) {
            const handedness = detail.handedness;
            if (!handedness) return;

            const stateName = getStateName(element as SVGPathElement);
            if (!stateName) return;

            console.log(
              `tile ${stateName} gesture-selected with ${handedness} hand`
            );

            doc.transact(() => {
              const targetArray =
                handedness === 'left' ? yPinnedLeftStates : yPinnedRightStates;
              if (!targetArray) return;

              const currentPinned = targetArray.toArray();
              const index = currentPinned.indexOf(stateName);

              if (index > -1) {
                // unpin if already pinned
                targetArray.delete(index, 1);
                console.log(`unpinned ${stateName} from ${handedness} hand`);
              } else {
                // pin if not already pinned
                targetArray.push([stateName]);
                console.log(`pinned ${stateName} to ${handedness} hand`);
              }
            }, `pin-toggle-${handedness}`);

            // trigger immediate visual update
            renderVisuals();
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
  }, [
    doc,
    syncStatus,
    yHoveredLeftStates,
    yHoveredRightStates,
    yPinnedLeftStates,
    yPinnedRightStates,
  ]);

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
