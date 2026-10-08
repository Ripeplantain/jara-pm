import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return <main className="auth-page"><div className="auth-shell"><section className="auth-form-wrap"><ForgotPasswordForm /></section></div></main>;
}
