import { backendFetch } from "@/lib/api/client";
import type { TokenResponse, User } from "@/lib/types/auth";

export const login = (email: string, password: string) =>
  backendFetch<TokenResponse>("/api/auth/login", { body: { email, password } });

export const register = (email: string, password: string) =>
  backendFetch<User>("/api/auth/register", { body: { email, password } });

export const getMe = (token: string) => backendFetch<User>("/api/me", { token });
