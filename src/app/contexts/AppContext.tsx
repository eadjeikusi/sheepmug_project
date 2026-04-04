import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Organization } from '@/types';

interface AppContextType {
  // Current organization
  currentOrganization: Organization | null;
  setCurrentOrganization: (org: Organization | null) => void;
  
  // Current branch
  currentBranchId: string | null;
  setCurrentBranchId: (branchId: string | null) => void;
  
  // Loading states
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentOrganization, setCurrentOrganization] = useState<Organization | null>(() => {
    const savedOrg = localStorage.getItem('churchhub_current_organization');
    if (savedOrg) {
      try {
        return JSON.parse(savedOrg);
      } catch (error) {
        return {
          id: "mock-org-123",
          name: "Mock Organization",
          slug: "mock-org",
          subdomain: null,
          logo_url: null,
          address: null,
          phone: null,
          email: null,
          website: null,
          timezone: "UTC",
          currency: "USD",
          subscription_status: "active",
          subscription_plan: "premium",
          trial_ends_at: null,
          settings: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
    }
    return {
      id: "mock-org-123",
      name: "Mock Organization",
      slug: "mock-org",
      subdomain: null,
      logo_url: null,
      address: null,
      phone: null,
      email: null,
      website: null,
      timezone: "UTC",
      currency: "USD",
      subscription_status: "active",
      subscription_plan: "premium",
      trial_ends_at: null,
      settings: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Load branch from localStorage on mount
  useEffect(() => {
    const savedBranch = localStorage.getItem('churchhub_current_branch');
    if (savedBranch) {
      setCurrentBranchId(savedBranch);
    }
  }, []);

  // Save organization to localStorage when it changes
  useEffect(() => {
    if (currentOrganization) {
      localStorage.setItem('churchhub_current_organization', JSON.stringify(currentOrganization));
    } else {
      localStorage.removeItem('churchhub_current_organization');
    }
  }, [currentOrganization]);

  // Save branch to localStorage when it changes
  useEffect(() => {
    if (currentBranchId) {
      localStorage.setItem('churchhub_current_branch', currentBranchId);
    } else {
      localStorage.removeItem('churchhub_current_branch');
    }
  }, [currentBranchId]);

  return (
    <AppContext.Provider
      value={{
        currentOrganization,
        setCurrentOrganization,
        currentBranchId,
        setCurrentBranchId,
        isLoading,
        setIsLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}