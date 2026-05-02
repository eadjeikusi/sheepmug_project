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
  const SA_ACT_KEY = 'superadmin_act_as';

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
      let actAs: { organization_id?: string; branch_id?: string } | null = null;
      try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SA_ACT_KEY) : null;
        if (raw && user?.is_super_admin === true) {
          actAs = JSON.parse(raw) as { organization_id?: string; branch_id?: string };
        }
      } catch {
        actAs = null;
      }

      if (actAs?.organization_id && user?.is_super_admin === true) {
        const r = await fetch(`/api/superadmin/branches?org_id=${encodeURIComponent(actAs.organization_id)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error('Failed to load branches for organization');
        const payload = (await r.json()) as { branches?: Branch[] };
        const data = (payload.branches || []) as Branch[];
        setBranches(data);
        const want = actAs.branch_id;
        const pick = want ? data.find((b) => b.id === want) : undefined;
        const branchToSelect = pick || data[0];
        if (branchToSelect) {
          setSelectedBranchState(branchToSelect);
          localStorage.setItem('selectedBranchId', branchToSelect.id);
        } else {
          setSelectedBranchState(null);
        }
        setLoading(false);
        return;
      }

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

        /** Assigned branch in profile wins over stale localStorage so X-Branch-Id matches server checks. */
        const byUser =
          userBranchId && data.some((b: Branch) => b.id === userBranchId) ? userBranchId : null;
        const preferredId = byUser || storedBranchId || userBranchId;
        const found = preferredId ? data.find((b: Branch) => b.id === preferredId) : undefined;

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
  }, [user?.branch_id, user?.is_super_admin, token, currentOrganization?.id]);

  // Load branches when user is available
  useEffect(() => {
    if (isAuthenticated) {
      fetchBranches();
    } else {
      setBranches([]);
      setSelectedBranchState(null);
    }
  }, [isAuthenticated, fetchBranches]);

  const setSelectedBranch = useCallback(
    (branch: Branch) => {
      if (
        user?.is_super_admin !== true &&
        user?.is_org_owner !== true &&
        user?.branch_id &&
        branch.id !== user.branch_id
      ) {
        toast.error('Only the organization owner can switch branches.');
        return;
      }
      setSelectedBranchState(branch);
      localStorage.setItem('selectedBranchId', branch.id);
    },
    [user?.is_super_admin, user?.is_org_owner, user?.branch_id]
  );

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