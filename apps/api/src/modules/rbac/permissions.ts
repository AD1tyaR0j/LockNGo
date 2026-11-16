import type { Role } from '@sl/shared';

/**
 * Source of truth for permissions. Synced into the roles/permissions tables by
 * `syncRbac()` on every migration run. Routes check permission keys, never role names.
 */
export const PERMISSIONS = {
  'storage:book': 'Create and manage own storage bookings',
  'admin:dashboard:read': 'View network overview metrics',
  'admin:outlets:read': 'View all outlets including drafts',
  'admin:outlets:write': 'Create and edit outlets',
  'admin:inventory:write': 'Create locker banks and compartments',
  'admin:compartments:status': 'Disable / inspect / return compartments to service',
  'admin:devices:read': 'View device registry and health',
  'admin:devices:register': 'Register devices and issue device credentials',
  'admin:bookings:read': 'View any booking and its timeline',
  'admin:audit:read': 'View audit log',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

const SUPPORT: PermissionKey[] = [
  'admin:dashboard:read',
  'admin:outlets:read',
  'admin:devices:read',
  'admin:bookings:read',
];

const ADMIN: PermissionKey[] = [
  ...SUPPORT,
  'admin:outlets:write',
  'admin:inventory:write',
  'admin:compartments:status',
  'admin:devices:register',
  'admin:audit:read',
];

/** Roles not yet active in Milestone 1 intentionally have no permissions. */
export const ROLE_PERMISSIONS: Record<Role, PermissionKey[]> = {
  CUSTOMER: ['storage:book'],
  COURIER: [],
  HOST_PARTNER: [],
  OUTLET_OPERATOR: [],
  MAINTENANCE_TECHNICIAN: [],
  SUPPORT_AGENT: SUPPORT,
  ADMIN,
  SUPER_ADMIN: ADMIN,
};
