import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useApp } from './AppContext';
import { useAuth } from './AuthContext';
import { toast } from 'sonner';
import { Branch } from '@/types';

interface BranchContextType {
  selectedBranch: Branch | null;
  setSelectedBranch: (branch: Branch) => void;
  branches: Branch[];
  refreshBranches: () => Promise<void>;
  loading: boolean;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: ReactNode }) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranchState] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(false);
  const { currentOrganization } = useApp();
  const { user, isAuthenticated, token } = useAuth();

  // Fetch branches from database
  const fetchBranches = useCallback(async () => {
    if (!token && !user) {
      const mockBranches: Branch[] = [
        {
          id: 'mock-branch-1',
          name: 'Mock Main Branch',
          location: 'Mock City, MC',
          organization_id: currentOrganization?.id || 'mock-org-123',
          is_active: true,
        },
      ];
      setBranches(mockBranches);
      setSelectedBranchState(mockBranches[0]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/branches', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to fetch branches');
      }
      
      const data = await response.json();
      setBranches(data);
      
      // Select the first branch if none selected or if current selection not in new list
      if (data.length > 0) {
        const storedBranchId = localStorage.getItem('selectedBranchId');
        const userBranchId = user?.branch_id;
        
        
        const found = data.find((b: Branch) => b.id === (storedBranchId || userBranchId));
        
        const branchToSelect = found || data[0];
        setSelectedBranchState(branchToSelect);
        
        // Persist selection
        localStorage.setItem('selectedBranchId', branchToSelect.id);
      } else {
        setSelectedBranchState(null);
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to load branches');
    } finally {
      setLoading(false);
    }
  }, [user?.branch_id, token, currentOrganization?.id]); // Added currentOrganization.id to dependencies

  // Load branches when user is available
  useEffect(() => {
    if (isAuthenticated) {
      fetchBranches();
    } else {
      setBranches([]);
      setSelectedBranchState(null);
    }
  }, [isAuthenticated, fetchBranches]);

  const setSelectedBranch = (branch: Branch) => {
    setSelectedBranchState(branch);
    localStorage.setItem('selectedBranchId', branch.id);
  };

  const refreshBranches = async () => {
    await fetchBranches();
  };

  return (
    <BranchContext.Provider value={{ selectedBranch, setSelectedBranch, branches, refreshBranches, loading }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const context = useContext(BranchContext);
  if (context === undefined) {
    throw new Error('useBranch must be used within a BranchProvider');
  }
  return context;
}