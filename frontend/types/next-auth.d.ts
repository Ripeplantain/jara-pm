import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    accessToken: string;
    accessTokenExpires: number;
  }
  interface Session {
    user: { id: string; email?: string | null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    accessToken?: string;
    accessTokenExpires?: number;
  }
}
