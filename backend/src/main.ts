import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";
import { AppExceptionFilter } from "./core/app-exception.filter";
import { getConfig } from "./core/config";
import {
  requestIdMiddleware,
  RequestWithId,
  ResponseWithHeader
} from "./core/request-id.middleware";
import { ResultInterceptor } from "./core/result.interceptor";

async function bootstrap() {
  const config = getConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

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
