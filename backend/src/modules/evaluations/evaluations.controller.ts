import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { UserRole, WorkspaceRole } from "@prisma/client";

import { CurrentUser } from "../../core/auth/current-user.decorator";
import { Roles } from "../../core/auth/roles.decorator";
import { WorkspaceRequired, WorkspaceRoles } from "../../core/auth/workspace.decorator";
import { CurrentUserDto } from "../users/dto/user.dto";
import {
  CreateEvaluationCaseDto,
  CreateEvaluationDatasetDto,
  CreateEvaluationVersionDto,
  EvaluationCaseQueryDto,
  EvaluationDatasetQueryDto,
  FreezeEvaluationVersionDto,
  UpdateEvaluationCaseDto,
  UpdateEvaluationDatasetDto
} from "./dto/evaluation.dto";
import { EvaluationsService } from "./evaluations.service";

@Controller("evaluations")
@Roles(UserRole.ADMIN, UserRole.USER)
@WorkspaceRequired()
@WorkspaceRoles(WorkspaceRole.OWNER, WorkspaceRole.MANAGER)
export class EvaluationsController {
  constructor(private readonly evaluationsService: EvaluationsService) {}

  @Get("datasets")
  listDatasets(@Query() query: EvaluationDatasetQueryDto) {
    return this.evaluationsService.listDatasets(query);
  }

  @Post("datasets")
  createDataset(@Body() payload: CreateEvaluationDatasetDto, @CurrentUser() user: CurrentUserDto) {
    return this.evaluationsService.createDataset(payload, user.id);
  }

  @Get("datasets/:datasetId")
  getDataset(@Param("datasetId") datasetId: string) {
    return this.evaluationsService.getDataset(datasetId);
  }

  @Patch("datasets/:datasetId")
  updateDataset(
    @Param("datasetId") datasetId: string,
    @Body() payload: UpdateEvaluationDatasetDto
  ) {
    return this.evaluationsService.updateDataset(datasetId, payload);
  }

  @Post("datasets/:datasetId/archive")
  archiveDataset(@Param("datasetId") datasetId: string) {
    return this.evaluationsService.setDatasetStatus(datasetId, "ARCHIVED");
  }

  @Post("datasets/:datasetId/restore")
  restoreDataset(@Param("datasetId") datasetId: string) {
    return this.evaluationsService.setDatasetStatus(datasetId, "ACTIVE");
  }

  @Post("datasets/:datasetId/versions")
  createVersion(
    @Param("datasetId") datasetId: string,
    @Body() payload: CreateEvaluationVersionDto,
    @CurrentUser() user: CurrentUserDto
  ) {
    return this.evaluationsService.createVersion(datasetId, payload, user.id);
  }

  @Get("dataset-versions/:versionId")
  getVersion(@Param("versionId") versionId: string) {
    return this.evaluationsService.getVersion(versionId);
  }

  @Get("dataset-versions/:versionId/cases")
  listCases(@Param("versionId") versionId: string, @Query() query: EvaluationCaseQueryDto) {
    return this.evaluationsService.listCases(versionId, query);
  }

  @Post("dataset-versions/:versionId/cases")
  createCase(
    @Param("versionId") versionId: string,
    @Body() payload: CreateEvaluationCaseDto,
    @CurrentUser() user: CurrentUserDto
  ) {
    return this.evaluationsService.createCase(versionId, payload, user.id);
  }

  @Patch("dataset-versions/:versionId/cases/:caseId")
  updateCase(
    @Param("versionId") versionId: string,
    @Param("caseId") caseId: string,
    @Body() payload: UpdateEvaluationCaseDto
  ) {
    return this.evaluationsService.updateCase(versionId, caseId, payload);
  }

  @Delete("dataset-versions/:versionId/cases/:caseId")
  async deleteCase(@Param("versionId") versionId: string, @Param("caseId") caseId: string) {
    await this.evaluationsService.deleteCase(versionId, caseId);
    return null;
  }

  @Post("dataset-versions/:versionId/freeze")
  freezeVersion(
    @Param("versionId") versionId: string,
    @Body() payload: FreezeEvaluationVersionDto
  ) {
    return this.evaluationsService.freezeVersion(versionId, payload);
  }
}
