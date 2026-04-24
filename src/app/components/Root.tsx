import { useState, useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import Sidebar from './layout/Sidebar';
import Header from './layout/Header';
import { CmsOnboardingModal } from './modals/CmsOnboardingModal';
import { AppProvider } from '@/contexts/AppContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { permissionsForPath } from '@/utils/routePermissions';
import { canOpenSettings } from '../../permissions/atomicCanHelpers';

export default function Root() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { can } = usePermissions();

  useEffect(() => {
    if (loading || !user) return;
    const seg = location.pathname === '/' ? '' : location.pathname.replace(/^\//, '').split('/')[0] || '';
    if (seg === 'superadmin') {
      if (user.is_super_admin !== true) {
        navigate('/', { replace: true });
      }
      return;
    }
    if (seg === 'settings') {
      if (!canOpenSettings(can)) navigate('/', { replace: true });
      return;
    }
    const req = permissionsForPath(location.pathname);
    if (req !== null && req.length > 0 && !req.some((p) => can(p))) {
      navigate('/', { replace: true });
    }
  }, [loading, user, location.pathname, can, navigate]);
  
  // Show loading state while checking auth (bypassed but kept for compatibility)
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-gray-900 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  // Determine active tab from URL
  const getActiveTab = () => {
    const path = location.pathname;
    if (path === '/') return 'dashboard';
    if (path.startsWith('/groups')) return 'groups';
    if (path.startsWith('/tasks')) return 'tasks';
    if (path.startsWith('/messages')) return 'messages';
    return path.slice(1).split('/')[0] || 'dashboard';
  };

  const activeTab = getActiveTab();

  const setActiveTab = (tab: string) => {
    navigate(`/${tab === 'dashboard' ? '' : tab}`);
  };

  return (
    <AppProvider>
      <NotificationProvider>
        <div className="flex h-screen bg-gray-50">
          <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
          <div className="flex-1 flex flex-col overflow-hidden">
            <Header setActiveTab={setActiveTab} />
            <main className="flex-1 overflow-y-auto p-8">
              <Outlet />
            </main>
          </div>
        </div>
        {user.cms_onboarding_completed !== true ? <CmsOnboardingModal /> : null}
      </NotificationProvider>
    </AppProvider>
  );
}