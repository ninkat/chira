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

// constants for styling
const totalWidth = window.innerWidth;
const totalHeight = window.innerHeight;
const defaultFill = 'rgba(170, 170, 170, 0.6)'; // restore transparent fill
const strokeColor = '#fff'; // restore white stroke
const defaultStrokeWidth = 0.5;
const mapWidth = totalWidth * (3 / 4); // width of the map area (updated to match new panel width)

// constants for airport styling
const airportRadius = 15;
const airportFill = '#1E90FF';
const airportStroke = '#ffffff';
const airportStrokeWidth = 1.5;
const airportHighlightFill = '#1E90FF';
const airportHighlightStroke = '#FFD580';
const airportHighlightStrokeWidth = 4;

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

    // load both data files using Promise.all
    Promise.all([
      d3.json<WorldTopology>('/src/assets/world110.topo.json'),
      d3.json<Airport[]>('/src/assets/airports.json'),
    ])
      .then(([topology, airports]) => {
        if (!topology || !topology.objects.countries || !airports) {
          console.error('failed to load data.');
          return;
        }

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
                event.element.classList.contains('airport')
              ) {
                d3.select(event.element)
                  .attr('fill', airportHighlightFill)
                  .attr('stroke', airportHighlightStroke)
                  .attr(
                    'stroke-width',
                    airportHighlightStrokeWidth / transformRef.current.k
                  )
                  .raise(); // bring to front
              }
              break;

            case 'pointerout':
              // handle hover out for airports
              if (
                event.element &&
                event.element.classList.contains('airport')
              ) {
                d3.select(event.element)
                  .attr('fill', airportFill)
                  .attr('stroke', airportStroke)
                  .attr(
                    'stroke-width',
                    airportStrokeWidth / transformRef.current.k
                  );
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
                .attr(
                  'stroke-width',
                  airportStrokeWidth / transformRef.current.k
                );
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
          padding: '36px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          zIndex: 1000,
          fontSize: '18px',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '28px',
        }}
      >
        {/* filters section title */}
        <h2
          style={{
            margin: '0 0 -10px 0',
            fontSize: '24px',
            color: 'rgba(255, 255, 255, 0.85)',
            fontWeight: 600,
            textTransform: 'lowercase',
            letterSpacing: '0.05em',
          }}
        >
          filters
        </h2>

        {/* sliders section */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
          }}
        >
          {/* price slider */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <label
              style={{
                color: 'rgba(255, 255, 255, 0.75)',
                fontSize: '18px',
                fontWeight: 500,
                textTransform: 'lowercase',
                letterSpacing: '0.05em',
              }}
            >
              price range: $400 - $1,200
            </label>
            <div
              style={{
                height: '6px',
                background: 'rgba(255, 255, 255, 0.15)',
                borderRadius: '3px',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: '20%',
                  right: '30%',
                  height: '100%',
                  background: 'rgba(255, 255, 255, 0.7)',
                  borderRadius: '3px',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: '20%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '18px',
                  height: '18px',
                  background: 'white',
                  borderRadius: '50%',
                  cursor: 'pointer',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: '70%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '18px',
                  height: '18px',
                  background: 'white',
                  borderRadius: '50%',
                  cursor: 'pointer',
                }}
              />
            </div>
          </div>

          {/* days from today slider */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <label
              style={{
                color: 'rgba(255, 255, 255, 0.75)',
                fontSize: '18px',
                fontWeight: 500,
                textTransform: 'lowercase',
                letterSpacing: '0.05em',
              }}
            >
              days from today: 7 - 14
            </label>
            <div
              style={{
                height: '6px',
                background: 'rgba(255, 255, 255, 0.15)',
                borderRadius: '3px',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: '25%',
                  right: '40%',
                  height: '100%',
                  background: 'rgba(255, 255, 255, 0.7)',
                  borderRadius: '3px',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: '25%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '18px',
                  height: '18px',
                  background: 'white',
                  borderRadius: '50%',
                  cursor: 'pointer',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: '60%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '18px',
                  height: '18px',
                  background: 'white',
                  borderRadius: '50%',
                  cursor: 'pointer',
                }}
              />
            </div>
          </div>

          {/* flight time slider */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <label
              style={{
                color: 'rgba(255, 255, 255, 0.75)',
                fontSize: '18px',
                fontWeight: 500,
                textTransform: 'lowercase',
                letterSpacing: '0.05em',
              }}
            >
              flight time: 2h - 8h
            </label>
            <div
              style={{
                height: '6px',
                background: 'rgba(255, 255, 255, 0.15)',
                borderRadius: '3px',
                position: 'relative',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: '15%',
                  right: '25%',
                  height: '100%',
                  background: 'rgba(255, 255, 255, 0.7)',
                  borderRadius: '3px',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: '15%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '18px',
                  height: '18px',
                  background: 'white',
                  borderRadius: '50%',
                  cursor: 'pointer',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: '75%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '18px',
                  height: '18px',
                  background: 'white',
                  borderRadius: '50%',
                  cursor: 'pointer',
                }}
              />
            </div>
          </div>
        </div>

        {/* current selections title */}
        <h2
          style={{
            margin: '5px 0 -10px 0',
            fontSize: '24px',
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
            gap: '12px',
            marginTop: '10px',
          }}
        >
          {/* origins box */}
          <div
            style={{
              flex: 1,
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.07)',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: '20px',
                color: 'rgba(255, 255, 255, 0.75)',
                fontWeight: 500,
                textTransform: 'lowercase',
                letterSpacing: '0.05em',
              }}
            >
              origins
            </h3>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <div
                style={{
                  background: 'rgba(232, 27, 35, 0.3)',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '18px',
                  fontWeight: 600,
                }}
              >
                JFK
              </div>
              <div
                style={{
                  background: 'rgba(232, 27, 35, 0.3)',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '18px',
                  fontWeight: 600,
                }}
              >
                YYZ
              </div>
              <div
                style={{
                  background: 'rgba(232, 27, 35, 0.3)',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '18px',
                  fontWeight: 600,
                }}
              >
                LAX
              </div>
            </div>
          </div>

          {/* destinations box */}
          <div
            style={{
              flex: 1,
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.07)',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: '20px',
                color: 'rgba(255, 255, 255, 0.75)',
                fontWeight: 500,
                textTransform: 'lowercase',
                letterSpacing: '0.05em',
              }}
            >
              destinations
            </h3>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <div
                style={{
                  background: 'rgba(0, 174, 243, 0.3)',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '18px',
                  fontWeight: 600,
                }}
              >
                LHR
              </div>
              <div
                style={{
                  background: 'rgba(0, 174, 243, 0.3)',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontSize: '18px',
                  fontWeight: 600,
                }}
              >
                CDG
              </div>
            </div>
          </div>
        </div>

        {/* flights section */}
        <div
          style={{
            marginTop: '10px',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            overflow: 'hidden',
          }}
        >
          <h2
            style={{
              margin: '5px 0 0 0',
              fontSize: '24px',
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
              gap: '12px',
              overflowY: 'auto',
              flex: 1,
            }}
          >
            {/* flight items */}
            <div
              className='flight-item'
              style={{
                padding: '18px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.07)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '20px' }}>
                  JFK → LHR
                </span>
                <span
                  style={{
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontWeight: 500,
                    fontSize: '20px',
                  }}
                >
                  $740
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '18px',
                  color: 'rgba(255, 255, 255, 0.6)',
                }}
              >
                <span>American Airlines</span>
                <span>7h 20m</span>
              </div>
              <div
                style={{
                  fontSize: '16px',
                  color: 'rgba(255, 255, 255, 0.5)',
                }}
              >
                May 15, 2023 • 9:45 PM
              </div>
            </div>

            <div
              className='flight-item'
              style={{
                padding: '18px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.07)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '20px' }}>
                  BOS → CDG
                </span>
                <span
                  style={{
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontWeight: 500,
                    fontSize: '20px',
                  }}
                >
                  $820
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '18px',
                  color: 'rgba(255, 255, 255, 0.6)',
                }}
              >
                <span>Air France</span>
                <span>6h 55m</span>
              </div>
              <div
                style={{
                  fontSize: '16px',
                  color: 'rgba(255, 255, 255, 0.5)',
                }}
              >
                May 17, 2023 • 7:30 PM
              </div>
            </div>

            <div
              className='flight-item'
              style={{
                padding: '18px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.07)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '20px' }}>
                  LAX → LHR
                </span>
                <span
                  style={{
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontWeight: 500,
                    fontSize: '20px',
                  }}
                >
                  $980
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '18px',
                  color: 'rgba(255, 255, 255, 0.6)',
                }}
              >
                <span>British Airways</span>
                <span>10h 30m</span>
              </div>
              <div
                style={{
                  fontSize: '16px',
                  color: 'rgba(255, 255, 255, 0.5)',
                }}
              >
                May 14, 2023 • 3:15 PM
              </div>
            </div>

            <div
              className='flight-item'
              style={{
                padding: '18px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.07)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: '20px' }}>
                  JFK → CDG
                </span>
                <span
                  style={{
                    color: 'rgba(255, 255, 255, 0.7)',
                    fontWeight: 500,
                    fontSize: '20px',
                  }}
                >
                  $690
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '18px',
                  color: 'rgba(255, 255, 255, 0.6)',
                }}
              >
                <span>Delta Airlines</span>
                <span>7h 05m</span>
              </div>
              <div
                style={{
                  fontSize: '16px',
                  color: 'rgba(255, 255, 255, 0.5)',
                }}
              >
                May 19, 2023 • 8:20 PM
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default WorldMap;
