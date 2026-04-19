# Sheepmug Mobile (Expo)

This app reuses the same backend API endpoints used by the web app.

## 1) Install dependencies from repo root

```bash
npm install
```

## 2) Configure mobile API base URL

Copy:

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

Then set:

```env
EXPO_PUBLIC_API_BASE_URL=http://YOUR_LOCAL_IP:3000
```

Use your machine LAN IP for physical device testing (not `localhost`).

## 3) Start backend (existing server)

```bash
npm run dev
```

## 4) Start mobile app

```bash
npm run mobile:start
```

Or direct workspace command:

```bash
npm run start --workspace @sheepmug/mobile
```

## Current MVP screens

- Login
- Dashboard
- Members (list + search)
- Notifications (list, unread count, mark all read, clear all)
- Settings (logout)
