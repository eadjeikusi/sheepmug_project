import { useEffect, useMemo, useState } from 'react';
import { X, Download, Search, CheckSquare, Filter, User } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';
import { withBranchScope } from '@/utils/branchScopeHeaders';
import type { Group, Member } from '@/types';
import { formatLongWeekdayDate } from '@/utils/dateDisplayFormat';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string | null;
  branchId?: string;
}

type ExportFormat = 'csv' | 'pdf';

type ExportMember = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  location: string;
  emergencyContact: string;
  dateJoined: string;
  dateOfBirth: string | null;
  profileImage: string;
};

type ExportGroup = {
  id: string;
  name: string;
  type: string;
  tag: string;
  description: string;
  memberCount: number;
  leaderName: string;
  parentGroupId: string | null;
  parentGroupName: string;
};

const calculateAge = (dob: string | null): number => {
  if (!dob) return 0;
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return age;
};

const toExportMember = (m: Member): ExportMember => ({
  id: String(m.id),
  fullName: `${m.first_name || ''} ${m.last_name || ''}`.trim() || 'Unnamed member',
  email: m.email || '-',
  phone: m.phone || m.phoneNumber || '-',
  location: m.address || m.location || '-',
  emergencyContact: m.emergency_contact_phone || m.emergencyContactPhone || '-',
  dateJoined: m.date_joined || '-',
  dateOfBirth: m.dob || null,
  profileImage: m.avatar_url || m.member_url || m.profileImage || '',
});

function flattenGroups(rows: any[], out: any[] = []): any[] {
  for (const row of rows || []) {
    out.push(row);
    const subs = Array.isArray((row as { subgroups?: unknown[] }).subgroups)
      ? ((row as { subgroups?: unknown[] }).subgroups as any[])
      : [];
    if (subs.length > 0) flattenGroups(subs, out);
  }
  return out;
}

