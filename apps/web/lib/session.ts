import { headers } from "next/headers";
import { getAuth } from "./auth";

/**
 * Resolves the current request's signed-in User ID from Better Auth's
 * session cookie, server-side — for Server Components and Route Handlers
 * only. Never accept a viewer/user ID as a client-supplied parameter
 * (query string, request body): that would let one User read or act as
 * another. Returns `undefined` when there is no session.
 */
export async function getCurrentUserId(): Promise<string | undefined> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session?.user.id;
}
