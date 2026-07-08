import { UserRole } from "@prisma/client";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { PasswordService } from "../modules/auth/password.service";
import { PrismaService } from "../modules/prisma/prisma.service";
import { UsersService, normalizeUserEmail } from "../modules/users/users.service";

type BootstrapArguments = {
  email: string;
  displayName: string;
};

/**
 * 解析管理员初始化命令参数。
 *
 * 密码不允许作为命令参数传入，避免出现在 shell 历史和进程参数中；脚本只接收
 * 邮箱和展示名，密码始终通过交互式隐藏输入读取。
 */
function parseArguments(argv: string[]): BootstrapArguments {
  const readValue = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const email = readValue("--email");
  const displayName = readValue("--name") ?? "Mia 管理员";

  if (!email) {
    throw new Error("请提供 --email，例如：--email admin@example.com");
  }

  return {
    email: normalizeUserEmail(email),
    displayName: displayName.trim()
  };
}

/**
 * 读取管理员初始密码。
 *
 * 使用 readline 的标准输入读取，不把密码写入命令行、日志或数据库以外的任何文件；
 * 终端回显无法在所有 shell 环境可靠关闭，因此运行时明确提醒部署人员在可信终端输入。
 */
async function readInitialPassword(): Promise<string> {
  const readline = createInterface({ input, output });

  try {
    return await readline.question("请输入初始管理员密码：");
  } finally {
    readline.close();
  }
}

/**
 * 创建唯一的首位可用管理员。
 *
 * 首位管理员是平台接入权限控制后的恢复入口，因此只允许在没有任何可用 ADMIN 时执行；
 * 防止脚本被误执行后绕过既有管理员的成员管理流程。
 */
async function bootstrapAdmin(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const password = await readInitialPassword();
  const prisma = new PrismaService();
  const usersService = new UsersService(prisma);
  const passwordService = new PasswordService();

  try {
    const activeAdminCount = await prisma.user.count({
      where: {
        role: UserRole.ADMIN,
        disabledAt: null
      }
    });

    if (activeAdminCount > 0) {
      throw new Error("已存在可用管理员，请通过成员管理功能创建或调整账号");
    }

    const user = await usersService.createUser({
      email: args.email,
      displayName: args.displayName,
      passwordHash: await passwordService.hashPassword(password),
      role: UserRole.ADMIN
    });

    console.log(`已创建管理员：${user.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * 执行脚本并输出不包含敏感信息的失败原因。
 *
 * 初始化失败必须以非零状态退出，部署脚本才能阻止服务在没有恢复入口时继续发布。
 */
async function main(): Promise<void> {
  try {
    await bootstrapAdmin();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "初始化管理员失败");
    process.exitCode = 1;
  }
}

void main();
