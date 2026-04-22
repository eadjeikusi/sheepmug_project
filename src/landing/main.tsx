import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import "../styles/index.css";
import { LandingApp } from "./LandingApp";
import { AuthProvider } from "../app/contexts/AuthContext";
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from "../auth/AuthPages";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingApp />} />
          <Route path="/login" element={<Navigate to="/cms/login" replace />} />
          <Route path="/signup" element={<Navigate to="/cms/signup" replace />} />
          <Route path="/forgot-password" element={<Navigate to="/cms/forgot-password" replace />} />
          <Route path="/reset-password" element={<Navigate to="/cms/reset-password" replace />} />
          <Route path="/cms/login" element={<LoginPage />} />
          <Route path="/cms/signup" element={<SignupPage />} />
          <Route path="/cms/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/cms/reset-password" element={<ResetPasswordPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Analytics />
    </AuthProvider>
  </StrictMode>,
);
