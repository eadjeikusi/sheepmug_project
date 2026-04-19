import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/index.css";
import { LandingApp } from "./LandingApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LandingApp />
  </StrictMode>,
);
