import { Controller, Get } from "@nestjs/common";

import { HealthService, HealthResponse } from "./health.service";
import { Public } from "../../core/auth/public.decorator";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  async getHealth(): Promise<HealthResponse> {
    return this.healthService.getHealth();
  }
}
