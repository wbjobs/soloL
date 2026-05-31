import Layout from '@/components/Layout';
import Dashboard from '@/pages/Dashboard';
import DataManagement from '@/pages/DataManagement';
import Detection from '@/pages/Detection';
import RootCause from '@/pages/RootCause';
import Backtest from '@/pages/Backtest';
import MultiAsset from '@/pages/MultiAsset';
import ReportGenerator from '@/pages/ReportGenerator';
import StreamProcessor from '@/pages/StreamProcessor';
import SQLExporter from '@/pages/SQLExporter';
import { useAppStore, type PageType } from '@/store/useAppStore';

const pageComponents: Record<PageType, React.ComponentType> = {
  dashboard: Dashboard,
  data: DataManagement,
  anomaly: Detection,
  rootcause: RootCause,
  backtest: Backtest,
  multiasset: MultiAsset,
  report: ReportGenerator,
  stream: StreamProcessor,
  sql: SQLExporter,
};

export default function App() {
  const { currentPage } = useAppStore();
  const PageComponent = pageComponents[currentPage];

  return (
    <Layout>
      <PageComponent />
    </Layout>
  );
}
