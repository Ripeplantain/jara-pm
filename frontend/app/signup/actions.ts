"use server";

import { register } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";

export interface RegisterResult {
  ok: boolean;
  errors?: { email?: string; password?: string; form?: string };
}

/** Runs on the server so the browser never calls the backend directly. */
export async function registerAction(email: string, password: string): Promise<RegisterResult> {
  try {
    await register(email, password);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      return { ok: false, errors: { email: "An account with this email already exists." } };
    }
    if (err instanceof ApiError && err.status === 422) {
      const errors: NonNullable<RegisterResult["errors"]> = {};
      const detail = (err.body as { detail?: { loc?: string[] }[] } | null)?.detail ?? [];
      for (const d of detail) {
        const field = d.loc?.[d.loc.length - 1];
        if (field === "email") errors.email = "Enter a valid email address.";
        if (field === "password") errors.password = "Password must be 8 to 128 characters.";
      }
      return { ok: false, errors: Object.keys(errors).length ? errors : { form: "Invalid input." } };
    }
    return { ok: false, errors: { form: "Could not create the account. Please try again." } };
  }
}
