import { NestFactory } from "@nestjs/core";

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
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true
  });
  app.use((req: RequestWithId, res: ResponseWithHeader, next: () => void) => {
    requestIdMiddleware(req, res, next);
  });
  app.setGlobalPrefix(config.apiPrefix.replace(/^\//u, ""));
  app.useGlobalFilters(new AppExceptionFilter());
  app.useGlobalInterceptors(new ResultInterceptor());

  await app.listen(config.port);
}

void bootstrap();
