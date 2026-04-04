import { 
  LayoutDashboard, 
  Users, 
  Church, 
  UserCircle2, 
  Settings, 
  MessageSquare,
  Trophy,
  Shield,
  Tag,
  ClipboardList,
} from 'lucide-react';

const navItems = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'members', icon: Users, label: 'Members' },
  { id: 'groups', icon: UserCircle2, label: 'Ministries' },
  { id: 'events', icon: Trophy, label: 'Events' },
  { id: 'event-types', icon: Tag, label: 'Event types' },
  { id: 'program-templates', icon: ClipboardList, label: 'Program templates' },
  { id: 'messages', icon: MessageSquare, label: 'Messages' },
];

const shortcutItems = [
  { id: 'settings', icon: Settings, label: 'Settings' },
];

const adminItems = [
  { id: 'superadmin', icon: Shield, label: 'SuperAdmin' },
];
interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export default function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  return (
    <aside className="w-64 bg-white border-r border-gray-100 flex flex-col">
      {/* Logo */}
      <div className="h-20 flex items-center px-6">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
          <Church className="w-6 h-6 text-white" />
        </div>
        <span className="ml-3 text-xl font-semibold text-gray-900">ChurchHub</span>
      </div>

      {/* Workspace */}
      <div className="px-6 pb-4">
        
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;
            
            return (
              <li key={item.id}>
                <button
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center w-full px-3 py-2.5 rounded-xl transition-all ${
                    isActive
                      ? 'text-gray-900 bg-gray-100 font-medium'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? 'text-gray-900' : 'text-gray-400'}`} />
                  <span className="ml-3 text-[14px]">{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Admin Section */}
      <div className="px-3 py-4 border-t border-gray-100">
        <p className="px-3 text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
          Admin
        </p>
        {adminItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex items-center w-full px-3 py-2.5 rounded-xl transition-all ${
                isActive
                  ? 'text-purple-900 bg-purple-50 font-medium'
                  : 'text-gray-600 hover:bg-purple-50 hover:text-purple-900'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-purple-600' : 'text-gray-400'}`} />
              <span className="ml-3 text-[14px]">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Shortcuts Section */}
      <div className="px-3 py-4 border-t border-gray-100">
        <p className="px-3 text-sm font-medium text-gray-400 uppercase tracking-wider mb-3">
          Shortcuts
        </p>
        {shortcutItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex items-center w-full px-3 py-2.5 rounded-xl transition-all ${
                isActive
                  ? 'text-gray-900 bg-gray-100 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-gray-900' : 'text-gray-400'}`} />
              <span className="ml-3 text-[14px]">{item.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}