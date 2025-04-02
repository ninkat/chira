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

const USTile: React.FC = () => {
  // refs for svg and group elements
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const defaultFill = 'rgba(170,170,170,0.5)';

  // dimensions
  const width = 1920;
  const height = 1080;

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

      // draw tiles
      g.selectAll('path')
        .data(geoFeature.features)
        .join('path')
        .attr('class', 'tile')
        .attr('d', path)
        .attr('fill', defaultFill)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .on('mouseenter', function (event, d) {
          // highlight tile on hover
          d3.select(this).attr('fill', '#2a5caa').attr('stroke-width', 2);

          // add tooltip
          const feature = d as Feature<Geometry, TileGeometry['properties']>;
          const tooltip = g
            .append('g')
            .attr('class', 'tooltip')
            .attr('pointer-events', 'none');

          const text = tooltip
            .append('text')
            .style('font-size', '24px')
            .style('fill', '#333')
            .text(feature.properties?.name || '');

          const textWidth = (
            text.node() as SVGTextElement
          ).getComputedTextLength();

          // get centroid for positioning
          const centroid = path.centroid(d);
          if (!isNaN(centroid[0]) && !isNaN(centroid[1])) {
            tooltip
              .insert('rect', 'text')
              .attr('x', centroid[0] - textWidth / 2 - 10)
              .attr('y', centroid[1] - 40)
              .attr('width', textWidth + 20)
              .attr('height', 48)
              .attr('fill', 'white')
              .attr('rx', 8)
              .attr('opacity', 0.9);

            text
              .attr('x', centroid[0] - textWidth / 2)
              .attr('y', centroid[1] - 10);
          }
        })
        .on('mouseleave', function () {
          // reset tile style
          d3.select(this).attr('fill', defaultFill).attr('stroke-width', 1);

          // remove tooltip
          g.selectAll('.tooltip').remove();
        });

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
          return feature.properties?.name.substring(0, 2) || '';
        });
    });
  }, []);

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
      <g ref={gRef} />
    </svg>
  );
};

export default USTile;
