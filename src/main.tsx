import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { BranchProvider } from "@/contexts/BranchContext";
import { AppProvider } from "@/contexts/AppContext";

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <AppProvider>
      <BranchProvider>
        <App />
      </BranchProvider>
    </AppProvider>
  </AuthProvider>
);
