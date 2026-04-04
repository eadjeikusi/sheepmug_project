import { createBrowserRouter } from "react-router";
import Root from "./components/Root";
import MemberRegistration from "./components/pages/MemberRegistration";
import Dashboard from "./components/pages/Dashboard";
import Members from "./components/pages/Members";
import Ministries from "./components/pages/Ministries";
import MinistryDetail from "./components/pages/MinistryDetail";
import Events from "./components/pages/Events";
import EventTypes from "./components/pages/EventTypes";
import EventOutlineTemplates from "./components/pages/EventOutlineTemplates";
import Families from "./components/pages/Families";
import Messages from "./components/pages/Messages";
import Notifications from "./components/pages/Notifications";
import Settings from "./components/pages/Settings";
import ProfileSettings from "./components/pages/ProfileSettings";
import SuperAdmin from "./components/pages/SuperAdmin";
import NotFound from "./components/pages/NotFound";
import PublicGroupPage from "./components/pages/PublicGroupPage";
import JoinGroupPage from "./components/pages/JoinGroupPage";

export const router = createBrowserRouter([
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
        path: "event-types",
        Component: EventTypes,
      },
      {
        path: "program-templates",
        Component: EventOutlineTemplates,
      },
      {
        path: "families",
        Component: Families,
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
]);