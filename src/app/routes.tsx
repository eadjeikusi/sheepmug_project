import { createBrowserRouter, Navigate } from "react-router";
import Root from "./components/Root";
import MemberRegistration from "./components/pages/MemberRegistration";
import Dashboard from "./components/pages/Dashboard";
import Members from "./components/pages/Members";
import Ministries from "./components/pages/Ministries";
import MinistryDetail from "./components/pages/MinistryDetail";
import Events from "./components/pages/Events";
import EventDetail from "./components/pages/EventDetail";
import Tasks from "./components/pages/Tasks";
import Messages from "./components/pages/Messages";
import Notifications from "./components/pages/Notifications";
import Settings from "./components/pages/Settings";
import ImportantDates from "./components/pages/ImportantDates";
import ProfileSettings from "./components/pages/ProfileSettings";
import SuperAdmin from "./components/pages/SuperAdmin";
import NotFound from "./components/pages/NotFound";
import PublicGroupPage from "./components/pages/PublicGroupPage";
import JoinGroupPage from "./components/pages/JoinGroupPage";
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from "../auth/AuthPages";

const CMS_BASENAME = (() => {
  const configuredRaw = String(import.meta.env.VITE_CMS_BASENAME || "/cms").trim() || "/cms";
  if (configuredRaw === "/") return "/";
  return configuredRaw.startsWith("/") ? configuredRaw : `/${configuredRaw}`;
})();

export const router = createBrowserRouter([
  {
    path: "/login",
    Component: LoginPage,
  },
  {
    path: "/signup",
    Component: SignupPage,
  },
  {
    path: "/forgot-password",
    Component: ForgotPasswordPage,
  },
  {
    path: "/reset-password",
    Component: ResetPasswordPage,
  },
  {
    path: "/public/groups/:slug",
    Component: PublicGroupPage,
  },
  {
    path: "/join-group/:groupId",
    Component: JoinGroupPage,
  },
  {
    path: "/register/member/:code",
    Component: MemberRegistration,
  },
  {
    path: "/",
    Component: Root,
    children: [
      {
        index: true,
        Component: Dashboard,
      },
      {
        path: "members",
        Component: Members,
      },
      {
        path: "groups",
        Component: Ministries,
      },
      {
        path: "groups/:groupId",
        Component: MinistryDetail,
      },
      {
        path: "events",
        Component: Events,
      },
      {
        path: "events/:eventId",
        Component: EventDetail,
      },
      {
        path: "event-types",
        element: <Navigate to="/settings?tab=eventTypes" replace />,
      },
      {
        path: "program-templates",
        element: <Navigate to="/settings?tab=programTemplates" replace />,
      },
      {
        path: "tasks",
        Component: Tasks,
      },
      {
        path: "messages",
        Component: Messages,
      },
      {
        path: "notifications",
        Component: Notifications,
      },
      {
        path: "important-dates",
        Component: ImportantDates,
      },
      {
        path: "member-join-requests",
        element: <Navigate to="/members?tab=requests" replace />,
      },
      {
        path: "settings",
        Component: Settings,
      },
      {
        path: "profile",
        Component: ProfileSettings,
      },
      {
        path: "superadmin",
        Component: SuperAdmin,
      },
      {
        path: "*",
        Component: NotFound,
      },
    ],
  },
], {
  basename: CMS_BASENAME,
});