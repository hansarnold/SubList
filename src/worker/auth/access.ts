import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AuthenticatedIdentity } from "../../application/models";
import { ApplicationError } from "../../application/errors";

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

export type AuthenticationEnvironment = {
  ENVIRONMENT: Env["ENVIRONMENT"];
  PUBLIC_ORIGIN: string;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
};

export type AccessAuthDependencies = {
  getRemoteKeySet: (url: string) => JWTVerifyGetKey;
};

const defaultDependencies: AccessAuthDependencies = {
  getRemoteKeySet,
};

export async function authenticateRequest(
  request: Request,
  env: AuthenticationEnvironment,
  dependencies: AccessAuthDependencies = defaultDependencies,
): Promise<AuthenticatedIdentity> {
  if (env.ENVIRONMENT === "local") {
    assertLocalDevelopmentRequest(request, env);
    return {
      provider: "local_development",
      subject: "local-user",
      email: "developer@localhost.invalid",
    };
  }

  assertAccessConfiguration(env);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (token === null || token.length === 0) throw unauthenticated();

  try {
    const issuer = `https://${env.TEAM_DOMAIN}`;
    const keySet = dependencies.getRemoteKeySet(`${issuer}/cdn-cgi/access/certs`);
    const { payload } = await jwtVerify(token, keySet, {
      issuer,
      audience: env.POLICY_AUD,
      requiredClaims: ["exp", "nbf", "iat", "sub", "email", "type"],
    });
    if (payload.type !== "app") throw unauthenticated();
    if (typeof payload.sub !== "string" || payload.sub.length === 0) throw unauthenticated();
    if (typeof payload.email !== "string" || payload.email.trim().length < 4) {
      throw unauthenticated();
    }
    return {
      provider: "cloudflare_access",
      subject: payload.sub,
      email: payload.email,
    };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw unauthenticated();
  }
}

function assertLocalDevelopmentRequest(request: Request, env: AuthenticationEnvironment): void {
  let requestHost: string;
  let configuredHost: string;
  try {
    requestHost = new URL(request.url).hostname;
    configuredHost = new URL(env.PUBLIC_ORIGIN).hostname;
  } catch {
    throw authConfigurationError();
  }

  if (!isLoopbackHost(requestHost) || !isLoopbackHost(configuredHost)) {
    throw authConfigurationError();
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function getRemoteKeySet(url: string): JWTVerifyGetKey {
  const cached = remoteKeySets.get(url);
  if (cached !== undefined) return cached;
  const created = createRemoteJWKSet(new URL(url));
  remoteKeySets.set(url, created);
  return created;
}

function assertAccessConfiguration(env: AuthenticationEnvironment): void {
  const isPlaceholder =
    env.TEAM_DOMAIN === "local.invalid" ||
    env.TEAM_DOMAIN === "example.cloudflareaccess.com" ||
    env.POLICY_AUD === "local-development" ||
    env.POLICY_AUD.startsWith("replace-with-");
  const domainValid = /^[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(env.TEAM_DOMAIN);
  if (isPlaceholder || !domainValid || env.POLICY_AUD.length < 8) {
    throw authConfigurationError();
  }
}

function authConfigurationError(): ApplicationError {
  return new ApplicationError(
    "AUTH_CONFIGURATION_ERROR",
    "Authentication is not configured for this environment.",
    500,
  );
}

function unauthenticated(): ApplicationError {
  return new ApplicationError(
    "UNAUTHENTICATED",
    "Your session is missing or no longer valid.",
    401,
  );
}
