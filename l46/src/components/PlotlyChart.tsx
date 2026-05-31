import { useMemo } from 'react';
import Plot from 'react-plotly.js';
import type { Config, Data, Layout } from 'plotly.js';
import { cn } from '@/lib/utils';

interface PlotlyChartProps {
  data: any[];
  layout?: any;
  config?: Partial<Config>;
  className?: string;
  height?: number;
  onRelayout?: (event: any) => void;
  onSelected?: (event: any) => void;
}

export default function PlotlyChart({
  data,
  layout = {},
  config = {},
  className,
  height = 400,
  onRelayout,
  onSelected,
}: PlotlyChartProps) {
  const baseLayout = useMemo<Partial<Layout>>(
    () => ({
      paper_bgcolor: '#0d1320',
      plot_bgcolor: '#0d1320',
      font: {
        color: '#e5e7eb',
        family: 'Outfit, system-ui, sans-serif',
      },
      xaxis: {
        gridcolor: '#1a2332',
        zerolinecolor: '#1a2332',
        linecolor: '#2a3a4e',
        tickcolor: '#2a3a4e',
        tickfont: {
          color: '#9ca3af',
        },
      },
      yaxis: {
        gridcolor: '#1a2332',
        zerolinecolor: '#1a2332',
        linecolor: '#2a3a4e',
        tickcolor: '#2a3a4e',
        tickfont: {
          color: '#9ca3af',
        },
      },
      legend: {
        bgcolor: '#0d1320',
        bordercolor: '#1a2332',
        borderwidth: 1,
        font: {
          color: '#9ca3af',
        },
      },
      margin: {
        l: 60,
        r: 40,
        t: 40,
        b: 60,
      },
      dragmode: 'zoom',
      ...layout,
    }),
    [layout]
  );

  const baseConfig = useMemo<Partial<Config>>(
    () => ({
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d'],
      modeBarButtonsToAdd: ['select2d'],
      ...config,
    }),
    [config]
  );

  return (
    <div className={cn('w-full', className)}>
      <Plot
        data={data}
        layout={baseLayout}
        config={baseConfig}
        style={{ width: '100%', height }}
        onRelayout={onRelayout}
        onSelected={onSelected}
      />
    </div>
  );
}
