import React, { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { familyApi } from '../../utils/api';
import FamilyGroupModal from '../modals/FamilyGroupModal';
import { useBranch } from '../../contexts/BranchContext';

interface Family {
  id: string;
  family_name: string;
  branch_id: string;
  organization_id: string;
}

const Families = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [families, setFamilies] = useState<Family[]>([]);
  const [loading, setLoading] = useState(true);
  const { selectedBranch } = useBranch();

  useEffect(() => {
    if (selectedBranch) {
      fetchFamilies();
    }
  }, [selectedBranch]);

  const fetchFamilies = async () => {
    if (!selectedBranch) return;
    try {
      setLoading(true);
      const data = await familyApi.getAll({ branch_id: selectedBranch.id });
      setFamilies(data);
    } catch (error) {
    } finally {
      setLoading(false);
    }
  };

  const handleFamilyCreated = async (familyData: any) => {
    if (!selectedBranch) return;
    try {
      await familyApi.create({
        familyName: familyData.familyName,
        branch_id: selectedBranch.id,
      });
      setIsModalOpen(false);
      fetchFamilies();
    } catch (error) {
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Families</h1>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          Add Family
        </button>
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
