import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Request, Response } from "express";

import { AppModule } from "./app.module";
import { AppExceptionFilter } from "./core/app-exception.filter";
import { getConfig } from "./core/config";
import {
  requestIdMiddleware,
  RequestWithId,
  ResponseWithHeader
} from "./core/request-id.middleware";
import { ResultInterceptor } from "./core/result.interceptor";

/**
 * 公共 Widget 的预检请求不携带 agentToken，无法在 OPTIONS 阶段查询 Agent 白名单。
 * 因此这里只让浏览器通过公共路由预检；真正请求仍由 PublicAccessService 按
 * publicAllowedOrigins 校验，管理端等其他 API 继续使用全局 CORS 白名单。
 */
function publicWidgetCorsMiddleware(
  req: Request,
  res: Response,
  next: () => void
): void {
  const apiPrefix = getConfig().apiPrefix.replace(/\/+$/u, "");
  const pathname = req.url?.split("?", 1)[0] ?? "";
  const origin = req.headers.origin;
  const requestOrigin = Array.isArray(origin) ? origin[0] : origin;

  if (!pathname.startsWith(`${apiPrefix}/public/`) || !requestOrigin) {
    next();
    return;
  }

  res.setHeader("Access-Control-Allow-Origin", requestOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    Array.isArray(req.headers["access-control-request-headers"])
      ? req.headers["access-control-request-headers"].join(",")
      : (req.headers["access-control-request-headers"] ?? "Content-Type")
  );

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  next();
}

async function bootstrap() {
  const config = getConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(publicWidgetCorsMiddleware);
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true
  });
  // Chat 图片上传会把图片转为 data URL 放进 JSON body。
  // 默认 body-parser 限制过小会在进入 controller 前抛错，导致前端只看到 internal server error。
  app.useBodyParser("json", { limit: "32mb" });
  app.useBodyParser("urlencoded", { extended: true, limit: "32mb" });
  app.use((req: RequestWithId, res: ResponseWithHeader, next: () => void) => {
    requestIdMiddleware(req, res, next);
  });
  app.setGlobalPrefix(config.apiPrefix.replace(/^\//u, ""));
  app.useGlobalFilters(new AppExceptionFilter());
  app.useGlobalInterceptors(new ResultInterceptor());

  await app.listen(config.port);
}

void bootstrap();
