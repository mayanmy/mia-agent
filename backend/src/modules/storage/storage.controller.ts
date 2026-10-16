import { Controller, Get, Header, Param, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../../core/auth/public.decorator";

import { StorageService } from "./storage.service";

@Controller("files")
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get(":id")
  @Public()
  @Header("Cache-Control", "private, max-age=300")
  async download(
    @Param("id") id: string,
    @Query("expires") expires: string,
    @Query("signature") signature: string,
    @Res() response: Response
  ): Promise<void> {
    const { file, data } = await this.storage.readSignedFile(id, expires, signature);
    response.type(file.mimeType);
    response.setHeader("Content-Length", String(file.size));
    response.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`
    );
    response.send(data);
  }
}
