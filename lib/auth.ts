import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// httpOnly cookie, not localStorage — see LEARNING.md for why
export const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET is not set");

export interface SessionPayload {
  userId: string;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET!, { algorithm: "HS256", expiresIn: SESSION_MAX_AGE_SECONDS });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    // Pinning algorithms stops a forged token from choosing a weaker one, see LEARNING.md
    const decoded = jwt.verify(token, JWT_SECRET!, { algorithms: ["HS256"] });
    if (typeof decoded !== "object" || typeof decoded.userId !== "string" || !decoded.userId) return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}

// Set by proxy.ts after verifying the JWT, so routes trust it instead of re-verifying
export const USER_ID_HEADER = "x-user-id";

export function requireUserId(req: Request): string {
  const userId = req.headers.get(USER_ID_HEADER);
  if (!userId) throw new Error("Missing x-user-id header — route must run behind proxy.ts");
  return userId;
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};
