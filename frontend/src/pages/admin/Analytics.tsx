import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/ui';
import { OptsCtx, useReportOpts } from './Reports';
import { DimensionalReport } from './analytics/DimensionalReport';
import FlexReport from './analytics/FlexReport';
import DynamicNestedReport from './analytics/DynamicNestedReport';
import CohortReport from './analytics/CohortReport';
import RedirectReport from './analytics/RedirectReport';
import VarianceReport from './analytics/VarianceReport';
import FunnelReport from './analytics/FunnelReport';

export default function Analytics() {
  const [params] = useSearchParams();
  const tabParam = params.get('tab');
  const tab = tabParam === 'flex' ? 'Flex' : tabParam === 'nested' ? 'Nested' : tabParam === 'cohort' ? 'Cohort' : tabParam === 'redirect' ? 'Redirect' : tabParam === 'variance' ? 'Variance' : tabParam === 'funnel' ? 'Funnel' : 'Dimensional';
  const opts = useReportOpts();

  return (
    <OptsCtx.Provider value={opts}>
      {tab === 'Dimensional' && <PageHeader title="Dimensional Report" subtitle="Analytics › Dimensional" />}
      {tab === 'Dimensional' && <DimensionalReport />}
      {tab === 'Flex' && <FlexReport />}
      {tab === 'Nested' && <DynamicNestedReport />}
      {tab === 'Cohort' && <CohortReport />}
      {tab === 'Redirect' && <RedirectReport />}
      {tab === 'Variance' && <VarianceReport />}
      {tab === 'Funnel' && <FunnelReport />}
    </OptsCtx.Provider>
  );
}
