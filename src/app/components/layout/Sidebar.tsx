import { 
  LayoutDashboard, 
  Users, 
  UserCircle2, 
  Settings, 
  Trophy,
  Shield,
  ListTodo,
  MessageSquare,
  Bell,
} from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { useMyOpenTaskCount } from '@/hooks/useMyOpenTaskCount';

const navItems: {
  id: string;
  icon: typeof LayoutDashboard;
  label: string;
  permission: string | null;
  /** If set, user needs any of these permissions (overrides `permission`). */
  anyPermissions?: string[];
  showOpenTaskBadge?: boolean;
}[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard', permission: 'view_dashboard' },
  { id: 'members', icon: Users, label: 'Members', permission: 'view_members' },
  {
    id: 'tasks',
    icon: ListTodo,
    label: 'Tasks',
    permission: 'view_member_tasks',
    anyPermissions: [
      'view_member_tasks',
      'monitor_member_tasks',
      'manage_member_tasks',
      'manage_member_task_checklist',
      'complete_member_task_checklist',
      'view_group_tasks',
      'monitor_group_tasks',
      'manage_group_tasks',
      'manage_group_task_checklist',
      'complete_group_task_checklist',
    ],
    showOpenTaskBadge: true,
  },
  { id: 'groups', icon: UserCircle2, label: 'Ministries', permission: 'view_groups' },
  { id: 'messages', icon: MessageSquare, label: 'Messages', permission: 'send_messages' },
  { id: 'notifications', icon: Bell, label: 'Notifications', permission: null },
  { id: 'events', icon: Trophy, label: 'Events', permission: 'view_events' },
];

const shortcutItems: { id: string; icon: typeof Settings; label: string; permission: string | null }[] = [
  { id: 'settings', icon: Settings, label: 'Settings', permission: null },
];

const adminItems: { id: string; icon: typeof Shield; label: string; permission: string | null }[] = [
  { id: 'superadmin', icon: Shield, label: 'SuperAdmin', permission: 'manage_permissions' },
];
interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export default function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const { count: openTaskCount } = useMyOpenTaskCount();
  const visibleNav = navItems.filter((item) => {
    if (item.anyPermissions?.length) return item.anyPermissions.some((p) => can(p));
    return item.permission == null || can(item.permission);
  });
  const visibleShortcuts = shortcutItems.filter((item) => {
    if (item.id === 'settings') {
      return (
        can('system_settings') ||
        can('manage_permissions') ||
        can('manage_staff') ||
        can('manage_event_types') ||
        can('manage_program_templates')
      );
    }
    return item.permission == null || can(item.permission);
  });
  const visibleAdmin = adminItems.filter((item) => item.permission == null || can(item.permission));
  const navCompletelyEmpty =
    !!user &&
    visibleNav.length === 0 &&
    visibleShortcuts.length === 0 &&
    visibleAdmin.length === 0;

  return (
    <aside className="w-64 bg-[#fbfcfb] border-r border-gray-200/70 flex flex-col">
      <div className="h-16 flex items-center px-4 border-b border-gray-200/70">
        <img
          src="/sheepmug-logo.png"
          alt=""
          className="w-9 h-9 rounded-md object-contain bg-white shadow-sm ring-1 ring-gray-200/80"
          width={36}
          height={36}
        />
        <div className="ml-2.5 min-w-0">
          <p className="text-[15px] font-semibold text-gray-900 leading-tight truncate">SheepMug</p>
          <p className="text-[11px] text-gray-500 leading-tight">Discipleship Made Easy</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        {navCompletelyEmpty && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Your account has no role permissions yet. Ask an admin to assign a role, or sign out and sign back in to refresh your access.
          </div>
        )}

        <p className="px-2.5 mb-1.5 text-[10px] font-semibold text-gray-500">Main</p>
        <ul className="space-y-1">
          {visibleNav.map((item) => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;
            
            return (
              <li key={item.id}>
                <button
                  onClick={() => setActiveTab(item.id)}
                  className={`group flex items-center w-full px-2.5 py-2 rounded-md transition-all ${
                    isActive
                      ? 'text-blue-900 bg-blue-50 border border-blue-100 font-medium shadow-sm'
                      : 'text-gray-600 border border-transparent hover:bg-white hover:border-gray-200 hover:text-gray-900'
                  }`}
                >
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-all ${
                    isActive ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500 group-hover:bg-blue-100 group-hover:text-blue-700'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="ml-2.5 text-[13px] flex-1 text-left">{item.label}</span>
                  {item.showOpenTaskBadge && can('view_group_tasks') && openTaskCount > 0 && (
                    <span className="ml-2 min-w-[1.15rem] h-[18px] px-1 rounded-full bg-blue-700 text-white text-[10px] font-semibold flex items-center justify-center">
                      {openTaskCount > 99 ? '99+' : openTaskCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {visibleAdmin.length > 0 && (
        <div className="px-2.5 py-3 border-t border-gray-200/70">
          <p className="px-2.5 mb-1.5 text-[10px] font-semibold text-gray-500">Admin</p>
          {visibleAdmin.map((item) => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`group flex items-center w-full px-2.5 py-2 rounded-md transition-all ${
                  isActive
                    ? 'text-blue-900 bg-blue-50 border border-blue-100 font-medium shadow-sm'
                    : 'text-gray-600 border border-transparent hover:bg-white hover:border-gray-200 hover:text-gray-900'
                }`}
              >
                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-all ${
                  isActive ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500 group-hover:bg-blue-100 group-hover:text-blue-700'
                }`}>
                  <Icon className="w-4 h-4" />
                </span>
                <span className="ml-2.5 text-[13px]">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="px-2.5 py-3 border-t border-gray-200/70">
        <p className="px-2.5 mb-1.5 text-[10px] font-semibold text-gray-500">Shortcuts</p>
        {visibleShortcuts.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`group flex items-center w-full px-2.5 py-2 rounded-md transition-all ${
                isActive
                  ? 'text-blue-900 bg-blue-50 border border-blue-100 font-medium shadow-sm'
                  : 'text-gray-600 border border-transparent hover:bg-white hover:border-gray-200 hover:text-gray-900'
              }`}
            >
              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md transition-all ${
                isActive ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-500 group-hover:bg-blue-100 group-hover:text-blue-700'
              }`}>
                <Icon className="w-4 h-4" />
              </span>
              <span className="ml-2.5 text-[13px]">{item.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}