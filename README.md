# ChurchHub Member Registration Project

> Consolidated project docs: `docs/PROJECT_DOCUMENTATION.md`

## Overview
This project implements an online member registration system for ChurchHub, allowing new members to register via a public-facing form. The system integrates with the existing database schema to manage member requests and member records.

## Current Implementation Status
- **Database**: Schema is ready (`members` and `member_requests` tables).
- **Frontend**: `MemberRegistration.tsx` has been updated to include all required fields:
  - Image, First Name, Last Name, Email, Phone Number, Address, Emergency Contact Name, Emergency Contact Phone, Date of Birth, Gender, Marital Status, Occupation, Date Joined.
- **Backend**: Submission logic is partially implemented (image upload), but submission to the `member_requests` table is still a TODO.

## Changes Made
- Updated `MemberRegistration.tsx` state and UI to include all requested fields.
- Split `fullName` into `firstName` and `lastName`.
- Added dropdowns for `gender` and `maritalStatus`.
- Added inputs for `occupation` and `dateJoined`.
- Updated `handleSubmit` to map form data to backend field names.

## Errors Encountered & Fixes
- **UI Rendering Issue**: Fields added to the form were not appearing in the registration modal.
  - *Fix Attempted*: Restructured the layout using `space-y-6` and nested grids to prevent clipping.
  - *Status*: Still under investigation. The fields are correctly defined in the state and JSX, but may be hidden by modal container constraints or CSS conflicts.

## Patterns & Trends
- **Layout Complexity**: The registration form is extensive, making it prone to layout issues when rendered within a modal.
- **State Management**: The form uses a single `useState` object for all fields, which is efficient but requires careful updates.

## Future Development & Migration Guide
### To Continue Development:
1. **Fix UI Rendering**: Investigate the modal container CSS. The form might be too long for the modal's default height. Consider adding `overflow-y-auto` to the modal container.
2. **Implement Backend Submission**: Complete the `handleSubmit` function in `MemberRegistration.tsx` to send the `registrationData` to the `member_requests` table.
3. **Implement Staff Approval Workflow**: Update `Members.tsx` to fetch real data from `member_requests` and implement the logic to approve requests and create records in the `members` table.

### Migration Notes:
- The system relies on `organization_id` and `branch_id` being passed via URL parameters or context. Ensure these are correctly handled when migrating to different environments.
- Database schema changes should be tracked in `DATABASE_SCHEMA.md`.

