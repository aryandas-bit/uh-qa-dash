import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/layout/Layout';
import DashboardPage from './pages/DashboardPage';
import AgentDetailPage from './pages/AgentDetailPage';
import TicketPage from './pages/TicketPage';
import TicketsPage from './pages/TicketsPage';
import CustomerPage from './pages/CustomerPage';
import DefaultersPage from './pages/DefaultersPage';
import QCReviewsPage from './pages/QCReviewsPage';
import TrendsPage from './pages/TrendsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="agent/:email" element={<AgentDetailPage />} />
            <Route path="ticket/:id" element={<TicketPage />} />
            <Route path="customer/:email" element={<CustomerPage />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="defaulters" element={<DefaultersPage />} />
            <Route path="qc-reviews" element={<QCReviewsPage />} />
            <Route path="trends" element={<TrendsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
