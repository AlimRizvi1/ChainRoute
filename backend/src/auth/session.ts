import type { FastifyReply } from "fastify";
import { isRole } from "./authorization.js";

export const ACCESS_TOKEN_SECONDS = 15 * 60;

export async function sendSession(reply: FastifyReply, user: { user_id: string; username: string; role: string }, status = 200) {
  if (!isRole(user.role)) throw new Error("Account has an invalid role.");
  const token = await reply.jwtSign({ sub: user.user_id, role: user.role });
  reply.header("cache-control", "no-store");
  return reply.code(status).send({
    token, tokenType: "Bearer", expiresIn: ACCESS_TOKEN_SECONDS,
    user: { id: user.user_id, username: user.username, role: user.role },
  });
}
