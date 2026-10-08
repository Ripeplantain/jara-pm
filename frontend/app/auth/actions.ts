"use server";

import { backendFetch } from "@/lib/api/client";
import type { User } from "@/lib/types/auth";

export async function verifyEmail(token: string): Promise<User> {
  return backendFetch<User>("/api/auth/verify-email", { body: { token } });
}

export async function resendVerification(email: string): Promise<void> {
  await backendFetch<void>("/api/auth/verification-email", { body: { email } });
}

export async function requestPasswordReset(email: string): Promise<void> {
  await backendFetch<void>("/api/auth/password-reset/request", { body: { email } });
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await backendFetch<void>("/api/auth/password-reset/confirm", {
    body: { token, new_password: newPassword },
  });
}
