import { useState } from 'react';
import { X, Download, Search, CheckSquare, Filter } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { mockMembers as originalMockMembers, mockGroups, type Member, type Group } from '../../utils/mockData';
import { patchMemberWithDOB } from '../../utils/addDOB';
import { toast } from 'sonner';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ExportFormat = 'csv' | 'pdf';

export default function ExportModal({ isOpen, onClose }: ExportModalProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [birthMonth, setBirthMonth] = useState<string>('');
  const [birthYear, setBirthYear] = useState<string>('');
  const [ageRange, setAgeRange] = useState<string>('');
  const [customMinAge, setCustomMinAge] = useState<string>('');
  const [customMaxAge, setCustomMaxAge] = useState<string>('');

  // Patch mockMembers with DOB data
  const mockMembers = originalMockMembers.map(patchMemberWithDOB);

  const mainGroups = mockGroups.filter(g => !g.parentGroupId);
  const subGroups = mockGroups.filter(g => g.parentGroupId);

  // Helper function to calculate age from DOB
  const calculateAge = (dob: string | undefined): number => {
    if (!dob) return 0;
    const birthDate = new Date(dob);
    const today = new Date('2026-03-06'); // Using the current date from context
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  };

  // Filter members by search, DOB month, year, and age range
  const filteredMembers = mockMembers.filter(m => {
    const matchesSearch = m.fullName.toLowerCase().includes(searchQuery.toLowerCase());
    
    // Month filter
    const matchesMonth = !birthMonth || (m.dateOfBirth && new Date(m.dateOfBirth).getMonth() + 1 === parseInt(birthMonth));
    
    // Year filter
    const matchesYear = !birthYear || (m.dateOfBirth && new Date(m.dateOfBirth).getFullYear() === parseInt(birthYear));
    
    // Age range filter
    let matchesAge = true;
    if (ageRange && m.dateOfBirth) {
      const age = calculateAge(m.dateOfBirth);
      switch (ageRange) {
        case '0-17':
          matchesAge = age >= 0 && age <= 17;
          break;
        case '18-25':
          matchesAge = age >= 18 && age <= 25;
          break;
        case '26-35':
          matchesAge = age >= 26 && age <= 35;
          break;
        case '36-50':
          matchesAge = age >= 36 && age <= 50;
          break;
        case '51+':
          matchesAge = age >= 51;
          break;
      }
    }
    
    // Custom age range filter
    if (customMinAge || customMaxAge) {
      const age = calculateAge(m.dateOfBirth);
      const minAge = customMinAge ? parseInt(customMinAge) : 0;
      const maxAge = customMaxAge ? parseInt(customMaxAge) : 100;
      matchesAge = age >= minAge && age <= maxAge;
    }
    
    return matchesSearch && matchesMonth && matchesYear && matchesAge;
  });
  
  const filteredMainGroups = mainGroups.filter(g =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredSubGroups = subGroups.filter(g =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleMember = (id: string) => {
    const newSet = new Set(selectedMembers);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedMembers(newSet);
  };

  const toggleGroup = (id: string) => {
    const newSet = new Set(selectedGroups);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedGroups(newSet);
  };

  const selectAllMembers = () => {
    if (selectedMembers.size === mockMembers.length) {
      setSelectedMembers(new Set());
    } else {
      setSelectedMembers(new Set(mockMembers.map(m => m.id)));
    }
  };

  const hasSelection = selectedMembers.size > 0 || selectedGroups.size > 0;

  // CSV Export Functions
  const exportMembersToCSV = (memberIds: string[]) => {
    const members = mockMembers.filter(m => memberIds.includes(m.id));
    const headers = ['Full Name', 'Email', 'Phone Number', 'Location', 'Emergency Contact', 'Join Date', 'Last Attendance', 'Attendance Rate'];
    const rows = members.map(member => [
      member.fullName,
      member.email,
      member.phoneNumber,
      member.location,
      member.emergencyContact,
      member.joinDate,
      member.lastAttendance,
      `${member.attendanceRate}%`,
    ]);
    return { headers, rows };
  };

  const exportGroupsToCSV = (groupIds: string[]) => {
    const groups = mockGroups.filter(g => groupIds.includes(g.id));
    const headers = ['Group Name', 'Type', 'Tag', 'Description', 'Members Count', 'Leader', 'Parent Group'];
    
    const rows = groups.map(group => {
      const leader = mockMembers.find(m => m.id === group.leaderId);
      const parentGroup = group.parentGroupId ? mockGroups.find(g => g.id === group.parentGroupId) : null;
      
      return [
        group.name,
        group.type,
        group.tag,
        group.description,
        group.memberIds.length.toString(),
        leader?.fullName || 'Unknown',
        parentGroup?.name || '-',
      ];
    });
    return { headers, rows };
  };

  const downloadCSV = (headers: string[], rows: string[][], filename: string) => {
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // PDF Export Functions
  const exportMembersToPDF = (doc: jsPDF, startY: number, memberIds: string[]) => {
    const { headers, rows } = exportMembersToCSV(memberIds);
    
    doc.setFontSize(14);
    doc.setTextColor(55, 65, 81);
    doc.text('Members', 14, startY);
    
    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: startY + 8,
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [75, 85, 99], textColor: 255, fontStyle: 'bold' },
      margin: { left: 14, right: 14 },
    });

    return (doc as any).lastAutoTable.finalY + 12;
  };

  const exportGroupsToPDF = (doc: jsPDF, startY: number, groupIds: string[]) => {
    const { headers, rows } = exportGroupsToCSV(groupIds);
    
    doc.setFontSize(14);
    doc.setTextColor(55, 65, 81);
    doc.text('Groups', 14, startY);
    
    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: startY + 8,
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [75, 85, 99], textColor: 255, fontStyle: 'bold' },
      margin: { left: 14, right: 14 },
    });

    return (doc as any).lastAutoTable.finalY + 12;
  };

  const downloadPDF = (filename: string) => {
    const doc = new jsPDF();
    let currentY = 20;

    // Add header
    doc.setFontSize(18);
    doc.setTextColor(31, 41, 55);
    doc.text('ChurchHub Export', 14, currentY);
    
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(`Generated on ${new Date().toLocaleDateString()}`, 14, currentY + 6);
    
    doc.setDrawColor(229, 231, 235);
    doc.line(14, currentY + 10, 196, currentY + 10);
    
    currentY += 18;

    // Export selected data
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

    // Add footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(156, 163, 175);
      doc.text(
        `Page ${i} of ${pageCount}`,
        doc.internal.pageSize.width / 2,
        doc.internal.pageSize.height - 10,
        { align: 'center' }
      );
    }

    doc.save(filename);
  };

  const handleExport = () => {
    if (!hasSelection) {
      toast.error('Please select at least one item to export');
      return;
    }

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `ChurchHub_${timestamp}`;

    try {
      if (format === 'csv') {
        // Always export to separate files for CSV
        if (selectedMembers.size > 0) {
          const { headers, rows } = exportMembersToCSV(Array.from(selectedMembers));
          downloadCSV(headers, rows, `${filename}_Members.csv`);
        }
        if (selectedGroups.size > 0) {
          const { headers, rows } = exportGroupsToCSV(Array.from(selectedGroups));
          downloadCSV(headers, rows, `${filename}_Groups.csv`);
        }
        toast.success('Export completed!');
      } else {
        // PDF exports to single file
        downloadPDF(`${filename}.pdf`);
        toast.success('PDF downloaded!');
      }
      onClose();
    } catch (error) {
      toast.error('Export failed. Please try again.');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">
                      Export Data
                    </h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {selectedMembers.size + selectedGroups.size} items selected
                    </p>
                  </div>
                  <div className="flex items-center space-x-3">
                    {/* Format Toggle */}
                    <div className="flex items-center bg-gray-100 rounded-lg p-1">
                      <button
                        onClick={() => setFormat('csv')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                          format === 'csv'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        CSV
                      </button>
                      <button
                        onClick={() => setFormat('pdf')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                          format === 'pdf'
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        PDF
                      </button>
                    </div>
                    
                    <button
                      onClick={onClose}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Search */}
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
                    
                    {/* DOB Filters */}
                    <div className="flex items-center space-x-2">
                      <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <select
                        value={birthMonth}
                        onChange={(e) => setBirthMonth(e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                      >
                        <option value="">Birth Month</option>
                        <option value="1">January</option>
                        <option value="2">February</option>
                        <option value="3">March</option>
                        <option value="4">April</option>
                        <option value="5">May</option>
                        <option value="6">June</option>
                        <option value="7">July</option>
                        <option value="8">August</option>
                        <option value="9">September</option>
                        <option value="10">October</option>
                        <option value="11">November</option>
                        <option value="12">December</option>
                      </select>
                      
                      <select
                        value={birthYear}
                        onChange={(e) => setBirthYear(e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                      >
                        <option value="">Birth Year</option>
                        {Array.from({ length: 100 }, (_, i) => 2026 - i).map(year => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                      </select>
                      
                      <select
                        value={ageRange}
                        onChange={(e) => setAgeRange(e.target.value)}
                        className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                      >
                        <option value="">Age Range</option>
                        <option value="0-17">0-17 years</option>
                        <option value="18-25">18-25 years</option>
                        <option value="26-35">26-35 years</option>
                        <option value="36-50">36-50 years</option>
                        <option value="51+">51+ years</option>
                      </select>
                      
                      {(birthMonth || birthYear || ageRange) && (
                        <button
                          onClick={() => {
                            setBirthMonth('');
                            setBirthYear('');
                            setAgeRange('');
                          }}
                          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 font-medium whitespace-nowrap"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    
                    {/* Custom Age Range */}
                    <div className="flex items-center space-x-2">
                      <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <input
                        type="number"
                        value={customMinAge}
                        onChange={(e) => setCustomMinAge(e.target.value)}
                        placeholder="Min Age"
                        className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                      />
                      
                      <input
                        type="number"
                        value={customMaxAge}
                        onChange={(e) => setCustomMaxAge(e.target.value)}
                        placeholder="Max Age"
                        className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
                      />
                      
                      {(customMinAge || customMaxAge) && (
                        <button
                          onClick={() => {
                            setCustomMinAge('');
                            setCustomMaxAge('');
                          }}
                          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 font-medium whitespace-nowrap"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="space-y-6">
                    {/* Members Section */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-gray-900">
                          Members ({filteredMembers.length})
                        </h3>
                        <button
                          onClick={selectAllMembers}
                          className="text-sm text-gray-600 hover:text-gray-900 font-medium"
                        >
                          {selectedMembers.size === mockMembers.length ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {filteredMembers.map((member) => (
                          <button
                            key={member.id}
                            onClick={() => toggleMember(member.id)}
                            className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-all text-left"
                          >
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                              selectedMembers.has(member.id)
                                ? 'bg-gray-900 border-gray-900'
                                : 'bg-white border-gray-300'
                            }`}>
                              {selectedMembers.has(member.id) && (
                                <CheckSquare className="w-3 h-3 text-white" />
                              )}
                            </div>
                            <img
                              src={member.profileImage}
                              alt={member.fullName}
                              className="w-8 h-8 rounded-lg object-cover flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {member.fullName}
                              </p>
                              <p className="text-sm text-gray-500 truncate">{member.email}</p>
                            </div>
                          </button>
                        ))}
                        {filteredMembers.length === 0 && (
                          <p className="text-sm text-gray-500 text-center py-4">No members found</p>
                        )}
                      </div>
                    </div>

                    {/* Main Groups Section */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-gray-900">
                          Main Groups ({filteredMainGroups.length})
                        </h3>
                      </div>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {filteredMainGroups.map((group) => (
                          <button
                            key={group.id}
                            onClick={() => toggleGroup(group.id)}
                            className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-all text-left"
                          >
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                              selectedGroups.has(group.id)
                                ? 'bg-gray-900 border-gray-900'
                                : 'bg-white border-gray-300'
                            }`}>
                              {selectedGroups.has(group.id) && (
                                <CheckSquare className="w-3 h-3 text-white" />
                              )}
                            </div>
                            <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 text-sm">
                              {group.name.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {group.name}
                              </p>
                              <p className="text-sm text-gray-500">
                                {group.memberIds.length} members • {group.tag}
                              </p>
                            </div>
                          </button>
                        ))}
                        {filteredMainGroups.length === 0 && (
                          <p className="text-sm text-gray-500 text-center py-4">No groups found</p>
                        )}
                      </div>
                    </div>

                    {/* Subgroups Section */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-gray-900">
                          Subgroups ({filteredSubGroups.length})
                        </h3>
                      </div>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {filteredSubGroups.map((group) => {
                          const parentGroup = mockGroups.find(g => g.id === group.parentGroupId);
                          return (
                            <button
                              key={group.id}
                              onClick={() => toggleGroup(group.id)}
                              className="w-full flex items-center space-x-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-all text-left"
                            >
                              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                                selectedGroups.has(group.id)
                                  ? 'bg-gray-900 border-gray-900'
                                  : 'bg-white border-gray-300'
                              }`}>
                                {selectedGroups.has(group.id) && (
                                  <CheckSquare className="w-3 h-3 text-white" />
                                )}
                              </div>
                              <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0 text-sm border border-gray-200">
                                {group.name.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {group.name}
                                </p>
                                <p className="text-sm text-gray-500">
                                  {parentGroup?.name} • {group.memberIds.length} members
                                </p>
                              </div>
                            </button>
                          );
                        })}
                        {filteredSubGroups.length === 0 && (
                          <p className="text-sm text-gray-500 text-center py-4">No subgroups found</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
                  <p className="text-sm text-gray-600">
                    {selectedMembers.size > 0 && selectedGroups.size > 0 ? (
                      <span>Exports to <strong>separate files</strong></span>
                    ) : (
                      <span>Ready to export</span>
                    )}
                  </p>
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={onClose}
                      className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleExport}
                      disabled={!hasSelection}
                      className={`flex items-center px-4 py-2 text-sm rounded-lg transition-all ${
                        hasSelection
                          ? 'text-white bg-gray-900 hover:bg-gray-800'
                          : 'text-gray-400 bg-gray-200 cursor-not-allowed'
                      }`}
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