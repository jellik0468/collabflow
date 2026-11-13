# CollabFlow — product blueprint

## Audience
Small software teams (3–20 members) managing projects and shared work.

## Navigation
- App shell: persistent workspace switcher, sidebar, top search/notifications/profile.
- Workspace overview: personal tasks, project progress and recent activity using real API data.
- Projects: list and project-specific Board, List and Overview views.
- Task details: URL-addressable right-side drawer (`?task=<id>`), full-screen on narrow screens.
- Members and settings: invitation flow, membership and workspace preferences.

## Visual language
Modern SaaS, not a generic dashboard template: restrained indigo-to-violet accents, neutral surfaces, purposeful cards, clear information hierarchy, responsive spacing, light and dark themes. Avoid decorative charts without meaningful data.

## Core flows
1. Register -> create workspace -> create project -> add tasks -> work in Kanban.
2. Owner invites teammate by expiring link -> teammate accepts -> workspace access granted.
3. Open task drawer -> edit status/assignee/due date -> add comment -> broadcast update to authorized collaborators.

## MVP scope (14-day target)
Authentication, workspace and project management, tasks, Kanban drag-and-drop, real-time updates, owner/member permissions, dashboard, comments, email invitations, in-app notifications, dark mode.

## Security and reliability
Enforce membership and role authorization on the API and Socket.IO rooms; hash passwords; use secure session cookies; expire and hash invitation tokens; validate input; use transactions/version checks for conflicting task changes. No secrets in git.

## Delivery
Feature-named branches and PRs; CI checks; real data in production; a feature is complete only after checks and acceptance criteria pass. The 14-day schedule is a target, not a guarantee.
