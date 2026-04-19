import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Branch } from "@sheepmug/shared-api";
import { api, setApiBranchId } from "../lib/api";
import { getSelectedBranchId, setSelectedBranchId } from "../lib/storage";
import { useAuth } from "./AuthContext";

type BranchState = {
  branches: Branch[];
  selectedBranch: Branch | null;
  loading: boolean;
  refreshBranches: () => Promise<void>;
  selectBranch: (branch: Branch | null) => Promise<void>;
};

const BranchContext = createContext<BranchState | undefined>(undefined);

export function BranchProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshBranches = useCallback(async () => {
    if (!token) {
      setBranches([]);
      setSelectedBranch(null);
      setApiBranchId(null);
      await setSelectedBranchId(null);
      return;
    }

    setLoading(true);
    try {
      const list = await api.branches.list().catch(() => []);
      setBranches(list);

      const storedId = await getSelectedBranchId();
      const found = storedId ? list.find((b) => b.id === storedId) ?? null : null;
      const fallback = found ?? list[0] ?? null;

      setSelectedBranch(fallback);
      setApiBranchId(fallback?.id ?? null);
      await setSelectedBranchId(fallback?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refreshBranches();
  }, [refreshBranches]);

  const selectBranch = useCallback(async (branch: Branch | null) => {
    setSelectedBranch(branch);
    setApiBranchId(branch?.id ?? null);
    await setSelectedBranchId(branch?.id ?? null);
  }, []);

  const value = useMemo<BranchState>(
    () => ({ branches, selectedBranch, loading, refreshBranches, selectBranch }),
    [branches, selectedBranch, loading, refreshBranches, selectBranch]
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used inside BranchProvider");
  return ctx;
}
