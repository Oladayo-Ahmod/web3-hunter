import Link from "next/link";
import { AuthForm } from "@/features/auth/components/auth-form";

export default function SignInPage() {
  return (
    <main className="mx-auto max-w-sm space-y-6 px-6 py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      </div>
      <AuthForm mode="sign-in" />
      <p className="text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/sign-up" className="text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </main>
  );
}
