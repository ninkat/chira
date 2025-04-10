import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import {
  Topology as TopoTopology,
  GeometryCollection,
} from 'topojson-specification';

// define a non-null version of geojsonproperties for extension
type DefinedGeoJsonProperties = Exclude<GeoJsonProperties, null>;

interface CountryProperties extends DefinedGeoJsonProperties {
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
const panelWidth = totalWidth * (1 / 3); // width of the info panel
const defaultFill = 'rgba(170, 170, 170, 0.6)'; // restore transparent fill
const strokeColor = '#fff'; // restore white stroke
const defaultStrokeWidth = 0.5;
const mapWidth = totalWidth * (2 / 3); // width of the map area

// constants for info panel styling (placeholder)
const panelBackground = 'rgba(33, 33, 33, 0.65)';
const panelBorderRadius = '8px';

// constants for airport styling
const airportRadius = 15;
const airportFill = '#ff6b6b';
const airportStroke = '#ffffff';
const airportStrokeWidth = 1;

const WorldMap: React.FC = () => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    // add guard clause for svg ref
    const currentSvg = svgRef.current;
    if (!currentSvg) {
      return;
    }
    const svg = d3.select(currentSvg);
    svg.selectAll('*').remove(); // clear previous renders

    const g = svg.append('g'); // main group for transformations

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
          .center([-30, 50]) // center on north atlantic
          .translate([mapWidth / 2, totalHeight / 3.75]) // translate projection center to svg center
          .scale(800); // increased scale to zoom in on the north atlantic

        const path = d3.geoPath().projection(projection);

        // create a group for map features
        const mapGroup = g.append('g').attr('class', 'map-features');

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
          .style('pointer-events', 'all'); // ensure tooltips work

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
          .attr('r', airportRadius)
          .attr('fill', airportFill)
          .attr('stroke', airportStroke)
          .attr('stroke-width', airportStrokeWidth)
          .append('title')
          .text((d) => `${d['Airport Name']} (${d.IATA})`);

        // define zoom behavior
        const zoom = d3
          .zoom<SVGSVGElement, unknown>()
          .scaleExtent([0.4, 6]) // allow zoom out to 0.5x, zoom in to 6x
          .on('zoom', (event) => {
            // apply zoom/pan transformation to the main group 'g'
            g.attr('transform', event.transform.toString());
          });

        // apply zoom behavior to the svg element containing the map
        svg.call(zoom);
      })
      .catch((error) => {
        console.error('error loading data:', error); // log errors during data loading
      });
  }, []); // empty dependency array ensures this runs once on mount

  return (
    <div
      style={{
        display: 'flex',
        width: '100vw', // use viewport width
        height: '100vh', // use viewport height
        overflow: 'hidden', // prevent scrollbars on the main container
      }}
    >
      {/* left panel (1/3 width) */}
      <div
        className='info-panel' // reuse class for potential future styling
        style={{
          width: `${panelWidth}px`,
          height: '100%',
          background: panelBackground, // placeholder background
          padding: '20px', // some padding
          boxSizing: 'border-box', // include padding in width
          // basic styling similar to ustile
          color: 'white',
          borderRadius: panelBorderRadius,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000, // ensure panel is above map potentially
          border: '1px solid rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(10px)',
        }}
      >
        {/* placeholder content for the panel */}
        <h3 style={{ margin: 0, color: 'rgba(255, 255, 255, 0.7)' }}>
          feedback panel
        </h3>
      </div>

      {/* map container (2/3 width) */}
      <div
        style={{
          width: `${mapWidth}px`,
          height: '100%',
          position: 'relative', // context for absolute positioning if needed later
        }}
      >
        <svg
          ref={svgRef}
          width='100%' // svg takes full width of its container
          height='100%' // svg takes full height of its container
          viewBox={`0 0 ${mapWidth} ${totalHeight}`} // adjust viewbox to map dimensions
          preserveAspectRatio='xMidYMid meet'
          style={{
            display: 'block', // remove extra space below svg
            background: 'transparent',
          }}
        />
      </div>
    </div>
  );
};

export default WorldMap;
