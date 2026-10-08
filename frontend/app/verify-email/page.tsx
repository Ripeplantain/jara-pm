import type { Metadata } from "next";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <main className="auth-page"><div className="auth-shell"><section className="auth-form-wrap"><VerifyEmailForm token={token ?? null} /></section></div></main>;
}
