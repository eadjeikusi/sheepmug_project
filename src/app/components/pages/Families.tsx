import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { familyApi } from '../../utils/api';
import FamilyGroupModal from '../modals/FamilyGroupModal';
import { useBranch } from '../../contexts/BranchContext';
import { usePermissions } from '../../hooks/usePermissions';

interface Family {
  id: string;
  family_name: string;
  branch_id: string;
  organization_id: string;
}

const PAGE_SIZE = 10;

const Families = () => {
  const { can } = usePermissions();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadedFamiliesCountRef = useRef(0);
  const { selectedBranch } = useBranch();

  useEffect(() => {
    loadedFamiliesCountRef.current = families.length;
  }, [families.length]);

  const fetchFamilies = useCallback(async (reset = true) => {
    if (!selectedBranch) return;
    try {
      if (reset) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      const offset = reset ? 0 : loadedFamiliesCountRef.current;
      const data = await familyApi.getAll({
        branch_id: selectedBranch.id,
        offset,
        limit: PAGE_SIZE,
      });
      const rows = Array.isArray(data) ? data : Array.isArray(data?.families) ? data.families : [];
      setFamilies((prev) => (reset ? rows : [...prev, ...rows]));
      setHasMore(rows.length === PAGE_SIZE);
    } catch (error) {
    } finally {
      if (reset) {
        setLoading(false);
      } else {
        setLoadingMore(false);
      }
    }
  }, [selectedBranch, can]);

  useEffect(() => {
    if (selectedBranch && can('view_families')) {
      void fetchFamilies(true);
    } else {
      setFamilies([]);
      setHasMore(true);
      setLoading(false);
    }
  }, [selectedBranch, fetchFamilies, can]);

  useEffect(() => {
    if (loading || loadingMore || !hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void fetchFamilies(false);
        }
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchFamilies, loading, loadingMore, hasMore]);

  const handleFamilyCreated = async (familyData: any) => {
    if (!selectedBranch || !can('add_families')) return;
    try {
      await familyApi.create({
        familyName: familyData.familyName,
        branch_id: selectedBranch.id,
      });
      setIsModalOpen(false);
      void fetchFamilies(true);
    } catch (error) {
    }
  };

  if (!can('view_families')) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Families</h1>
        <p className="text-gray-600">You do not have permission to view families.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Families</h1>
        {can('add_families') ? (
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Add Family
        </button>
        ) : null}
      </div>

      {loading ? (
        <p>Loading families...</p>
      ) : (
        <div className="grid gap-4">
          {families.map((family) => (
            <div key={family.id} className="bg-white p-4 rounded-lg shadow border border-gray-200 flex justify-between items-center">
              <h3 className="font-semibold text-lg">{family.family_name}</h3>
              <button className="text-red-500 hover:text-red-700">
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          ))}
          {families.length === 0 && <p>No families found.</p>}
          {!loading && hasMore ? <div ref={sentinelRef} className="h-6" /> : null}
          {loadingMore ? <p className="text-sm text-gray-500">Loading more families...</p> : null}
        </div>
      )}

      {isModalOpen && (
        <FamilyGroupModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleFamilyCreated}
        />
      )}
    </div>
  );
};

export default Families;
