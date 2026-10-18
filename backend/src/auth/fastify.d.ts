import type { Permission, Role } from "./authorization.js";

export type AuthenticatedActor = {
  userId: string;
  username: string;
  role: Role;
  chainAddress: string | null;
};

declare module "fastify" {
  interface FastifyRequest {
    actor: AuthenticatedActor | null;
  }

  interface FastifyContextConfig {
    public?: boolean;
    permission?: Permission;
    auditAction?: string;
    auditResourceType?: string;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: Role };
    user: { sub: string; role: Role; iat: number; exp: number; iss: string; aud: string };
  }
}
