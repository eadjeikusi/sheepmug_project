import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { User, Bell, Users, Square, Save, Plus, Trash2, Type, Hash, Calendar as CalendarIcon, CheckCircle, List, FileText, Upload, Edit, Edit2, Tag, Building2, ChevronRight, ChevronDown, UserCircle2, ClipboardList, Search, X, Layers, MapPin, Check, Globe, Copy, Settings2, Shield, CreditCard } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useBranch } from '../../contexts/BranchContext';
import { useAuth } from '../../contexts/AuthContext';
import BranchModal from '../modals/BranchModal';
import { useApp } from '../../contexts/AppContext';
import { withBranchScope } from '../../utils/branchScopeHeaders';
import { ALL_PERMISSION_IDS, resolveImpliedPermissions, validatePermissionIds } from '../../../permissions/catalog';
import { getMatrixSectionPermissionIds } from '../../../permissions/permissionMatrixLayout';
import { PermissionRoleMatrix } from '../permissions/PermissionRoleMatrix';
import {
  canAccessStaffOrRoleAdmin,
  canAnyRoleAdmin,
  canConfigureCustomFieldsUi,
  canConfigureGroupTypeOptions,
  canConfigureMemberStatusOptions,
  canViewOrEditEventTypesUi,
  canViewOrEditProgramTemplatesUi,
} from '../../../permissions/atomicCanHelpers';
import { usePermissions } from '@/hooks/usePermissions';
import { useMemberStatusOptions } from '../../hooks/useMemberStatusOptions';
import { useGroupTypeOptions } from '../../hooks/useGroupTypeOptions';
import type { MemberStatusOption, GroupTypeOption, CustomFieldDefinition, Organization } from '../../../types';
import EventTypes from './EventTypes';
import EventOutlineTemplates from './EventOutlineTemplates';
import { SortableSettingsOrderList } from '../settings/SortableSettingsOrderList';
import { SettingsSubscription, type SubscriptionSubTab } from './SettingsSubscription';
import { isSubscriptionSubTab } from '@/utils/subscriptionTabs';

type ApiRoleRow = { id: string; name: string; permissions: string[] };

type FieldDraft = {
  label: string;
  field_type: string;
  required: boolean;
  placeholder: string;
  options: string[];
  default_value: string;
  applies_to: ('member' | 'event' | 'group')[];
  show_on_public: boolean;
};

/** Top-level settings nav: General (with sub-sections), Notifications, Subscription, Roles & permissions (with sub-tabs). */
type SettingsMainTab = 'general' | 'notifications' | 'subscription' | 'roles';

type GeneralSubTab =
  | 'organization'
  | 'customFields'
  | 'eventTypes'
  | 'programTemplates'
  | 'memberStatuses'
  | 'groupTypes'
  | 'branches';

type RolesSubTab = 'staff' | 'permissions';

const GENERAL_SUB_TABS: { id: GeneralSubTab; label: string }[] = [
  { id: 'organization', label: 'Organization name' },
  { id: 'customFields', label: 'Custom fields' },
  { id: 'eventTypes', label: 'Event types' },
  { id: 'programTemplates', label: 'Program templates' },
  { id: 'memberStatuses', label: 'Member status' },
  { id: 'groupTypes', label: 'Group types' },
  { id: 'branches', label: 'Branch selection' },
];

const LEGACY_SETTINGS_TAB_TO_STATE: Record<
  string,
  { main: SettingsMainTab; generalSub?: GeneralSubTab; rolesSub?: RolesSubTab }
> = {
  staff: { main: 'roles', rolesSub: 'staff' },
  permissions: { main: 'roles', rolesSub: 'permissions' },
  customFields: { main: 'general', generalSub: 'customFields' },
  eventTypes: { main: 'general', generalSub: 'eventTypes' },
  programTemplates: { main: 'general', generalSub: 'programTemplates' },
  memberStatuses: { main: 'general', generalSub: 'memberStatuses' },
  groupTypes: { main: 'general', generalSub: 'groupTypes' },
  branches: { main: 'general', generalSub: 'branches' },
  integrations: { main: 'general', generalSub: 'organization' },
  database: { main: 'general', generalSub: 'organization' },
};

function isGeneralSubTab(value: string | null | undefined): value is GeneralSubTab {
  if (!value) return false;
  return GENERAL_SUB_TABS.some((t) => t.id === value);
}

function buildSettingsSearchParams(
  main: SettingsMainTab,
  generalSub: GeneralSubTab,
  rolesSub: RolesSubTab,
  subscriptionSub: SubscriptionSubTab,
): Record<string, string> {
  if (main === 'notifications') return { tab: 'notifications' };
  if (main === 'subscription') {
    if (subscriptionSub === 'overview') return { tab: 'subscription' };
    return { tab: 'subscription', sub: subscriptionSub };
  }
  if (main === 'general') {
    if (generalSub === 'organization') return {};
    return { tab: 'general', sub: generalSub };
  }
  if (main === 'roles') {
    if (rolesSub === 'staff') return { tab: 'roles' };
    return { tab: 'roles', sub: 'permissions' };
  }
  return {};
}

type Ministry = {
  id: string;
  name: string;
  children?: Ministry[];
};

