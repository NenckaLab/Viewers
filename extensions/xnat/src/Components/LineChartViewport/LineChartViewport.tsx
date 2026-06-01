import React from 'react';

const LineChartViewport = ({ displaySets }) => {
  const displaySet = displaySets[0];
  const { axis: chartAxis, series: chartSeries } = displaySet.instance.chartData;

  // Minimal fallback renderer (avoids dependency on legacy @ohif/ui LineChart)
  const points = (chartSeries?.[0]?.data || [])
    .map((pair, idx) => ({ x: idx, y: Array.isArray(pair) ? pair[1] : pair?.y ?? 0 }))
    .filter(p => Number.isFinite(p.y));

  const maxY = points.reduce((m, p) => Math.max(m, p.y), 0) || 1;
  const w = 800;
  const h = 280;
  const polyline = points
    .map((p, i) => {
      const x = (i / Math.max(points.length - 1, 1)) * (w - 20) + 10;
      const y = h - (p.y / maxY) * (h - 20) - 10;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="h-full w-full bg-black p-2 text-white">
      <div className="text-[14px] leading-[1.2] opacity-80">
        {chartAxis?.y?.label ?? 'Value'} vs {chartAxis?.x?.label ?? 'Index'}
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="mt-2 bg-black">
        <polyline fill="none" stroke="white" strokeWidth="2" points={polyline} />
      </svg>
    </div>
  );
};

export { LineChartViewport as default };
