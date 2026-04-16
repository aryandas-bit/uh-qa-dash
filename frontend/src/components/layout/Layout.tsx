import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, AlertTriangle, ClipboardList, PanelLeftClose, PanelLeft } from 'lucide-react';
import TicketSearchBar from '../common/TicketSearchBar';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/defaulters', label: 'Defaulters', icon: AlertTriangle },
  { path: '/qc-reviews', label: 'QC Reviews', icon: ClipboardList },
];

export default function Layout() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar — fixed height, never scrolls with page */}
      <aside
        className={`${
          collapsed ? 'w-[68px]' : 'w-60'
        } h-screen bg-white shadow-elevation-2 flex flex-col shrink-0
          transition-all duration-300 ease-md3 overflow-hidden`}
      >
        {/* Header — Logo + Collapse toggle */}
        <div className="flex items-center gap-3 px-4 h-16 shrink-0">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors shrink-0"
          >
            {collapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
          </button>
          <div
            className={`overflow-hidden transition-all duration-300 ease-md3 ${
              collapsed ? 'w-0 opacity-0' : 'w-auto opacity-100'
            }`}
          >
            <h1 className="text-lg font-bold text-uh-purple whitespace-nowrap">QA Dashboard</h1>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 mt-2">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = item.path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.path);

              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 ease-md3 ${
                      isActive
                        ? 'bg-uh-purple/10 text-uh-purple font-semibold'
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    <Icon size={20} className="shrink-0" />
                    <span
                      className={`text-sm font-medium whitespace-nowrap transition-all duration-300 ease-md3 ${
                        collapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-auto opacity-100'
                      }`}
                    >
                      {item.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Ticket Search — pinned to bottom */}
        <div
          className={`px-2 pb-3 shrink-0 transition-all duration-300 ease-md3 ${
            collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <TicketSearchBar />
        </div>
      </aside>

      {/* Main Content — scrolls independently */}
      <main className="flex-1 overflow-auto h-screen">
        <Outlet />
      </main>
    </div>
  );
}