export default function Settings() {
  const [mainTab, setMainTab] = useState<SettingsMainTab>('general');
  const [generalSub, setGeneralSub] = useState<GeneralSubTab>('organization');
  const [rolesSub, setRolesSub] = useState<RolesSubTab>('staff');
  const [subscriptionSub, setSubscriptionSub] = useState<SubscriptionSubTab>('overview');
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedBranch, setSelectedBranch, branches, refreshBranches, loading: branchLoading } = useBranch();
  const { currentOrganization, setCurrentOrganization } = useApp();
  const { user, token } = useAuth();
  const canSwitchBranch = user?.is_org_owner === true;
  const { can } = usePermissions();
  const canEditOrgName = can('edit_organization_name');
  const canManageSubscription = user?.is_org_owner === true || can('system_settings') || can('manage_subscription');

  const [orgNameDraft, setOrgNameDraft] = useState('');
  const [orgNameLoading, setOrgNameLoading] = useState(false);
  const [orgNameSaving, setOrgNameSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setOrgNameLoading(true);
    void (async () => {
      try {
        const res = await fetch('/api/org/organization', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const err = typeof (data as { error?: string }).error === 'string' ? (data as { error: string }).error : 'Failed to load organization';
          throw new Error(err);
        }
        const org = (data as { organization?: Record<string, unknown> }).organization;
        if (cancelled || !org) return;
        if (typeof org.name === 'string') setOrgNameDraft(org.name);
        setCurrentOrganization((prev) => {
          if (!prev) return org as Organization;
          return { ...prev, ...org } as Organization;
        });
      } catch (e: unknown) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : 'Failed to load organization');
      } finally {
        if (!cancelled) setOrgNameLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, setCurrentOrganization]);

  const saveOrganizationName = async () => {
    if (!token || !canEditOrgName) return;
    const name = orgNameDraft.trim();
    if (!name) {
      toast.error('Enter an organization name');
      return;
    }
    setOrgNameSaving(true);
    try {
      const res = await fetch('/api/org/organization', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof (data as { error?: string }).error === 'string' ? (data as { error: string }).error : 'Save failed');
      }
      const org = (data as { organization?: Record<string, unknown> }).organization;
      if (org) {
        setCurrentOrganization((prev) => {
          if (!prev) return org as Organization;
          return { ...prev, ...org } as Organization;
        });
      }
      toast.success('Organization name saved');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setOrgNameSaving(false);
    }
  };

  useEffect(() => {
    const rawTab = searchParams.get('tab');
    const rawSub = searchParams.get('sub');

    if (!rawTab) {
      setMainTab('general');
      setGeneralSub('organization');
      setRolesSub('staff');
      setSubscriptionSub('overview');
      return;
    }

    if (rawTab === 'notifications') {
      setMainTab('notifications');
      return;
    }

    if (rawTab === 'subscription') {
      setMainTab('subscription');
      setSubscriptionSub(isSubscriptionSubTab(rawSub) ? rawSub : 'overview');
      return;
    }

    if (rawTab === 'general') {
      setMainTab('general');
      setGeneralSub(isGeneralSubTab(rawSub) ? rawSub : 'organization');
      return;
    }

    if (rawTab === 'roles') {
      setMainTab('roles');
      setRolesSub(rawSub === 'permissions' ? 'permissions' : 'staff');
      return;
    }

    const legacy = LEGACY_SETTINGS_TAB_TO_STATE[rawTab];
    if (legacy) {
      setMainTab(legacy.main);
      if (legacy.generalSub) setGeneralSub(legacy.generalSub);
      if (legacy.rolesSub) setRolesSub(legacy.rolesSub);
      return;
    }

    setMainTab('general');
    setGeneralSub('organization');
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const navigateSettings = (next: {
    main: SettingsMainTab;
    generalSub?: GeneralSubTab;
    rolesSub?: RolesSubTab;
    subscriptionSub?: SubscriptionSubTab;
  }) => {
    const m = next.main;
    const gResolved = m === 'general' ? (next.generalSub !== undefined ? next.generalSub : generalSub) : generalSub;
    const rResolved = m === 'roles' ? (next.rolesSub !== undefined ? next.rolesSub : rolesSub) : rolesSub;
    const subResolved =
      m === 'subscription' ? (next.subscriptionSub !== undefined ? next.subscriptionSub : subscriptionSub) : subscriptionSub;
    setMainTab(m);
    if (next.generalSub !== undefined) setGeneralSub(next.generalSub);
    if (next.rolesSub !== undefined) setRolesSub(next.rolesSub);
    if (next.subscriptionSub !== undefined) setSubscriptionSub(next.subscriptionSub);
    setSearchParams(buildSettingsSearchParams(m, gResolved, rResolved, subResolved), { replace: true });
  };

  const fetchNotificationPrefs = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/notification-preferences/me', {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed to load notification settings');
      const p = (data as { preferences?: Record<string, unknown> }).preferences || {};
      setNotificationPrefs({
        mute_all: Boolean(p.mute_all),
        tasks_enabled: p.tasks_enabled !== false,
        attendance_enabled: p.attendance_enabled !== false,
        events_enabled: p.events_enabled !== false,
        requests_enabled: p.requests_enabled !== false,
        assignments_enabled: p.assignments_enabled !== false,
        permissions_enabled: p.permissions_enabled !== false,
        member_care_enabled: p.member_care_enabled !== false,
        leader_updates_enabled: p.leader_updates_enabled !== false,
        granular_preferences:
          p.granular_preferences && typeof p.granular_preferences === 'object' && !Array.isArray(p.granular_preferences)
            ? Object.fromEntries(
                Object.entries(p.granular_preferences as Record<string, unknown>).filter(([, v]) => typeof v === 'boolean'),
              )
            : {},
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load notification settings');
    }
  }, [selectedBranch?.id, token]);

  useEffect(() => {
    if (mainTab === 'notifications' && token) {
      void fetchNotificationPrefs();
    }
  }, [mainTab, fetchNotificationPrefs, token]);

  const updateNotificationPref = async (key: string, value: boolean) => {
    if (!token) return;
    setNotificationPrefs((prev) => (prev ? { ...prev, [key]: value } : prev));
    setNotificationPrefsSaving(true);
    try {
      const res = await fetch('/api/notification-preferences/me', {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ [key]: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed to save notification settings');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to save notification settings');
      await fetchNotificationPrefs();
    } finally {
      setNotificationPrefsSaving(false);
    }
  };

  const updateNotificationGranularPref = async (key: string, value: boolean) => {
    if (!token) return;
    setNotificationPrefs((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        granular_preferences: {
          ...prev.granular_preferences,
          [key]: value,
        },
      };
    });
    setNotificationPrefsSaving(true);
    try {
      const nextGranular = {
        ...(notificationPrefs?.granular_preferences || {}),
        [key]: value,
      };
      const res = await fetch('/api/notification-preferences/me', {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ granular_preferences: nextGranular }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed to save notification settings');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to save notification settings');
      await fetchNotificationPrefs();
    } finally {
      setNotificationPrefsSaving(false);
    }
  };

  const [apiRoles, setApiRoles] = useState<ApiRoleRow[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState('');
  const [permDraft, setPermDraft] = useState<Set<string>>(new Set());
  const [savingRole, setSavingRole] = useState(false);
  const [staffRoleUpdating, setStaffRoleUpdating] = useState<string | null>(null);
  const [notificationPrefs, setNotificationPrefs] = useState<{
    mute_all: boolean;
    tasks_enabled: boolean;
    attendance_enabled: boolean;
    events_enabled: boolean;
    requests_enabled: boolean;
    assignments_enabled: boolean;
    permissions_enabled: boolean;
    member_care_enabled: boolean;
    leader_updates_enabled: boolean;
    granular_preferences: Record<string, boolean>;
  } | null>(null);
  const [notificationPrefsSaving, setNotificationPrefsSaving] = useState(false);
  const [expandedNotificationSections, setExpandedNotificationSections] = useState<Set<string>>(
    () => new Set(['tasks_enabled', 'events_enabled']),
  );

  const selectedRole = apiRoles.find((r) => r.id === selectedRoleId) ?? null;

  /** Match server MEMBER_STATUS_OPTION_WRITE_PERMS and who can open /settings (Root.tsx). */
  const canConfigureMemberStatuses = canConfigureMemberStatusOptions(can);

  const canConfigureGroupTypes = canConfigureGroupTypeOptions(can);

  const memberStatusesTabActive = mainTab === 'general' && generalSub === 'memberStatuses';
  const groupTypesTabActive = mainTab === 'general' && generalSub === 'groupTypes';
  const customFieldsTabActive = mainTab === 'general' && generalSub === 'customFields';
  const {
    options: memberStatusOptions,
    loading: memberStatusOptionsLoading,
    refresh: refreshMemberStatusOptions,
  } = useMemberStatusOptions(memberStatusesTabActive);
  const {
    options: groupTypeOptions,
    loading: groupTypeOptionsLoading,
    refresh: refreshGroupTypeOptions,
    tableMissing: groupTypeTableMissing,
  } = useGroupTypeOptions(groupTypesTabActive);
  const canConfigureCustomFields = canConfigureCustomFieldsUi(can);

  const [customFieldsSchemaHint, setCustomFieldsSchemaHint] = useState<string | null>(null);

  const fetchCustomFieldDefinitions = useCallback(async () => {
    if (!token) return;
    setCustomFieldsLoading(true);
    try {
      const res = await fetch('/api/custom-field-definitions', {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg =
          typeof (data as { error?: string }).error === 'string'
            ? (data as { error: string }).error
            : 'Load failed';
        const hint =
          typeof (data as { hint?: string }).hint === 'string' ? (data as { hint: string }).hint : null;
        if (res.status === 503 && hint) setCustomFieldsSchemaHint(hint);
        else setCustomFieldsSchemaHint(null);
        setCustomFieldDefinitions([]);
        throw new Error(errMsg);
      }
      setCustomFieldsSchemaHint(null);
      setCustomFieldDefinitions(Array.isArray(data) ? (data as CustomFieldDefinition[]) : []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not load custom fields');
    } finally {
      setCustomFieldsLoading(false);
    }
  }, [token, selectedBranch?.id]);

  useEffect(() => {
    if (customFieldsTabActive && token) void fetchCustomFieldDefinitions();
  }, [customFieldsTabActive, token, fetchCustomFieldDefinitions]);
  const [memberStatusNewLabel, setMemberStatusNewLabel] = useState('');
  const [memberStatusBusy, setMemberStatusBusy] = useState(false);

  const sortedMemberStatusOptions = useMemo(() => {
    return [...memberStatusOptions].sort(
      (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
    );
  }, [memberStatusOptions]);

  const sortedGroupTypeOptions = useMemo(() => {
    return [...groupTypeOptions].sort(
      (a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label),
    );
  }, [groupTypeOptions]);

  const [groupTypeNewLabel, setGroupTypeNewLabel] = useState('');
  const [groupTypeBusy, setGroupTypeBusy] = useState(false);

  const seedMemberStatusDefaults = async () => {
    if (!token || !canConfigureMemberStatuses) return;
    setMemberStatusBusy(true);
    try {
      const res = await fetch('/api/member-status-options/seed-defaults', {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Seed failed');
      toast.success('Default member statuses added');
      await refreshMemberStatusOptions();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not add defaults');
    } finally {
      setMemberStatusBusy(false);
    }
  };

  const addMemberStatusOption = async () => {
    if (!token || !canConfigureMemberStatuses) return;
    const label = memberStatusNewLabel.trim();
    if (!label) {
      toast.error('Enter a status label');
      return;
    }
    setMemberStatusBusy(true);
    try {
      const res = await fetch('/api/member-status-options', {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          label,
          sort_order: sortedMemberStatusOptions.length,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Add failed');
      toast.success('Status added');
      setMemberStatusNewLabel('');
      await refreshMemberStatusOptions();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not add status');
    } finally {
      setMemberStatusBusy(false);
    }
  };

  const patchMemberStatusOption = async (id: string, patch: Partial<Pick<MemberStatusOption, 'label' | 'sort_order'>>) => {
    if (!token || !canConfigureMemberStatuses) return;
    setMemberStatusBusy(true);
    try {
      const res = await fetch(`/api/member-status-options/${id}`, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Update failed');
      await refreshMemberStatusOptions();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setMemberStatusBusy(false);
    }
  };

  const deleteMemberStatusOption = async (id: string) => {
    if (!token || !canConfigureMemberStatuses) return;
    const opt = sortedMemberStatusOptions.find((x) => x.id === id);
    const name = (opt?.label ?? '').trim() || 'this option';
    if (!window.confirm(`Remove member status “${name}”? It will no longer be available for new assignments.`)) return;
    setMemberStatusBusy(true);
    try {
      const res = await fetch(`/api/member-status-options/${id}`, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Delete failed');
      toast.success('Status removed');
      await refreshMemberStatusOptions();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setMemberStatusBusy(false);
    }
  };

  const commitMemberStatusOrder = useCallback(
    async (next: MemberStatusOption[]) => {
      if (!token || !canConfigureMemberStatuses) return;
      const orderedIds = next.map((x) => x.id);
      const prevIds = sortedMemberStatusOptions.map((x) => x.id);
      if (orderedIds.join('\u0001') === prevIds.join('\u0001')) return;
      setMemberStatusBusy(true);
      try {
        const headers = withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        });
        await Promise.all(
          orderedIds.map((id, i) =>
            fetch(`/api/member-status-options/${id}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ sort_order: i }),
            }).then(async (r) => {
              const d = (await r.json().catch(() => ({}))) as { error?: string };
              if (!r.ok) throw new Error(d.error || 'Reorder failed');
            }),
          ),
        );
        await refreshMemberStatusOptions();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Could not reorder');
      } finally {
        setMemberStatusBusy(false);
      }
    },
    [token, canConfigureMemberStatuses, selectedBranch?.id, sortedMemberStatusOptions, refreshMemberStatusOptions],
  );

  const seedGroupTypeDefaults = async () => {
    if (!token || !canConfigureGroupTypes) return;
    setGroupTypeBusy(true);
    try {
      const res = await fetch('/api/group-type-options/seed-defaults', {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Seed failed');
      toast.success('Default group types added');
      await refreshGroupTypeOptions();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not add defaults');
    } finally {
      setGroupTypeBusy(false);
    }
  };

  const addGroupTypeOption = async () => {
    if (!token || !canConfigureGroupTypes) return;
    const label = groupTypeNewLabel.trim();
    if (!label) {
      toast.error('Enter a group type label');
      return;
    }
    setGroupTypeBusy(true);
    try {
      const res = await fetch('/api/group-type-options', {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          label,
          sort_order: sortedGroupTypeOptions.length,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Add failed');
      toast.success('Group type added');
      setGroupTypeNewLabel('');
      await refreshGroupTypeOptions();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Could not add group type');
    } finally {
      setGroupTypeBusy(false);
    }
  };

  const patchGroupTypeOption = async (
    id: string,
    patch: Partial<Pick<GroupTypeOption, 'label' | 'sort_order'>>,
  ) => {
    if (!token || !canConfigureGroupTypes) return;
    setGroupTypeBusy(true);
    try {
      const res = await fetch(`/api/group-type-options/${id}`, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Update failed');
      await refreshGroupTypeOptions();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setGroupTypeBusy(false);
    }
  };

  const deleteGroupTypeOption = async (id: string) => {
    if (!token || !canConfigureGroupTypes) return;
    const opt = sortedGroupTypeOptions.find((x) => x.id === id);
    const name = (opt?.label ?? '').trim() || 'this option';
    if (!window.confirm(`Remove group type “${name}”? It will no longer be available when creating or editing groups.`)) return;
    setGroupTypeBusy(true);
    try {
      const res = await fetch(`/api/group-type-options/${id}`, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Delete failed');
      toast.success('Group type removed');
      await refreshGroupTypeOptions();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setGroupTypeBusy(false);
    }
  };

  const commitGroupTypeOrder = useCallback(
    async (next: GroupTypeOption[]) => {
      if (!token || !canConfigureGroupTypes) return;
      const orderedIds = next.map((x) => x.id);
      const prevIds = sortedGroupTypeOptions.map((x) => x.id);
      if (orderedIds.join('\u0001') === prevIds.join('\u0001')) return;
      setGroupTypeBusy(true);
      try {
        const headers = withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        });
        await Promise.all(
          orderedIds.map((id, i) =>
            fetch(`/api/group-type-options/${id}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({ sort_order: i }),
            }).then(async (r) => {
              const d = (await r.json().catch(() => ({}))) as { error?: string };
              if (!r.ok) throw new Error(d.error || 'Reorder failed');
            }),
          ),
        );
        await refreshGroupTypeOptions();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Could not reorder');
      } finally {
        setGroupTypeBusy(false);
      }
    },
    [token, canConfigureGroupTypes, selectedBranch?.id, sortedGroupTypeOptions, refreshGroupTypeOptions],
  );

  const fetchOrgRoles = useCallback(async () => {
    if (!token) return;
    setRolesLoading(true);
    try {
      const res = await fetch('/api/org/roles', {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load roles');
      const list: ApiRoleRow[] = (data.roles || []).map((r: { id: string; name: string; permissions: unknown }) => ({
        id: r.id,
        name: r.name,
        permissions: Array.isArray(r.permissions) ? (r.permissions as string[]) : [],
      }));
      setApiRoles(list);
      setSelectedRoleId((cur) => {
        if (cur && list.some((x) => x.id === cur)) return cur;
        return list[0]?.id ?? null;
      });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load roles');
    } finally {
      setRolesLoading(false);
    }
  }, [token, selectedBranch?.id]);

  useEffect(() => {
    if (selectedRoleId) {
      const r = apiRoles.find((x) => x.id === selectedRoleId);
      if (r) setPermDraft(new Set(r.permissions));
    }
  }, [selectedRoleId, apiRoles]);

  useEffect(() => {
    if (mainTab === 'roles' && rolesSub === 'permissions' && token && canAnyRoleAdmin(can)) void fetchOrgRoles();
  }, [mainTab, rolesSub, token, fetchOrgRoles, can]);

  const persistRolePermissions = async () => {
    if (!token || !selectedRoleId) return;
    setSavingRole(true);
    try {
      const res = await fetch(`/api/org/roles/${selectedRoleId}`, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ permission_ids: [...permDraft] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      toast.success('Role permissions updated');
      void fetchOrgRoles();
    } catch (e: any) {
      toast.error(e?.message || 'Save failed');
    } finally {
      setSavingRole(false);
    }
  };

  const applyAllPermissionsToDraft = () => {
    const full = new Set(validatePermissionIds(ALL_PERMISSION_IDS));
    setPermDraft(new Set(resolveImpliedPermissions(full)));
  };

  const applySectionPermissionsToDraft = (sectionId: string) => {
    const sectionIds = getMatrixSectionPermissionIds(sectionId);
    if (sectionIds.length === 0) return;
    setPermDraft((prev) => {
      const next = new Set(prev);
      for (const id of sectionIds) next.add(id);
      return new Set(resolveImpliedPermissions(next));
    });
  };

  const nextDuplicateRoleName = (sourceName: string, existing: ApiRoleRow[]) => {
    const base = sourceName.trim() || 'Role';
    const used = new Set(existing.map((r) => r.name.trim()));
    let n = 2;
    for (; n < 9999; n += 1) {
      const candidate = `${base} ${n}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${base} ${Date.now()}`;
  };

  const duplicateOrgRole = async (source: ApiRoleRow) => {
    if (!token) return;
    const name = nextDuplicateRoleName(source.name, apiRoles);
    setSavingRole(true);
    try {
      const res = await fetch('/api/org/roles', {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          name,
          permission_ids: validatePermissionIds([...source.permissions]),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Duplicate failed');
      toast.success(`Role created: ${name}`);
      await fetchOrgRoles();
      if (data.role?.id) setSelectedRoleId(data.role.id);
    } catch (e: any) {
      toast.error(e?.message || 'Duplicate failed');
    } finally {
      setSavingRole(false);
    }
  };

  const createOrgRole = async () => {
    const name = newRoleName.trim();
    if (!token || !name) {
      toast.error('Enter a role name');
      return;
    }
    try {
      const res = await fetch('/api/org/roles', {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ name, permission_ids: [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
      toast.success('Role created');
      setNewRoleName('');
      await fetchOrgRoles();
      if (data.role?.id) setSelectedRoleId(data.role.id);
    } catch (e: any) {
      toast.error(e?.message || 'Create failed');
    }
  };

  const deleteOrgRole = async (id: string) => {
    if (!token) return;
    if (!confirm('Delete this role? Users must be reassigned first if the role is in use.')) return;
    try {
      const res = await fetch(`/api/org/roles/${id}`, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      toast.success('Role deleted');
      if (selectedRoleId === id) setSelectedRoleId(null);
      void fetchOrgRoles();
    } catch (e: any) {
      toast.error(e?.message || 'Delete failed');
    }
  };

  const patchStaffRole = async (profileId: string, roleId: string | null) => {
    if (!token) return;
    setStaffRoleUpdating(profileId);
    try {
      const res = await fetch(`/api/org/staff/${profileId}/role`, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ role_id: roleId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      toast.success('Role assigned');
      void fetchStaffList();
      void fetchStaffProfileGroups();
    } catch (e: any) {
      toast.error(e?.message || 'Update failed');
    } finally {
      setStaffRoleUpdating(null);
    }
  };

  const createStaffProfileGroup = async () => {
    if (!token || !newStaffGroupName.trim()) return;
    if (!newStaffGroupRoleId) {
      toast.error('Choose a role for this group.');
      return;
    }
    setCreatingStaffGroup(true);
    try {
      const res = await fetch('/api/org/staff-profile-groups', {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ name: newStaffGroupName.trim(), role_id: newStaffGroupRoleId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Create failed');
      toast.success('Staff access group created');
      setNewStaffGroupName('');
      setNewStaffGroupRoleId('');
      void fetchStaffProfileGroups();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setCreatingStaffGroup(false);
    }
  };

  const patchStaffProfileGroupRole = async (groupId: string, roleId: string | null) => {
    if (!token) return;
    const g = staffProfileGroups.find((x) => x.id === groupId);
    const n = g?.member_count ?? 0;
    if (
      !confirm(
        roleId
          ? `Update this group’s role?${n > 0 ? ` This will set all ${n} member(s) to this role.` : ' New members will use this role.'}`
          : `Remove the group’s role?${n > 0 ? ` This will clear the role for ${n} member(s).` : ''}`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/org/staff-profile-groups/${encodeURIComponent(groupId)}`, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ role_id: roleId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      toast.success('Group updated');
      void fetchStaffProfileGroups();
      void fetchStaffList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const deleteStaffProfileGroup = async (groupId: string) => {
    if (!token) return;
    if (
      !confirm(
        'Delete this staff access group?\n\n' +
          'Members will be removed from the group and their assigned role will be cleared. They will lose access to the platform until an administrator assigns a role again under Branch staff.\n\n' +
          'This does not delete their login account, but they cannot use the app without a role and active access.',
      )
    )
      return;
    try {
      const res = await fetch(`/api/org/staff-profile-groups/${encodeURIComponent(groupId)}`, {
        method: 'DELETE',
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      toast.success('Group deleted');
      void fetchStaffProfileGroups();
      void fetchStaffList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const addStaffToProfileGroup = async (groupId: string, profileId: string) => {
    if (!token || !profileId) return;
    try {
      const res = await fetch(`/api/org/staff-profile-groups/${encodeURIComponent(groupId)}/members`, {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ profile_id: profileId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Add failed');
      toast.success('Added to group');
      void fetchStaffProfileGroups();
      void fetchStaffList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Add failed');
    }
  };

  const removeStaffFromProfileGroup = async (groupId: string, profileId: string) => {
    if (!token) return;
    if (!confirm('Remove this person from the group? Their role will be cleared unless you assign one under Branch staff.')) return;
    try {
      const res = await fetch(
        `/api/org/staff-profile-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(profileId)}`,
        {
          method: 'DELETE',
          headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Remove failed');
      toast.success('Removed from group');
      void fetchStaffProfileGroups();
      void fetchStaffList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Remove failed');
    }
  };

  const patchStaffPlatformAccess = async (profileId: string, is_active: boolean) => {
    if (!token) return;
    if (
      !is_active &&
      !confirm(
        'Suspend this user’s platform access?\n\nThey will be signed out and cannot use the app until access is restored here.',
      )
    )
      return;
    try {
      const res = await fetch(`/api/org/staff/${encodeURIComponent(profileId)}/access`, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      toast.success(is_active ? 'Access restored' : 'Access suspended');
      void fetchStaffList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const patchStaffGroupSuspended = async (groupId: string, suspended: boolean) => {
    if (!token) return;
    if (
      suspended &&
      !confirm(
        'Suspend this staff access group?\n\nAll members will lose platform access until the group is unsuspended.',
      )
    )
      return;
    try {
      const res = await fetch(`/api/org/staff-profile-groups/${encodeURIComponent(groupId)}`, {
        method: 'PATCH',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ suspended }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      toast.success(suspended ? 'Group suspended' : 'Group unsuspended');
      void fetchStaffProfileGroups();
      void fetchStaffList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const togglePermDraft = (id: string) => {
    setPermDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        const expanded = resolveImpliedPermissions(next);
        for (const imp of expanded) next.add(imp);
      }
      return next;
    });
  };

  const impliedByOther = useMemo(() => {
    return resolveImpliedPermissions(permDraft);
  }, [permDraft]);

  const [staffList, setStaffList] = useState<
    {
      id: string;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      branch_id: string | null;
      role_id: string | null;
      is_org_owner?: boolean | null;
      is_active?: boolean;
      staff_access_group_name?: string | null;
      ministry_scope_group_ids?: string[];
      created_at: string | null;
    }[]
  >([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [ministryGroupNameById, setMinistryGroupNameById] = useState<Map<string, string>>(() => new Map());
  const [ministryModalProfileId, setMinistryModalProfileId] = useState<string | null>(null);
  const [ministryModalGroups, setMinistryModalGroups] = useState<
    { id: string; name: string; system_kind?: string | null }[]
  >([]);
  const [ministryModalSelected, setMinistryModalSelected] = useState<Set<string>>(() => new Set());
  const [ministryModalLoading, setMinistryModalLoading] = useState(false);
  const [ministryModalSaving, setMinistryModalSaving] = useState(false);
  const [leaderForm, setLeaderForm] = useState({ firstName: '', lastName: '', email: '', password: '' });
  const [leaderSubmitting, setLeaderSubmitting] = useState(false);

  type StaffProfileGroupRow = {
    id: string;
    name: string;
    role_id: string | null;
    suspended?: boolean;
    member_count: number;
    members: { profile_id: string; email: string | null; first_name: string | null; last_name: string | null }[];
  };
  const [staffProfileGroups, setStaffProfileGroups] = useState<StaffProfileGroupRow[]>([]);
  const [staffGroupsLoading, setStaffGroupsLoading] = useState(false);
  const [newStaffGroupName, setNewStaffGroupName] = useState('');
  const [newStaffGroupRoleId, setNewStaffGroupRoleId] = useState('');
  const [creatingStaffGroup, setCreatingStaffGroup] = useState(false);
  const [staffGroupExpanded, setStaffGroupExpanded] = useState<Record<string, boolean>>({});
  const [bulkModalGroupId, setBulkModalGroupId] = useState<string | null>(null);
  const [bulkModalStep, setBulkModalStep] = useState<'pick' | 'confirm'>('pick');
  const [bulkModalSearch, setBulkModalSearch] = useState('');
  const [bulkModalSelected, setBulkModalSelected] = useState<Set<string>>(new Set());
  const [bulkModalSubmitting, setBulkModalSubmitting] = useState(false);
  const fetchStaffProfileGroups = useCallback(async () => {
    if (!token) return;
    setStaffGroupsLoading(true);
    try {
      const res = await fetch('/api/org/staff-profile-groups', {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load staff access groups');
      setStaffProfileGroups(Array.isArray(data.groups) ? data.groups : []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to load staff access groups';
      toast.error(msg);
      setStaffProfileGroups([]);
    } finally {
      setStaffGroupsLoading(false);
    }
  }, [token, selectedBranch?.id]);

  const profileIdToStaffGroupId = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of staffProfileGroups) {
      for (const mem of g.members) {
        m.set(mem.profile_id, g.id);
      }
    }
    return m;
  }, [staffProfileGroups]);

  const fetchStaffList = useCallback(async () => {
    if (!token) return;
    setStaffLoading(true);
    try {
      const res = await fetch('/api/org/staff', {
        headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load staff');
      setStaffList(Array.isArray(data.staff) ? data.staff : []);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load staff');
    } finally {
      setStaffLoading(false);
    }
  }, [token, selectedBranch?.id]);

  useEffect(() => {
    if (mainTab !== 'roles' || rolesSub !== 'staff' || !token) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          new URL('/api/groups?tree=1&include_system=1', window.location.origin).toString(),
          { headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }) },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || cancelled) return;
        const m = new Map<string, string>();
        const gList = Array.isArray(data) ? data : Array.isArray(data?.groups) ? data.groups : [];
        for (const g of gList) {
          const row = g as { id?: string; name?: string };
          if (row.id && typeof row.name === 'string') m.set(row.id, row.name);
        }
        if (!cancelled) setMinistryGroupNameById(m);
      } catch {
        /* */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mainTab, rolesSub, token, selectedBranch?.id]);

  const openMinistryScopeModal = useCallback(
    async (profileId: string) => {
      if (!token) return;
      setMinistryModalProfileId(profileId);
      setMinistryModalLoading(true);
      try {
        const [grRes, scRes] = await Promise.all([
          fetch(new URL('/api/groups?tree=1&include_system=1', window.location.origin).toString(), {
            headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
          }),
          fetch(`/api/org/staff/${encodeURIComponent(profileId)}/ministry-scope`, {
            headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
          }),
        ]);
        const gData = await grRes.json().catch(() => ({}));
        const sData = await scRes.json().catch(() => ({}));
        if (!grRes.ok) {
          throw new Error(typeof (gData as { error?: string }).error === 'string' ? (gData as { error: string }).error : 'Failed to load groups');
        }
        if (!scRes.ok) {
          throw new Error(typeof (sData as { error?: string }).error === 'string' ? (sData as { error: string }).error : 'Failed to load scope');
        }
        const gArr = Array.isArray(gData) ? gData : Array.isArray(gData?.groups) ? gData.groups : [];
        const list = (gArr as { id: string; name: string; system_kind?: string | null }[]).map((g) => ({
            id: g.id,
            name: (g.name || '').trim() || 'Ministry',
            system_kind: g.system_kind ?? null,
          }));
        setMinistryModalGroups(list.sort((a, b) => a.name.localeCompare(b.name)));
        const ids = Array.isArray((sData as { group_ids?: string[] }).group_ids)
          ? (sData as { group_ids: string[] }).group_ids
          : [];
        setMinistryModalSelected(new Set(ids.filter((x) => typeof x === 'string' && x.length > 0)));
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Failed to open editor');
        setMinistryModalProfileId(null);
        setMinistryModalGroups([]);
        setMinistryModalSelected(new Set());
      } finally {
        setMinistryModalLoading(false);
      }
    },
    [token, selectedBranch?.id],
  );

  const saveMinistryScopeModal = useCallback(async () => {
    if (!token || !ministryModalProfileId) return;
    setMinistryModalSaving(true);
    try {
      const res = await fetch(`/api/org/staff/${encodeURIComponent(ministryModalProfileId)}/ministry-scope`, {
        method: 'PUT',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ group_ids: [...ministryModalSelected] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof (data as { error?: string }).error === 'string' ? (data as { error: string }).error : 'Save failed');
      }
      toast.success('Ministry scope saved');
      setMinistryModalProfileId(null);
      setMinistryModalGroups([]);
      setMinistryModalSelected(new Set());
      void fetchStaffList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setMinistryModalSaving(false);
    }
  }, [token, ministryModalProfileId, ministryModalSelected, selectedBranch?.id, fetchStaffList]);

  const bulkEligibleStaff = useMemo(() => {
    const q = bulkModalSearch.trim().toLowerCase();
    return staffList.filter((row) => {
      if (row.is_org_owner === true) return false;
      if (profileIdToStaffGroupId.has(row.id)) return false;
      if (!q) return true;
      const name = [row.first_name, row.last_name].filter(Boolean).join(' ').toLowerCase();
      return name.includes(q) || (row.email || '').toLowerCase().includes(q);
    });
  }, [staffList, profileIdToStaffGroupId, bulkModalSearch]);

  const submitBulkAddMembers = async () => {
    if (!token || !bulkModalGroupId || bulkModalSelected.size === 0) return;
    setBulkModalSubmitting(true);
    try {
      const res = await fetch(
        `/api/org/staff-profile-groups/${encodeURIComponent(bulkModalGroupId)}/members/bulk`,
        {
          method: 'POST',
          headers: withBranchScope(selectedBranch?.id, {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ profile_ids: [...bulkModalSelected] }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk add failed');
      const added = (data.added as string[]) || [];
      const skipped = (data.skipped as { profile_id: string; reason: string }[]) || [];
      toast.success(`Added ${added.length} member(s)${skipped.length ? `; ${skipped.length} skipped` : ''}`);
      setBulkModalGroupId(null);
      setBulkModalStep('pick');
      setBulkModalSelected(new Set());
      setBulkModalSearch('');
      void fetchStaffProfileGroups();
      void fetchStaffList();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Bulk add failed');
    } finally {
      setBulkModalSubmitting(false);
    }
  };

  useEffect(() => {
    if (
      mainTab === 'roles' &&
      rolesSub === 'staff' &&
      token &&
      canAccessStaffOrRoleAdmin(can)
    ) {
      void fetchStaffList();
    }
  }, [mainTab, rolesSub, token, fetchStaffList, can]);

  useEffect(() => {
    if (
      mainTab === 'roles' &&
      rolesSub === 'staff' &&
      token &&
      canAccessStaffOrRoleAdmin(can)
    ) {
      void fetchOrgRoles();
    }
  }, [mainTab, rolesSub, token, can, fetchOrgRoles]);

  useEffect(() => {
    if (
      mainTab === 'roles' &&
      rolesSub === 'staff' &&
      token &&
      canAccessStaffOrRoleAdmin(can)
    ) {
      void fetchStaffProfileGroups();
    }
  }, [mainTab, rolesSub, token, can, fetchStaffProfileGroups]);


  const handleCreateGroupLeader = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      toast.error('Sign in required');
      return;
    }
    setLeaderSubmitting(true);
    try {
      const res = await fetch('/api/org/group-leaders', {
        method: 'POST',
        headers: withBranchScope(selectedBranch?.id, {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          first_name: leaderForm.firstName.trim(),
          last_name: leaderForm.lastName.trim(),
          email: leaderForm.email.trim(),
          password: leaderForm.password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details || 'Failed to create account');
      toast.success('Group leader account created. They can sign in with this email and password.');
      setLeaderForm({ firstName: '', lastName: '', email: '', password: '' });
      void fetchStaffList();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create account');
    } finally {
      setLeaderSubmitting(false);
    }
  };
  
  // Debug: Check auth status on component mount
  useEffect(() => {
  }, [user, currentOrganization, branches]);
  
  const [showAssignLeaderModal, setShowAssignLeaderModal] = useState(false);
  const [selectedMember, setSelectedMember] = useState('');
  const [assignLeaderRoleType, setAssignLeaderRoleType] = useState('group_leader');
  const [selectedMinistries, setSelectedMinistries] = useState<string[]>([]);
  const [expandedMinistries, setExpandedMinistries] = useState<Set<string>>(new Set());
  
  // Branch management states
  const [dbBranches, setDbBranches] = useState<any[]>([]);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<any | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [customFieldDefinitions, setCustomFieldDefinitions] = useState<CustomFieldDefinition[]>([]);
  const [customFieldsLoading, setCustomFieldsLoading] = useState(false);
  const [showFieldEditor, setShowFieldEditor] = useState(false);
  const [editingDefinitionId, setEditingDefinitionId] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState<FieldDraft>({
    label: '',
    field_type: 'text',
    required: false,
    placeholder: '',
    options: [],
    default_value: '',
    applies_to: ['member'],
    show_on_public: false,
  });

  // Sample data for member selection
  const mockMembers = [
    { id: '1', name: 'Emma Thompson', email: 'emma.t@church.com', avatar: '' },
    { id: '2', name: 'David Martinez', email: 'david.m@church.com', avatar: '' },
    { id: '3', name: 'Lisa Anderson', email: 'lisa.a@church.com', avatar: '' },
    { id: '4', name: 'James Wilson', email: 'james.w@church.com', avatar: '' },
  ];

  // Sample ministries with tree structure
  const availableMinistries: Ministry[] = [
    {
      id: 'worship',
      name: 'Worship Team',
      children: [
        { id: 'worship-vocals', name: 'Vocals' },
        { id: 'worship-instruments', name: 'Instruments' },
        { id: 'worship-tech', name: 'Technical Support' }
      ]
    },
    {
      id: 'youth',
      name: 'Youth Ministry',
      children: [
        { id: 'youth-teens', name: 'Teenagers (13-17)' },
        { id: 'youth-young-adults', name: 'Young Adults (18-25)' }
      ]
    },
    {
      id: 'children',
      name: 'Children Ministry',
      children: [
        { id: 'children-nursery', name: 'Nursery (0-2)' },
        { id: 'children-preschool', name: 'Preschool (3-5)' },
        { id: 'children-elementary', name: 'Elementary (6-12)' }
      ]
    },
    {
      id: 'media',
      name: 'Media Ministry',
      children: [
        { id: 'media-sound', name: 'Sound Engineering' },
        { id: 'media-video', name: 'Video Production' },
        { id: 'media-graphics', name: 'Graphics & Design' }
      ]
    },
    { id: 'outreach', name: 'Outreach' },
    { id: 'prayer', name: 'Prayer Ministry' },
    { id: 'community', name: 'Community' },
    { id: 'missions', name: 'Missions' },
    { id: 'events', name: 'Events' },
    { id: 'sunday-school', name: 'Sunday School' },
    { id: 'intercession', name: 'Intercession' },
    { id: 'hospitality', name: 'Hospitality' },
    { id: 'ushers', name: 'Ushers' }
  ];

  const handleAssignLeader = () => {
    if (!selectedMember) {
      toast.error('Please select a member');
      return;
    }
    if (selectedMinistries.length === 0) {
      toast.error('Please select at least one ministry');
      return;
    }
    
    // In real implementation, this would save to backend
    toast.success('Leader assigned successfully!');
    setShowAssignLeaderModal(false);
    setSelectedMember('');
    setAssignLeaderRoleType('group_leader');
    setSelectedMinistries([]);
    setExpandedMinistries(new Set());
  };

  const toggleMinistry = (ministryId: string) => {
    setSelectedMinistries(prev =>
      prev.includes(ministryId)
        ? prev.filter(m => m !== ministryId)
        : [...prev, ministryId]
    );
  };

  const toggleExpanded = (ministryId: string) => {
    setExpandedMinistries(prev => {
      const newSet = new Set(prev);
      if (newSet.has(ministryId)) {
        newSet.delete(ministryId);
      } else {
        newSet.add(ministryId);
      }
      return newSet;
    });
  };

  const renderMinistryTree = (ministry: Ministry, level: number = 0) => {
    const hasChildren = ministry.children && ministry.children.length > 0;
    const isExpanded = expandedMinistries.has(ministry.id);
    const isSelected = selectedMinistries.includes(ministry.id);

    return (
      <div key={ministry.id}>
        <button
          onClick={() => {
            if (hasChildren) {
              toggleExpanded(ministry.id);
            }
            toggleMinistry(ministry.id);
          }}
          className={`w-full px-3 py-2 rounded-lg border text-xs font-medium transition-all text-left flex items-center ${
            isSelected
              ? 'border-blue-500 bg-blue-100 text-blue-700'
              : 'border-gray-200 hover:border-gray-300 text-gray-700 bg-white'
          }`}
          style={{ marginLeft: `${level * 20}px` }}
        >
          {hasChildren && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(ministry.id);
              }}
              className="mr-1 flex-shrink-0"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </span>
          )}
          {!hasChildren && <span className="w-4 mr-1" />}
          <span className="flex-1">{ministry.name}</span>
          {isSelected && (
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
        </button>
        {hasChildren && isExpanded && (
          <div className="mt-1 space-y-1">
            {ministry.children!.map(child => renderMinistryTree(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const fetchBranches = useCallback(async () => {
    if (!token) return;
    setLoadingBranches(true);
    try {
      const res = await fetch('/api/branches', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error((data as { error?: string }).error || 'Failed to load branches');
      setDbBranches(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to load branches');
    } finally {
      setLoadingBranches(false);
    }
  }, [token]);

  useEffect(() => {
    if (mainTab === 'general' && generalSub === 'branches') {
      void fetchBranches();
    }
  }, [mainTab, generalSub, fetchBranches]);

  const handleSaveBranch = async (branchData: any) => {
    if (!token) return;
    try {
      const isEdit = !!branchData.id;
      const url = isEdit ? `/api/branches/${branchData.id}` : '/api/branches';
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(branchData),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Failed to save branch');
      }
      toast.success(isEdit ? 'Branch updated successfully!' : 'Branch created successfully!');
    setShowBranchModal(false);
    setEditingBranch(null);
      await fetchBranches();
      await refreshBranches();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to save branch');
    }
  };

  const handleDeleteBranch = async (branchId: string, branchName: string) => {
    if (!token) {
      return;
    }
    const confirmText = `DELETE ${branchName}`.trim();
    const warningMessage =
      'WARNING: You are about to permanently delete this branch.\n\n' +
      `Branch: ${branchName}\n` +
      'This action cannot be undone.\n\n' +
      `Type "${confirmText}" to continue.`;
    const typed = window.prompt(warningMessage);
    if (!typed || typed.trim() !== confirmText) {
      toast.error('Branch delete cancelled. Confirmation text did not match.');
      return;
    }
    try {
      const res = await fetch(`/api/branches/${branchId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || 'Failed to delete branch');
    }
    toast.success('Branch deleted successfully!');
      await fetchBranches();
      await refreshBranches();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete branch');
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="space-y-3">
        <div className="flex max-w-full flex-nowrap items-center gap-x-0.5 gap-y-1 overflow-x-auto overflow-y-hidden scroll-smooth border-b border-gray-200 overscroll-x-contain sm:flex-wrap sm:overflow-x-visible sm:gap-x-1">
          <button
            type="button"
            onClick={() => navigateSettings({ main: 'general' })}
            className={`shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-all sm:px-5 ${
              mainTab === 'general'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Settings2 className="w-4 h-4 inline mr-2 shrink-0" />
            General settings
          </button>
          <button
            type="button"
            onClick={() => navigateSettings({ main: 'notifications' })}
            className={`shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-all sm:px-5 ${
              mainTab === 'notifications'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Bell className="w-4 h-4 inline mr-2" />
            Notifications
          </button>
          {canManageSubscription ? (
            <button
              type="button"
              onClick={() => navigateSettings({ main: 'subscription' })}
              className={`shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-all sm:px-5 ${
                mainTab === 'subscription'
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <CreditCard className="w-4 h-4 inline mr-2 shrink-0" />
              Subscription
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => navigateSettings({ main: 'roles' })}
            className={`shrink-0 whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 transition-all sm:px-5 ${
              mainTab === 'roles'
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Shield className="w-4 h-4 inline mr-2" />
            Roles and permissions
          </button>
        </div>

        {mainTab === 'general' && (
          <div
            className="flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden scroll-smooth border-b border-gray-100 pb-3 -mb-1 overscroll-x-contain sm:flex-wrap sm:overflow-x-visible"
            role="tablist"
            aria-label="General settings sections"
          >
            {GENERAL_SUB_TABS.filter((t) => {
              if (t.id === 'eventTypes' && !canViewOrEditEventTypesUi(can)) return false;
              if (t.id === 'programTemplates' && !canViewOrEditProgramTemplatesUi(can)) return false;
              return true;
            }).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={generalSub === t.id}
                onClick={() => navigateSettings({ main: 'general', generalSub: t.id })}
                className={`shrink-0 rounded-full border px-3 py-2 text-xs font-medium transition-all min-[480px]:py-1.5 ${
                  generalSub === t.id
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {mainTab === 'roles' && (
          <div
            className="flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto overflow-y-hidden scroll-smooth border-b border-gray-100 pb-3 -mb-1 overscroll-x-contain sm:flex-wrap sm:overflow-x-visible"
            role="tablist"
            aria-label="Roles and permissions"
          >
            <button
              type="button"
              role="tab"
              aria-selected={rolesSub === 'staff'}
              onClick={() => navigateSettings({ main: 'roles', rolesSub: 'staff' })}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-all min-[480px]:py-1.5 ${
                rolesSub === 'staff'
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              Staff / Leaders
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={rolesSub === 'permissions'}
              onClick={() => navigateSettings({ main: 'roles', rolesSub: 'permissions' })}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-all min-[480px]:py-1.5 ${
                rolesSub === 'permissions'
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Roles and permission
            </button>
          </div>
        )}
      </div>

      {/* General → Organization name */}
      {mainTab === 'general' && generalSub === 'organization' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm max-w-2xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-gray-900">Organization name</h2>
                <div className="mt-4 flex flex-col sm:flex-row gap-3 sm:items-end">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                    <input
                      type="text"
                      value={orgNameDraft}
                      onChange={(e) => setOrgNameDraft(e.target.value)}
                      disabled={orgNameLoading || !canEditOrgName}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-500"
                      placeholder={currentOrganization?.name || 'Your organization'}
                    />
                  </div>
                  {canEditOrgName && (
                    <button
                      type="button"
                      onClick={() => void saveOrganizationName()}
                      disabled={orgNameSaving || orgNameLoading}
                      className="inline-flex items-center justify-center px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium disabled:opacity-50 shrink-0"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      {orgNameSaving ? 'Saving…' : 'Save'}
                    </button>
                  )}
              </div>
                {!canEditOrgName && (
                  <p className="mt-3 text-xs text-blue-900 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    You can view the name. Ask an owner or administrator to grant &quot;Edit organization name&quot; in
                    Roles &amp; permissions if you need to change it.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {mainTab === 'notifications' && (
        <div className="space-y-6 max-w-3xl">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900">Notification Settings</h2>
            <p className="text-sm text-gray-600 mt-1">
              Control which notifications you receive in real-time. These changes affect only your account.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4">
            {notificationPrefs == null ? (
              <p className="text-sm text-gray-500">Loading notification preferences...</p>
            ) : (
              <>
                <label className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div>
                    <span className="text-sm font-medium text-gray-900">Mute all notifications</span>
                    <p className="text-xs text-gray-500 mt-1">Pause every in-app notification until you re-enable them.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(notificationPrefs.mute_all)}
                    disabled={notificationPrefsSaving}
                    onChange={(e) => void updateNotificationPref('mute_all', e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </label>

                {[
                  {
                    key: 'tasks_enabled',
                    label: 'Tasks',
                    description: 'Updates related to assigned work and completion status.',
                    examples: [
                      { toggleKey: 'task_assigned', title: 'Task assigned', desc: 'Get notified when a task is assigned to you.' },
                      { toggleKey: 'task_completed', title: 'Task completed', desc: 'Leaders can see when assigned tasks are completed.' },
                      { toggleKey: 'task_overdue', title: 'Task overdue', desc: 'Reminders for pending items that passed due date.' },
                    ],
                  },
                  {
                    key: 'attendance_enabled',
                    label: 'Attendance',
                    description: 'Reminders and updates for attendance tracking windows.',
                    examples: [
                      { toggleKey: 'attendance_start_reminder', title: 'Take attendance reminder', desc: 'Alert 5 minutes before event starts.' },
                      { toggleKey: 'attendance_close_reminder', title: 'Closing reminder', desc: 'Alert 10 minutes before attendance close time.' },
                      { toggleKey: 'attendance_missed', title: 'Attendance missed', desc: 'Flag when attendance was not taken on time.' },
                    ],
                  },
                  {
                    key: 'events_enabled',
                    label: 'Events',
                    description: 'Changes made to event schedule and event details.',
                    examples: [
                      { toggleKey: 'event_created', title: 'Event created', desc: 'See newly created events for your branch.' },
                      { toggleKey: 'event_updated', title: 'Event updated', desc: 'Get updates when event time/location changes.' },
                      { toggleKey: 'event_changes_summary', title: 'Event changes summary', desc: 'Quick view of major event edits.' },
                    ],
                  },
                  {
                    key: 'requests_enabled',
                    label: 'Requests',
                    description: 'Approvals and updates for member/group requests.',
                    examples: [
                      { toggleKey: 'member_request', title: 'Member requests', desc: 'Notify approvers when member requests come in.' },
                      { toggleKey: 'group_join_request', title: 'Group join requests', desc: 'Notify approvers of pending group join requests.' },
                      { toggleKey: 'request_approval_updates', title: 'Approval updates', desc: 'See when requests are approved/rejected.' },
                    ],
                  },
                  {
                    key: 'assignments_enabled',
                    label: 'Assignments',
                    description: 'Member and group assignment changes.',
                    examples: [
                      { toggleKey: 'member_assigned', title: 'Member assigned', desc: 'Alert when a member is assigned to a group.' },
                      { toggleKey: 'group_assignment_changes', title: 'Group assignment changes', desc: 'Track assignment updates to ministries.' },
                      { toggleKey: 'role_assignment_flow', title: 'Role assignment flow', desc: 'Visibility into assignment actions.' },
                    ],
                  },
                  {
                    key: 'permissions_enabled',
                    label: 'Permissions',
                    description: 'Security-relevant updates to access and permissions.',
                    examples: [
                      { toggleKey: 'permission_changed', title: 'Permission changed', desc: 'Get notified when your access is modified.' },
                      { toggleKey: 'role_updated', title: 'Role updated', desc: 'See updates to role-based access.' },
                      { toggleKey: 'account_access_changed', title: 'Account access changed', desc: 'Alert when account status is enabled/disabled.' },
                    ],
                  },
                  {
                    key: 'member_care_enabled',
                    label: 'Member Care',
                    description: 'Health alerts for member attendance and follow-up.',
                    examples: [
                      { toggleKey: 'low_attendance_alert', title: 'Low attendance alert', desc: 'Flag members missing frequent services.' },
                      { toggleKey: 'follow_up_needed', title: 'Follow-up needed', desc: 'Prompt checkups for members needing attention.' },
                      { toggleKey: 'care_risk_trend', title: 'Care risk trend', desc: 'Summary of members entering risk state.' },
                    ],
                  },
                  {
                    key: 'leader_updates_enabled',
                    label: 'Leader Updates',
                    description: 'Progress updates to help leaders monitor activity.',
                    examples: [
                      { toggleKey: 'team_activity', title: 'Team activity', desc: 'Leader visibility on team execution progress.' },
                      { toggleKey: 'completion_highlights', title: 'Completion highlights', desc: 'Celebrate completed actions and milestones.' },
                      { toggleKey: 'stale_action_alerts', title: 'Stale action alerts', desc: 'Notify leaders when updates are missing.' },
                    ],
                  },
                ].map((section) => {
                  const checked = Boolean((notificationPrefs as Record<string, unknown>)[section.key]);
                  const expanded = expandedNotificationSections.has(section.key);
                  return (
                    <div key={section.key} className="border border-gray-200 rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-3 bg-gray-50/60">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedNotificationSections((prev) => {
                              const next = new Set(prev);
                              if (next.has(section.key)) next.delete(section.key);
                              else next.add(section.key);
                              return next;
                            })
                          }
                          className="flex items-center gap-2 text-left"
                        >
                          {expanded ? (
                            <ChevronDown className="w-4 h-4 text-gray-500" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-500" />
                          )}
                          <div>
                            <p className="text-sm font-medium text-gray-900">{section.label}</p>
                            <p className="text-xs text-gray-500">{section.description}</p>
                          </div>
                        </button>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={notificationPrefsSaving || notificationPrefs.mute_all}
                          onChange={(e) => void updateNotificationPref(section.key, e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                      </div>
                      {expanded && (
                        <div className="px-4 py-3 bg-white">
                          <p className="text-xs font-medium text-gray-600 mb-2">Included notifications</p>
                          <ul className="space-y-2">
                            {section.examples.map((ex) => (
                              <li key={ex.title} className="rounded-lg border border-gray-100 px-3 py-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm text-gray-900">{ex.title}</p>
                                    <p className="text-xs text-gray-500 mt-0.5">{ex.desc}</p>
                                  </div>
                                  <input
                                    type="checkbox"
                                    checked={notificationPrefs.granular_preferences[ex.toggleKey] !== false}
                                    disabled={notificationPrefsSaving || notificationPrefs.mute_all || !checked}
                                    onChange={(e) => void updateNotificationGranularPref(ex.toggleKey, e.target.checked)}
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 mt-1"
                                  />
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      )}

      {mainTab === 'subscription' && canManageSubscription && (
        <div className="max-w-5xl">
          <SettingsSubscription
            activeSub={subscriptionSub}
            onSubChange={(sub) => navigateSettings({ main: 'subscription', subscriptionSub: sub })}
            organization={currentOrganization}
          />
        </div>
      )}

      {mainTab === 'roles' && rolesSub === 'staff' && (
        <div className="space-y-8 max-w-3xl">
          {!canAccessStaffOrRoleAdmin(can) ? (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6 text-sm text-blue-900">
              You do not have permission to view staff accounts. Ask an administrator.
            </div>
          ) : (
            <>
                        <div>
            <h2 className="font-semibold text-gray-900 text-lg">Group leader accounts</h2>
            <p className="mt-1 text-sm text-gray-500">
              Create a login for a group leader in your organization. They use the same sign-in page as you. Their
              profile is scoped to the branch selected in the header (
              <span className="font-medium text-gray-700">{selectedBranch?.name || 'current branch'}</span>
              ). For testing, new accounts skip email verification unless you set{' '}
              <code className="text-xs bg-gray-100 px-1 rounded">AUTH_EMAIL_AUTO_CONFIRM=false</code> on the server.
            </p>
                        </div>

          <form onSubmit={handleCreateGroupLeader} className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">First name</label>
                <input
                  type="text"
                  required
                  value={leaderForm.firstName}
                  onChange={(ev) => setLeaderForm((f) => ({ ...f, firstName: ev.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                      </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Last name</label>
                <input
                  type="text"
                  required
                  value={leaderForm.lastName}
                  onChange={(ev) => setLeaderForm((f) => ({ ...f, lastName: ev.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                      </div>
                      </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email"
                required
                autoComplete="off"
                value={leaderForm.email}
                onChange={(ev) => setLeaderForm((f) => ({ ...f, email: ev.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </div>
                        <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Initial password</label>
              <input
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={leaderForm.password}
                onChange={(ev) => setLeaderForm((f) => ({ ...f, password: ev.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-400">Share this once; ask them to change it after first login when you enable that flow.</p>
                        </div>
            <button
              type="submit"
              disabled={leaderSubmitting || !token}
              className="flex items-center px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              <Plus className="w-4 h-4 mr-2" />
              {leaderSubmitting ? 'Creating…' : 'Create leader account'}
            </button>
          </form>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 space-y-1">
              <h3 className="text-sm font-semibold text-gray-900">Staff access groups</h3>
              <p className="text-xs text-gray-500">
                Named groups of staff accounts (not ministry groups). Assign a role to the group once, then add people—
                their login permissions follow the group role. The organization owner cannot be added. Each person can
                belong to at most one staff access group; changing role from the staff table below removes them from a
                group.
              </p>
                      </div>
            <div className="px-6 py-4 space-y-4">
              {staffGroupsLoading ? (
                <p className="text-sm text-gray-500">Loading groups…</p>
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
                    <div className="flex-1 min-w-0">
                      <label className="block text-xs font-medium text-gray-600 mb-1">New group name</label>
                      <input
                        type="text"
                        value={newStaffGroupName}
                        onChange={(e) => setNewStaffGroupName(e.target.value)}
                        placeholder="e.g. Campus leaders"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="w-full sm:w-56">
                      <label className="block text-xs font-medium text-gray-600 mb-1">Role for group</label>
                      <select
                        value={newStaffGroupRoleId}
                        onChange={(e) => setNewStaffGroupRoleId(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      >
                        <option value="">Select role…</option>
                        {apiRoles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      </div>
                    <button
                      type="button"
                      disabled={creatingStaffGroup || !token || !newStaffGroupName.trim() || !newStaffGroupRoleId}
                      onClick={() => void createStaffProfileGroup()}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 shrink-0"
                    >
                      {creatingStaffGroup ? 'Creating…' : 'Create group'}
                        </button>
                      </div>

                  {staffProfileGroups.length === 0 ? (
                    <p className="text-sm text-gray-500">No staff access groups yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {staffProfileGroups.map((g) => {
                        const expanded = staffGroupExpanded[g.id] === true;
                        return (
                          <li
                            key={g.id}
                            className="rounded-xl border border-gray-100 bg-gray-50/80 overflow-hidden"
                          >
                            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setStaffGroupExpanded((prev) => ({
                                    ...prev,
                                    [g.id]: !prev[g.id],
                                  }))
                                }
                                className="p-1 rounded hover:bg-gray-200 text-gray-600"
                                aria-expanded={expanded}
                              >
                                <ChevronDown
                                  className={`w-4 h-4 transition ${expanded ? '' : '-rotate-90'}`}
                                />
                              </button>
                              <span className="font-medium text-sm text-gray-900">{g.name}</span>
                              <span className="text-xs text-gray-500">
                                {g.member_count} member{g.member_count === 1 ? '' : 's'}
                              </span>
                              {g.suspended === true && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 border border-blue-200">
                                  Suspended
                                </span>
                              )}
                              <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={g.suspended === true}
                                  onChange={(e) => void patchStaffGroupSuspended(g.id, e.target.checked)}
                                  className="rounded border-gray-300"
                                />
                                Suspend group
                              </label>
                              <div className="ml-auto flex flex-wrap items-center gap-2">
                                <select
                                  value={g.role_id || ''}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    void patchStaffProfileGroupRole(g.id, v === '' ? null : v);
                                  }}
                                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 max-w-[200px]"
                                >
                                  <option value="">No role</option>
                                  {apiRoles.map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => void deleteStaffProfileGroup(g.id)}
                                  className="text-xs text-blue-600 hover:underline"
                                >
                                  Delete group
                                </button>
                        </div>
                      </div>
                            {expanded && (
                              <div className="px-3 pb-3 pt-0 border-t border-gray-100 bg-white space-y-2">
                                <div className="flex flex-wrap gap-2 items-center">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setBulkModalGroupId(g.id);
                                      setBulkModalStep('pick');
                                      setBulkModalSelected(new Set());
                                      setBulkModalSearch('');
                                    }}
                                    className="text-xs font-medium text-blue-600 hover:text-blue-800"
                                  >
                                    Add multiple…
                                  </button>
                                  <span className="text-xs text-gray-400">|</span>
                                  <span className="text-xs font-medium text-gray-600">Add one</span>
                                  <select
                                    className="text-xs border border-gray-200 rounded-lg px-2 py-1 max-w-[240px]"
                                    defaultValue=""
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (v) {
                                        void addStaffToProfileGroup(g.id, v);
                                        e.target.value = '';
                                      }
                                    }}
                                  >
                                    <option value="">Choose profile…</option>
                                    {staffList
                                      .filter(
                                        (row) =>
                                          row.is_org_owner !== true &&
                                          !profileIdToStaffGroupId.has(row.id),
                                      )
                                      .map((row) => (
                                        <option key={row.id} value={row.id}>
                                          {[row.first_name, row.last_name].filter(Boolean).join(' ') ||
                                            row.email ||
                                            row.id.slice(0, 8)}
                                        </option>
                                      ))}
                      </select>
                      </div>
                                {g.members.length === 0 ? (
                                  <p className="text-xs text-gray-500">No members yet.</p>
                                ) : (
                                  <ul className="text-xs space-y-1">
                                    {g.members.map((m) => (
                                      <li
                                        key={m.profile_id}
                                        className="flex items-center justify-between gap-2 py-1 border-b border-gray-50 last:border-0"
                                      >
                                        <span>
                                          {[m.first_name, m.last_name].filter(Boolean).join(' ') || '—'}{' '}
                                          <span className="text-gray-500">{m.email || ''}</span>
                      </span>
                                        <button
                                          type="button"
                                          onClick={() => void removeStaffFromProfileGroup(g.id, m.profile_id)}
                                          className="text-blue-600 hover:underline shrink-0"
                                        >
                                          Remove
                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                      </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Branch staff</h3>
              <button
                type="button"
                onClick={() => void fetchStaffList()}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Refresh
              </button>
                        </div>
            {staffLoading ? (
              <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
            ) : staffList.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">
                No staff for this branch yet. Create a leader account below.
                      </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold text-gray-600">
                    <tr>
                      <th className="px-4 py-2">Name</th>
                      <th className="px-4 py-2">Email</th>
                      <th className="px-4 py-2">Access group</th>
                      <th className="px-4 py-2">Role</th>
                      <th className="px-4 py-2">Ministry scope</th>
                      <th className="px-4 py-2">Platform access</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {staffList.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <span className="inline-flex items-center gap-2 flex-wrap">
                            {[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}
                            {row.is_org_owner === true && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 border border-blue-200">
                                Owner
                        </span>
                            )}
                        </span>
                    </td>
                        <td className="px-4 py-2 text-gray-600">{row.email || '—'}</td>
                        <td className="px-4 py-2 text-gray-700 max-w-[10rem] truncate" title={row.staff_access_group_name || undefined}>
                          {row.staff_access_group_name || '—'}
                        </td>
                        <td className="px-4 py-2">
                          {row.is_org_owner === true ? (
                            <span className="text-sm text-gray-700">
                              {row.role_id
                                ? apiRoles.find((r) => r.id === row.role_id)?.name ?? 'Role'
                                : '—'}{' '}
                              <span className="text-xs font-normal text-gray-500">(owner — full access)</span>
                      </span>
                          ) : canAnyRoleAdmin(can) ? (
                            <select
                              className="text-sm border border-gray-200 rounded-lg px-2 py-1 max-w-[220px]"
                              value={row.role_id || ''}
                              disabled={staffRoleUpdating === row.id}
                              onChange={(e) => {
                                const v = e.target.value;
                                void patchStaffRole(row.id, v === '' ? null : v);
                              }}
                            >
                              <option value="">No role</option>
                              {apiRoles.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-gray-500 font-mono text-xs">{row.role_id || '—'}</span>
                          )}
                    </td>
                        <td className="px-4 py-2 align-top">
                          {row.is_org_owner === true ? (
                            <span className="text-xs text-gray-500">Full branch (owner)</span>
                          ) : (
                            <div className="flex flex-col gap-1 max-w-[14rem]">
                              <span className="text-xs text-gray-700 line-clamp-2" title={(row.ministry_scope_group_ids || []).map((id) => ministryGroupNameById.get(id) || id).join(', ') || undefined}>
                                {(row.ministry_scope_group_ids || []).length === 0
                                  ? 'Default: all members in branch'
                                  : (row.ministry_scope_group_ids || [])
                                      .map((id) => ministryGroupNameById.get(id) || id.slice(0, 8))
                                      .join(', ')}
                              </span>
                              {canAccessStaffOrRoleAdmin(can) && (
                                <button
                                  type="button"
                                  onClick={() => void openMinistryScopeModal(row.id)}
                                  className="text-left text-xs font-medium text-blue-600 hover:text-blue-800"
                                >
                                  Edit ministries…
                        </button>
                              )}
                      </div>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {row.is_org_owner === true ? (
                            <span className="text-xs text-gray-500">—</span>
                          ) : canAccessStaffOrRoleAdmin(can) ? (
                            <select
                              className="text-sm border border-gray-200 rounded-lg px-2 py-1"
                              value={row.is_active === false ? 'suspended' : 'active'}
                              onChange={(e) => {
                                const active = e.target.value === 'active';
                                void patchStaffPlatformAccess(row.id, active);
                              }}
                            >
                              <option value="active">Active</option>
                              <option value="suspended">Suspended</option>
                            </select>
                          ) : (
                            <span className="text-xs text-gray-500">
                              {row.is_active === false ? 'Suspended' : 'Active'}
                            </span>
                          )}
                    </td>
                  </tr>
                    ))}
                </tbody>
              </table>
              </div>
            )}
            </div>

          {ministryModalProfileId ? (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
              role="dialog"
              aria-modal="true"
              aria-labelledby="ministry-scope-title"
            >
              <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col">
                <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center gap-3">
                  <h3 id="ministry-scope-title" className="font-semibold text-gray-900">
                    Ministry visibility
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setMinistryModalProfileId(null);
                      setMinistryModalGroups([]);
                      setMinistryModalSelected(new Set());
                    }}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="p-4 overflow-y-auto flex-1 text-sm text-gray-600">
                  <p className="mb-3">
                    Choose which ministries this staff member can see. Select <strong>All Members</strong> for full-branch
                    access, and/or specific ministries (subgroups inherit from parents).
                  </p>
                  {ministryModalLoading ? (
                    <div className="py-8 text-center text-gray-500">Loading…</div>
                  ) : (
                    <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
                      {ministryModalGroups.map((g) => (
                        <li key={g.id}>
                          <label className="flex items-start gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-1 rounded border-gray-300"
                              checked={ministryModalSelected.has(g.id)}
                              onChange={(e) => {
                                setMinistryModalSelected((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(g.id);
                                  else next.delete(g.id);
                                  return next;
                                });
                              }}
                            />
                            <span>
                              <span className="font-medium text-gray-900">{g.name}</span>
                              {g.system_kind === 'all_members' ? (
                                <span className="ml-2 text-xs text-blue-700">Full branch</span>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMinistryModalProfileId(null);
                      setMinistryModalGroups([]);
                      setMinistryModalSelected(new Set());
                    }}
                    className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
                  >
                    Cancel
                </button>
                  <button
                    type="button"
                    disabled={ministryModalSaving || ministryModalLoading}
                    onClick={() => void saveMinistryScopeModal()}
                    className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {ministryModalSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
          ) : null}

          {bulkModalGroupId ? (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
              role="dialog"
              aria-modal="true"
              aria-labelledby="bulk-add-staff-title"
            >
              <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col">
                <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center gap-3">
                  <h3 id="bulk-add-staff-title" className="font-semibold text-gray-900">
                    {bulkModalStep === 'pick' ? 'Add members to group' : 'Confirm selection'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkModalGroupId(null);
                      setBulkModalStep('pick');
                      setBulkModalSelected(new Set());
                      setBulkModalSearch('');
                    }}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                    aria-label="Close"
                  >
                    <X className="w-5 h-5" />
                  </button>
                    </div>
                {bulkModalStep === 'pick' ? (
                  <>
                    <div className="p-3 border-b border-gray-100">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          value={bulkModalSearch}
                          onChange={(e) => setBulkModalSearch(e.target.value)}
                          placeholder="Search by name or email…"
                          className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg"
                        />
                    </div>
                  </div>
                    <div className="overflow-y-auto flex-1 p-3 max-h-64 space-y-1">
                      {bulkEligibleStaff.length === 0 ? (
                        <p className="text-sm text-gray-500">No eligible staff match.</p>
                      ) : (
                        bulkEligibleStaff.map((row) => (
                          <label
                            key={row.id}
                            className="flex items-center gap-2 text-sm py-1.5 px-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={bulkModalSelected.has(row.id)}
                              onChange={() => {
                                setBulkModalSelected((prev) => {
                                  const n = new Set(prev);
                                  if (n.has(row.id)) n.delete(row.id);
                                  else n.add(row.id);
                                  return n;
                                });
                              }}
                              className="rounded border-gray-300"
                            />
                            <span className="font-medium text-gray-900">
                              {[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}
                            </span>
                            <span className="text-xs text-gray-500 truncate">{row.email || ''}</span>
                          </label>
                        ))
                            )}
                          </div>
                    <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
                      <button
                        type="button"
                        className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
                        onClick={() => {
                          setBulkModalGroupId(null);
                          setBulkModalStep('pick');
                          setBulkModalSelected(new Set());
                          setBulkModalSearch('');
                        }}
                      >
                        Cancel
                        </button>
                      <button
                        type="button"
                        disabled={bulkModalSelected.size === 0}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50"
                        onClick={() => setBulkModalStep('confirm')}
                      >
                        Review ({bulkModalSelected.size})
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="p-4 overflow-y-auto max-h-64 text-sm space-y-2">
                      <p className="text-gray-600">
                        Add <strong>{bulkModalSelected.size}</strong> people to this group. Their role will match the
                        group&apos;s assigned role.
                      </p>
                      <ul className="space-y-1 border border-gray-100 rounded-lg p-2 bg-gray-50/80 max-h-48 overflow-y-auto">
                        {[...bulkModalSelected].map((id) => {
                          const r = staffList.find((x) => x.id === id);
                          return (
                            <li key={id} className="text-xs">
                              <span className="font-medium text-gray-900">
                                {r ? [r.first_name, r.last_name].filter(Boolean).join(' ') : id}
                              </span>
                              {r?.email ? <span className="text-gray-500"> — {r.email}</span> : null}
                            </li>
                      );
                    })}
                      </ul>
                  </div>
                    <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
                      <button
                        type="button"
                        className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
                        onClick={() => setBulkModalStep('pick')}
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        disabled={bulkModalSubmitting}
                        onClick={() => void submitBulkAddMembers()}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50"
                      >
                        {bulkModalSubmitting ? 'Adding…' : 'Confirm'}
                      </button>
                    </div>
                  </>
                  )}
                </div>
              </div>
          ) : null}
            </>
          )}
          </div>
      )}

      {/* Permissions Tab */}
      {mainTab === 'roles' && rolesSub === 'permissions' && (
        <div className="space-y-6">
          {!canAnyRoleAdmin(can) ? (
            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6 text-sm text-blue-900">
              You do not have permission to manage roles. Ask an organization administrator.
                </div>
          ) : rolesLoading ? (
            <p className="text-sm text-gray-500">Loading roles…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-4 justify-between">
                <div>
                  <h2 className="font-semibold text-gray-900 text-lg">Roles & permissions</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Create roles and assign categorized permissions. Organization owners always have full access.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value)}
                    placeholder="New role name"
                    className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void createOrgRole()}
                    className="flex items-center px-3 py-2 bg-gray-900 text-white rounded-lg text-sm"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add role
                  </button>
              </div>
                </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-500">Roles</p>
                  <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 max-h-[480px] overflow-y-auto">
                    {apiRoles.map((r) => (
                      <li key={r.id} className="group/role-row flex items-stretch">
                        <button
                          type="button"
                          onClick={() => setSelectedRoleId(r.id)}
                          className={
                            selectedRoleId === r.id
                              ? 'flex-1 min-w-0 text-left px-4 py-3 text-sm flex justify-between items-center gap-2 hover:bg-gray-50 bg-blue-50 text-blue-900'
                              : 'flex-1 min-w-0 text-left px-4 py-3 text-sm flex justify-between items-center gap-2 hover:bg-gray-50'
                          }
                        >
                          <span className="font-medium truncate">{r.name}</span>
                          <span className="text-xs text-gray-400 shrink-0">{r.permissions.length} perms</span>
                        </button>
                        <button
                          type="button"
                          title="Duplicate role"
                          aria-label={`Duplicate role ${r.name}`}
                          disabled={savingRole || !token}
                          onClick={(e) => {
                            e.stopPropagation();
                            void duplicateOrgRole(r);
                          }}
                          className="shrink-0 border-l border-gray-100 px-3 text-gray-500 transition-opacity hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40 opacity-0 group-hover/role-row:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gray-400"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="lg:col-span-8 space-y-4">
                  {selectedRole ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="font-medium text-gray-900">{selectedRole.name}</h3>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={savingRole}
                            onClick={applyAllPermissionsToDraft}
                            className="px-4 py-2 text-sm border border-gray-200 rounded-lg bg-white hover:bg-gray-50 text-gray-800 disabled:opacity-50"
                          >
                            Apply all permissions
                          </button>
                          <button
                            type="button"
                            disabled={savingRole}
                            onClick={() => void persistRolePermissions()}
                            className="flex items-center px-4 py-2 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50"
                          >
                            <Save className="w-4 h-4 mr-2" />
                            {savingRole ? 'Saving…' : 'Save permissions'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteOrgRole(selectedRole.id)}
                            className="px-4 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
                          >
                            Delete role
                          </button>
              </div>
                </div>
                      <p className="text-xs text-gray-500">
                        Assign staff to roles from <strong>Roles and permissions</strong> →{' '}
                        <strong>Staff / Leaders</strong>.
                      </p>

                      <div className="max-h-[min(75dvh,720px)] overflow-y-auto pr-1 sm:max-h-[min(70vh,720px)]">
                        <PermissionRoleMatrix
                          permDraft={permDraft}
                          impliedByOther={impliedByOther}
                          onToggle={togglePermDraft}
                          onApplySection={applySectionPermissionsToDraft}
                          disabled={savingRole}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-500">Select or create a role.</p>
                  )}
              </div>
                </div>

              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-sm text-gray-700">
                Changes apply immediately for users with this role after you save. Organization owners bypass permission checks in the API.
              </div>
            </>
          )}
        </div>
      )}

      {/* Custom Fields Tab */}
      {mainTab === 'general' && generalSub === 'customFields' && (
        <div className="space-y-6">
          {customFieldsSchemaHint ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
              <p className="font-semibold text-blue-900">Database setup required</p>
              <p className="mt-2 leading-relaxed text-blue-900/90">{customFieldsSchemaHint}</p>
              <button
                type="button"
                onClick={() => void fetchCustomFieldDefinitions()}
                className="mt-3 text-sm font-semibold text-blue-900 underline decoration-blue-700/60 hover:decoration-blue-900"
              >
                Retry after running the migration
              </button>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Manage Custom Fields</h2>
              <p className="text-sm text-gray-500 mt-1">
                Define fields for member profiles, events, and the public ministry page. Values are stored per record.
              </p>
            </div>
            <button
              type="button"
              disabled={!token || !canConfigureCustomFields || !!customFieldsSchemaHint}
              onClick={() => {
                setEditingDefinitionId(null);
                setFieldDraft({
                  label: '',
                  field_type: 'text',
                  required: false,
                  placeholder: '',
                  options: [],
                  default_value: '',
                  applies_to: ['member'],
                  show_on_public: false,
                });
                setShowFieldEditor(true);
              }}
              className="flex items-center px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-all disabled:opacity-50"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Field
            </button>
          </div>

          {!canConfigureCustomFields ? (
            <p className="text-sm text-gray-600">You need system settings (or staff/permissions admin) access to manage custom fields.</p>
          ) : customFieldsLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {customFieldDefinitions.map((field) => (
              <div
                key={field.id}
                className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden"
              >
                <div className="bg-gray-50 px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{field.label}</h3>
                        <p className="text-sm text-gray-500 mt-1">
                          {field.field_type} · <span className="font-mono text-xs">{field.field_key}</span>
                        </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                          type="button"
                        onClick={() => {
                            setEditingDefinitionId(field.id);
                            const opts = Array.isArray(field.options) ? field.options.map((x) => String(x)) : [];
                            setFieldDraft({
                              label: field.label,
                              field_type: field.field_type,
                              required: field.required,
                              placeholder: field.placeholder || '',
                              options: opts,
                              default_value: field.default_value || '',
                              applies_to: [...field.applies_to] as ('member' | 'event' | 'group')[],
                              show_on_public: field.show_on_public,
                            });
                          setShowFieldEditor(true);
                        }}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                          type="button"
                          onClick={async () => {
                            if (!token || !window.confirm('Delete this custom field definition?')) return;
                            try {
                              const res = await fetch(`/api/custom-field-definitions/${field.id}`, {
                                method: 'DELETE',
                                headers: withBranchScope(selectedBranch?.id, { Authorization: `Bearer ${token}` }),
                              });
                              const data = await res.json().catch(() => ({}));
                              if (!res.ok) {
                                const errMsg =
                                  typeof (data as { error?: string }).error === 'string'
                                    ? (data as { error: string }).error
                                    : 'Delete failed';
                                const hint =
                                  typeof (data as { hint?: string }).hint === 'string'
                                    ? (data as { hint: string }).hint
                                    : null;
                                if (res.status === 503 && hint) setCustomFieldsSchemaHint(hint);
                                throw new Error(errMsg);
                              }
                              toast.success('Field removed');
                              await fetchCustomFieldDefinitions();
                            } catch (e: unknown) {
                              toast.error(e instanceof Error ? e.message : 'Delete failed');
                            }
                        }}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="p-6">
                    <h4 className="text-xs font-semibold text-gray-500r mb-3">Details</h4>
                    <div className="space-y-2 text-sm text-gray-500">
                      <p>{field.required ? 'Required' : 'Optional'}</p>
                      {field.show_on_public ? <p>Show on public ministry page when set</p> : null}
                      <p>Applies to: {field.applies_to.join(', ')}</p>
                    </div>
                </div>
              </div>
            ))}
          </div>
          )}

          {showFieldEditor && canConfigureCustomFields && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden mt-6">
              <div className="bg-gray-50 px-6 py-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingDefinitionId ? 'Edit Field' : 'Add New Field'}
                </h3>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Label</label>
                    <input
                      type="text"
                      value={fieldDraft.label}
                      onChange={(e) => setFieldDraft((d) => ({ ...d, label: e.target.value }))}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Field Type</label>
                    <select
                      value={fieldDraft.field_type}
                      onChange={(e) => setFieldDraft((d) => ({ ...d, field_type: e.target.value }))}
                      className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="email">Email</option>
                      <option value="phone">Phone</option>
                      <option value="date">Date</option>
                      <option value="dropdown">Dropdown</option>
                      <option value="checkbox">Checkbox</option>
                      <option value="textarea">Textarea</option>
                      <option value="file">File (not supported in forms yet)</option>
                    </select>
                  </div>
                  <div>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                        checked={fieldDraft.required}
                        onChange={(e) => setFieldDraft((d) => ({ ...d, required: e.target.checked }))}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600"
                      />
                      Required
                      </label>
                    </div>
                  {['text', 'textarea'].includes(fieldDraft.field_type) && (
                    <div>
                      <label className="text-sm font-medium text-gray-700">Placeholder</label>
                      <input
                        type="text"
                        value={fieldDraft.placeholder}
                        onChange={(e) => setFieldDraft((d) => ({ ...d, placeholder: e.target.value }))}
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm sm:text-sm"
                      />
                    </div>
                  )}
                  {fieldDraft.field_type === 'dropdown' && (
                    <div>
                      <label className="text-sm font-medium text-gray-700">Options (comma-separated)</label>
                      <input
                        type="text"
                        value={fieldDraft.options.join(', ')}
                        onChange={(e) =>
                          setFieldDraft((d) => ({
                            ...d,
                            options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean),
                          }))
                        }
                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm sm:text-sm"
                      />
                    </div>
                  )}
                  {fieldDraft.field_type === 'checkbox' && (
                    <div>
                      <label className="text-sm font-medium text-gray-700">Default (checked)</label>
                      <label className="mt-1 flex items-center gap-2">
                          <input
                            type="checkbox"
                          checked={fieldDraft.default_value === 'true'}
                          onChange={(e) =>
                            setFieldDraft((d) => ({ ...d, default_value: e.target.checked ? 'true' : '' }))
                          }
                          className="h-4 w-4 rounded border-gray-300 text-blue-600"
                        />
                        <span className="text-sm text-gray-600">On by default for new records</span>
                        </label>
                    </div>
                  )}
                    <div>
                    <label className="text-sm font-medium text-gray-700">Applies to</label>
                    <div className="mt-2 flex flex-wrap gap-4">
                      {(['member', 'event', 'group'] as const).map((scope) => (
                        <label key={scope} className="inline-flex items-center gap-2 text-sm text-gray-600">
                      <input
                            type="checkbox"
                            checked={fieldDraft.applies_to.includes(scope)}
                        onChange={(e) => {
                              setFieldDraft((d) => ({
                                ...d,
                                applies_to: e.target.checked
                                  ? [...d.applies_to, scope]
                                  : d.applies_to.filter((x) => x !== scope),
                              }));
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600"
                          />
                          {scope === 'member' ? 'Members' : scope === 'event' ? 'Events' : 'Group public page'}
                        </label>
                      ))}
                    </div>
                    </div>
                  <div>
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                        checked={fieldDraft.show_on_public}
                        onChange={(e) => setFieldDraft((d) => ({ ...d, show_on_public: e.target.checked }))}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600"
                      />
                      Show on public ministry page (when the field applies to events or groups)
                      </label>
                    </div>
                  </div>
                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowFieldEditor(false)}
                    className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!token) return;
                      const label = fieldDraft.label.trim();
                      if (!label) {
                        toast.error('Enter a label');
                        return;
                      }
                      if (fieldDraft.applies_to.length === 0) {
                        toast.error('Select at least one: Members, Events, or Group public page');
                        return;
                      }
                      try {
                        const body: Record<string, unknown> = {
                          label,
                          field_type: fieldDraft.field_type,
                          required: fieldDraft.required,
                          placeholder: fieldDraft.placeholder.trim() || null,
                          options: fieldDraft.field_type === 'dropdown' ? fieldDraft.options : [],
                          default_value: fieldDraft.default_value.trim() || null,
                          applies_to: fieldDraft.applies_to,
                          show_on_public: fieldDraft.show_on_public,
                          sort_order: customFieldDefinitions.length,
                        };
                        const url = editingDefinitionId
                          ? `/api/custom-field-definitions/${editingDefinitionId}`
                          : '/api/custom-field-definitions';
                        const res = await fetch(url, {
                          method: editingDefinitionId ? 'PATCH' : 'POST',
                          headers: withBranchScope(selectedBranch?.id, {
                            'Content-Type': 'application/json',
                            Authorization: `Bearer ${token}`,
                          }),
                          body: JSON.stringify(body),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                          const errMsg =
                            typeof (data as { error?: string }).error === 'string'
                              ? (data as { error: string }).error
                              : 'Save failed';
                          const hint =
                            typeof (data as { hint?: string }).hint === 'string'
                              ? (data as { hint: string }).hint
                              : null;
                          if (res.status === 503 && hint) setCustomFieldsSchemaHint(hint);
                          throw new Error(errMsg);
                        }
                        toast.success(editingDefinitionId ? 'Field updated' : 'Field created');
                      setShowFieldEditor(false);
                        await fetchCustomFieldDefinitions();
                      } catch (e: unknown) {
                        toast.error(e instanceof Error ? e.message : 'Save failed');
                      }
                    }}
                    className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-all"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Event Types Tab */}
      {mainTab === 'general' &&
        generalSub === 'eventTypes' &&
        (canViewOrEditEventTypesUi(can) ? (
          <EventTypes embedded />
        ) : (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6 text-sm text-blue-900">
            You do not have permission to manage event types.
          </div>
        ))}

      {/* Program templates Tab */}
      {mainTab === 'general' &&
        generalSub === 'programTemplates' &&
        (canViewOrEditProgramTemplatesUi(can) ? (
          <EventOutlineTemplates embedded />
        ) : (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 p-6 text-sm text-blue-900">
            You do not have permission to manage program templates.
          </div>
        ))}

      {/* Member statuses Tab */}
      {mainTab === 'general' && generalSub === 'memberStatuses' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Member statuses</h2>
              <p className="text-sm text-gray-500 mt-1">
                Labels available when editing members. The value stored on each member matches the label text exactly.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canConfigureMemberStatuses && memberStatusOptions.length === 0 && (
            <button
                  type="button"
                  onClick={() => void seedMemberStatusDefaults()}
                  disabled={memberStatusBusy || !token}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  Load default labels
            </button>
              )}
            </div>
          </div>

          {!canConfigureMemberStatuses && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
              You can view status labels below. Adding or editing requires <strong>System settings</strong>,{' '}
              <strong>Manage staff</strong>, <strong>Manage roles &amp; permissions</strong>, or{' '}
              <strong>Manage member statuses</strong> (configure under Roles &amp; Permissions).
                      </div>
          )}

          {memberStatusOptionsLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <>
              {canConfigureMemberStatuses && (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
                  <h3 className="text-sm font-semibold text-gray-900">Add status</h3>
                  <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">Label</label>
                      <input
                        type="text"
                        value={memberStatusNewLabel}
                        onChange={(e) => setMemberStatusNewLabel(e.target.value)}
                        placeholder="e.g. Active, Transferred"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void addMemberStatusOption()}
                      disabled={memberStatusBusy}
                      className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                {sortedMemberStatusOptions.length === 0 ? (
                  <p className="p-6 text-sm text-gray-500">
                    No statuses yet.
                    {canConfigureMemberStatuses
                      ? ' Use “Load default labels” or add your own above.'
                      : ' Ask an administrator to configure statuses.'}
                  </p>
                ) : canConfigureMemberStatuses ? (
                  <SortableSettingsOrderList
                    items={sortedMemberStatusOptions}
                    disabled={memberStatusBusy}
                    onReorder={commitMemberStatusOrder}
                    listClassName="divide-y divide-gray-100"
                    itemClassName="p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                    renderItem={(row, _index, dragHandle) => (
                      <>
                        <div className="flex items-center sm:w-10 shrink-0 justify-start">{dragHandle}</div>
                        <div className="flex-1 min-w-0">
                          <input
                            type="text"
                            defaultValue={row.label}
                            key={row.id + row.label}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v && v !== row.label) void patchMemberStatusOption(row.id, { label: v });
                            }}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void deleteMemberStatusOption(row.id)}
                          disabled={memberStatusBusy}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-50"
                          aria-label="Delete status"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  />
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {sortedMemberStatusOptions.map((row) => (
                      <li
                        key={row.id}
                        className="p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                      >
                        <p className="font-medium text-gray-900 flex-1 min-w-0">{row.label}</p>
                      </li>
                    ))}
                  </ul>
                )}
                </div>
            </>
          )}

          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
            <div className="flex items-start space-x-3">
              <UserCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-gray-900">About member statuses</h4>
                <p className="text-sm text-gray-600 mt-2">
                  Each member&apos;s <strong>status</strong> field stores one of these labels. Removing a label does not
                  change existing members; they will still show their saved value.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Group types Tab */}
      {mainTab === 'general' && generalSub === 'groupTypes' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Group types</h2>
              <p className="text-sm text-gray-500 mt-1">
                Labels for ministry and group rows (<code className="text-xs bg-gray-100 px-1 rounded">groups.group_type</code>
                ). Used in add/edit group and list filters.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canConfigureGroupTypes && groupTypeOptions.length === 0 && !groupTypeTableMissing && (
                <button
                  type="button"
                  onClick={() => void seedGroupTypeDefaults()}
                  disabled={groupTypeBusy || !token}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  Load default labels
                </button>
              )}
            </div>
          </div>

          {groupTypeTableMissing && !groupTypeOptionsLoading && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
              <p className="font-semibold">Database table missing</p>
              <p className="mt-2 text-blue-900">
                The <code className="rounded bg-blue-100 px-1 py-0.5 text-xs">group_type_options</code> table is not in
                your Supabase project yet.
              </p>
              <ol className="mt-3 list-decimal list-inside space-y-1 text-blue-900">
                <li>
                  Open <strong>Supabase → SQL Editor</strong>, paste the contents of{' '}
                  <code className="rounded bg-blue-100 px-1 py-0.5 text-xs">migrations/group_type_options.sql</code>, and
                  run it.
                </li>
                <li>
                  Or from the project folder run{' '}
                  <code className="rounded bg-blue-100 px-1 py-0.5 text-xs">npm run migrate:group-type-options</code>{' '}
                  with <code className="rounded bg-blue-100 px-1 py-0.5 text-xs">DATABASE_URL</code> (or{' '}
                  <code className="rounded bg-blue-100 px-1 py-0.5 text-xs">SUPABASE_DB_URL</code>) in{' '}
                  <code className="rounded bg-blue-100 px-1 py-0.5 text-xs">.env</code>.
                </li>
              </ol>
              <p className="mt-3">
                <button
                  type="button"
                  onClick={() => void refreshGroupTypeOptions()}
                  className="text-sm font-medium text-blue-900 underline underline-offset-2 hover:text-blue-700"
                >
                  Retry after installing
                </button>
              </p>
            </div>
          )}

          {!canConfigureGroupTypes && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
              You can view group types below. Adding or editing requires <strong>Manage groups</strong>,{' '}
              <strong>System settings</strong>, <strong>Manage staff</strong>, or{' '}
              <strong>Manage roles &amp; permissions</strong>.
            </div>
          )}

          {groupTypeOptionsLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : (
            <>
              {canConfigureGroupTypes && !groupTypeTableMissing && (
                <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
                  <h3 className="text-sm font-semibold text-gray-900">Add type</h3>
                  <div className="flex flex-col md:flex-row gap-3 md:items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 mb-1">Label</label>
                      <input
                        type="text"
                        value={groupTypeNewLabel}
                        onChange={(e) => setGroupTypeNewLabel(e.target.value)}
                        placeholder="e.g. Ministry, Cell group"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void addGroupTypeOption()}
                      disabled={groupTypeBusy}
                      className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                {groupTypeTableMissing ? (
                  <p className="p-6 text-sm text-gray-500">
                    Install the database table using the steps above, then click &quot;Retry after installing&quot;.
                  </p>
                ) : sortedGroupTypeOptions.length === 0 ? (
                  <p className="p-6 text-sm text-gray-500">
                    No group types yet.
                    {canConfigureGroupTypes
                      ? ' Use “Load default labels” or add your own above.'
                      : ' Ask an administrator to configure types.'}
                  </p>
                ) : canConfigureGroupTypes ? (
                  <SortableSettingsOrderList
                    items={sortedGroupTypeOptions}
                    disabled={groupTypeBusy}
                    onReorder={commitGroupTypeOrder}
                    listClassName="divide-y divide-gray-100"
                    itemClassName="p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                    renderItem={(row, _index, dragHandle) => (
                      <>
                        <div className="flex items-center sm:w-10 shrink-0 justify-start">{dragHandle}</div>
                        <div className="flex-1 min-w-0">
                          <input
                            type="text"
                            defaultValue={row.label}
                            key={row.id + row.label}
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v && v !== row.label) void patchGroupTypeOption(row.id, { label: v });
                            }}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => void deleteGroupTypeOption(row.id)}
                          disabled={groupTypeBusy}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-50"
                          aria-label="Delete group type"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  />
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {sortedGroupTypeOptions.map((row) => (
                      <li
                        key={row.id}
                        className="p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                      >
                        <p className="font-medium text-gray-900 flex-1 min-w-0">{row.label}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6">
            <div className="flex items-start space-x-3">
              <Layers className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-sm font-semibold text-gray-900">About group types</h4>
                <p className="text-sm text-gray-600 mt-2">
                  Each group stores one of these labels in <strong>group type</strong>. Existing groups keep their
                  current value if you rename a label here; update them from the ministry or group edit screen.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}


      {/* Branches Tab */}
      {mainTab === 'general' && generalSub === 'branches' && (
        <div className="space-y-6 max-w-4xl">
          {/* Active branch (scope for the whole app) */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h2 className="text-base font-semibold text-gray-900">Active branch</h2>
            <p className="text-sm text-gray-600 mt-1">
              Members, events, groups, and tasks are scoped to this branch. Switch here if you manage multiple
              locations.
            </p>
            {branchLoading ? (
              <div className="mt-4 flex items-center gap-3 p-4 rounded-lg border border-gray-100 bg-gray-50/80 animate-pulse">
                <div className="w-10 h-10 rounded-md bg-gray-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 rounded w-40" />
                  <div className="h-2 bg-gray-200 rounded w-56" />
                </div>
              </div>
            ) : canSwitchBranch ? (
              <div className="mt-4 space-y-2">
                {branches.length > 0 ? (
                  branches.map((branch, index) => (
                    <motion.button
                      key={branch.id}
                      type="button"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      onClick={() => {
                        setSelectedBranch(branch);
                        toast.success(`Switched to ${branch.name}`);
                      }}
                      className={`w-full px-4 py-3 flex items-center space-x-3 rounded-lg border transition-colors text-left ${
                        selectedBranch?.id === branch.id
                          ? 'border-blue-200 bg-blue-50/60'
                          : 'border-gray-100 bg-gray-50/50 hover:bg-blue-50/40 hover:border-blue-100'
                      }`}
                    >
                      <div
                        className={`w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 ${
                          selectedBranch?.id === branch.id
                            ? 'bg-blue-700 text-white'
                            : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        <MapPin className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-semibold truncate ${
                            selectedBranch?.id === branch.id ? 'text-blue-900' : 'text-gray-700'
                          }`}
                        >
                          {branch.name}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{branch.location || 'No location set'}</p>
                      </div>
                      {selectedBranch?.id === branch.id && (
                        <div className="w-5 h-5 bg-blue-700 rounded-full flex items-center justify-center flex-shrink-0">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </motion.button>
                  ))
                ) : (
                  <div className="text-center py-8 rounded-lg border border-dashed border-gray-200 bg-gray-50/60">
                    <MapPin className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No branches found</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 flex items-center gap-3 p-4 rounded-lg border border-gray-100 bg-gray-50/80">
                <div className="w-10 h-10 rounded-md bg-blue-700 flex items-center justify-center text-white flex-shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{selectedBranch?.name || '—'}</p>
                  <p className="text-xs text-gray-500">
                    Only the organization owner can switch branches. Contact them if you need a different branch.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Header with Create Button */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Branch Management</h2>
              <p className="text-sm text-gray-600 mt-1">
                Create and manage your church branches
              </p>
            </div>
            <button
              onClick={() => {
                setEditingBranch(null);
                setShowBranchModal(true);
              }}
              className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center space-x-2"
            >
              <Plus className="w-4 h-4" />
              <span>Create Branch</span>
            </button>
          </div>

          {/* Branches List */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <h3 className="text-sm font-medium text-gray-900">All Branches</h3>
              <p className="text-xs text-gray-500 mt-0.5">Manage all branches in your organization</p>
            </div>
            
            {loadingBranches ? (
              <div className="p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
                <p className="text-sm text-gray-500 mt-3">Loading branches...</p>
              </div>
            ) : dbBranches.length === 0 ? (
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Building2 className="w-8 h-8 text-gray-400" />
                </div>
                <p className="text-gray-600 mb-2">No branches found</p>
                <p className="text-sm text-gray-500 mb-4">Create your first branch to get started</p>
                <button
                  onClick={() => {
                    setEditingBranch(null);
                    setShowBranchModal(true);
                  }}
                  className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors inline-flex items-center space-x-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Create First Branch</span>
                </button>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {dbBranches.map((branch, index) => (
                  <motion.div
                    key={branch.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="p-4 hover:bg-gray-50 transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3 flex-1">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          branch.is_active ? 'bg-gray-900' : 'bg-gray-300'
                        }`}>
                          <Building2 className="w-5 h-5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <h4 className="text-sm font-semibold text-gray-900">{branch.name}</h4>
                            {branch.is_active ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                                <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mr-1"></div>
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                                Inactive
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 ml-4">
                        <button
                          onClick={() => {
                            setEditingBranch(branch);
                            setShowBranchModal(true);
                          }}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                          title="Edit branch"
                        >
                          <Edit2 className="w-4 h-4 text-gray-600" />
                        </button>
                        <button
                          onClick={() => handleDeleteBranch(branch.id, String(branch.name || ''))}
                          className="p-2 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Delete branch"
                        >
                          <Trash2 className="w-4 h-4 text-blue-600" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h5 className="text-xs font-semibold text-blue-900 mb-2 flex items-center">
              <Globe className="w-3.5 h-3.5 mr-1.5" />
              About Branches
            </h5>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>• Each branch has its own members, events, and groups</li>
              <li>• All data is filtered by the active branch you choose above (organization owners only)</li>
              <li>• Inactive branches won&apos;t appear in the active branch list</li>
            </ul>
          </div>
        </div>
      )}

      {/* Assign Leader Modal */}
      {showAssignLeaderModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden"
          >
            {/* Modal Header */}
            <div className="px-6 py-5 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-blue-50">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">Assign Leader</h2>
                  <p className="text-sm text-gray-600 mt-1">Select a member and assign them to ministries</p>
                </div>
                <button
                  onClick={() => {
                    setShowAssignLeaderModal(false);
                    setSelectedMember('');
                    setAssignLeaderRoleType('group_leader');
                    setSelectedMinistries([]);
                  }}
                  className="p-2 hover:bg-white/50 rounded-lg transition-all"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6 overflow-y-auto max-h-[calc(90vh-180px)]">
              {/* Member Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Member <span className="text-blue-600">*</span>
                </label>
                <select
                  value={selectedMember}
                  onChange={(e) => setSelectedMember(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="">Choose a member...</option>
                  {mockMembers.map(member => (
                    <option key={member.id} value={member.id}>
                      {member.name} - {member.email}
                    </option>
                  ))}
                </select>
              </div>

              {/* Selected Member Preview */}
              {selectedMember && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  {(() => {
                    const member = mockMembers.find(m => m.id === selectedMember);
                    return member ? (
                      <div className="flex items-center space-x-3">
                        <img
                          src={member.avatar}
                          alt={member.name}
                          className="w-12 h-12 rounded-xl object-cover"
                        />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{member.name}</p>
                          <p className="text-xs text-gray-500">{member.email}</p>
                        </div>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}

              {/* Role Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Leadership Role <span className="text-blue-600">*</span>
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'pastor', name: 'Pastor', color: 'indigo' },
                    { id: 'group_leader', name: 'Group Leader', color: 'green' },
                    { id: 'volunteer', name: 'Volunteer', color: 'blue' }
                  ].map(role => (
                    <button
                      key={role.id}
                      onClick={() => setAssignLeaderRoleType(role.id)}
                      className={`px-4 py-3 rounded-xl border-2 transition-all text-sm font-medium ${
                        assignLeaderRoleType === role.id
                          ? `border-${role.color}-500 bg-${role.color}-50 text-${role.color}-700`
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      {role.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ministry Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Assign to Ministries <span className="text-blue-600">*</span>
                </label>
                <p className="text-xs text-gray-500 mb-3">Select one or more ministries this leader will manage</p>
                <div className="space-y-1 max-h-64 overflow-y-auto p-1">
                  {availableMinistries.map(ministry => renderMinistryTree(ministry))}
                </div>
                {selectedMinistries.length > 0 && (
                  <p className="text-xs text-gray-600 mt-2">
                    {selectedMinistries.length} {selectedMinistries.length === 1 ? 'ministry' : 'ministries'} selected
                  </p>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end space-x-3">
              <button
                onClick={() => {
                  setShowAssignLeaderModal(false);
                  setSelectedMember('');
                  setAssignLeaderRoleType('group_leader');
                  setSelectedMinistries([]);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white border border-gray-200 rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAssignLeader}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-all flex items-center"
              >
                <Save className="w-4 h-4 mr-2" />
                Assign Leader
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Branch Modal */}
      {showBranchModal && user?.organization_id && (
        <BranchModal
          branch={editingBranch}
          organizationId={user.organization_id}
          onClose={() => {
            setShowBranchModal(false);
            setEditingBranch(null);
          }}
          onSave={handleSaveBranch}
        />
      )}
    </div>
  );
}
