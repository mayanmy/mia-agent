import { SetMetadata } from "@nestjs/common";

/** 标记不需要内部工作台登录态的路由，例如登录、健康检查和公开分享信息。 */
export const IS_PUBLIC_KEY = "mia:isPublic";
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);
