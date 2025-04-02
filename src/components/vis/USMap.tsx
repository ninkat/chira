import React, { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { feature } from 'topojson-client';
import { FeatureCollection, GeoJsonProperties } from 'geojson';
import { Topology, Objects } from 'topojson-specification';

const USMap: React.FC = () => {
  // refs for managing the svg and d3 group elements
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<d3.Selection<
    SVGGElement,
    unknown,
    null,
    undefined
  > | null>(null);

  // constants for map dimensions and visual styling
  const width = 1920;
  const height = 1080;
  const defaultFill = 'rgba(170,170,170,0.5)';

  // initialize map
  useEffect(() => {
    // create svg and group elements
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg.append('g');
    gRef.current = g;

    // set up the map projection using albers usa
    const projection = d3
      .geoAlbersUsa()
      .scale(2000)
      .translate([width / 2, height / 2]);
    const pathGenerator = d3.geoPath().projection(projection);

    // load and render the us states data
    d3.json<Topology<Objects<GeoJsonProperties>>>('./src/assets/usmap.json')
      .then((usData) => {
        if (!usData) return;
        const states = feature(
          usData,
          usData.objects.states
        ) as unknown as FeatureCollection;

        // create and style the state paths
        g.append('g')
          .selectAll('path')
          .data(states.features)
          .enter()
          .append('path')
          .attr('d', pathGenerator)
          .attr('fill', defaultFill)
          .attr('stroke', '#fff')
          .attr('stroke-width', 1)
          .attr('vector-effect', 'non-scaling-stroke');
      })
      .catch((error) => {
        console.error('error loading or processing data', error);
      });
  }, []);

  // render the svg container for the map
  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{
        position: 'relative',
        overflow: 'visible',
      }}
    />
  );
};

export default USMap;
