import { Outlet, NavLink } from 'react-router-dom';
import { Activity, Cpu, BarChart2, MessageSquare, Zap } from 'lucide-react';

const navItems = [
  { to: '/providers', icon: Cpu, label: 'Providers' },
  { to: '/models', icon: Zap, label: 'Model Aliases' },
  { to: '/usage', icon: BarChart2, label: 'Usage' },
  { to: '/playground', icon: MessageSquare, label: 'Playground' },
];

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-400" />
            <span className="font-semibold text-sm text-gray-100">Free LLM Router</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">OpenAI-compatible gateway</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 font-medium'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-800">
          <p className="text-xs text-gray-600">
            API: <span className="text-gray-500">localhost:3001</span>
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-gray-950">
        <Outlet />
      </main>
    </div>
  );
}
