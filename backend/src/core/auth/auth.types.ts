import type { Request } from "express";

import type { CurrentUserDto } from "../../modules/users/dto/user.dto";

/** Guard 成功后挂载在 HTTP Request 上的已验证身份。 */
export type AuthenticatedRequest = Request & {
  currentUser?: CurrentUserDto;
};
