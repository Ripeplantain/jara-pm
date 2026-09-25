import type { Metadata } from "next";
import { SignOutOnMount } from "@/components/auth/sign-out-on-mount";

export const metadata: Metadata = { title: "Signing out" };

export default function SignOutPage() {
  return (
    <main>
      <SignOutOnMount />
    </main>
  );
}
