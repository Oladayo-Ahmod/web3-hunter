import Link from "next/link";
import { AuthForm } from "@/features/auth/components/auth-form";

export default function SignUpPage() {
  return (
    <main className="mx-auto max-w-sm space-y-6 px-6 py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Used only to build your Skill Profile and personalized Matches.
        </p>
      </div>
      <AuthForm mode="sign-up" />
      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
