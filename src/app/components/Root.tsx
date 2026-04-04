import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import Sidebar from './layout/Sidebar';
import Header from './layout/Header';
import { AppProvider } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';

export default function Root() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  
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
  
  // Determine active tab from URL
  const getActiveTab = () => {
    const path = location.pathname;
    if (path === '/') return 'dashboard';
    if (path.startsWith('/groups')) return 'groups';
    return path.slice(1).split('/')[0] || 'dashboard';
  };

  const activeTab = getActiveTab();

  const setActiveTab = (tab: string) => {
    navigate(`/${tab === 'dashboard' ? '' : tab}`);
  };

  return (
    <AppProvider>
      <div className="flex h-screen bg-gray-50">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header setActiveTab={setActiveTab} />
          <main className="flex-1 overflow-y-auto p-8">
            <Outlet />
          </main>
        </div>
      </div>
    </AppProvider>
  );
}