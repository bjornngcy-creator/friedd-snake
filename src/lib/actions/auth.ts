"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState = {
  error?: string;
};

/** Turns Supabase's raw auth error messages into friendlier copy. */
function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }
  if (lower.includes("already registered") || lower.includes("already exists")) {
    return "That email is already registered. Try logging in instead.";
  }
  if (lower.includes("password should be at least")) {
    return "Password is too short. Use at least 6 characters.";
  }
  if (lower.includes("unable to validate email") || lower.includes("invalid email")) {
    return "That doesn't look like a valid email address.";
  }
  if (lower.includes("rate limit")) {
    return "Too many attempts. Please wait a moment and try again.";
  }

  return message;
}

export async function signUp(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: friendlyAuthError(error.message) };
  }

  redirect("/access-code");
}

export async function signIn(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: friendlyAuthError(error.message) };
  }

  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
