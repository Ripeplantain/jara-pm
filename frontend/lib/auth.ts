import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { login } from "@/lib/api/auth";

/**
 * NextAuth (v4) with a Credentials provider. The backend owns users and passwords;
 * `authorize()` only forwards the credentials to the backend login endpoint.
 * The backend access token lives in the httpOnly session cookie (JWT strategy) and is
 * deliberately NOT copied into the client-visible session.
 */
export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 60 * 60 },
  pages: { signIn: "/signin" },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        try {
          const res = await login(credentials.email, credentials.password);
          return {
            id: String(res.user.id),
            email: res.user.email,
            accessToken: res.access_token,
            accessTokenExpires: Date.now() + res.expires_in * 1000,
          };
        } catch (err) {
          // Generic failure for the user; log only the status, never credentials.
          console.error("login failed", err instanceof Error ? err.message : "unknown");
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.accessToken = user.accessToken;
        token.accessTokenExpires = user.accessTokenExpires;
      }
      return token;
    },
    async session({ session, token }) {
      // No accessToken here: this object is readable by browser code.
      if (session.user) session.user.id = token.userId;
      return session;
    },
  },
};

/** True when the JWT holds a backend token that has not expired yet. */
export function hasLiveBackendToken(token: JWT | null): token is JWT & { accessToken: string } {
  return !!token?.accessToken && (token.accessTokenExpires ?? 0) > Date.now();
}
