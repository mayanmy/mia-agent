import * as assert from "node:assert/strict";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@prisma/client";

import { JwtAuthGuard } from "../../core/auth/jwt-auth.guard";
import { RolesGuard } from "../../core/auth/roles.guard";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

const testUser = {
  id: "c5c177f3-3f47-4547-b520-dbd0875e5eb8",
  email: "admin@example.com",
  displayName: "Mia 管理员",
  passwordHash: "",
  role: UserRole.ADMIN,
  disabledAt: null
};

export const tests = [
  {
    name: "PasswordService 使用 Argon2id 验证密码并拒绝弱密码",
    run: async () => {
      const passwordService = new PasswordService();
      const passwordHash = await passwordService.hashPassword("MiaPassword2026");

      assert.equal(await passwordService.verifyPassword(passwordHash, "MiaPassword2026"), true);
      assert.equal(await passwordService.verifyPassword(passwordHash, "wrong-password"), false);
      assert.throws(
        () => passwordService.validatePasswordStrength("short1"),
        /密码至少需要 12 位/u
      );
    }
  },

  {
    name: "TokenService 签发并验证短期 Access Token",
    run: () => {
      const tokenService = new TokenService();
      const token = tokenService.signAccessToken({
        sub: testUser.id,
        email: testUser.email,
        role: testUser.role
      });

      const payload = tokenService.verifyAccessToken(token) as {
        sub: string;
        email: string;
        role: UserRole;
        iat: number;
        exp: number;
      };

      assert.equal(payload.sub, testUser.id);
      assert.equal(payload.email, testUser.email);
      assert.equal(payload.role, testUser.role);
      assert.equal(typeof payload.iat, "number");
      assert.equal(typeof payload.exp, "number");
    }
  },

  {
    name: "AuthService 刷新登录态时撤销旧 Refresh Session",
    run: async () => {
      const passwordService = new PasswordService();
      const tokenService = new TokenService();
      const sessions: Array<{
        id: string;
        userId: string;
        refreshTokenHash: string;
        expiresAt: Date;
        revokedAt: Date | null;
      }> = [];
      let sessionSequence = 0;
      testUser.passwordHash = await passwordService.hashPassword("MiaPassword2026");

      type MockSession = (typeof sessions)[number];
      type MockSessionCreateData = Omit<MockSession, "id" | "revokedAt"> & {
        ipAddress?: string | null;
        userAgent?: string | null;
      };
      type MockPrisma = {
        authSession: {
          create: (input: { data: MockSessionCreateData }) => Promise<MockSession>;
          findUnique: (input: {
            where: { refreshTokenHash: string };
          }) => Promise<(MockSession & { user: typeof testUser }) | null>;
          updateMany: (input: {
            where: {
              id?: string;
              refreshTokenHash?: string;
              revokedAt: null;
              expiresAt?: { gt: Date };
            };
            data: { revokedAt: Date };
          }) => Promise<{ count: number }>;
        };
        $transaction: <T>(callback: (transaction: MockPrisma) => Promise<T>) => Promise<T>;
      };
      const prisma: MockPrisma = {
        authSession: {
          create: async ({ data }) => {
            const session = {
              id: `session-${++sessionSequence}`,
              userId: data.userId,
              refreshTokenHash: data.refreshTokenHash,
              expiresAt: data.expiresAt,
              revokedAt: null
            };
            sessions.push(session);
            return session;
          },
          findUnique: async ({ where }) => {
            const session = sessions.find(
              (item) => item.refreshTokenHash === where.refreshTokenHash
            );

            return session ? { ...session, user: testUser } : null;
          },
          updateMany: async ({ where, data }) => {
            const matched = sessions.filter((session) => {
              return (
                (where.id === undefined || session.id === where.id) &&
                (where.refreshTokenHash === undefined ||
                  session.refreshTokenHash === where.refreshTokenHash) &&
                session.revokedAt === where.revokedAt &&
                (where.expiresAt === undefined || session.expiresAt > where.expiresAt.gt)
              );
            });
            matched.forEach((session) => {
              session.revokedAt = data.revokedAt;
            });
            return { count: matched.length };
          }
        },
        $transaction: async <T>(callback: (transaction: MockPrisma) => Promise<T>) => callback(prisma)
      };
      const usersService = {
        findActiveUserByEmail: async () => testUser,
        recordSuccessfulLogin: async () => undefined,
        toCurrentUser: (user: typeof testUser) => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role
        })
      };
      const authService = new AuthService(
        prisma as never,
        usersService as never,
        passwordService,
        tokenService
      );
      const context = { ipAddress: "127.0.0.1", userAgent: "test" };
      const loginResult = await authService.login(
        { email: testUser.email, password: "MiaPassword2026" },
        context
      );
      const refreshedResult = await authService.refresh(loginResult.refreshToken, context);

      assert.equal(sessions.length, 2);
      assert.ok(sessions[0].revokedAt);
      assert.equal(sessions[1].revokedAt, null);
      assert.notEqual(loginResult.refreshToken, refreshedResult.refreshToken);
      await assert.rejects(
        () => authService.refresh(loginResult.refreshToken, context),
        /登录状态已失效/u
      );
    }
  },

  {
    name: "JwtAuthGuard 拒绝缺少 Bearer Token 的内部请求",
    run: async () => {
      const reflector = {
        getAllAndOverride: () => false
      } as unknown as Reflector;
      const guard = new JwtAuthGuard(
        reflector,
        new TokenService(),
        {
          findActiveCurrentUser: async () => ({
            id: testUser.id,
            email: testUser.email,
            displayName: testUser.displayName,
            role: testUser.role
          })
        } as never
      );
      const request = { headers: {} };
      const context = {
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => request })
      };

      await assert.rejects(
        () => guard.canActivate(context as never),
        /未登录或登录状态已失效/u
      );
    }
  },

  {
    name: "RolesGuard 拒绝普通用户访问管理员路由",
    run: () => {
      const reflector = {
        getAllAndOverride: (key: string) => {
          if (key === "mia:isPublic") {
            return false;
          }

          return [UserRole.ADMIN];
        }
      } as unknown as Reflector;
      const guard = new RolesGuard(reflector);
      const context = {
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({
          getRequest: () => ({
            currentUser: {
              id: testUser.id,
              email: testUser.email,
              displayName: testUser.displayName,
              role: UserRole.USER
            }
          })
        })
      };

      assert.throws(() => guard.canActivate(context as never), /没有权限访问此资源/u);
    }
  }
];