export default function ExportModal({ isOpen, onClose, token, branchId }: ExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [birthMonth, setBirthMonth] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [ageRange, setAgeRange] = useState('');
  const [customMinAge, setCustomMinAge] = useState('');
  const [customMaxAge, setCustomMaxAge] = useState('');
  const [members, setMembers] = useState<ExportMember[]>([]);
  const [groups, setGroups] = useState<ExportGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedMembers(new Set());
    setSelectedGroups(new Set());
    setSearchQuery('');
    setBirthMonth('');
    setBirthYear('');
    setAgeRange('');
    setCustomMinAge('');
    setCustomMaxAge('');
    setFormat('csv');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!token) {
      setError('Sign in required.');
      setMembers([]);
      setGroups([]);
      return;
    }
    if (!branchId) {
      setError('Select a branch to export data.');
      setMembers([]);
      setGroups([]);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const membersUrl = new URL('/api/members', window.location.origin);
        membersUrl.searchParams.set('include_deleted', 'false');
        membersUrl.searchParams.set('branch_id', branchId);
        const groupsUrl = new URL('/api/groups', window.location.origin);
        groupsUrl.searchParams.set('tree', '1');
        groupsUrl.searchParams.set('branch_id', branchId);

        const [membersRes, groupsRes] = await Promise.all([
          fetch(membersUrl.toString(), {
            headers: withBranchScope(branchId, { Authorization: `Bearer ${token}` }),
          }),
          fetch(groupsUrl.toString(), {
            headers: withBranchScope(branchId, { Authorization: `Bearer ${token}` }),
          }),
        ]);

        const membersRaw = await membersRes.json().catch(() => ({}));
        const groupsRaw = await groupsRes.json().catch(() => ({}));
        if (!membersRes.ok) throw new Error((membersRaw as { error?: string }).error || 'Failed to load members');
        if (!groupsRes.ok) throw new Error((groupsRaw as { error?: string }).error || 'Failed to load groups');
        if (cancelled) return;

        const mArr = Array.isArray(membersRaw) ? membersRaw : Array.isArray(membersRaw?.members) ? membersRaw.members : [];
        const exportMembers = mArr.map((m: any) => toExportMember(m as Member));

        const gArr = Array.isArray(groupsRaw) ? groupsRaw : Array.isArray(groupsRaw?.groups) ? groupsRaw.groups : [];
        const flatGroups = flattenGroups(gArr);
        const groupNameById = new Map<string, string>();
        for (const g of flatGroups) groupNameById.set(String(g.id), String(g.name || ''));
        const exportGroups: ExportGroup[] = flatGroups.map((g) => {
          const parentId = g.parent_group_id ? String(g.parent_group_id) : null;
          return {
            id: String(g.id),
            name: String(g.name || ''),
            type: String(g.group_type || 'other'),
            tag: String(g.group_type || 'other'),
            description: String(g.description || ''),
            memberCount: Number(g.member_count || 0),
            leaderName: g.profiles
              ? `${String(g.profiles.first_name || '')} ${String(g.profiles.last_name || '')}`.trim() || 'Unknown'
              : 'Unknown',
            parentGroupId: parentId,
            parentGroupName: parentId ? String(groupNameById.get(parentId) || '-') : '-',
          };
        });

        setMembers(exportMembers);
        setGroups(exportGroups);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load export data.');
          setMembers([]);
          setGroups([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, token, branchId]);

  const filteredMembers = useMemo(
    () =>
      members.filter((m) => {
        const matchesSearch = m.fullName.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesMonth =
          !birthMonth ||
          (m.dateOfBirth && new Date(m.dateOfBirth).getMonth() + 1 === parseInt(birthMonth, 10));
        const matchesYear =
          !birthYear || (m.dateOfBirth && new Date(m.dateOfBirth).getFullYear() === parseInt(birthYear, 10));

        let matchesAge = true;
        if (ageRange && m.dateOfBirth) {
          const age = calculateAge(m.dateOfBirth);
          if (ageRange === '0-17') matchesAge = age >= 0 && age <= 17;
          else if (ageRange === '18-25') matchesAge = age >= 18 && age <= 25;
          else if (ageRange === '26-35') matchesAge = age >= 26 && age <= 35;
          else if (ageRange === '36-50') matchesAge = age >= 36 && age <= 50;
          else if (ageRange === '51+') matchesAge = age >= 51;
        }

        if (customMinAge || customMaxAge) {
          const age = calculateAge(m.dateOfBirth);
          const minAge = customMinAge ? parseInt(customMinAge, 10) : 0;
          const maxAge = customMaxAge ? parseInt(customMaxAge, 10) : 100;
          matchesAge = age >= minAge && age <= maxAge;
        }

        return matchesSearch && matchesMonth && matchesYear && matchesAge;
      }),
    [members, searchQuery, birthMonth, birthYear, ageRange, customMinAge, customMaxAge],
  );

  const filteredGroups = useMemo(
    () => groups.filter((g) => g.name.toLowerCase().includes(searchQuery.toLowerCase())),
    [groups, searchQuery],
  );
  const filteredMainGroups = useMemo(() => filteredGroups.filter((g) => !g.parentGroupId), [filteredGroups]);
  const filteredSubGroups = useMemo(() => filteredGroups.filter((g) => !!g.parentGroupId), [filteredGroups]);

  const allFilteredMembersSelected =
    filteredMembers.length > 0 && filteredMembers.every((member) => selectedMembers.has(member.id));

  const toggleMember = (id: string) => {
    const next = new Set(selectedMembers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedMembers(next);
  };

  const toggleGroup = (id: string) => {
    const next = new Set(selectedGroups);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedGroups(next);
  };

  const selectAllMembers = () => {
    const visible = filteredMembers.map((m) => m.id);
    if (allFilteredMembersSelected) {
      const next = new Set(selectedMembers);
      visible.forEach((id) => next.delete(id));
      setSelectedMembers(next);
      return;
    }
    const next = new Set(selectedMembers);
    visible.forEach((id) => next.add(id));
    setSelectedMembers(next);
  };

  const hasSelection = selectedMembers.size > 0 || selectedGroups.size > 0;

  const exportMembersToCSV = (memberIds: string[]) => {
    const rowsData = members.filter((m) => memberIds.includes(m.id));
    const headers = ['Full Name', 'Email', 'Phone Number', 'Location', 'Emergency Contact', 'Date Joined'];
    const rows = rowsData.map((member) => [
      member.fullName,
      member.email,
      member.phone,
      member.location,
      member.emergencyContact,
      member.dateJoined,
    ]);
    return { headers, rows };
  };

  const exportGroupsToCSV = (groupIds: string[]) => {
    const rowsData = groups.filter((g) => groupIds.includes(g.id));
    const headers = ['Group Name', 'Type', 'Tag', 'Description', 'Members Count', 'Leader', 'Parent Group'];
    const rows = rowsData.map((group) => [
      group.name,
      group.type,
      group.tag,
      group.description,
      String(group.memberCount),
      group.leaderName,
      group.parentGroupName,
    ]);
    return { headers, rows };
  };

  const downloadCSV = (headers: string[], rows: string[][], filename: string) => {
    const csvContent = [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell ?? ''}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportMembersToPDF = (doc: jsPDF, startY: number, memberIds: string[]) => {
    const { headers, rows } = exportMembersToCSV(memberIds);
    doc.setFontSize(14);
    doc.text('Members', 14, startY);
    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: startY + 8,
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    return (doc as any).lastAutoTable.finalY + 12;
  };

  const exportGroupsToPDF = (doc: jsPDF, startY: number, groupIds: string[]) => {
    const { headers, rows } = exportGroupsToCSV(groupIds);
    doc.setFontSize(14);
    doc.text('Groups', 14, startY);
    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: startY + 8,
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    return (doc as any).lastAutoTable.finalY + 12;
  };

  const downloadPDF = (filename: string) => {
    const doc = new jsPDF();
    let currentY = 20;
    doc.setFontSize(18);
    doc.text('Members Export', 14, currentY);
    doc.setFontSize(9);
    doc.text(
      `Generated on ${formatLongWeekdayDate(new Date()) || new Date().toLocaleDateString()}`,
      14,
      currentY + 6,
    );
    currentY += 16;

    if (selectedMembers.size > 0) {
      currentY = exportMembersToPDF(doc, currentY, Array.from(selectedMembers));
    }
    if (selectedGroups.size > 0) {
      if (currentY > 200) {
        doc.addPage();
        currentY = 20;
      }
      currentY = exportGroupsToPDF(doc, currentY, Array.from(selectedGroups));
    }

    doc.save(filename);
  };

  const handleExport = () => {
    if (!hasSelection) {
      toast.error('Please select at least one item to export');
      return;
    }
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `Members_Export_${timestamp}`;
    try {
      if (format === 'csv') {
        if (selectedMembers.size > 0) {
          const m = exportMembersToCSV(Array.from(selectedMembers));
          downloadCSV(m.headers, m.rows, `${filename}_Members.csv`);
        }
        if (selectedGroups.size > 0) {
          const g = exportGroupsToCSV(Array.from(selectedGroups));
          downloadCSV(g.headers, g.rows, `${filename}_Groups.csv`);
        }
      } else {
        downloadPDF(`${filename}.pdf`);
      }
      toast.success('Export completed.');
      onClose();
    } catch {
      toast.error('Export failed. Please try again.');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />

          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[88vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
                  <div>
                    <h2 className="text-4 font-semibold text-gray-900">Export Data</h2>
                    <p className="text-sm text-gray-500 mt-0.5">{selectedMembers.size + selectedGroups.size} items selected</p>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center bg-gray-100 rounded-lg p-1">
                      <button
                        onClick={() => setFormat('csv')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${format === 'csv' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                      >
                        CSV
                      </button>
                      <button
                        onClick={() => setFormat('pdf')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${format === 'pdf' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                      >
                        PDF
                      </button>
                    </div>
                    <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="px-6 py-3 border-b border-gray-200">
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search members or groups..."
                        className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                      />
                    </div>

                    <div className="flex items-center space-x-2">
                      <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <select value={birthMonth} onChange={(e) => setBirthMonth(e.target.value)} className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                        <option value="">Birth Month</option>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      <select value={birthYear} onChange={(e) => setBirthYear(e.target.value)} className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                        <option value="">Birth Year</option>
                        {Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </select>
                      <select value={ageRange} onChange={(e) => setAgeRange(e.target.value)} className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                        <option value="">Age Range</option>
                        <option value="0-17">0-17 years</option>
                        <option value="18-25">18-25 years</option>
                        <option value="26-35">26-35 years</option>
                        <option value="36-50">36-50 years</option>
                        <option value="51+">51+ years</option>
                      </select>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <input value={customMinAge} onChange={(e) => setCustomMinAge(e.target.value)} placeholder="Min Age" type="number" className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm" />
                      <input value={customMaxAge} onChange={(e) => setCustomMaxAge(e.target.value)} placeholder="Max Age" type="number" className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm" />
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4">
                  {loading ? (
                    <div className="py-14 text-center text-sm text-gray-500">Loading export data...</div>
                  ) : error ? (
                    <div className="py-10 text-center text-sm text-red-600">{error}</div>
                  ) : (
                    <div className="space-y-6">
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-semibold text-gray-900">Members ({filteredMembers.length})</h3>
                          <button onClick={selectAllMembers} className="text-sm text-gray-600 hover:text-gray-900 font-medium">
                            {allFilteredMembersSelected ? 'Deselect All' : 'Select All'}
                          </button>
                        </div>
                        <div className="space-y-1 max-h-64 overflow-y-auto">
                          {filteredMembers.map((member) => (
                            <button key={member.id} onClick={() => toggleMember(member.id)} className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-all text-left">
                              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${selectedMembers.has(member.id) ? 'bg-gray-900 border-gray-900' : 'bg-white border-gray-300'}`}>
                                {selectedMembers.has(member.id) && <CheckSquare className="w-3 h-3 text-white" />}
                              </div>
                              {member.profileImage ? (
                                <img src={member.profileImage} alt={member.fullName} className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-8 h-8 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center flex-shrink-0">
                                  <User className="w-4 h-4 text-gray-400" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{member.fullName}</p>
                                <p className="text-sm text-gray-500 truncate">{member.email}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 mb-3">Main Groups ({filteredMainGroups.length})</h3>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {filteredMainGroups.map((group) => (
                            <button key={group.id} onClick={() => toggleGroup(group.id)} className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-all text-left">
                              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${selectedGroups.has(group.id) ? 'bg-gray-900 border-gray-900' : 'bg-white border-gray-300'}`}>
                                {selectedGroups.has(group.id) && <CheckSquare className="w-3 h-3 text-white" />}
                              </div>
                              <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 text-sm">{group.name.charAt(0)}</div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{group.name}</p>
                                <p className="text-sm text-gray-500">{group.memberCount} members • {group.tag}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 mb-3">Subgroups ({filteredSubGroups.length})</h3>
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {filteredSubGroups.map((group) => (
                            <button key={group.id} onClick={() => toggleGroup(group.id)} className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-all text-left">
                              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${selectedGroups.has(group.id) ? 'bg-gray-900 border-gray-900' : 'bg-white border-gray-300'}`}>
                                {selectedGroups.has(group.id) && <CheckSquare className="w-3 h-3 text-white" />}
                              </div>
                              <div className="w-8 h-8 bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-center flex-shrink-0 text-sm">{group.name.charAt(0)}</div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{group.name}</p>
                                <p className="text-sm text-gray-500">{group.parentGroupName} • {group.memberCount} members</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="sticky bottom-0 z-10 flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
                  <p className="text-sm text-gray-600">Ready to export</p>
                  <div className="flex items-center space-x-3">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all">Cancel</button>
                    <button
                      onClick={handleExport}
                      disabled={!hasSelection || loading || !!error}
                      className={`flex items-center px-4 py-2 text-sm rounded-lg transition-all ${hasSelection && !loading && !error ? 'text-white bg-gray-900 hover:bg-gray-800' : 'text-gray-400 bg-gray-200 cursor-not-allowed'}`}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Export {format.toUpperCase()}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}