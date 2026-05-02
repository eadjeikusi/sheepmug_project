import { useState, useEffect, useCallback } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import Sidebar from './layout/Sidebar';
import Header from './layout/Header';
import { CmsOnboardingModal } from './modals/CmsOnboardingModal';
import { AppProvider } from '@/contexts/AppContext';
import { MemberProfileModalProvider } from '@/contexts/MemberProfileModalContext';
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

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

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

  useEffect(() => {
    closeMobileNav();
  }, [location.pathname, closeMobileNav]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobileNav();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileNavOpen, closeMobileNav]);

  useEffect(() => {
    if (typeof document === 'undefined' || !mobileNavOpen) return;
    const mq = window.matchMedia('(max-width: 1023px)');
    const apply = () => {
      if (mq.matches) document.body.style.overflow = 'hidden';
      else document.body.style.overflow = '';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
      document.body.style.overflow = '';
    };
  }, [mobileNavOpen]);

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

  const getActiveTab = () => {
    const path = location.pathname;
    if (path === '/') return 'dashboard';
    if (path.startsWith('/leaders')) return 'leaders';
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
        <MemberProfileModalProvider>
        <div className="flex h-dvh min-h-0 w-full max-w-full bg-gray-50">
          {mobileNavOpen ? (
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default border-0 bg-black/50 p-0 lg:hidden"
              aria-label="Close menu"
              onClick={closeMobileNav}
            />
          ) : null}
          <Sidebar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            mobileOpen={mobileNavOpen}
            onMobileClose={closeMobileNav}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <Header setActiveTab={setActiveTab} onOpenMobileNav={() => setMobileNavOpen(true)} />
            <main className="flex-1 min-h-0 w-full min-w-0 overflow-x-hidden overflow-y-auto overscroll-y-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 lg:p-8">
              <Outlet />
            </main>
          </div>
        </div>
        {user.cms_onboarding_completed !== true ? <CmsOnboardingModal /> : null}
        </MemberProfileModalProvider>
      </NotificationProvider>
    </AppProvider>
  );
}